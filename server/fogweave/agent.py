"""The thinking agent: a small Tree of Thoughts over the reader's items.

Instead of one answer in one go, the agent
  1. branches: proposes a few different explanations (thoughts);
  2. gathers: where it helps, searches the news for evidence (a real tool call);
  3. judges: each thought must show itself with quotes from the items;
  4. prunes: code drops what it cannot show, a skeptic attacks what is left (real
     quotes do not make a good argument), and code ranks the rest;
  5. deepens: the best thoughts get one sharper round, judged the same way.

The model proposes; code decides. A thought survives only with verbatim quotes
from the items, the right items, and dates in the right order, exactly as for
every other link in FogWeave. What survives is Inferred, never Reported: it comes
from reading items together, not from a source that says it.

Every step is streamed, so the reader can watch the tree grow, including what was
dropped and why. Thoughts are short public statements, not hidden reasoning. A hard
budget caps the model calls for one question (the free quota is shared), and when
the quota runs out the agent stops and keeps what it has already shown.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import AsyncIterator, Literal

from pydantic import BaseModel, Field

from .llm import QuotaExhausted
from .patterns import KINDS as PATTERN_KINDS
from .related import _day, verify_parts
from .safety import UNTRUSTED_RULES, check_request, wrap_untrusted

BRANCH = 3  # thoughts in the first round
KEEP = 2  # thoughts that go one level deeper
CHILDREN = 2  # sharper versions of each
MAX_CALLS = 6  # model calls for one question, searches included
MAX_SEARCHES = 1
SEARCH_SECONDS = 20  # the reader is watching: a slow search is skipped
MAX_RESULTS = 3
WHY_KINDS = ("background", "precedent", "trigger")
CONFIDENCE_SCORE = {"high": 2, "medium": 1, "low": 0}


class Idea(BaseModel):
    kind: str = Field(description="the kind of thought, from the list given")
    text: str = Field(description="the thought in one short plain sentence, 16 words or fewer")
    search: str = Field(description="a few words to search the news for evidence, or empty if not needed")


class Ideas(BaseModel):
    items: list[Idea]


class Quote(BaseModel):
    id: str = Field(description="the item id, as given (S, E1, I1 ...)")
    quote: str = Field(description="ONE continuous exact span from that item's text, 20 words or fewer, no '...'")


class Verdict(BaseModel):
    thought: str = Field(description="the thought id, as given (T1, T2 ...)")
    kind: str
    text: str = Field(description="what the items show, in one or two plain sentences")
    quotes: list[Quote] = Field(description="one quote from each item that shows it")
    confidence: Literal["low", "medium", "high"]


class Verdicts(BaseModel):
    items: list[Verdict]


class Doubt(BaseModel):
    thought: str = Field(description="the thought id, as given")
    holds: bool = Field(description="true only if the quoted items really show this, not just share a name or topic")
    why: str = Field(description="if it does not hold, why, in 10 words or fewer")


class Doubts(BaseModel):
    items: list[Doubt]


class NextStep(BaseModel):
    id: str = Field(description="the node id, as given")
    question: str = Field(description="the question this node could answer, 12 words or fewer")


class NextSteps(BaseModel):
    items: list[NextStep]


@dataclass
class Task:
    """What the tree is working on: the items, the kinds of thought, and the rule that decides."""

    name: str
    goal: str
    kinds: tuple[str, ...]
    by_sid: dict[str, dict]
    can_search: bool = False
    quote_rule: str = "One quote from each item that shows it, from two or more items."

    def listing(self) -> str:
        return "\n\n".join(f"[{sid}] ({it.get('type') or 'item'}{', ' + it['date'][:10] if it.get('date') else ''}) {it['label']}. {it.get('text', '')}" for sid, it in self.by_sid.items())

    def shown_quotes(self, v: Verdict) -> list[dict]:
        out, seen = [], set()
        for q in v.quotes:
            it = self.by_sid.get(q.id.strip().strip("[]"))
            if not it or it["id"] in seen:
                continue
            ok = verify_parts(q.quote, f"{it['label']}. {it.get('text', '')}")
            if ok:
                out.append({"id": it["id"], "quote": ok, "date": it.get("date", "")})
                seen.add(it["id"])
        return out

    def unshown_name(self, text: str, quotes: list[dict]) -> str:
        """A name in the statement that none of its quoted items mention (blame needs a source)."""
        shown = " ".join(f"{it['label']} {it.get('text', '')}" for it in self.by_sid.values() if it["id"] in {q["id"] for q in quotes}).lower()
        sentences = re.split(r"(?<=[.!?])\s+", text)
        for sentence in sentences:
            names = re.findall(r"(?<!^)(?<![.!?] )\b[A-Z][\w'-]+(?:\s+(?:of\s+)?[A-Z][\w'-]+)+|\b[A-Z]{2,}\b", sentence)  # a name, or an abbreviation like RSF
            for name in names:
                if name.lower() not in shown:
                    return name
        return ""

    def check(self, v: Verdict) -> tuple[dict | None, str]:
        """Keep a thought only when code can show it. Returns (result, why it was dropped)."""
        raise NotImplementedError


class PatternTask(Task):
    def check(self, v: Verdict) -> tuple[dict | None, str]:
        if v.kind not in self.kinds:
            return None, "not a kind of pattern"
        if v.confidence == "low":
            return None, "too unsure"
        quotes = self.shown_quotes(v)
        if len(quotes) < 2:
            return None, "no quote found in two items"
        if v.kind == "sequence":
            days = [_day(q["date"]) for q in quotes]
            if any(d is None for d in days):
                return None, "an item has no date"
            quotes.sort(key=lambda q: _day(q["date"]))
        name = self.unshown_name(v.text, quotes)
        if name:
            return None, f"names {name}, which its items do not"
        return {"kind": v.kind, "text": v.text.strip(), "label": "inferred", "items": [q["id"] for q in quotes], "quotes": quotes}, ""


class WhyTask(Task):
    def check(self, v: Verdict) -> tuple[dict | None, str]:
        if v.kind not in self.kinds:
            return None, "not a kind of explanation"
        if v.confidence == "low":
            return None, "too unsure"
        story = self.by_sid["S"]
        quotes = self.shown_quotes(v)
        others = [q for q in quotes if q["id"] != story["id"]]
        if not others:
            return None, "no quote from another item"
        if not any(q["id"] == story["id"] for q in quotes):
            return None, "no quote from the story"
        day = _day(story.get("date") or "")
        for q in others:
            d = _day(q["date"])
            if d is None:
                return None, "the evidence has no date"
            if day is not None and d > day:
                return None, "the evidence is later than the story"
        name = self.unshown_name(v.text, quotes)
        if name:
            return None, f"names {name}, which its items do not"
        return {"kind": v.kind, "text": v.text.strip(), "label": "inferred", "items": [q["id"] for q in quotes], "quotes": quotes}, ""


def _score(result: dict, confidence: str) -> int:
    """Code's ranking: more items shown, with quotes, and how sure the judge was."""
    return 2 * len(result["quotes"]) + CONFIDENCE_SCORE.get(confidence, 0)


