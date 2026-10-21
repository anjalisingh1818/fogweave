"""Connect the dots (V3 F6): patterns across the items the reader sealed.

The model proposes patterns (the same actor again and again, a recurring kind
of event, a sequence in time, a contrast); code keeps only those it can show:
  - at least two of the reader's items, each with a short quote that is in
    that item's own text (verbatim)
  - a sequence must run in date order
  - low-confidence patterns are dropped
Patterns are Inferred: they come from reading the items together, not from a
source that states them. Shared names across items are found in the client
from the graph itself (Reported), so they need no model.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .llm import QuotaExhausted
from .related import _day, verify_parts
from .safety import UNTRUSTED_RULES, wrap_untrusted

KINDS = ("same_actor", "recurring", "sequence", "contrast", "common_theme")


class PatternQuote(BaseModel):
    id: str = Field(description="the item id, as given (I1, I2 ...)")
    quote: str = Field(description="ONE continuous exact span from that item's text, 20 words or fewer, no '...'")


class Pattern(BaseModel):
    kind: Literal["same_actor", "recurring", "sequence", "contrast", "common_theme"]
    text: str = Field(description="the pattern in one or two plain sentences")
    quotes: list[PatternQuote] = Field(description="one quote from each item that shows the pattern (two or more items)")
    confidence: Literal["low", "medium", "high"]


class Patterns(BaseModel):
    items: list[Pattern]


class PatternFinder:
    def __init__(self, llm):
        self.llm = llm

    async def run(self, items: list[dict]) -> Patterns:
        listing = "\n\n".join(f"[{i['sid']}] ({i['type']}{', ' + i['date'][:10] if i['date'] else ''}) {i['label']}. {i['text']}" for i in items)
        return await self.llm.json(
            role="patterns",
            system=(
                "You find patterns across the ITEMS a reader saved: same_actor (the same person, organisation or place acts in several items), "
                "recurring (the same kind of event happens again), sequence (one item's event follows from or after another's), "
                "contrast (items disagree or show opposite trends), common_theme (a shared underlying issue). "
                "Give at most 4 patterns, each across two or more items, with one quote from each item. "
                "Each quote is ONE continuous exact span copied from that item's text (20 words or fewer, no '...'). "
                "Do not invent facts, do not predict, and give no financial, medical or legal advice. "
                "If there is no real pattern, return an empty list. " + UNTRUSTED_RULES
            ),
            user="ITEMS:\n" + wrap_untrusted(listing, 7000),
            schema=Patterns,
            max_tokens=1400,
        )


def check(p: Pattern, by_sid: dict[str, dict]) -> dict | None:
    """Keep a pattern only when code can show it: two or more items, verbatim quotes, date order."""
    if p.confidence == "low" or p.kind not in KINDS:
        return None
    quotes, seen = [], set()
    for q in p.quotes:
        it = by_sid.get(q.id.strip().strip("[]"))
        if not it or it["id"] in seen:
            continue
        ok = verify_parts(q.quote, f"{it['label']}. {it['text']}")
        if ok:
            quotes.append({"id": it["id"], "quote": ok, "date": it["date"]})
            seen.add(it["id"])
    if len(quotes) < 2:
        return None
    if p.kind == "sequence":
        days = [_day(q["date"]) for q in quotes]
        if any(d is None for d in days):
            return None
        quotes.sort(key=lambda q: _day(q["date"]))
    return {"kind": p.kind, "text": p.text.strip(), "label": "inferred", "items": [q["id"] for q in quotes], "quotes": quotes}


async def find_patterns(llm, items: list[dict]) -> dict:
    if len(items) < 2:
        return {"patterns": [], "note": "Seal two or more items to look for patterns."}
    by_sid = {}
    for n, it in enumerate(items):
        it["sid"] = f"I{n + 1}"  # short ids: models copy them back reliably
        by_sid[it["sid"]] = it
    try:
        found = (await PatternFinder(llm).run(items)).items
    except QuotaExhausted:
        return {"patterns": [], "degraded": True, "note": "Free model quota is spent for now; shared names are still shown."}
    except Exception:  # noqa: BLE001 (a bad answer must not break the Library)
        return {"patterns": [], "degraded": True, "note": "The pattern finder gave no usable answer; shared names are still shown."}
    kept = [x for x in (check(p, by_sid) for p in found) if x]
    dropped = len(found) - len(kept)
    note = f"{dropped} suggested pattern{'s' if dropped != 1 else ''} dropped: quotes not found in the items, too few items, or low confidence." if dropped else ""
    return {"patterns": kept[:4], "note": note}
