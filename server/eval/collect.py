"""Build the evaluation sets from Wikipedia's Current events portal, whose
sections (domains) and story headings give honest ground truth.

  python eval/collect.py

Writes eval/data/items.json (impact + connection set: 30 items, stratified
across sections) and eval/data/cluster.json (story-clustering set: entries
from stories with >= 2 entries; dev days vs test days kept apart).
"""

from __future__ import annotations

import asyncio
import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fogweave.http import PoliteClient  # noqa: E402
from fogweave.sources.wikipedia import WikipediaAdapter  # noqa: E402

DATA = ROOT / "eval" / "data"
END = datetime(2026, 10, 19, tzinfo=timezone.utc)  # fixed so the set is reproducible
DAYS = 14
PERSONAS = {
    "A": ["Rotterdam", "logistics", "energy prices", "public transport"],
    "B": ["Uttar Pradesh", "farming", "monsoon", "rice"],
    "C": ["Seoul", "software engineering", "cloud computing", "semiconductors"],
}


async def main():
    http = PoliteClient()
    wiki = WikipediaAdapter(http)
    entries = []
    for back in range(DAYS):
        day = END - timedelta(days=back)
        for it in await wiki.current_events(day):
            entries.append(it.to_dict())
    await http.aclose()
    print(f"{len(entries)} entries from {DAYS} days")

    # ---- impact set: round-robin across sections, newest first, one per story
    by_section = defaultdict(list)
    for e in entries:
        by_section[e["extra"]["section"] or "Other"].append(e)
    picked, seen_story = [], set()
    while len(picked) < 30 and any(by_section.values()):
        for sec in sorted(by_section):
            if not by_section[sec] or len(picked) >= 30:
                continue
            e = by_section[sec].pop(0)
            story = " > ".join(e["extra"]["storyPath"][:1]) or e["id"]
            if story in seen_story:
                continue
            seen_story.add(story)
            picked.append(e)
    for i, e in enumerate(picked):
        e["persona"] = "ABC"[i % 3]
    sections = sorted({e["extra"]["section"] for e in picked})
    print(f"impact set: {len(picked)} items across {len(sections)} sections: {sections}")

    # ---- clustering set: stories (top heading) with >= 2 entries
    by_story = defaultdict(list)
    for e in entries:
        if e["extra"]["storyPath"]:
            by_story[e["extra"]["storyPath"][0]].append(e)
    multi = {k: v for k, v in by_story.items() if len(v) >= 2}
    stories = sorted(multi, key=lambda k: -len(multi[k]))[:20]
    cluster = []
    for k in stories:
        for e in multi[k][:5]:
            cluster.append({"id": e["id"], "title": e["title"], "snippet": e["snippet"], "story": k, "day": e["date"][:10]})
    dev_days = {(END - timedelta(days=b)).date().isoformat() for b in range(7, DAYS)}
    for c in cluster:
        c["split"] = "dev" if c["day"] in dev_days else "test"
    print(f"cluster set: {len(cluster)} entries in {len(stories)} stories (dev {sum(c['split']=='dev' for c in cluster)}, test {sum(c['split']=='test' for c in cluster)})")

    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "items.json").write_text(json.dumps({"collected": datetime.now(timezone.utc).isoformat(), "personas": PERSONAS, "items": picked}, indent=1, ensure_ascii=False), encoding="utf-8")
    (DATA / "cluster.json").write_text(json.dumps({"stories": stories, "entries": cluster}, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
