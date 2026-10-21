"""Story clustering eval: do related items group correctly?

Gold: Wikipedia Current events story headings (e.g. '2026 Iran war').
Method: the production method (bge-small embeddings of title + snippet,
single-link clustering above a cosine threshold). The threshold is tuned on
the DEV days only and reported on the TEST days, plus the current production
threshold (0.72). Also checks near-duplicate removal (0.93) never merges
different stories.

  python eval/cluster_eval.py   ->  eval/results/cluster.json
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from itertools import combinations
from math import comb
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fogweave import embed as E  # noqa: E402

DATA = ROOT / "eval" / "data"
OUT = ROOT / "eval" / "results"
PROD = 0.72


def pairwise(gold, pred):
    tp = fp = fn = 0
    for i, j in combinations(range(len(gold)), 2):
        same_g, same_p = gold[i] == gold[j], pred[i] == pred[j]
        tp += same_g and same_p
        fp += (not same_g) and same_p
        fn += same_g and not same_p
    p = tp / (tp + fp) if tp + fp else 1.0
    r = tp / (tp + fn) if tp + fn else 1.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return {"precision": round(p, 3), "recall": round(r, 3), "f1": round(f, 3)}


def ari(gold, pred):
    n = len(gold)
    cont = Counter(zip(gold, pred))
    a = Counter(gold)
    b = Counter(pred)
    sum_ij = sum(comb(v, 2) for v in cont.values())
    sum_a = sum(comb(v, 2) for v in a.values())
    sum_b = sum(comb(v, 2) for v in b.values())
    exp = sum_a * sum_b / comb(n, 2) if n > 1 else 0
    mx = (sum_a + sum_b) / 2
    return round((sum_ij - exp) / (mx - exp), 3) if mx != exp else 1.0


def evaluate(rows, vecs, threshold):
    """Baseline: single-link on embeddings only."""
    gold = [r["story"] for r in rows]
    pred = E.cluster(vecs, threshold)
    return {**pairwise(gold, pred), "ari": ari(gold, pred), "clusters": len(set(pred)), "stories": len(set(gold))}


def evaluate_prod(rows):
    """Production: average-link on embeddings + shared names (alpha 0.5, threshold 0.35, chosen on DEV)."""
    gold = [r["story"] for r in rows]
    pred = E.stories([f"{r['title']}. {r['snippet'][:200]}" for r in rows])
    return {**pairwise(gold, pred), "ari": ari(gold, pred), "clusters": len(set(pred)), "stories": len(set(gold))}


def main():
    data = json.loads((DATA / "cluster.json").read_text(encoding="utf-8"))
    rows = data["entries"]
    vecs = E.embed([f"{r['title']}. {r['snippet'][:200]}" for r in rows])
    idx = {s: [i for i, r in enumerate(rows) if r["split"] == s] for s in ("dev", "test")}
    sweep = []
    for t in [round(0.5 + 0.025 * k, 3) for k in range(17)]:
        sweep.append({"threshold": t, **evaluate([rows[i] for i in idx["dev"]], vecs[idx["dev"]], t)})
    best = max(sweep, key=lambda s: (s["f1"], -abs(s["threshold"] - PROD)))
    test_rows = [rows[i] for i in idx["test"]]
    res = {
        "backend": E.BACKEND,
        "n": {"dev": len(idx["dev"]), "test": len(idx["test"]), "stories": len(data["stories"])},
        "dev_sweep": sweep,
        "baseline_tuned_threshold": best["threshold"],
        "baseline_single_link_test_at_tuned": evaluate(test_rows, vecs[idx["test"]], best["threshold"]),
        "baseline_single_link_test_at_0.72": evaluate(test_rows, vecs[idx["test"]], PROD),
        "production_avg_link_names": {"dev": evaluate_prod([rows[i] for i in idx["dev"]]), "test": evaluate_prod(test_rows)},
    }
    # near-duplicate removal must not merge different stories
    drop = E.near_duplicates(vecs)
    sims = vecs @ vecs.T
    wrong = [(i, j) for i, j in combinations(range(len(rows)), 2) if sims[i, j] >= 0.93 and rows[i]["story"] != rows[j]["story"]]
    res["dedupe"] = {"dropped": len(drop), "cross_story_pairs_above_0.93": len(wrong)}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "cluster.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in res.items() if k != "dev_sweep"}, indent=1))


if __name__ == "__main__":
    main()
