"""Live smoke run: fetch lights, read + expand one item, print a summary.
Usage: python scripts/try_expand.py [index] [context labels...]"""

import asyncio
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fogweave.pipeline import Engine  # noqa: E402


async def main():
    idx = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    context = sys.argv[2:]
    eng = Engine()
    lights = await eng.lights(context=context)
    print("sources:", json.dumps(lights["sources"]))
    print("notes:", lights["notes"])
    for i, it in enumerate(lights["items"][:25]):
        print(f"{i:2d} {it['via']:10s} {it['kind']:8s} rel={it['relevance']:.2f} story={it['story']:2d} {it['source']:22s} {it['headline'][:70]}")
    item = lights["items"][idx]
    print("\nREAD", item["headline"])
    print(json.dumps(await eng.read(item["id"]), indent=1, ensure_ascii=False)[:1500])
    print("\nEXPAND")
    kinds, labels, types = Counter(), Counter(), Counter()
    async for ev in eng.expand(item["id"], context=context):
        kinds[ev["type"]] += 1
        if ev["type"] == "edge":
            e = ev["edge"]
            labels[e["label"]] += 1
            types[e["type"]] += 1
            if e["label"] != "reported" or e["type"] in ("supports", "contradicts"):
                print(f"  {e['label']:11s} {e['from']} -{e['type']}-> {e['to']}  {e.get('reasoning', '')[:90]}")
        elif ev["type"] in ("status", "note"):
            print(" ", ev["type"], ev.get("text"))
        elif ev["type"] == "verified":
            print("  verified", ev["id"], ev["verdict"], json.dumps(ev["evidence"]))
        elif ev["type"] == "done":
            print("  done", json.dumps(ev["stats"], ensure_ascii=False)[:900])
    print(dict(kinds), dict(labels), dict(types))
    print("llm stats", eng.llm.stats)
    await eng.http.aclose()


asyncio.run(main())
