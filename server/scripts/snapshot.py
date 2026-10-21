"""Record a dated offline snapshot from REAL pipeline runs (take-it-away test).

  python scripts/snapshot.py [--expand 6] [--explore 6] [--read 12]

Writes ../public/demo/snapshot/:
  index.json        pool (scored, tagged: the client samples lights from it),
                    recorded reader claims, and maps to recorded runs
  expansions/*.json event logs of real expansions (+ answers to suggested questions)
  explores/*.json   event logs of real explores of entities (shared ones first)
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
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fogweave import embed, ontology  # noqa: E402
from fogweave.answer import answer  # noqa: E402
from fogweave.explore import Explorer  # noqa: E402
from fogweave.pipeline import Engine, now_iso  # noqa: E402

OUT = ROOT.parent / "public" / "demo" / "snapshot"
PERSONA = ["Rotterdam", "logistics", "cloud computing", "electric vehicles", "public transport", "energy prices"]
QUESTIONS = ["What changes because of this?", "Who is affected?", "What happened before this?"]


def safe_name(item_id: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", item_id.lower()).strip("-") + ".json"


def graph_of(events):
    nodes, edges = {}, []
    for ev in events:
        if ev["type"] == "node":
            nodes.setdefault(ev["node"]["id"], {}).update(ev["node"])
        elif ev["type"] == "edge":
            edges.append(ev["edge"])
        elif ev["type"] == "verified" and ev["id"] in nodes:
            nodes[ev["id"]].update(verdict=ev["verdict"], evidence=ev["evidence"])
    return {"nodes": [n for n in nodes.values() if n.get("type") != "ContextNode"], "edges": edges}


async def main(n_expand: int, n_explore: int, n_read: int):
    eng = Engine()
    t0 = time.monotonic()
    # the pool also carries datasets and older news; the client shows datasets only when turned on
    pool = await eng.pool({"sourceTypes": ["dataset", "archive"]})
    items = pool["items"]
    print(f"pool: {len(items)} items from {json.dumps(pool['sources'])[:200]}", flush=True)

    world = [it for it in items if it["via"] in ("wikipedia", "gdelt") and it["kind"] == "breaking"]
    to_read, seen = [], set()
    for it in [*world[:8], *items]:
        if it["id"] not in seen and len(to_read) < n_read:
            seen.add(it["id"])
            to_read.append(it)
    for it in to_read:
        r = await eng.read(it["id"])
        it["claims"] = r.get("claims", [])
        it["textHow"] = r.get("textHow")
        if r.get("note"):
            it["claimsNote"] = r["note"]
        print(f"  read claims={len(it['claims'])} {it['textHow']} | {it['headline'][:60]}", flush=True)

    tmp = OUT.with_name("snapshot.new")
    if tmp.exists():
        shutil.rmtree(tmp)
    (tmp / "expansions").mkdir(parents=True)
    (tmp / "explores").mkdir(parents=True)

    candidates = sorted([it for it in to_read if len(it.get("claims") or []) >= 2], key=lambda it: (it["via"] not in ("wikipedia", "gdelt"), it.get("textHow") != "article", -it["quality"]))
    expansions, entity_count, entity_info = {}, Counter(), {}
    for it in candidates[:n_expand]:
        events = [ev async for ev in eng.expand(it["id"], context=PERSONA)]
        g = graph_of(events)
        answers = {}
        for q in QUESTIONS:
            try:
                answers[q] = {**(await answer(eng.llm, eng.router, q, g, fresh=False)), "recordedAt": now_iso()}
            except Exception as exc:  # noqa: BLE001
                print("   answer failed:", exc, flush=True)
        name = safe_name(it["id"])
        (tmp / "expansions" / name).write_text(json.dumps({"id": it["id"], "recordedAt": now_iso(), "context": "sample persona (fictional)", "events": events, "stats": events[-1].get("stats", {}), "answers": answers}, ensure_ascii=False), encoding="utf-8")
        expansions[it["id"]] = f"expansions/{name}"
        for n in g["nodes"]:
            if n["type"] in ("Organisation", "Place", "Technology", "Topic", "Event", "PublicFigure") and not n.get("derived"):
                entity_count[n["id"]] += 1
                entity_info[n["id"]] = n
        labels = Counter(e["label"] for e in g["edges"])
        print(f"  expand {it['id']} nodes={len(g['nodes'])} labels={dict(labels)} | {it['headline'][:60]}", flush=True)

    # explore: entities shared by stories first (one node, two stories), then others
    type_rank = {"Place": 0, "Organisation": 0, "Technology": 1, "PublicFigure": 2, "Topic": 3, "Event": 4}
    order = sorted(entity_count, key=lambda k: (-entity_count[k], not k.startswith("wd:"), type_rank.get(entity_info[k]["type"], 5), entity_info[k]["label"]))
    explores = {}
    for nid in order[:n_explore]:
        n = entity_info[nid]
        events = [ev async for ev in Explorer(eng).run({"id": nid, "type": n["type"], "label": n["label"], "qid": n.get("qid")}, context=PERSONA)]
        name = safe_name(nid)
        (tmp / "explores" / name).write_text(json.dumps({"id": nid, "recordedAt": now_iso(), "events": events}, ensure_ascii=False), encoding="utf-8")
        explores[nid] = f"explores/{name}"
        groups = Counter(ev.get("group") for ev in events if ev["type"] == "edge")
        print(f"  explore {nid} shared_by={entity_count[nid]} groups={dict(groups)}", flush=True)

    # one step further: explore a neighbour of the first explored nodes, so
    # "touch a neighbour, explore again, go back" works offline too
    for nid in list(explores):
        rec = json.loads((tmp / explores[nid]).read_text(encoding="utf-8"))
        nb = next((ev["node"] for ev in rec["events"] if ev["type"] == "node" and ev.get("group") == "parts" and ev["node"]["id"] not in explores), None)
        if not nb:
            continue
        events = [ev async for ev in Explorer(eng).run({"id": nb["id"], "type": nb["type"], "label": nb["label"], "qid": nb.get("qid")}, context=PERSONA)]
        name = safe_name(nb["id"])
        (tmp / "explores" / name).write_text(json.dumps({"id": nb["id"], "recordedAt": now_iso(), "events": events}, ensure_ascii=False), encoding="utf-8")
        explores[nb["id"]] = f"explores/{name}"
        print(f"  explore neighbour {nb['id']} of {nid}", flush=True)

    old_and_new = []
    for nid, f in explores.items():
        rec = json.loads((tmp / f).read_text(encoding="utf-8"))
        groups = {ev.get("group") for ev in rec["events"] if ev["type"] == "edge"}
        if "archive" in groups and "news" in groups:
            old_and_new.append(nid)
    print(f"  focus nodes with older and recent related news: {len(old_and_new)} {old_and_new}", flush=True)

    index = {
        "schema": "fogweave.snapshot/2",
        "generatedAt": now_iso(),
        "provenance": {
            "kind": "pipeline",
            "note": "Recorded output of the live FogWeave engine. Titles, our own short summaries, short verbatim quotes and links only.",
            "ontology": ontology.VERSION,
            "embeddings": embed.BACKEND,
            "llm": eng.llm.stats,
            "sources": pool["sources"],
            "attribution": [
                "Wikipedia text is CC BY-SA 4.0 (Wikipedia contributors)",
                "Wikidata is CC0",
                "News metadata: The GDELT Project, https://www.gdeltproject.org/",
                "Via Hacker News (titles and links)",
                "Paper metadata from arXiv (CC0); not endorsed by arXiv",
                "Dataset metadata from Zenodo (CERN), CC0",
            ],
        },
        "persona": {"fictional": True, "labels": PERSONA},
        "pool": [{**it, "live": False} for it in items],
        "expansions": expansions,
        "explores": explores,
        "sharedEntities": {k: v for k, v in entity_count.items() if v >= 2},
        # F10: focus nodes whose web holds both older news (archive) and recent news
        "focusWithOldAndNew": old_and_new,
        "seconds": int(time.monotonic() - t0),
    }
    (tmp / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    # swap in only when the whole snapshot is complete
    # (copy, not rename: a running dev server may hold the folder open on Windows)
    if OUT.exists():
        shutil.rmtree(OUT, ignore_errors=True)
    shutil.copytree(tmp, OUT, dirs_exist_ok=True)
    shutil.rmtree(tmp, ignore_errors=True)
    # what every node in the recorded webs is, with key facts and sources
    from snapshot_dossiers import add_dossiers

    await add_dossiers(OUT, eng)
    print(f"wrote {OUT} in {index['seconds']} s; shared entities {index['sharedEntities']}; llm {eng.llm.stats}", flush=True)
    await eng.http.aclose()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--expand", type=int, default=6)
    ap.add_argument("--explore", type=int, default=6)
    ap.add_argument("--read", type=int, default=12)
    a = ap.parse_args()
    asyncio.run(main(a.expand, a.explore, a.read))
