"""Ablation: does the graph help answers?

Same 30 questions (10 expanded items x 3 questions), two conditions:
  A  search-only : facts from a fresh search on the question (no graph)
  B  graph       : the item's web (GraphRAG) + the same fresh search
Answers and their cited facts are saved for hand judging (accuracy and
citation correctness); the judging rubric is in eval/README.md.

  python eval/ablation.py   ->  eval/results/ablation.json
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fogweave.answer import answer  # noqa: E402
from fogweave.pipeline import Engine  # noqa: E402

RUNS = ROOT / "eval" / "runs"
OUT = ROOT / "eval" / "results"
QUESTIONS = ["Who is affected?", "What changes because of this?", "Where did this happen?"]


def graph_of(events):
    nodes = {}
    edges = []
    for ev in events:
        if ev["type"] == "node":
            nodes[ev["node"]["id"]] = dict(ev["node"])
        elif ev["type"] == "edge":
            edges.append(ev["edge"])
        elif ev["type"] == "verified" and ev["id"] in nodes:
            nodes[ev["id"]].update(verdict=ev["verdict"], evidence=ev["evidence"])
    return {"nodes": [n for n in nodes.values() if n["type"] != "ContextNode"], "edges": edges}


async def main():
    eng = Engine()
    runs = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(RUNS.glob("*.json"))]
    runs = [r for r in runs if r.get("done") and sum(e["type"] == "node" for e in r["events"]) >= 8][:10]
    out = []
    for r in runs:
        g = graph_of(r["events"])
        title = r["item"]["title"]
        for q in QUESTIONS:
            # the question names the story so search-only has a fair chance
            full = f"{q} ({title[:90]})"
            a = await answer(eng.llm, eng.router, full, {"nodes": [], "edges": []}, fresh=True)
            b = await answer(eng.llm, eng.router, full, g, fresh=True)
            out.append({"item": r["item"]["id"], "title": title, "question": q, "search_only": a, "graph": b})
            print(f"{r['item']['id']} | {q} | A:{a.get('answerable')} B:{b.get('answerable')}", flush=True)
    await eng.http.aclose()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "ablation.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print("llm", eng.llm.stats)


if __name__ == "__main__":
    asyncio.run(main())
