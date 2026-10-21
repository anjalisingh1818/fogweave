"""V3 eval: relation precision on related-news pairs (V3 §11).

  python eval/v3_relations.py collect   # grow the 30 eval items live, keep every related-news pair
  python eval/v3_relations.py sheet     # print the pairs for labelling
  python eval/v3_relations.py score     # precision from eval/labels/v3_relation_labels.json

A pair is one focus news item and one other news item that the Related-News
Finder linked to it, with the relation, the label and both quotes. A label
says whether the relation is right for the two texts (the relation kind, the
direction in time, and that the quotes show it). Labels are made by the build
assistant (Claude), not an independent human; each keeps a reason.
"""

from __future__ import annotations

import asyncio
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DATA = ROOT / "eval" / "data" / "items.json"
OUT = ROOT / "eval" / "runs_v3"
PAIRS = OUT / "relations.json"
LABELS = ROOT / "eval" / "labels" / "v3_relation_labels.json"


async def collect():
    from fogweave.pipeline import Engine

    items = json.loads(DATA.read_text(encoding="utf-8"))["items"]
    eng = Engine()
    OUT.mkdir(parents=True, exist_ok=True)
    pairs = json.loads(PAIRS.read_text(encoding="utf-8")) if PAIRS.exists() else []
    done = {p["focus"]["id"] for p in pairs} | set(json.loads((OUT / "done.json").read_text()) if (OUT / "done.json").exists() else [])
    for item in items:
        if item["id"] in done:
            continue
        eng.items.set(item["id"], {k: v for k, v in item.items() if k != "persona"})
        nodes, edges = {}, []
        try:
            async for ev in eng.expand(item["id"]):
                if ev["type"] == "node":
                    nodes[ev["node"]["id"]] = ev["node"]
                elif ev["type"] == "edge" and ev["edge"].get("relation"):
                    edges.append(ev["edge"])
        except Exception as err:  # noqa: BLE001
            print("  error", item["id"], err)
            continue
        for e in edges:
            other = nodes.get(e["to"] if e["from"] == item["id"] else e["from"], {})
            ev = {x.get("side"): x for x in e.get("evidence", [])}
            pairs.append({
                "id": f"{item['id']}|{other.get('id')}",
                "focus": {"id": item["id"], "date": item["date"][:10], "text": f"{item['title']}. {item.get('snippet', '')}"[:700]},
                "other": {"id": other.get("id"), "date": str(other.get("date", ""))[:10], "text": f"{other.get('label', '')}. {other.get('summary', '')}"[:700], "older": other.get("kind") == "archive"},
                "relation": e["relation"], "label": e["label"], "reason": e.get("reasoning", ""),
                "quote_focus": ev.get("focus", {}).get("quote", ""), "quote_other": ev.get("other", {}).get("quote", ""),
            })
        done.add(item["id"])
        PAIRS.write_text(json.dumps(pairs, indent=1, ensure_ascii=False), encoding="utf-8")
        (OUT / "done.json").write_text(json.dumps(sorted(done)))
        print(f"{len(done):2d}/{len(items)} pairs so far {len(pairs)}  {item['title'][:60]}")
    print("relations:", Counter(p["relation"] for p in pairs))


def sheet():
    pairs = json.loads(PAIRS.read_text(encoding="utf-8"))
    for i, p in enumerate(pairs):
        print(f"\n#{i} {p['id']}\n  {p['relation']} / {p['label']}  reason: {p['reason']}")
        print(f"  FOCUS ({p['focus']['date']}): {p['focus']['text'][:400]}")
        print(f"  OTHER ({p['other']['date']}{', older' if p['other']['older'] else ''}): {p['other']['text'][:400]}")
        print(f"  quotes: “{p['quote_focus']}” / “{p['quote_other']}”")


def score() -> dict:
    pairs = json.loads(PAIRS.read_text(encoding="utf-8"))
    labels = json.loads(LABELS.read_text(encoding="utf-8")) if LABELS.exists() else {}
    rows = [(p, labels[p["id"]]) for p in pairs if p["id"] in labels]
    by: dict[str, list[bool]] = {}
    for p, lab in rows:
        by.setdefault(p["relation"], []).append(bool(lab["ok"]))
    ok = sum(lab["ok"] for _, lab in rows)
    out = {
        "n": len(rows), "pairs": len(pairs), "precision": round(ok / len(rows), 2) if rows else None,
        "by_relation": {k: {"n": len(v), "precision": round(sum(v) / len(v), 2)} for k, v in sorted(by.items())},
        "older": sum(1 for p, _ in rows if p["other"]["older"]),
        "wrong": [{"id": p["id"], "relation": p["relation"], "why": lab["reason"]} for p, lab in rows if not lab["ok"]],
    }
    print(json.dumps(out, indent=1))
    return out


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "score"
    if cmd == "collect":
        asyncio.run(collect())
    elif cmd == "sheet":
        sheet()
    else:
        score()
