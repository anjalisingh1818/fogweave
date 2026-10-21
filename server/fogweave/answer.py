"""Answerer (GraphRAG): answer a question from the reader's web plus a small
fresh search, in 2-5 sentences, every sentence citing retrieved facts.

Code, not the model, decides what counts:
- citations to fact ids that were not retrieved are dropped;
- a sentence left without citations is marked as a guess ("unsupported");
- with no supported sentence the answer is "The web doesn't tell us."
The question passes the safety check first; fetched text is untrusted data.
"""

from __future__ import annotations

import asyncio
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

from .embed import embed
from .safety import UNTRUSTED_RULES, check_request, wrap_untrusted

NO_ANSWER = "The web doesn't tell us."


class ASentence(BaseModel):
    text: str
    cites: list[str] = Field(description="fact ids like F3 that state what this sentence says")
    kind: Literal["supported", "guess"] = Field(description="supported only if the cited facts state it")


class AnswerOut(BaseModel):
    sentences: list[ASentence]
    answerable: bool = Field(description="false if the facts do not answer the question")


def facts_from_graph(graph: dict) -> list[dict]:
    """Turn the client's compact web into citable facts (speculative links excluded)."""
    nodes = {n["id"]: n for n in graph.get("nodes", []) if isinstance(n, dict) and n.get("id")}
    facts = []
    for n in nodes.values():
        if n.get("type") == "Claim" and n.get("label"):
            ev = n.get("evidence") or {}
            facts.append({
                "text": f"Claim ({n.get('verdict', 'unverified')}, {ev.get('independentDomains', 1)} independent domain(s)): {n['label']}",
                "quote": n.get("quote", ""), "ref": {"node": n["id"]}, "source": n.get("url", ""),
            })
        elif n.get("type") == "NewsItem":
            facts.append({"text": f"News item from {n.get('outlet', '')} dated {str(n.get('date', ''))[:10]}: {n.get('label', '')}", "quote": "", "ref": {"node": n["id"]}, "source": n.get("url", "")})
    for e in graph.get("edges", []):
        if not isinstance(e, dict) or e.get("label") == "speculative" or e.get("type") in ("mentions", "reports"):
            continue
        a, b = nodes.get(e.get("from"), {}), nodes.get(e.get("to"), {})
        if not a or not b or b.get("type") == "ContextNode" or a.get("type") == "ContextNode":
            continue  # private context is never used as evidence
        rel = str(e.get("type", "")).replace("_", " ")
        ev = (e.get("evidence") or [{}])[0]
        why = f" (inferred: {e.get('reasoning')})" if e.get("label") == "inferred" else ""
        facts.append({
            "text": f"{a.get('label')} {rel} {b.get('label')}{why}",
            "quote": ev.get("quote", ""), "ref": {"edge": e.get("id")}, "source": ev.get("url", ""), "label": e.get("label"),
        })
    return facts


async def fresh_facts(router, question: str) -> list[dict]:
    out = []
    jobs = []
    if "wikipedia" in router.adapters:
        jobs.append(router._safe("wikipedia-search", router.adapters["wikipedia"].search(question[:100], limit=2)))
    if "gdelt" in router.adapters:
        jobs.append(router._safe("gdelt-search", router.adapters["gdelt"].search(question[:100], limit=3)))
    for batch in await asyncio.gather(*jobs):
        for r in batch:
            out.append({"text": f"{r.title}. {r.snippet}".strip()[:500], "quote": "", "ref": {"url": r.url}, "source": r.url})
    wiki = router.adapters.get("wikipedia")
    wiki_facts = [f for f in out if "wikipedia.org/wiki/" in f["source"]]
    if wiki and wiki_facts:
        try:
            leads = await wiki.intros([f["source"].rsplit("/", 1)[-1].replace("_", " ") for f in wiki_facts])
        except Exception:  # noqa: BLE001
            leads = {}
        for f in wiki_facts:
            title = f["source"].rsplit("/", 1)[-1].replace("_", " ")
            if leads.get(title):
                f["text"] = f"{title}: {leads[title][:600]}"
    return out


def rank(question: str, facts: list[dict], k: int = 14) -> list[dict]:
    if len(facts) <= k:
        return facts
    vecs = embed([question] + [f["text"] for f in facts])
    sims = vecs[1:] @ vecs[0]
    order = np.argsort(-sims)[:k]
    return [facts[i] for i in sorted(order)]


async def answer(llm, router, question: str, graph: dict, fresh: bool = True) -> dict:
    refusal = check_request(question)
    if refusal:
        return {"refused": True, "text": refusal, "sentences": [], "citations": {}}
    facts = facts_from_graph(graph)
    if fresh:
        facts += await fresh_facts(router, question)
    facts = rank(question, facts)
    if not facts:
        return {"refused": False, "text": NO_ANSWER, "sentences": [], "citations": {}, "answerable": False}
    for i, f in enumerate(facts):
        f["id"] = f"F{i + 1}"
    body = "\n".join(f"{f['id']}: {f['text']}" + (f" | quote: \"{f['quote']}\"" if f["quote"] else "") for f in facts)
    out = await llm.json(
        role="answerer",
        system=(
            "You answer a reader's question about news using ONLY the numbered facts. "
            "Write 2-5 short sentences. Every sentence must cite the fact ids that state it. "
            "If the facts do not answer the question, set answerable to false and say so in one sentence. "
            "Mark a sentence 'guess' if it goes beyond what the cited facts state. "
            "Possible effects are not predictions; never give financial, medical or legal advice. " + UNTRUSTED_RULES
        ),
        user=f"Question: {question}\n\nFacts:\n" + wrap_untrusted(body, 8000),
        schema=AnswerOut,
        max_tokens=900,
    )
    known = {f["id"]: f for f in facts}
    sentences = []
    for s in out.sentences[:5]:
        cites = [c for c in s.cites if c in known]
        kind = s.kind if cites else "guess"
        sentences.append({"text": s.text, "cites": cites, "kind": kind})
    supported = [s for s in sentences if s["kind"] == "supported"]
    if not out.answerable or not supported:
        return {
            "refused": False,
            "answerable": False,
            "text": NO_ANSWER,
            "sentences": [s for s in sentences if s["kind"] == "supported"],
            "citations": {},
        }
    used = sorted({c for s in sentences for c in s["cites"]}, key=lambda x: int(x[1:]))
    citations = {c: {"text": known[c]["text"][:240], "quote": known[c]["quote"], "source": known[c]["source"], **known[c]["ref"]} for c in used}
    return {"refused": False, "answerable": True, "text": " ".join(s["text"] for s in sentences), "sentences": sentences, "citations": citations}
