"""Explore: touch any node and the world around it opens.

For a node (entity, event, topic, technology, place, organisation) this
streams graph events for a bounded set of neighbours, grouped:
  definition / origin  - Wikipedia lead (CC BY-SA, short excerpt + link)
  parts / belongs to   - Wikidata statements (CC0): part of, has part,
                         subclass of, parent organisation, located in, country
  related news         - Current-events entries that name it + a news search
  related papers       - arXiv search, kept only if the abstract names it
  impact               - possible effects (inferred / speculative), same
                         rules as expand (basis required, persona guard)
Every link is labelled; reported links carry a quote (or the Wikidata
statement) and a URL. The client shows about 8 new nodes, with "show more".
"""

from __future__ import annotations

import asyncio
import re
import unicodedata

from . import ontology
from .http import SourceError
from .linking import fits, key
from .safety import verify_quote
from .sources.base import RawItem, domain_of

WD_API = "https://www.wikidata.org/w/api.php"
WIKI_API = "https://en.wikipedia.org/w/api.php"

# property -> (relation, direction): "out" = node -> value, "in" = value -> node
PROPS = {
    "P361": ("part_of", "out", "part of"),
    "P279": ("part_of", "out", "subclass of"),
    "P749": ("part_of", "out", "parent organisation"),
    "P131": ("part_of", "out", "located in"),
    "P17": ("part_of", "out", "country"),
    "P527": ("part_of", "in", "has part"),
    "P452": ("part_of", "out", "industry"),
    "P30": ("part_of", "out", "continent"),
    "P36": ("part_of", "in", "capital"),
    "P102": ("part_of", "out", "member of party"),
    "P108": ("part_of", "out", "employer"),
    "P463": ("part_of", "out", "member of"),
}
ORIGIN_WORDS = re.compile(r"\b(founded|established|formed|created|began|originat\w*|invented|first|since|dates? back|history)\b", re.I)


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text or "") if len(s.strip()) > 20]


def _type_from_description(desc: str) -> str:
    for t in ("Place", "Organisation", "Technology", "PublicFigure", "Event"):
        if fits(t, desc):
            return t
    return "Topic"


def _fold(s: str) -> str:
    """key() without accents: "Raúl Castro" and "Raul Castro" are the same title."""
    return unicodedata.normalize("NFKD", key(s)).encode("ascii", "ignore").decode()


def _mention(text: str, label: str) -> str | None:
    m = re.search(r"(?<![\w])" + re.escape(label) + r"(?![\w])", text, re.I)
    if not m and len(label) > 4 and label.lower().endswith("s") and not label.lower().endswith("ss"):
        # "electric vehicles" also matches "Electric Vehicle" (singular), nothing looser
        m = re.search(r"(?<![\w])" + re.escape(label[:-1]) + r"(?![\w])", text, re.I)
    if not m:
        return None
    before = text[: m.start()].split()[-10:]
    after = text[m.end():].split()[:10]
    return " ".join(before + [text[m.start(): m.end()]] + after).strip()


