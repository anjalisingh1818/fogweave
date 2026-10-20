"""Labelling sheets for the hand-judged parts of the eval.

  python eval/sheets.py  ->  eval/labels/impact_sheet.json, connection_sheet.json

impact_sheet: every inferred/speculative impact link and every reported
relation with what it rests on (basis facts / quote), for correct / partial /
wrong labels.
connection_sheet: for each item and its persona, the "Touches me?" result the
app would show (grounded path or "no clear connection"), mirroring the
client: private context nodes + on-device same_as by name similarity +
context links from the engine.
"""

from __future__ import annotations

import json
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fogweave import graphalgo  # noqa: E402
from fogweave.pipeline import slug  # noqa: E402

RUNS = ROOT / "eval" / "runs"
LABELS = ROOT / "eval" / "labels"
REPORTED_RELATIONS = {"happened_in", "involves", "affects", "depends_on", "part_of", "competes_with"}


def similarity(a: str, b: str) -> float:
    a, b = a.lower(), b.lower()
    if a == b:
        return 1.0
    if a in b or b in a:
        return 0.75
    wa = {w for w in a.split() if len(w) > 2}
    wb = {w for w in b.split() if len(w) > 2}
    return 0.6 * len(wa & wb) / max(len(wa), len(wb)) if wa and wb else 0.0


def main():
    impact, connection = [], []
    for p in sorted(RUNS.glob("*.json")):
        r = json.loads(p.read_text(encoding="utf-8"))
        if not r.get("done"):
            continue
        nodes = {e["node"]["id"]: e["node"] for e in r["events"] if e["type"] == "node"}
        edges = [e["edge"] for e in r["events"] if e["type"] == "edge"]
        item = r["item"]
        refs = {}
        for n in nodes.values():
            refs[n["id"]] = n.get("label")
        for e in edges:
            refs[e["id"]] = f"{nodes.get(e['from'], {}).get('label')} {e['type']} {nodes.get(e['to'], {}).get('label')}"
        for e in edges:
            if e["label"] in ("inferred", "speculative") or (e["label"] == "reported" and e["type"] in REPORTED_RELATIONS):
                impact.append({
                    "key": f"{item['id']}|{e['id']}|{e['label']}",
                    "item": item["title"][:140],
                    "section": item["extra"].get("section"),
                    "label": e["label"],
                    "link": f"{nodes.get(e['from'], {}).get('label')} --{e['type']}--> {nodes.get(e['to'], {}).get('label')}",
                    "hop": e.get("hop"),
                    "reasoning": e.get("reasoning"),
                    "basis": [refs.get(b, b) for b in e.get("basis", [])],
                    "quote": (e.get("evidence") or [{}])[0].get("quote"),
                    "verdict": None,  # correct | partial | wrong (hand label)
                })
        # "Touches me?" as the client computes it
        ctx = r["context"]
        all_nodes = list(nodes.values())
        all_edges = list(edges)
        ctx_ids = []
        for c in ctx:
            cid = f"ctx:{slug(c)}"
            ctx_ids.append(cid)
            if cid not in nodes:
                all_nodes.append({"id": cid, "type": "ContextNode", "label": c})
            for n in nodes.values():
                if n["type"] in ("Place", "Organisation", "Topic", "Technology", "Event") and similarity(c, n["label"]) >= 0.75:
                    all_edges.append({"id": f"same_as:{cid}->{n['id']}", "type": "same_as", "from": cid, "to": n["id"], "label": "inferred"})
        g = graphalgo.build(all_nodes, all_edges)
        path = graphalgo.best_path(g, item["id"], ctx_ids)
        connection.append({
            "item": item["title"][:140],
            "id": item["id"],
            "persona": r["persona"],
            "context": ctx,
            "result": "no clear connection" if not path else " -> ".join(f"{g.nodes[n].get('label')}" for n in path["nodes"]),
            "hops": [h["label"] for h in path["hops"]] if path else [],
            "ctx_links_from_engine": [f"{nodes.get(e['from'], {}).get('label')} --{e['type']}/{e['label']}--> {nodes.get(e['to'], {}).get('label')}" for e in edges if e["to"].startswith("ctx:")],
            "plausible_connection": None,  # hand label: is there a real, grounded way this touches the persona?
            "sensible": None,  # hand label: is the shown result sensible?
        })
    LABELS.mkdir(parents=True, exist_ok=True)
    (LABELS / "impact_sheet.json").write_text(json.dumps(impact, indent=1, ensure_ascii=False), encoding="utf-8")
    (LABELS / "connection_sheet.json").write_text(json.dumps(connection, indent=1, ensure_ascii=False), encoding="utf-8")
    by = {}
    for x in impact:
        by[x["label"]] = by.get(x["label"], 0) + 1
    print("impact rows", len(impact), by, "| connection rows", len(connection), "paths", sum(c["result"] != "no clear connection" for c in connection))


if __name__ == "__main__":
    main()
