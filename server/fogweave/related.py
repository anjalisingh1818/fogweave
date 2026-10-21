"""Related-News Finder + Relation Reasoner (V3 §2.4-2.5, §7).

For a focus news item, find OTHER news (recent and older) that names the same
people, places or organisations, rank the candidates, and decide how each one
relates to the focus: same event, follow-up, background, cause, effect,
precedent, similar pattern, corroborates, contradicts, shares an entity,
possible consequence. Every link carries two quotes, one from each item.

Code decides what the model may not:
  - both quotes must appear in the texts (verbatim, 25 words or fewer)
  - dates must fit the relation (background, cause, precedent are earlier;
    a follow-up or an effect is later)
  - "unrelated" and low-confidence pairs are dropped
  - cause/effect come from one pair of texts, so they are never Reported:
    Inferred at most (two independent supports would be needed)
  - a possible consequence is always Speculative
  - "shares an entity" is computed in code (both texts name it) and is Reported
If the model is unavailable, the code-only "shares an entity" links still come.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timedelta, timezone

import numpy as np

from .embed import embed
from .linking import key
from .safety import verify_quote
from .sources.base import RawItem

# relation -> (edge type, direction, label)
RELATION_EDGE = {
    "same_event": ("same_event", "focus->other", "inferred"),
    "follow_up": ("follows", "other->focus", "inferred"),
    "background": ("background_of", "other->focus", "inferred"),
    "cause_of": ("causes", "other->focus", "inferred"),
    "effect_of": ("causes", "focus->other", "inferred"),
    "precedent_of": ("precedent_of", "other->focus", "inferred"),
    "similar_pattern": ("similar_to", "focus->other", "inferred"),
    "corroborates": ("corroborates", "other->focus", "inferred"),
    "contradicts": ("contradicts", "other->focus", "inferred"),
    "shares_entity": ("shares_entity", "focus->other", "reported"),
    "possible_consequence": ("possible_consequence_of", "other->focus", "speculative"),
}
EARLIER = {"background", "cause_of", "precedent_of"}
LATER = {"follow_up", "effect_of"}
OLD_DAYS = 30
MAX_RELATED = 6


def _fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def _day(date: str) -> datetime | None:
    try:
        d = datetime.fromisoformat(str(date).replace("Z", "+00:00"))
    except ValueError:
        try:
            d = datetime.strptime(str(date)[:10], "%Y-%m-%d")
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def date_fits(relation: str, focus_date: str, other_date: str) -> bool:
    """A background, cause or precedent is earlier; a follow-up or an effect is later."""
    f, o = _day(focus_date), _day(other_date)
    if not f or not o:
        return relation not in EARLIER | LATER  # unknown dates: no time claims
    if relation in EARLIER:
        return o.date() < f.date()
    if relation in LATER:
        return o.date() >= f.date()
    return True


def mention(text: str, name: str) -> str | None:
    """A short quote around the first mention of `name` in `text` (an exact slice of `text`)."""
    m = re.search(r"(?<![\w])" + re.escape(name) + r"(?![\w])", text, re.I)
    if not m:
        # accents aside ("Raul" / "Raúl"): only when folding keeps every position
        ft = _fold(text)
        if len(ft) != len(text):
            return None
        m = re.search(r"(?<![\w])" + re.escape(_fold(name)) + r"(?![\w])", ft)
        if not m:
            return None
    # an exact slice of the text (so the quote can be checked verbatim): about 8 words either side
    before = re.search(r"(?:\S+\s+){0,8}$", text[: m.start()])
    after = re.match(r"(?:\s*\S+){0,8}", text[m.end():])
    start = before.start() if before else m.start()
    end = m.end() + (after.end() if after else 0)
    return text[start:end].strip()


def verify_parts(quote: str, text: str) -> str | None:
    """verify_quote, but a quote with an ellipsis passes when every piece is in the text, in order."""
    parts = [p.strip(" .,;:") for p in re.split(r"\.\.\.|…", quote or "") if p.strip(" .,;:")]
    if len(parts) <= 1:
        return verify_quote(quote, text)
    pos = 0
    low = text.lower()
    for p in parts:
        if not verify_quote(p, text):
            return None
        i = low.find(p.lower()[:20], pos)
        if i < 0:
            return None
        pos = i
    return " … ".join(parts)


class RelatedFinder:
    def __init__(self, engine):
        self.e = engine
        self.router = engine.router

    def _strong(self, text: str, names: list[str], broad: set[str]) -> bool:
        """Names a specific person, organisation or event of the story, or two of its names.
        A shared big place alone ("Russia") is too weak a reason to link two stories."""
        hits = [n for n in names if mention(text, n)]
        return any(n not in broad for n in hits) or len(hits) >= 2

    async def candidates(self, item: RawItem, names: list[str], broad: set[str] = frozenset()) -> list[RawItem]:
        """Recent Current events entries and older archive entries that name the story's entities."""
        names = [n for n in names if n and len(n) > 2][:6]
        if not names:
            return []
        wiki = self.router.adapters.get("wikipedia")
        found: list[RawItem] = []
        if wiki:
            today = datetime.now(timezone.utc)
            recent: list[RawItem] = []
            for back in range(10):  # cached day pages
                try:
                    recent += await wiki.current_events(today - timedelta(days=back))
                except Exception:  # noqa: BLE001
                    continue
            found += [it for it in recent if self._strong(f"{it.title}. {it.snippet}", names, broad)]
            for n in [x for x in names if x not in broad][:2] or names[:1]:
                found += await self.router._safe(f"related-archive:{n[:30]}", wiki.archive_search(n, limit=2, min_age_days=OLD_DAYS))
        # not the focus itself, no duplicates
        seen = {item.url, " ".join(item.title.lower().split())}
        out = []
        for it in found:
            k = " ".join(it.title.lower().split())
            if it.url in seen or k in seen:
                continue
            seen.update({it.url, k})
            out.append(it)
        return out

    def rank(self, item: RawItem, cands: list[RawItem], names: list[str], broad: set[str] = frozenset()) -> list[RawItem]:
        """Closest first (text similarity + shared names); keep up to two older items."""
        if not cands:
            return []
        vecs = embed([f"{item.title}. {item.snippet[:300]}"] + [f"{c.title}. {c.snippet[:300]}" for c in cands])
        sims = (vecs[1:] @ vecs[0]) if vecs is not None and len(vecs) > 1 else np.zeros(len(cands))
        scored = []
        for c, s in zip(cands, sims):
            text = f"{c.title}. {c.snippet}"
            shared = sum(1 for n in names if mention(text, n))
            if not self._strong(text, names, broad) and float(s) < 0.55:
                continue  # neither a specific shared name nor a similar story
            scored.append((float(s) + 0.15 * shared, c))
        scored.sort(key=lambda x: -x[0])
        fd = _day(item.date)
        old = [c for _, c in scored if fd and _day(c.date) and (fd - _day(c.date)).days >= OLD_DAYS][:2]
        rest = [c for _, c in scored if c not in old]
        return (old + rest)[:MAX_RELATED]

    async def run(self, item: RawItem, focus_text: str, names: list[str], node, edge, retrieved: str, broad: list[str] | None = None):
        """Yields graph events: related news nodes and typed, two-quote links to the focus."""
        from .llm import QuotaExhausted
        from .roles import RelationReasoner

        broad_set = set(broad or [])
        cands = self.rank(item, await self.candidates(item, names, broad_set), names, broad_set)
        if not cands:
            return
        by_id = {c.id: c for c in cands}
        texts = {c.id: f"{c.title}. {c.snippet}" for c in cands}
        try:
            # short ids (C1, C2 ...): models copy them back reliably; long hashes they garble
            short = {f"C{i + 1}": c.id for i, c in enumerate(cands)}
            judged = (await RelationReasoner(self.e.llm).run({"date": item.date, "text": focus_text}, [{"id": k, "date": by_id[v].date, "text": texts[v][:700]} for k, v in short.items()])).items
            for j in judged:
                j.id = short.get(j.id.strip().strip("[]"), j.id)
        except QuotaExhausted:
            judged = []
        except Exception:  # noqa: BLE001 (a bad answer must not break the expansion)
            judged = []
        done = set()
        for j in judged:
            c = by_id.get(j.id)
            if c and j.relation == "unrelated" and j.confidence != "low":
                done.add(c.id)  # the model looked and found no link: no fallback link either
            if not c or j.relation == "unrelated" or j.confidence == "low" or j.relation not in RELATION_EDGE:
                continue
            q_focus = verify_parts(j.quote_focus, focus_text)
            q_other = verify_parts(j.quote_other, texts[c.id])
            if not q_focus or not q_other or not date_fits(j.relation, item.date, c.date):
                continue
            async for ev in self._emit(item, c, j.relation, q_focus, q_other, j.reason, node, edge, retrieved):
                yield ev
            done.add(c.id)
        # code-only fallback when the model gave no usable answer for an item (out of quota,
        # or its quotes failed the check): items that name the same entity (Reported, two quotes)
        for c in cands:
            if c.id in done:
                continue
            # specific names first; a broad place only as the second of two shared names
            shared = [n for n in names if mention(texts[c.id], n)]
            if not shared or (all(n in broad_set for n in shared) and len(shared) < 2):
                continue
            for n in sorted(shared, key=lambda x: x in broad_set):
                q_focus = verify_quote(mention(focus_text, n) or "", focus_text)
                q_other = verify_quote(mention(texts[c.id], n) or "", texts[c.id])
                if q_focus and q_other:
                    async for ev in self._emit(item, c, "shares_entity", q_focus, q_other, f"Both name {n}.", node, edge, retrieved):
                        yield ev
                    break

    async def _emit(self, item, c: RawItem, relation, q_focus, q_other, reason, node, edge, retrieved):
        etype, direction, label = RELATION_EDGE[relation]
        fd, cd = _day(item.date), _day(c.date)
        older = bool(fd and cd and (fd - cd).days >= OLD_DAYS)
        self.e.items.set(c.id, c.to_dict())  # so it can grow too
        n = {
            "id": c.id, "type": "NewsItem", "label": c.title, "outlet": c.outlet, "url": c.url, "date": c.date,
            "kind": "archive" if older else c.kind, "via": c.source, "summary": c.snippet[:220], "licence": c.licence, "group": "related",
        }
        if ev := node(n):
            ev["group"] = "related"
            yield ev
        frm, to = (item.id, c.id) if direction == "focus->other" else (c.id, item.id)
        src_other = c.extra.get("portal") if c.source == "wikipedia" else c.url
        e = edge({
            "type": etype, "from": frm, "to": to, "label": label, "relation": relation,
            "reasoning": reason or f"{relation.replace('_', ' ')}, from the two quotes",
            "basis": [q_focus, q_other],  # an inferred link rests on the two verified quotes
            "evidence": [
                {"source": item.outlet, "url": item.url, "quote": q_focus, "date": item.date, "retrievedAt": retrieved, "side": "focus"},
                {"source": c.outlet or "en.wikipedia.org", "url": src_other, "quote": q_other, "date": c.date, "retrievedAt": retrieved, "side": "other"},
            ],
        })
        if e:
            e["group"] = "related"
            yield e
