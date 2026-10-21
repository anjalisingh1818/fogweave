"""Verifier agreement sample: re-run the production verification step on
recorded claims and capture (claim, evidence text, model stance) pairs for
hand labelling. Uses the same code path as live expansions (Engine._verify)
with a spy on the Verifier, so what is judged is what the app does.

  python eval/verify_sample.py   ->  eval/results/verifier_pairs.json
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fogweave import pipeline  # noqa: E402
from fogweave.pipeline import Engine  # noqa: E402

RUNS = ROOT / "eval" / "runs"
OUT = ROOT / "eval" / "results"


async def main(target_pairs: int = 40):
    eng = Engine()
    pairs = []
    orig = pipeline.Verifier.run

    async def spy(self, claims, evidence):
        out = await orig(self, claims, evidence)
        cl = {c["id"]: c["text"] for c in claims}
        ev = {e["id"]: e for e in evidence}
        for j in out.items:
            if j.claim_id in cl and j.evidence_id in ev:
                pairs.append({"claim_id": j.claim_id, "claim": cl[j.claim_id], "evidence_domain": ev[j.evidence_id]["domain"], "evidence": ev[j.evidence_id]["text"][:700], "model": j.stance})
        return out

    pipeline.Verifier.run = spy
    for p in sorted(RUNS.glob("*.json")):
        if len(pairs) >= target_pairs:
            break
        r = json.loads(p.read_text(encoding="utf-8"))
        item = eng._item(r["item"]["id"])
        if not item:
            eng.items.set(r["item"]["id"], {k: v for k, v in r["item"].items() if k != "persona"})
            item = eng._item(r["item"]["id"])
        x = eng.reads.get(item.id)
        if not x or not x["claims"]:
            continue
        claim_ids = [f"{item.id}:c{i + 1}" for i in range(len(x["claims"]))]
        try:
            async for _ in eng._verify(item, x, claim_ids, lambda n: None, lambda e: None, {}):
                pass
        except Exception as exc:  # noqa: BLE001
            print("skip", item.id, exc)
        print(item.id, "pairs so far", len(pairs), flush=True)
    pipeline.Verifier.run = orig
    await eng.http.aclose()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "verifier_pairs.json").write_text(json.dumps(pairs, indent=1, ensure_ascii=False), encoding="utf-8")
    print("pairs", len(pairs), {s: sum(p["model"] == s for p in pairs) for s in ("supports", "contradicts", "unclear")})


if __name__ == "__main__":
    asyncio.run(main())
