"""Expand every eval item with its persona's context and save the full event
log (resumable: finished items are skipped; LLM/HTTP caches make reruns cheap).

  python eval/run.py            all items
  python eval/run.py --limit 5
  python eval/run.py --out runs_after   (same items, current pipeline, for before/after)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fogweave.pipeline import Engine  # noqa: E402

DATA = ROOT / "eval" / "data"
RUNS = ROOT / "eval" / "runs"


async def main(limit: int | None, out_dir: str):
    RUNS = ROOT / "eval" / out_dir
    spec = json.loads((DATA / "items.json").read_text(encoding="utf-8"))
    personas = spec["personas"]
    RUNS.mkdir(parents=True, exist_ok=True)
    eng = Engine()
    todo = spec["items"][:limit] if limit else spec["items"]
    for n, item in enumerate(todo, 1):
        out = RUNS / f"{item['id'].replace(':', '_')}.json"
        if out.exists() and json.loads(out.read_text(encoding="utf-8")).get("done"):
            continue
        eng.items.set(item["id"], {k: v for k, v in item.items() if k != "persona"})
        ctx = personas[item["persona"]]
        t0 = time.monotonic()
        events, first_node_ms, error = [], None, None
        try:
            async for ev in eng.expand(item["id"], context=ctx):
                if ev["type"] == "node" and first_node_ms is None:
                    first_node_ms = int((time.monotonic() - t0) * 1000)
                events.append(ev)
        except Exception as exc:  # noqa: BLE001
            error = f"{type(exc).__name__}: {exc}"
        done = bool(events) and events[-1]["type"] == "done" and not events[-1].get("stats", {}).get("error")
        out.write_text(
            json.dumps({"item": item, "persona": item["persona"], "context": ctx, "events": events, "firstNodeMs": first_node_ms, "error": error, "done": done}, ensure_ascii=False),
            encoding="utf-8",
        )
        st = events[-1].get("stats", {}) if events else {}
        print(f"[{n}/{len(todo)}] {item['id']} done={done} ms={st.get('ms')} calls={st.get('llmCalls')} tokens={st.get('llmTokens')} notes={st.get('notes')} | {item['title'][:60]}", flush=True)
    print("llm", json.dumps(eng.llm.stats), flush=True)
    await eng.http.aclose()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--out", default="runs")
    a = ap.parse_args()
    asyncio.run(main(a.limit, a.out))
