"""Feed candidate pool: tags and code-computed quality for each item.

The client draws the visible lights from this pool by seeded weighted random
sampling (src/feed.js), so the same logic works offline on the bundled pool.
Quality is never an LLM number:
  quality = 0.40 source class + 0.30 recency + 0.20 usefulness + 0.10 novelty
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone

from .evidence import CLASS_WEIGHT, classify_source

NEWS_TYPES = ["technology", "science", "business", "climate", "health", "space", "politics", "world", "culture", "sports"]

# arXiv categories offered as paper types (labels shown in the app)
PAPER_TYPES = {
    "cs.AI": "Artificial intelligence",
    "cs.CL": "Language models and NLP",
    "cs.RO": "Robotics",
    "cs.HC": "Human-computer interaction",
    "physics.soc-ph": "Physics and society",
    "astro-ph.GA": "Astrophysics (galaxies)",
    "q-bio.PE": "Biology (populations, evolution)",
    "econ.GN": "Economics",
    "eess.SY": "Systems and control",
    "cond-mat.mtrl-sci": "Materials science",
}

SECTION_TYPES = {
    "armed conflicts": ["world"],
    "arts": ["culture"],
    "business": ["business"],
    "disasters": ["world", "climate"],
    "health": ["health", "climate"],
    "international": ["politics", "world"],
    "law": ["politics"],
    "politics": ["politics"],
    "science": ["science", "technology"],
    "sports": ["sports"],
}

# GDELT query per news type (one paced request each)
TYPE_QUERIES = {
    "technology": "(technology OR software OR semiconductor OR \"artificial intelligence\")",
    "science": "(scientists OR research OR study)",
    "business": "(economy OR markets OR company OR trade)",
    "climate": "(climate OR emissions OR renewable OR drought)",
    "health": "(health OR hospital OR vaccine OR outbreak)",
    "space": "(space OR NASA OR satellite OR rocket)",
    "politics": "(election OR parliament OR government)",
    "world": "(conflict OR ceasefire OR summit)",
    "culture": "(film OR music OR museum OR literature)",
    "sports": "(football OR olympics OR championship)",
}
KEYWORDS = {
    "space": ["outer space", "spacecraft", "nasa", "satellite", "rocket", "orbit", "astronaut", "moon", "mars", "star", "galaxy", "jaxa", "esa"],
    "climate": ["climate", "emission", "carbon", "renewable", "solar", "wind power", "drought", "flood", "deforestation", "heatwave"],
    "health": ["health", "virus", "vaccine", "disease", "hospital", "outbreak", "ebola", "malaria", "medical"],
    "technology": ["software", "ai ", "artificial intelligence", "chip", "semiconductor", "app", "open-source", "computer", "robot", "cyber"],
    "business": ["bank", "market", "economy", "company", "stake", "trade", "tariff", "inflation", "shares"],
}


def tags_for(item) -> list[str]:
    """News types (and paper categories) for one RawItem."""
    tags: list[str] = []
    sec = str(item.extra.get("section", "")).lower()
    for key, types in SECTION_TYPES.items():
        if key in sec:
            tags += types
    if item.source == "hackernews":
        tags.append("technology")
    if item.source == "arxiv":
        tags.append("science")
        tags += item.extra.get("categories", [])
    if item.extra.get("type"):
        tags.append(item.extra["type"])
    text = f" {item.title} {item.snippet} ".lower()
    for t, words in KEYWORDS.items():
        if any(re.search(r"(?<![a-z])" + re.escape(w.strip()) + r"(?![a-z])", text) for w in words):
            tags.append(t)
    if not tags:
        tags.append("world")
    return sorted(set(tags))


def _recency(date: str, now: datetime) -> float:
    try:
        dt = datetime.fromisoformat(date.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return 0.3
    if dt.tzinfo is None:  # a bare date ("2026-09-30") counts as UTC
        dt = dt.replace(tzinfo=timezone.utc)
    days = max(0.0, (now - dt).total_seconds() / 86400)
    return math.exp(-days / 5)  # about half after 3.5 days


def quality(items, vecs, now: datetime | None = None) -> list[dict]:
    """Per-item quality breakdown (code only)."""
    now = now or datetime.now(timezone.utc)
    out = []
    for i, it in enumerate(items):
        hint = it.extra.get("sourceClass") or ("news" if it.source in ("gdelt", "wikipedia") else None)
        cls = classify_source(it.outlet, hint)
        if it.source == "arxiv":
            cls = "education"
        src = CLASS_WEIGHT.get(cls, 0.3)
        if it.source == "wikipedia":
            src = max(src, 0.75)  # curated by editors, with cited outlets
        rec = _recency(it.date, now) if it.kind != "archive" else 0.5  # archive items are wanted as archive
        words = len(re.findall(r"\w+", it.snippet))
        useful = min(1.0, 0.3 + words / 60) if it.snippet else 0.3
        if it.source == "hackernews":
            useful = min(1.0, 0.4 + it.extra.get("score", 0) / 800)
        novelty = 1.0
        if vecs is not None and i > 0:
            sims = vecs[:i] @ vecs[i]
            novelty = float(max(0.0, 1.0 - max(sims.max(), 0.0)))
        q = 0.40 * src + 0.30 * rec + 0.20 * useful + 0.10 * novelty
        out.append({"quality": round(q, 3), "breakdown": {"source": round(src, 2), "sourceClass": cls, "recency": round(rec, 2), "usefulness": round(useful, 2), "novelty": round(novelty, 2)}})
    return out


def interest_queries(interests: dict) -> tuple[list[str], list[str]]:
    """(GDELT queries, arXiv categories) shaped by the reader's interests."""
    types = [t for t in interests.get("newsTypes", []) if t in TYPE_QUERIES][:2]
    topics = [re.sub(r"[^\w\s-]", " ", t.get("label", "")).strip() for t in sorted(interests.get("topics", []), key=lambda t: -t.get("weight", 1))[:3]]
    queries = [TYPE_QUERIES[t] for t in types]
    topics = [t for t in topics if t]
    if topics:
        queries.append("(" + " OR ".join(f'"{t}"' if " " in t else t for t in topics) + ")")
    cats = [c for c in interests.get("paperTypes", []) if c in PAPER_TYPES][:4]
    return queries[:2], cats