async def tree_of_thoughts(llm, task: Task, search=None) -> AsyncIterator[dict]:
    """Yields thought, tool and status events, then one result and one done."""
    calls = {"n": 0}
    dropped: list[dict] = []
    stopped = ""

    def spend() -> bool:
        if calls["n"] >= MAX_CALLS:
            return False
        calls["n"] += 1
        return True

    kinds = ", ".join(task.kinds)
    # 1. branch
    yield {"type": "status", "text": "Thinking of different explanations"}
    ideas: list[Idea] = []
    try:
        spend()
        out = await llm.json(
            role="agent_propose",
            system=(
                f"{task.goal} Propose at most {BRANCH} DIFFERENT explanations worth checking, as short thoughts. Kinds: {kinds}. "
                "They must differ from each other. Do not invent facts or predict. Always give your best candidates, even if unsure: each is checked next, and the weak ones are dropped. "
                + ("If earlier news you cannot see here would help, give one to three words to search for, built on a specific name. " if task.can_search else "Leave search empty. ")
                + UNTRUSTED_RULES
            ),
            user="ITEMS:\n" + wrap_untrusted(task.listing(), 6000),
            schema=Ideas,
            max_tokens=500,
        )
        ideas = out.items[:BRANCH]
    except QuotaExhausted:
        stopped = "Free model quota is spent for now."
    except Exception:  # noqa: BLE001 (a bad answer must not break the card)
        stopped = "The agent gave no usable answer."

    thoughts = []
    for i, idea in enumerate(ideas):
        t = {"id": f"T{i + 1}", "parent": None, "depth": 1, "kind": idea.kind, "text": idea.text.strip(), "search": idea.search.strip()}
        thoughts.append(t)
        yield {"type": "thought", "state": "open", **{k: t[k] for k in ("id", "parent", "depth", "kind", "text")}}

    # 2. gather
    if search and task.can_search and thoughts:
        # the story's main name first: the older news that explains a story is found by who is in it
        queries = list(dict.fromkeys([q for q in [main_name(task.by_sid["S"]["label"])] if q] + [t["search"] for t in thoughts if t["search"]]))[:MAX_SEARCHES]
        for query in queries:
            if check_request(query) or not spend():
                continue
            yield {"type": "tool", "name": "search", "query": query, "state": "running"}
            found = []
            try:
                found = await asyncio.wait_for(search(query), SEARCH_SECONDS)
            except Exception:  # noqa: BLE001 (no search result is not a failure of the thought)
                found = []
            known = {it["id"] for it in task.by_sid.values()}
            added = 0
            for it in found:
                if it["id"] in known or len(task.by_sid) >= 14:
                    continue
                known.add(it["id"])
                task.by_sid[f"E{len(task.by_sid)}"] = it
                added += 1
            yield {"type": "tool", "name": "search", "query": query, "state": "done", "found": added}

    # 3. judge, 4. prune
    kept: list[dict] = []

    def judge_verdict(t: dict, v: Verdict) -> dict:
        result, why = task.check(v)
        if result is None:
            dropped.append({"thought": t["id"], "why": why})
            return {"type": "thought", "id": t["id"], "state": "dropped", "why": why}
        t["result"], t["score"] = result, _score(result, v.confidence)
        kept.append(t)
        return {"type": "thought", "id": t["id"], "state": "kept", "score": t["score"], "text": result["text"]}

    if thoughts and spend():
        yield {"type": "status", "text": "Checking each one against the items"}
        verdicts = {}
        try:
            out = await llm.json(
                role="agent_judge",
                system=(
                    f"{task.goal} For each thought, say what the items actually show. {task.quote_rule} "
                    "Each quote is ONE continuous exact span copied from that item's text (20 words or fewer, no '...'). "
                    "If the items do not show it, say so with confidence low. Kinds: " + kinds + ". " + UNTRUSTED_RULES
                ),
                user="THOUGHTS:\n" + "\n".join(f"{t['id']} ({t['kind']}): {t['text']}" for t in thoughts) + "\n\nITEMS:\n" + wrap_untrusted(task.listing(), 7000),
                schema=Verdicts,
                max_tokens=1200,
            )
            verdicts = {v.thought.strip(): v for v in out.items}
        except QuotaExhausted:
            stopped = "Free model quota ran out while checking."
        except Exception:  # noqa: BLE001
            stopped = "The agent gave no usable answer while checking."
        for t in thoughts:
            v = verdicts.get(t["id"])
            if v is None:
                why = "not checked" if stopped else "the items do not show it"
                dropped.append({"thought": t["id"], "why": why})
                yield {"type": "thought", "id": t["id"], "state": "dropped", "why": why}
                continue
            yield judge_verdict(t, v)

    # the skeptic: code has checked that the quotes are real, not that the argument is good
    if kept and not stopped and spend():
        yield {"type": "status", "text": "A skeptic looks for what is weak"}
        try:
            out = await llm.json(
                role="agent_skeptic",
                system=(
                    "You are a strict skeptic. For each statement, decide whether the quoted items really show it. The date after each quote is the item's real date, so timing is known. It does NOT hold if the items only share a name, "
                    "an institution, a place or a broad topic; if it claims a cause, motive, coordination or trend that the quotes do not state; if it compares unrelated things; "
                    "or if it says more than the quotes do. A precedent is different: it holds if the quotes show the same kind of event with the same actor or place earlier, and it needs no cause. Most statements that stretch should fail. " + UNTRUSTED_RULES
                ),
                user="STATEMENTS:\n" + "\n".join(f"{t['id']} ({t['kind']}): {t['result']['text']}\n" + "\n".join(f"   \u201c{q['quote']}\u201d ({known_label(task, q['id'])}; {str(q.get('date') or 'no date')[:10]})" for q in t["result"]["quotes"]) for t in kept),
                schema=Doubts,
                max_tokens=500,
            )
            doubts = {d.thought.strip(): d for d in out.items}
            for t in list(kept):
                d = doubts.get(t["id"])
                if d is not None and not d.holds:
                    why = f"a second look: {d.why.strip()}"[:90]
                    kept.remove(t)
                    dropped.append({"thought": t["id"], "why": why})
                    yield {"type": "thought", "id": t["id"], "state": "dropped", "why": why}
        except QuotaExhausted:
            stopped = "Free model quota ran out before the second look."
        except Exception:  # noqa: BLE001 (no second look: what passed the checks stays)
            pass

    # 5. deepen the best
    best = sorted(kept, key=lambda t: -t["score"])[:KEEP]
    for t in best:
        if stopped or not spend():
            stopped = stopped or "Reached this question's budget."
            break
        yield {"type": "status", "text": "Going deeper on the strongest idea"}
        try:
            out = await llm.json(
                role="agent_deepen",
                system=(
                    f"{task.goal} Here is a thought the items support. Give at most {CHILDREN} sharper versions: more specific about who, what or when, "
                    "or the part the items show most clearly. Use only what the items say. {task.quote_rule} Each quote is ONE continuous exact span "
                    "copied from that item's text (20 words or fewer, no '...'). Kinds: " + kinds + ". " + UNTRUSTED_RULES
                ),
                user=f"THOUGHT ({t['id']}, {t['kind']}): {t['result']['text']}\n\nITEMS:\n" + wrap_untrusted(task.listing(), 7000),
                schema=Verdicts,
                max_tokens=800,
            )
        except QuotaExhausted:
            stopped = "Free model quota ran out while going deeper."
            break
        except Exception:  # noqa: BLE001
            continue
        for j, v in enumerate(out.items[:CHILDREN]):
            child = {"id": f"{t['id']}{'ab'[j]}", "parent": t["id"], "depth": 2, "kind": v.kind, "text": v.text.strip()}
            yield {"type": "thought", "state": "open", **child}
            yield judge_verdict(child, v)

    # the best of each branch: a sharper child only replaces its parent if it is at least as strong
    branch_best: dict[str, dict] = {}
    for t in kept:
        root = t["parent"] or t["id"]
        cur = branch_best.get(root)
        if cur is None or t["score"] > cur["score"] or (t["score"] == cur["score"] and t["depth"] > cur["depth"]):
            branch_best[root] = t
    chosen = sorted(branch_best.values(), key=lambda t: -t["score"])[:MAX_RESULTS]
    for t in chosen:
        yield {"type": "thought", "id": t["id"], "state": "chosen"}
    known_ids = {it["id"]: it for it in task.by_sid.values()}
    used = {i for t in chosen for i in t["result"]["items"]}
    yield {
        "type": "result",
        "results": [t["result"] for t in chosen],
        "items": {i: {k: known_ids[i].get(k) for k in ("id", "label", "date", "url", "source", "kind", "star") if known_ids[i].get(k)} for i in used if i in known_ids},
        "dropped": dropped,
        "calls": calls["n"],
        "note": stopped,
    }
    yield {"type": "done", "stats": {"calls": calls["n"], "thoughts": len(thoughts) + sum(1 for t in kept if t["depth"] == 2), "dropped": len(dropped), "chosen": len(chosen), "stopped": stopped}}