class Explorer:
    def __init__(self, engine):
        self.e = engine
        self.http = engine.http
        self.router = engine.router

    async def _wikidata(self, qid: str | None, label: str, ntype: str = "Topic") -> tuple[str | None, dict]:
        """(qid, entity json) — find the item by label if no qid (conservative)."""
        try:
            if not qid:
                for t in dict.fromkeys([ntype, "Topic", "Organisation", "Place"]):
                    hit = await self.e.linker.link(label, t)
                    if hit:
                        qid = hit["qid"]
                        break
            if not qid:
                return None, {}
            data = await self.http.get(WD_API, params={"action": "wbgetentities", "ids": qid, "props": "labels|descriptions|claims|sitelinks", "sitefilter": "enwiki", "languages": "en", "format": "json"}, as_json=True, ttl=7 * 86400)
            return qid, (data or {}).get("entities", {}).get(qid, {})
        except SourceError:
            return qid, {}

    async def _labels(self, qids: list[str]) -> dict:
        if not qids:
            return {}
        try:
            data = await self.http.get(WD_API, params={"action": "wbgetentities", "ids": "|".join(qids[:20]), "props": "labels|descriptions", "languages": "en", "format": "json"}, as_json=True, ttl=7 * 86400)
        except SourceError:
            return {}
        out = {}
        for q, ent in (data or {}).get("entities", {}).items():
            lab = ent.get("labels", {}).get("en", {}).get("value")
            if lab:
                out[q] = {"label": lab, "description": ent.get("descriptions", {}).get("en", {}).get("value", "")}
        return out

    async def run(self, node: dict, context: list[str] | None = None, paper_types: list[str] | None = None):
        context = [c for c in (context or []) if isinstance(c, str) and 0 < len(c) < 60][:8]
        nid, label, ntype = node["id"], node["label"], node.get("type", "Topic")
        nodes: dict[str, dict] = {nid: {"id": nid, "type": ntype, "label": label}}
        rejected: list = []
        retrieved = __import__("fogweave.pipeline", fromlist=["now_iso"]).now_iso()

        def emit_node(n):
            problem = ontology.validate_node(n)
            if problem:
                rejected.append({"node": n.get("id"), "problem": problem})
                return None
            nodes.setdefault(n["id"], n)
            return {"type": "node", "node": n, "group": n.pop("_group", None)}

        def emit_edge(e, group):
            e.setdefault("id", f"{e['type']}:{e['from']}->{e['to']}")
            problem = ontology.validate_edge(e, nodes)
            if problem:
                rejected.append({"edge": e["id"], "problem": problem})
                return None
            return {"type": "edge", "edge": e, "group": group}

        yield {"type": "status", "phase": "define", "text": f"Looking up {label}"}
        # a linked node's own id is its Wikidata item
        known_qid = node.get("qid") or (nid[3:] if nid.startswith("wd:Q") else None)
        qid, ent = await self._wikidata(known_qid, label, ntype)
        title = ent.get("sitelinks", {}).get("enwiki", {}).get("title") if ent else None
        if not title:
            try:
                hits = await self.router.adapters["wikipedia"].search(label, limit=1)
                title = hits[0].title if hits and _fold(hits[0].title) == _fold(label) else None
            except Exception:  # noqa: BLE001
                title = None
        if title and not qid:
            try:
                pp = await self.http.get(WIKI_API, params={"action": "query", "prop": "pageprops", "titles": title, "format": "json", "formatversion": "2"}, as_json=True, ttl=7 * 86400)
                q2 = ((pp or {}).get("query", {}).get("pages") or [{}])[0].get("pageprops", {}).get("wikibase_item")
                if q2:
                    qid, ent = await self._wikidata(q2, label)
            except SourceError:
                pass
        definition = origin = ""
        wiki_url = ""
        if title:
            try:
                leads = await self.router.adapters["wikipedia"].intros([title])
            except Exception:  # noqa: BLE001
                leads = {}
            sents = _sentences(leads.get(title, ""))
            definition = " ".join(sents[:2])[:400]
            origin = next((s for s in sents[2:8] if ORIGIN_WORDS.search(s)), "")[:300]
            wiki_url = "https://en.wikipedia.org/wiki/" + title.replace(" ", "_")
        upd = {"id": nid, "type": ntype, "label": label, "definition": definition, "origin": origin, "definitionUrl": wiki_url, "definitionLicence": "Wikipedia, CC BY-SA 4.0" if definition else "", "qid": qid}
        yield {"type": "node", "node": {k: v for k, v in upd.items() if v not in (None, "")}}

        facts = []
        if definition:
            facts.append({"id": "F1", "text": definition, "ref": nid})
        if origin:
            facts.append({"id": f"F{len(facts) + 1}", "text": origin, "ref": nid})

        # ---- parts / belongs to (Wikidata, CC0)
        if ent:
            claims = ent.get("claims", {})
            pairs = []
            for pid, (rel, direction, plabel) in PROPS.items():
                for c in claims.get(pid, [])[:3]:
                    v = c.get("mainsnak", {}).get("datavalue", {}).get("value", {})
                    if isinstance(v, dict) and v.get("id"):
                        pairs.append((pid, v["id"]))
            labels = await self._labels([q for _, q in pairs])
            for pid, q in pairs[:6]:
                if q not in labels:
                    continue
                rel, direction, plabel = PROPS[pid]
                info = labels[q]
                tid = f"wd:{q}"
                ev = emit_node({"id": tid, "type": _type_from_description(info["description"]), "label": info["label"], "qid": q, "description": info["description"], "_group": "parts"})
                if ev:
                    yield ev
                frm, to = (nid, tid) if direction == "out" else (tid, nid)
                e = emit_edge({"type": rel, "from": frm, "to": to, "label": "reported", "evidence": [{"source": "wikidata.org", "url": f"https://www.wikidata.org/wiki/{qid}", "quote": f"{label}: {plabel} {info['label']} (Wikidata statement)", "retrievedAt": retrieved}]}, "parts")
                if e:
                    yield e

        # ---- related news (items that name it)
        yield {"type": "status", "phase": "news", "text": f"Finding news about {label}"}
        news: list[RawItem] = []
        try:
            wiki = self.router.adapters["wikipedia"]
            from datetime import datetime, timedelta, timezone

            recent = []
            today = datetime.now(timezone.utc)
            for back in range(10):  # cached pages: no LLM, polite pacing
                try:
                    recent += await wiki.current_events(today - timedelta(days=back))
                except SourceError:
                    continue
            news += [it for it in recent if _mention(f"{it.title}. {it.snippet}", label)][:3]
        except Exception:  # noqa: BLE001
            pass
        if "gdelt" in self.router.adapters:
            found = await self.router._safe("gdelt-explore", self.router.adapters["gdelt"].search(f'"{label}"' if " " in label else label, limit=4, timespan="1w"))
            news += [it for it in found if _mention(it.title, label)][:2]
        for it in news[:4]:
            self.e.items.set(it.id, it.to_dict())
            quote = verify_quote(_mention(f"{it.title}. {it.snippet}", label) or "", f"{it.title}. {it.snippet}")
            if not quote:
                continue
            ev = emit_node({"id": it.id, "type": "NewsItem", "label": it.title, "outlet": it.outlet, "url": it.url, "date": it.date, "kind": it.kind, "via": it.source, "summary": it.snippet[:220], "_group": "news"})
            if ev:
                yield ev
            src_url = it.extra.get("portal") if it.source == "wikipedia" else it.url
            e = emit_edge({"type": "mentions", "from": it.id, "to": nid, "label": "reported", "evidence": [{"source": "en.wikipedia.org" if it.source == "wikipedia" else it.outlet, "url": src_url, "quote": quote, "date": it.date, "retrievedAt": retrieved}]}, "news")
            if e:
                yield e
                facts.append({"id": f"F{len(facts) + 1}", "text": it.title, "ref": it.id})

        # ---- related papers (abstract must name it)
        if "arxiv" in self.router.adapters:
            papers = await self.router._safe("arxiv-explore", self.router.adapters["arxiv"].search(f'"{label}"' if " " in label else label, limit=4))
            kept = 0
            for p in papers:
                quote = _mention(f"{p.title}. {p.snippet}", label)
                if not quote or kept >= 2:
                    continue
                kept += 1
                self.e.items.set(p.id, p.to_dict())
                ev = emit_node({"id": p.id, "type": "NewsItem", "label": p.title, "outlet": "arxiv.org", "url": p.url, "date": p.date, "kind": "paper", "via": "arxiv", "summary": p.snippet[:220], "_group": "papers"})
                if ev:
                    yield ev
                e = emit_edge({"type": "mentions", "from": p.id, "to": nid, "label": "reported", "evidence": [{"source": "arxiv.org", "url": p.url, "quote": quote, "date": p.date, "retrievedAt": retrieved}]}, "papers")
                if e:
                    yield e

        # ---- open deep sources: older news, datasets, filings (each must name it)
        deep = []
        if "wikipedia" in self.router.adapters:
            yield {"type": "status", "phase": "archive", "text": f"Looking for older news about {label}"}
            old = await self.router._safe("wikipedia-archive-search", self.router.adapters["wikipedia"].archive_search(label, limit=3))
            deep += [("archive", it) for it in old]
        if "zenodo" in self.router.adapters and ntype in ("Topic", "Technology", "Place", "Organisation", "Event"):
            ds = await self.router._safe("zenodo", self.router.adapters["zenodo"].search(label, limit=3))
            deep += [("datasets", it) for it in ds[:2]]
        edgar = self.router.adapters.get("edgar")
        if edgar and ntype == "Organisation":
            if edgar.enabled:
                fl = await self.router._safe("edgar", edgar.search(label, limit=2))
                deep += [("filings", it) for it in fl]
            else:
                self.router.status["edgar"] = {"ok": False, "error": "off: needs FW_CONTACT_EMAIL (the owner's contact, as the SEC requires)"}
        for group, it in deep:
            text = f"{it.title}. {it.snippet}"
            # a filing is matched to the company by exact name, so the company name is the quote
            quote = verify_quote(_mention(text, label) or (it.extra.get("company") if group == "filings" else "") or "", text)
            if not quote:
                continue
            self.e.items.set(it.id, it.to_dict())
            ev = emit_node({"id": it.id, "type": "NewsItem", "label": it.title, "outlet": it.outlet, "url": it.url, "date": it.date, "kind": it.kind, "sourceType": it.extra.get("sourceType", it.kind), "via": it.source, "summary": it.snippet[:220], "licence": it.licence, "_group": group})
            if ev:
                yield ev
            src = it.extra.get("portal") if it.source == "wikipedia" else it.url
            e = emit_edge({"type": "mentions", "from": it.id, "to": nid, "label": "reported", "evidence": [{"source": "en.wikipedia.org" if it.source == "wikipedia" else it.outlet, "url": src, "quote": quote, "date": it.date, "retrievedAt": retrieved, "sourceClass": it.extra.get("sourceClass")}]}, group)
            if e:
                yield e
                if group == "archive":
                    facts.append({"id": f"F{len(facts) + 1}", "text": f"({it.date[:10]}) {it.title}", "ref": it.id})

        # ---- impact (what it may affect), same rules as expand
        if ntype in ("Event", "Topic", "Technology", "Organisation") and facts:
            yield {"type": "status", "phase": "impact", "text": f"Mapping what {label} may affect"}
            try:
                async for ev in self.e._impact(label, nid, facts, {key(label): nid}, context, False, emit_node_wrapper(emit_node, "impact"), lambda e: emit_edge(e, "impact")):
                    yield ev
            except Exception as exc:  # noqa: BLE001 (quota etc.)
                yield {"type": "note", "level": "degraded", "text": f"Effects not mapped this time ({type(exc).__name__})."}
        yield {"type": "done", "stats": {"node": nid, "qid": qid, "rejected": rejected[:10], "facts": len(facts), "sources": self.router.status}}


def emit_node_wrapper(fn, group):
    def inner(n):
        n["_group"] = group
        return fn(n)

    return inner
