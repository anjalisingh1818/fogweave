"""Record a dated offline snapshot from REAL pipeline runs (take-it-away test).

  python scripts/snapshot.py [--expand 3] [--read 8]

Writes ../public/demo/snapshot/index.json and expansions/<id>.json. The
lights, reader claims and expansions are exactly what the live engine
produced, recorded event by event, so the offline app replays real output.
Context used: the fictional sample persona (labelled as such in the app).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fogweave import embed, ontology  # noqa: E402
from fogweave.answer import answer  # noqa: E402
from fogweave.pipeline import Engine, now_iso  # noqa: E402

QUESTIONS = ["What changes because of this?", "Who is affected?", "What happened before this?"]

OUT = ROOT.parent / "public" / "demo" / "snapshot"
PERSONA = ["Rotterdam", "logistics", "cloud computing", "electric vehicles", "public transport", "energy prices"]


def safe_name(item_id: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", item_id.lower()).strip("-") + ".json"


async def main(n_expand: int, n_read: int, max_lights: int):
    eng = Engine()
    t0 = time.monotonic()
    lights = await eng.lights(context=PERSONA)
    items = lights["items"][:max_lights]
    print(f"lights: {len(items)} from {json.dumps(lights['sources'])}")

    # reader-card claims for the most relevant items
    order = sorted(items, key=lambda it: -it["relevance"])
    world = [it for it in items if it["via"] in ("wikipedia", "gdelt") and it["kind"] == "breaking"]
    to_read = []
    seen = set()
    for it in [*world[:6], *order]:
        if it["id"] not in seen and len(to_read) < n_read:
            seen.add(it["id"])
            to_read.append(it)
    for it in to_read:
        r = await eng.read(it["id"])
        it["claims"] = r.get("claims", [])
        it["textHow"] = r.get("textHow")
        if r.get("note"):
            it["claimsNote"] = r["note"]
        print(f"  read {it['id']} claims={len(it['claims'])} {r.get('textHow')} | {it['headline'][:60]}")

    # expand items whose article text could be read, most relevant first
    # world news with >=2 verified claims first, then the rest by relevance
    candidates = sorted(
        [it for it in to_read if len(it.get("claims") or []) >= 2],
        key=lambda it: (it["via"] not in ("wikipedia", "gdelt"), it.get("textHow") != "article", -it["relevance"]),
    )
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "expansions").mkdir(parents=True)
    expansions = {}
    for it in candidates[:n_expand]:
        events = []
        async for ev in eng.expand(it["id"], context=PERSONA):
            events.append(ev)
        stats = events[-1].get("stats", {}) if events else {}
        # recorded answers to the suggested questions, over exactly this web
        nodes, edges = {}, []
        for ev in events:
            if ev["type"] == "node":
                nodes[ev["node"]["id"]] = dict(ev["node"])
            elif ev["type"] == "edge":
                edges.append(ev["edge"])
            elif ev["type"] == "verified" and ev["id"] in nodes:
                nodes[ev["id"]].update(verdict=ev["verdict"], evidence=ev["evidence"])
        graph = {"nodes": [n for n in nodes.values() if n.get("type") != "ContextNode"], "edges": edges}
        answers = {}
        for q in QUESTIONS:
            try:
                r = await answer(eng.llm, eng.router, q, graph, fresh=False)
                answers[q] = {**r, "recordedAt": now_iso()}
            except Exception as exc:  # noqa: BLE001
                print("   answer failed:", q, exc)
        name = safe_name(it["id"])
        (OUT / "expansions" / name).write_text(
            json.dumps({"id": it["id"], "recordedAt": now_iso(), "context": "sample persona (fictional)", "events": events, "stats": stats, "answers": answers}, ensure_ascii=False),
            encoding="utf-8",
        )
        expansions[it["id"]] = f"expansions/{name}"
        kinds = {}
        for ev in events:
            if ev["type"] == "edge":
                kinds[ev["edge"]["label"]] = kinds.get(ev["edge"]["label"], 0) + 1
        print(f"  expand {it['id']} events={len(events)} labels={kinds} ms={stats.get('ms')} | {it['headline'][:60]}")

    index = {
        "schema": "fogweave.snapshot/1",
        "generatedAt": now_iso(),
        "provenance": {
            "kind": "pipeline",
            "note": "Recorded output of the live FogWeave engine. Titles, our own short summaries, short verbatim quotes and links only.",
            "ontology": ontology.VERSION,
            "embeddings": embed.BACKEND,
            "llm": eng.llm.stats,
            "sources": lights["sources"],
            "attribution": [
                "Wikipedia text is CC BY-SA 4.0 (Wikipedia contributors)",
                "News metadata: The GDELT Project, https://www.gdeltproject.org/",
                "Via Hacker News (titles and links)",
                "Paper metadata from arXiv (CC0); not endorsed by arXiv",
            ],
        },
        "persona": {"fictional": True, "labels": PERSONA},
        "lights": [{**it, "live": False} for it in items],
        "expansions": expansions,
        "seconds": int(time.monotonic() - t0),
    }
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT} in {index['seconds']} s; llm {eng.llm.stats}")
    await eng.http.aclose()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--expand", type=int, default=3)
    ap.add_argument("--read", type=int, default=11)
    ap.add_argument("--max-lights", type=int, default=18)
    a = ap.parse_args()
    asyncio.run(main(a.expand, a.read, a.max_lights))