def main_name(headline: str) -> str:
    """The longest run of capitalised words in a headline, not counting the first word alone."""
    names = re.findall(r"[A-Z][\w'-]+(?:\s+(?:of\s+|the\s+)?[A-Z][\w'-]+)*", headline)
    first = headline.split(" ", 1)[0]
    names = [re.sub(r"^(The|A|An|In)\s+", "", n) for n in names if n != first]
    return max(names, key=len, default="")[:60]


def known_label(task: Task, item_id: str) -> str:
    for it in task.by_sid.values():
        if it["id"] == item_id:
            return it["label"][:80]
    return ""


def patterns_task(items: list[dict]) -> PatternTask:
    by_sid = {f"I{n + 1}": it for n, it in enumerate(items)}
    return PatternTask(
        name="patterns",
        goal="You find patterns across the ITEMS a reader saved: same_actor (the same person, organisation or place acts in several items), recurring (the same kind of event happens again), sequence (one item's event follows another's), contrast (items disagree or show opposite trends), common_theme (a shared underlying issue). A pattern spans two or more items, about the same subject: never contrast or link things just because they happened at the same time, and an actor named in two unrelated stories is not a pattern unless its role connects them.",
        kinds=PATTERN_KINDS,
        by_sid=by_sid,
    )


def why_task(story: dict, related: list[dict]) -> WhyTask:
    by_sid = {"S": story}
    for n, it in enumerate(related):
        by_sid[f"E{n + 1}"] = it
    return WhyTask(
        name="why",
        goal="You explain why the news in the STORY (item S) happened, from other items: background (a situation that led to it), precedent (the same kind of event with the same actor or place before: it says only that this has happened before, not that it caused this), trigger (an earlier event that set it off). Use only earlier items, and say what they show, not more. An explanation must quote the story (S) and an earlier item, and the earlier event must really bear on this story: sharing an institution, a place or a topic is not enough. Never predict. A cause is a reasoned reading, not a fact.",
        kinds=WHY_KINDS,
        by_sid=by_sid,
        can_search=True,
        quote_rule="Always give two quotes: one from the story (S) and one from an earlier item that shows the explanation.",
    )


async def next_steps(llm, story: dict, nodes: list[dict]) -> list[dict]:
    """Which nodes in the web are most worth opening next, and what each could answer."""
    if not nodes:
        return []
    by_id = {n["id"]: n for n in nodes}
    listing = "\n".join(f"{n['id']} ({n.get('type', 'node')}): {n['label']}" for n in nodes)
    try:
        out = await llm.json(
            role="agent_next",
            system="A reader is exploring a news story. From the NODES in its web, choose at most 3 that would most help them understand it, each with the question it could answer. Use the node ids exactly as given. " + UNTRUSTED_RULES,
            user=f"STORY: {story['label']}\n\nNODES:\n" + wrap_untrusted(listing, 2500),
            schema=NextSteps,
            max_tokens=300,
        )
    except Exception:  # noqa: BLE001 (a suggestion is an extra)
        return []
    seen, kept = set(), []
    for s in out.items:
        if s.id in by_id and s.id not in seen:
            seen.add(s.id)
            kept.append({"id": s.id, "label": by_id[s.id]["label"], "question": s.question.strip()})
    return kept[:3]
