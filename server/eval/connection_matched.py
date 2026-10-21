"""Matched connection cases: items re-expanded with a persona that plausibly
relates to them (hand-picked by reading the titles; listed here so anyone can
check the choice). Together with the round-robin runs (mostly unrelated
personas) this tests both sides of "Touches me?": finding a grounded thread
when one exists, and saying "no clear connection" when not.

  python eval/connection_matched.py  ->  eval/runs_matched/*.json
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fogweave.pipeline import Engine  # noqa: E402

MATCHED = {
    "n:2ea4338fe8f4": ["Calgary", "Alberta", "oil and gas", "public transport"],  # Alberta referendums
    "n:e40e07b73237": ["Madhya Pradesh", "farming", "road travel"],  # Gwalior truck accident
    "n:0460555895d3": ["Guadalajara", "water supply", "small business"],  # Guadalajara water protests
    "n:047b20792022": ["United Kingdom", "retail", "cash payments"],  # Bank of England banknotes
    "n:c4f3475d8101": ["Brazil", "agriculture", "climate policy"],  # Brazil deforestation
    "n:8ab7353c3a4a": ["Frankfurt", "banking", "Commerzbank"],  # ECB / UniCredit / Commerzbank
    "n:f5225c9d8fb5": ["Nairobi", "healthcare work", "air travel"],  # Kenya Ebola cases
    "n:9700f8a230bf": ["Taiwan", "fishing", "semiconductors"],  # Taiwan coast guard
}
OUT = ROOT / "eval" / "runs_matched"


async def main():
    items = {i["id"]: i for i in json.loads((ROOT / "eval" / "data" / "items.json").read_text(encoding="utf-8"))["items"]}
    OUT.mkdir(parents=True, exist_ok=True)
    eng = Engine()
    for iid, ctx in MATCHED.items():
        out = OUT / f"{iid.replace(':', '_')}.json"
        if out.exists():
            continue
        item = items[iid]
        eng.items.set(iid, {k: v for k, v in item.items() if k != "persona"})
        events = [ev async for ev in eng.expand(iid, context=ctx)]
        done = bool(events) and events[-1]["type"] == "done"
        out.write_text(json.dumps({"item": item, "persona": "matched", "context": ctx, "events": events, "done": done}, ensure_ascii=False), encoding="utf-8")
        print(iid, done, sum(1 for e in events if e["type"] == "edge" and e["edge"]["to"].startswith("ctx:")), "ctx links", flush=True)
    await eng.http.aclose()


if __name__ == "__main__":
    asyncio.run(main())
