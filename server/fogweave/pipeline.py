"""News ingest + impact engine.

lights()  -> news lights from the source router (deduped, story-clustered,
             summarised in our own words when quota allows)
read(id)  -> reader-card details: key claims with verified verbatim quotes
expand(id)-> async stream of graph events for one item:
             status / node / edge / verified / note / done

Every statement carries provenance (source, url, quote, date, retrieval
time, extractor version) and a label: reported / inferred / speculative.
Everything is validated against the V2 ontology before it is emitted.
"""

from __future__ import annotations

import asyncio
import re
import time
import unicodedata
from datetime import datetime, timezone

from . import ontology
from .cache import DiskCache
from .config import MAX_ARTICLE_CHARS, MAX_CLAIMS_TO_VERIFY
from .embed import embed, near_duplicates
from .embed import stories as story_clusters
from .evidence import classify_source, registered_domain, strength
from .http import PoliteClient
from .linking import WikidataLinker, canonical, key, merge_entities
from .llm import LLMChain, QuotaExhausted
from .roles import Extractor, ImpactAnalyst, Summarizer, Verifier
from .safety import verify_quote
from .sources.base import RawItem, domain_of
from .sources.router import SourceRouter

EXTRACTOR_VERSION = "fogweave-extractor/2.0"
TYPE_PREFIX = {"Event": "ev", "Organisation": "org", "Place": "place", "Topic": "topic", "Technology": "tech", "PublicFigure": "person"}


def slug(text: str) -> str:
    """Same as the client's topicKey(): context ids must match on both sides."""
    t = unicodedata.normalize("NFKD", str(text).lower())
    return re.sub(r"[^\w]+|_", "-", t).strip("-")[:80]


_CTX_STOP = {"and", "the", "of", "in", "for", "with", "work", "use", "uses"}


def touches_context(text: str, context: list[str]) -> bool:
    """Does an impact target name one of the reader's context labels?"""
    words = set(re.findall(r"[a-z0-9]{3,}", text.lower())) - _CTX_STOP
    for c in context:
        cw = set(re.findall(r"[a-z0-9]{3,}", c.lower())) - _CTX_STOP
        if cw and cw <= words:
            return True
    return False


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def window(text: str, needle: str, words: int = 22) -> str | None:
    """A <=25-word verbatim window of text around needle (for 'mentions')."""
    m = re.search(re.escape(needle), text, re.I)
    if not m:
        return None
    before = text[: m.start()].split()[-(words // 2) :]
    after = text[m.end() :].split()[: words // 2]
    return " ".join(before + [text[m.start() : m.end()]] + after).strip()


class Engine:
    def __init__(self, http: PoliteClient | None = None, llm: LLMChain | None = None, router: SourceRouter | None = None):
        self.http = http or PoliteClient()
        self.router = router or SourceRouter(self.http)
        self.llm = llm or LLMChain()
        self.linker = WikidataLinker(self.http)
        self.items = DiskCache("items")  # RawItem dicts by id (titles/links only)
        self.reads = DiskCache("reads")  # extraction results by id

    # ------------------------------------------------------------------ lights

    async def pool(self, interests: dict | None = None, summarize: int = 24) -> dict:
        """Candidate pool for the curated-random feed (client samples from it)."""
        from .feed import TYPE_QUERIES, interest_queries, quality, tags_for

        interests = interests or {}
        queries, cats = interest_queries(interests)
        typed = []
        for q in queries:
            qtype = next((t for t, tq in TYPE_QUERIES.items() if tq == q), "topic")
            typed.append((qtype, q))
        raw = await self.router.pool(typed, cats)
        notes = []
        vecs = embed([f"{r.title}. {r.snippet[:200]}" for r in raw]) if raw else None
        if vecs is not None and len(raw):
            drop = near_duplicates(vecs)
            keep = [i for i in range(len(raw)) if i not in drop]
            raw, vecs = [raw[i] for i in keep], vecs[keep]
        q = quality(raw, vecs) if raw else []
        order = sorted(range(len(raw)), key=lambda i: -q[i]["quality"])
        raw, q = [raw[i] for i in order], [q[i] for i in order]
        vecs = vecs[order] if vecs is not None and len(raw) else vecs
        stories = story_clusters([f"{r.title}. {r.snippet[:200]}" for r in raw]) if raw else []
        summaries: dict[str, str] = {}
        try:
            top = raw[:summarize]
            for i in range(0, len(top), 12):
                out = await Summarizer(self.llm).run([{"id": r.id, "title": r.title, "snippet": r.snippet} for r in top[i : i + 12]])
                summaries.update({s.id: s.summary for s in out.items})
        except QuotaExhausted:
            notes.append("Free model quota is spent for now: summaries show the source's own short text.")
        items = []
        for i, r in enumerate(raw):
            self.items.set(r.id, r.to_dict())
            items.append({
                "id": r.id, "kind": r.kind, "headline": r.title, "source": r.outlet, "via": r.source, "url": r.url, "date": r.date,
                "summary": summaries.get(r.id) or r.snippet[:220], "summaryBy": "model" if r.id in summaries else "source",
                "claims": [], "tags": tags_for(r), "quality": q[i]["quality"], "qualityBreakdown": q[i]["breakdown"],
                "story": int(stories[i]) if stories else i, "licence": r.licence, "citations": r.citations,
                "extra": {k: v for k, v in r.extra.items() if k in ("discussion", "portal", "authors", "section", "categories", "interest")},
            })
        return {"generatedAt": now_iso(), "sources": self.router.status, "notes": notes, "interestsUsed": {"queries": [t for t, _ in typed], "paperTypes": cats}, "items": items}

    async def lights(self, context: list[str] | None = None) -> dict:
        raw = await self.router.lights()
        notes = []
        vecs = embed([f"{r.title}. {r.snippet[:200]}" for r in raw]) if raw else None
        if vecs is not None and len(raw):
            drop = near_duplicates(vecs)
            keep = [i for i in range(len(raw)) if i not in drop]
            raw = [raw[i] for i in keep]
            vecs = vecs[keep]
            stories = story_clusters([f"{r.title}. {r.snippet[:200]}" for r in raw])
        else:
            stories = []
        summaries: dict[str, str] = {}
        try:
            for i in range(0, len(raw), 12):
                batch = [{"id": r.id, "title": r.title, "snippet": r.snippet} for r in raw[i : i + 12]]
                out = await Summarizer(self.llm).run(batch)
                summaries.update({s.id: s.summary for s in out.items})
        except QuotaExhausted:
            notes.append("Free model quota is spent for now: summaries show the source's own short text.")
        relevance = self._relevance(vecs, context) if vecs is not None and len(raw) else []
        items = []
        for i, r in enumerate(raw):
            self.items.set(r.id, r.to_dict())
            items.append(
                {
                    "id": r.id,
                    "kind": r.kind,
                    "headline": r.title,
                    "source": r.outlet,
                    "via": r.source,
                    "url": r.url,
                    "date": r.date,
                    "summary": summaries.get(r.id) or r.snippet[:220],
                    "summaryBy": "model" if r.id in summaries else "source",
                    "claims": [],
                    "relevance": round(float(relevance[i]), 3) if len(relevance) else 0.4,
                    "story": int(stories[i]) if stories else i,
                    "licence": r.licence,
                    "citations": r.citations,
                    "extra": {k: v for k, v in r.extra.items() if k in ("discussion", "portal", "authors")},
                }
            )
        return {"generatedAt": now_iso(), "sources": self.router.status, "notes": notes, "items": items}

    def _relevance(self, vecs, context):
        """Similarity of each item to the reader's coarse context (max over
        context labels), blended with recency. Context is not stored."""
        import numpy as np

        if not context:
            return np.full(len(vecs), 0.4)
        cv = embed(context)
        sim = (vecs @ cv.T).max(axis=1)
        return np.clip((sim - 0.25) / 0.5, 0.05, 1.0)

    # -------------------------------------------------------------------- read

    async def _source_text(self, item: RawItem) -> tuple[str, str, dict]:
        """(text, how, where) for extraction. `where` is the page the text
        (and therefore every quote) really came from. Text is used
        transiently and never stored."""
        if item.source == "arxiv":
            return f"{item.title}. {item.snippet}", "abstract", {"url": item.url, "source": item.outlet}
        text = await self.http.fetch_article(item.url)
        if text and len(text) > 400:
            return text, "article", {"url": item.url, "source": item.outlet}
        for alt in item.citations[1:3]:
            text = await self.http.fetch_article(alt)
            if text and len(text) > 400:
                return text, "article", {"url": alt, "source": domain_of(alt)}
        base = f"{item.title}. {item.snippet}".strip()
        if item.source == "wikipedia":
            # the summary is Wikipedia's (CC BY-SA), not the outlet's words
            return base, "headline-only", {"url": item.extra.get("portal") or "https://en.wikipedia.org/wiki/Portal:Current_events", "source": "en.wikipedia.org"}
        return base, "headline-only", {"url": item.url, "source": item.outlet}

    async def _extract(self, item: RawItem) -> dict:
        cached = self.reads.get(item.id)
        if cached:
            return cached
        text, how, where = await self._source_text(item)
        x = await Extractor(self.llm).run(item.title, text, MAX_ARTICLE_CHARS)
        claims, relations = [], []
        for c in x.claims[:5]:
            q = verify_quote(c.quote, text)
            if q:
                claims.append({"text": c.text, "quote": q})
        for r in x.relations[:8]:
            q = verify_quote(r.quote, text)
            if q:
                relations.append({"subject": r.subject, "relation": r.relation, "object": r.object, "quote": q})
        entities = []
        for e in x.entities[:10]:
            mention = window(text, e.name) or (window(text, canonical(e.name)) if canonical(e.name) != e.name else None)
            if not mention:
                continue  # not in the text: never invent an entity
            entities.append({"name": e.name, "type": e.type, "public_role": e.public_role, "mention": mention})
        result = {
            "event": x.event.model_dump(),
            "entities": entities,
            "claims": claims,
            "relations": relations,
            "textHow": how,
            "textSource": where,
            "dropped": {"claims": len(x.claims) - len(claims), "relations": len(x.relations) - len(relations), "entities": len(x.entities) - len(entities)},
            "retrievedAt": now_iso(),
        }
        self.reads.set(item.id, result)
        return result

    def _item(self, item_id: str) -> RawItem | None:
        d = self.items.get(item_id)
        if not d:
            return None
        d = {k: v for k, v in d.items() if k != "id"}
        return RawItem(**d)

    async def read(self, item_id: str) -> dict:
        item = self._item(item_id)
        if not item:
            return {"id": item_id, "error": "unknown item"}
        try:
            x = await self._extract(item)
        except QuotaExhausted:
            return {"id": item_id, "claims": [], "note": "Free model quota is spent for now; key claims will load later."}
        note = "Only the headline was available (robots.txt, paywall or fetch failure)." if x["textHow"] == "headline-only" else ""
        return {"id": item_id, "claims": x["claims"][:3], "textHow": x["textHow"], "note": note}

    # ------------------------------------------------------------------ expand

    async def expand(self, item_id: str, context: list[str] | None = None, deep: bool = False):
        t0 = time.monotonic()
        timings: dict[str, int] = {}

        def mark(name):
            timings[name] = int((time.monotonic() - t0) * 1000)

        calls0 = self.llm.stats["calls"]
        tokens0 = self.llm.stats["tokens"]
        context = [c for c in (context or []) if isinstance(c, str) and 0 < len(c) < 60][:8]
        nodes: dict[str, dict] = {}
        rejected: list[dict] = []

        def node(n: dict):
            problem = ontology.validate_node(n)
            if problem:
                rejected.append({"node": n.get("id"), "problem": problem})
                return None
            if n["id"] in nodes:
                nodes[n["id"]].update({k: v for k, v in n.items() if v not in (None, "", [])})
                return {"type": "node", "node": nodes[n["id"]]}
            nodes[n["id"]] = n
            return {"type": "node", "node": n}

        def edge(e: dict):
            e.setdefault("id", f"{e['type']}:{e['from']}->{e['to']}")
            problem = ontology.validate_edge(e, nodes)
            if problem:
                rejected.append({"edge": e["id"], "problem": problem})
                return None
            return {"type": "edge", "edge": e}

        item = self._item(item_id)
        if not item:
            yield {"type": "note", "level": "error", "text": "This item is no longer in the cache; reload the lights."}
            yield {"type": "done", "stats": {}}
            return

        news = {
            "id": item.id,
            "type": "NewsItem",
            "label": item.title,
            "outlet": item.outlet,
            "url": item.url,
            "date": item.date,
            "kind": item.kind,
            "via": item.source,
            "licence": item.licence,
            "sourceClass": classify_source(item.outlet, "news" if item.source in ("gdelt", "wikipedia") else None),
        }
        yield {"type": "status", "phase": "reading", "text": f"Reading {item.outlet}"}
        if ev := node(news):
            yield ev

        try:
            x = await self._extract(item)
        except QuotaExhausted as exc:
            yield {"type": "note", "level": "degraded", "text": "Free model quota is spent for now: showing the item only."}
            yield {"type": "done", "stats": {"error": str(exc)[:120]}}
            return
        retrieved = x["retrievedAt"]
        mark("extracted")

        where = x.get("textSource") or {"url": item.url, "source": item.outlet}

        def prov(quote: str, url: str = where["url"], source: str = where["source"], date: str = item.date):
            return {"source": source, "url": url, "quote": quote, "date": date, "retrievedAt": retrieved, "extractor": EXTRACTOR_VERSION}

        # entities (linked conservatively, merged by Wikidata id / canonical name)
        yield {"type": "status", "phase": "linking", "text": "Finding who and what it is about"}
        linked = await asyncio.gather(*(self.linker.link(e["name"], e["type"]) for e in x["entities"]))
        ents = []
        for e, l in zip(x["entities"], linked):
            ents.append({**e, **({"qid": l["qid"], "wd_label": l["label"], "description": l["description"]} if l else {})})
        merged, by_key = merge_entities(ents)
        ent_id: dict[str, str] = {}
        for e in merged:
            nid = e["id"] if e["id"].startswith("wd:") else f"{TYPE_PREFIX[e['type']]}:{key(e['name'])}"
            ent_id.update({k: nid for k, v in by_key.items() if v == e["id"]})
            n = {"id": nid, "type": e["type"], "label": e["name"], "qid": e.get("qid"), "description": e.get("description"), "publicRole": e.get("public_role")}
            if ev := node(n):
                yield ev
            if ev := edge({"type": "mentions", "from": item.id, "to": nid, "label": "reported", "evidence": [prov(e["mention"])]}):
                yield ev

        mark("linked")
        # main event
        ev_name = x["event"]["name"]
        event_id = f"ev:{key(ev_name)}"
        if ev := node({"id": event_id, "type": "Event", "label": ev_name, "when": x["event"].get("when")}):
            yield ev
        ent_id[key(ev_name)] = event_id
        if ev := edge({"type": "about", "from": item.id, "to": event_id, "label": "reported", "evidence": [prov(" ".join(item.title.split()[:25]), url=item.url if item.source != "wikipedia" else where["url"], source=item.outlet if item.source != "wikipedia" else where["source"])]}):
            yield ev

        # claims
        claim_ids = []
        for i, c in enumerate(x["claims"]):
            cid = f"{item.id}:c{i + 1}"
            claim_ids.append(cid)
            if ev := node({"id": cid, "type": "Claim", "label": c["text"], "quote": c["quote"], "reportedBy": item.id, "url": item.url, "verdict": "unverified"}):
                yield ev
            if ev := edge({"type": "reports", "from": item.id, "to": cid, "label": "reported", "evidence": [prov(c["quote"])]}):
                yield ev

        # reported relations
        reported_triples: set[tuple[str, str, str]] = set()
        self._reported_triples = reported_triples
        facts = [{"id": f"F{i + 1}", "text": c["text"], "ref": cid} for i, (c, cid) in enumerate(zip(x["claims"], claim_ids))]
        for r in x["relations"]:
            s = ent_id.get(key(r["subject"])) or (event_id if key(r["subject"]) == key(ev_name) else None)
            o = ent_id.get(key(r["object"]))
            if not s or not o:
                rejected.append({"relation": r, "problem": "endpoint not among extracted entities"})
                continue
            e = edge({"type": r["relation"], "from": s, "to": o, "label": "reported", "evidence": [prov(r["quote"])]})
            if e:
                reported_triples.add((r["relation"], s, o))
                facts.append({"id": f"F{len(facts) + 1}", "text": f"{r['subject']} {r['relation'].replace('_', ' ')} {r['object']}", "ref": e["edge"]["id"]})
                yield e

        # verification: corroborate top claims across independent domains
        notes = []
        if claim_ids:
            yield {"type": "status", "phase": "checking", "text": "Checking claims against other sources"}
            try:
                async for ev in self._verify(item, x, claim_ids, node, edge, nodes):
                    yield ev
            except QuotaExhausted:
                notes.append("Free model quota ran out: some claims stay unverified.")
                yield {"type": "note", "level": "degraded", "text": notes[-1]}

        mark("verified")
        # impact chains
        yield {"type": "status", "phase": "impact", "text": "Mapping possible effects"}
        try:
            async for ev in self._impact(ev_name, event_id, facts, ent_id, context, deep, node, edge):
                yield ev
        except QuotaExhausted:
            notes.append("Free model quota ran out before effects could be mapped.")
            yield {"type": "note", "level": "degraded", "text": notes[-1]}

        mark("impact")
        if x["textHow"] == "headline-only":
            yield {"type": "note", "level": "info", "text": "Only the headline and source summary could be read for this item."}
        yield {
            "type": "done",
            "stats": {
                "ms": int((time.monotonic() - t0) * 1000),
                "timings": timings,
                "llmCalls": self.llm.stats["calls"] - calls0,
                "llmTokens": self.llm.stats["tokens"] - tokens0,
                "nodes": len(nodes),
                "rejected": rejected[:20],
                "dropped": x["dropped"],
                "textHow": x["textHow"],
                "sources": self.router.status,
                "notes": notes,
                "ontology": ontology.VERSION,
            },
        }

    async def _verify(self, item, x, claim_ids, node, edge, nodes):
        claims = [{"id": cid, "text": c["text"]} for cid, c in zip(claim_ids, x["claims"])][:MAX_CLAIMS_TO_VERIFY]
        own = registered_domain(item.outlet)
        evidence: list[dict] = []

        def add(url, title, snippet, date):
            dom = registered_domain(domain_of(url))
            if not url or dom == own or any(e["url"] == url for e in evidence):
                return
            evidence.append({"id": f"E{len(evidence) + 1}", "url": url, "domain": domain_of(url), "title": title, "text": f"{title}. {snippet}".strip(), "date": date})

        # 1) other outlets the source itself cites for this same story (strongest)
        for url in item.citations:
            if url != item.url:
                add(url, domain_of(url), "", item.date)
        # 2) one news search for the event (GDELT is paced at ~5.5 s, so once) + background
        names = [e["name"] for e in x["entities"] if e["type"] in ("Organisation", "Place", "PublicFigure", "Technology")][:3]
        q = re.sub(r"[^\w\s'-]", " ", " ".join(dict.fromkeys(names or x["event"]["name"].split()[:5])))
        jobs = []
        if "gdelt" in self.router.adapters:
            jobs.append(self.router._safe("gdelt-search", self.router.adapters["gdelt"].search(q[:100], limit=6, timespan="1w")))
        if "wikipedia" in self.router.adapters:
            jobs.append(self.router._safe("wikipedia-search", self.router.adapters["wikipedia"].search(x["event"]["name"][:100], limit=2)))
        for batch in await asyncio.gather(*jobs):
            for r in batch:
                add(r.url, r.title, r.snippet, r.date)
        # Wikipedia hits: use the article lead (whole sentences), not search fragments
        wiki = self.router.adapters.get("wikipedia")
        wiki_ev = [e for e in evidence if "wikipedia.org/wiki/" in e["url"]]
        if wiki and wiki_ev:
            try:
                leads = await wiki.intros([e["title"] for e in wiki_ev])
            except Exception:  # noqa: BLE001
                leads = {}
            for e in wiki_ev:
                if leads.get(e["title"]):
                    e["body"] = leads[e["title"]]
                    e["text"] = f"{e['title']}. {leads[e['title']][:1500]}"
        evidence = evidence[:8]
        if not evidence:
            return
        # read a little more of the best few (robots-respecting, cached)
        claim_words = set(re.findall(r"\w{4,}", " ".join(c["text"] for c in claims).lower()))

        async def enrich(e):
            try:
                body = e.get("body") or (await asyncio.wait_for(self.http.fetch_article(e["url"]), timeout=10) if "wikipedia.org" not in e["url"] else None)
            except asyncio.TimeoutError:
                body = None
            if body:
                sents = re.split(r"(?<=[.!?])\s+", body)[:80]
                best = sorted(sents, key=lambda s: -len(claim_words & set(re.findall(r"\w{4,}", s.lower()))))[:4]
                e["text"] = f"{e['title']}. {' '.join(best)}"
                e["body"] = body

        await asyncio.gather(*(enrich(e) for e in evidence[:5]))
        evidence = [e for e in evidence if len(e["text"]) > 40]  # bare links we could not read say nothing
        if not evidence:
            return
        verdicts = await Verifier(self.llm).run(claims, evidence)
        stance = {(j.claim_id, j.evidence_id): j.stance for j in verdicts.items}
        retrieved = now_iso()
        for c in claims:
            items = [{"domain": item.outlet, "source_class": classify_source(item.outlet, "news"), "stance": "supports", "date": item.date}]
            for e in evidence:
                if (c["id"], e["id"]) not in stance:
                    continue  # judged unrelated to this claim
                st = stance[(c["id"], e["id"])]
                cls = classify_source(e["domain"], "news" if "gdelt" in self.router.status else None)
                items.append({"domain": e["domain"], "source_class": cls, "stance": st, "date": e["date"]})
                if st == "unclear":
                    continue
                sid = f"src:{registered_domain(e['domain'])}"
                if ev := node({"id": sid, "type": "Source", "label": e["domain"], "domain": e["domain"], "sourceClass": cls, "url": e["url"]}):
                    yield ev
                # the quote must be verbatim from that source: title or fetched text
                quote = verify_quote(" ".join(e["text"].split()[:25]), e.get("body", "") + " " + e["text"]) or " ".join(e["title"].split()[:25])
                ed = edge({
                    "type": st, "from": sid, "to": c["id"], "label": "reported",
                    "evidence": [{"source": e["domain"], "url": e["url"], "quote": quote, "date": e["date"], "retrievedAt": retrieved, "extractor": EXTRACTOR_VERSION}],
                })
                if ed:
                    yield ed
            s = strength(items)
            yield {"type": "verified", "id": c["id"], "verdict": s["verdict"], "evidence": s["evidence"]}

    async def _impact(self, ev_name, event_id, facts, ent_id, context, deep, node, edge):
        if not facts:
            return
        out = await ImpactAnalyst(self.llm).run(ev_name, facts, context, max_hop=3 if deep else 2)
        fact_ref = {f["id"]: f["ref"] for f in facts}
        ctx_keys = {key(c): c for c in context}
        known = dict(ent_id)
        known[key(ev_name)] = event_id

        def resolve(name: str, hop: int):
            k = key(name)
            if k in known:
                return known[k]
            words = set(re.findall(r"\w{3,}", k))
            best, score = None, 0.0
            for kk, nid in known.items():
                kw = set(re.findall(r"\w{3,}", kk))
                if words and kw:
                    s_ = len(words & kw) / len(words | kw)
                    if s_ > score:
                        best, score = nid, s_
            if score >= 0.5:
                return best
            return event_id if hop == 1 else None  # a first hop always starts at the event

        dropped = 0
        emitted: set[tuple[str, str, str]] = set(self._reported_triples) if hasattr(self, "_reported_triples") else set()
        for link in out.links[:8]:
            if link.hop > (3 if deep else 2):
                continue
            s = resolve(link.source, link.hop)
            if not s:
                dropped += 1
                continue
            label = link.label
            basis = [fact_ref[b] for b in link.basis if b in fact_ref]
            if label == "inferred" and not basis:
                label = "speculative"  # claimed grounding that does not exist: demote
            if label == "speculative" and touches_context(link.target, context):
                dropped += 1  # a weak guess "about you" is worse than none (eval top failure)
                continue
            tk = key(link.target)
            if tk in ctx_keys:
                tid = f"ctx:{slug(ctx_keys[tk])}"
                n = {"id": tid, "type": "ContextNode", "label": ctx_keys[tk], "private": True}
            else:
                ttype = link.target_type
                tid = known.get(tk) or f"{TYPE_PREFIX[ttype]}:{tk}"
                n = {"id": tid, "type": ttype, "label": canonical(link.target), "derived": True}
            if ev := node(n):
                yield ev
            known[tk] = tid
            if (link.relation, s, tid) in emitted:
                continue  # already a reported (or earlier) link: the source wins
            emitted.add((link.relation, s, tid))
            e = {
                "type": link.relation, "from": s, "to": tid, "label": label, "hop": link.hop,
                "reasoning": link.reasoning, "basis": basis, "evidence": [],
            }
            if ev := edge(e):
                yield ev
