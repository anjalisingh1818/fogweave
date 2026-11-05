"""Does the thinking agent beat one pass? The old finder and the Tree of Thoughts on the same items.

  python eval/v4_agent.py run      # both methods on the same Library sets, the agent on Why sets
  python eval/v4_agent.py sheet    # every pattern and explanation, shuffled, with the method hidden
  python eval/v4_agent.py score    # precision and counts per method, from the labels

Library sets and Why sets come from the 30 eval items and their related news
(eval/runs_v3/relations.json): a story, its related news and two unrelated stories,
as a reader might seal them. A label says whether the statement is true of the
quoted items and says something a reader could not get from one headline.
Labels are made by the build assistant (Claude) with the method hidden, not by an
independent human; each keeps a reason.
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

PAIRS = ROOT / "eval" / "runs_v3" / "relations.json"
OUT = ROOT / "eval" / "runs_v3" / "agent.json"
LABELS = ROOT / "eval" / "labels" / "v4_agent_labels.json"
SETS = 8
PAUSE = float(os.getenv("EVAL_PAUSE", "40"))


def _item(side: dict) -> dict:
    label, _, text = side["text"].partition(". ")
    return {"id": side["id"], "type": "NewsItem", "label": label[:200], "date": side.get("date", ""), "text": text[:900]}


def build_sets():
    pairs = json.loads(PAIRS.read_text(encoding="utf-8"))
    by_focus = defaultdict(list)
    focus = {}
    for p in pairs:
        by_focus[p["focus"]["id"]].append(p)
        focus[p["focus"]["id"]] = p["focus"]
    ranked = sorted(by_focus, key=lambda f: (-len(by_focus[f]), f))[:SETS]
    rng = random.Random(7)
    library, why = [], []
    for f in ranked:
        rel = list({p["other"]["id"]: p["other"] for p in by_focus[f]}.values())[:3]
        others = rng.sample([x for x in focus if x != f and x not in {r["id"] for r in rel}], 2)
        library.append({"name": f, "items": [_item(focus[f]), *[_item(r) for r in rel], *[_item(focus[o]) for o in others]]})
        older = [r for r in rel if r.get("date", "") <= focus[f].get("date", "")]
        why.append({"name": f, "story": _item(focus[f]), "related": [_item(r) for r in older]})
    return library, why


async def run():
    from fogweave.agent import patterns_task, tree_of_thoughts, why_task
    from fogweave.patterns import find_patterns
    from fogweave.pipeline import Engine

    eng = Engine()
    library, why = build_sets()
    out = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {"library": {}, "why": {}}

    def save():
        OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")

    for s in library:
        if s["name"] in out["library"]:
            continue
        await asyncio.sleep(PAUSE)  # the free quota counts per minute: this run compares methods, not quota luck
        t0 = time.time()
        calls0 = eng.llm.stats["calls"]
        old = await find_patterns(eng.llm, [dict(i) for i in s["items"]])
        old_t, old_calls = time.time() - t0, eng.llm.stats["calls"] - calls0
        t0 = time.time()
        calls0 = eng.llm.stats["calls"]
        events = [ev async for ev in tree_of_thoughts(eng.llm, patterns_task([dict(i) for i in s["items"]]))]
        res = next(e for e in events if e["type"] == "result")
        out["library"][s["name"]] = {
            "items": s["items"],
            "old": {"results": old["patterns"], "seconds": round(old_t, 1), "calls": old_calls, "note": old.get("note", "")},
            "new": {"results": res["results"], "seconds": round(time.time() - t0, 1), "calls": eng.llm.stats["calls"] - calls0, "dropped": res["dropped"], "note": res["note"]},
        }
        save()
        print("library", s["name"], "old", len(old["patterns"]), "new", len(res["results"]), "dropped", len(res["dropped"]))

    for s in why:
        if s["name"] in out["why"]:
            continue
        await asyncio.sleep(PAUSE)
        t0 = time.time()
        calls0 = eng.llm.stats["calls"]
        events = [ev async for ev in tree_of_thoughts(eng.llm, why_task(dict(s["story"]), [dict(r) for r in s["related"]]), search=eng.older_news)]
        res = next(e for e in events if e["type"] == "result")
        tools = [e for e in events if e["type"] == "tool" and e["state"] == "done"]
        out["why"][s["name"]] = {
            "story": s["story"],
            "new": {"results": res["results"], "items": res["items"], "seconds": round(time.time() - t0, 1), "calls": eng.llm.stats["calls"] - calls0, "dropped": res["dropped"], "tools": [{"query": t["query"], "found": t["found"]} for t in tools], "note": res["note"]},
        }
        save()
        print("why", s["name"], "results", len(res["results"]), "dropped", len(res["dropped"]), "tools", len(tools))
    print("stats", eng.llm.stats)


def _rows():
    data = json.loads(OUT.read_text(encoding="utf-8"))
    rows = []
    for name, s in data["library"].items():
        by_id = {i["id"]: i for i in s["items"]}
        for method in ("old", "new"):
            for r in s[method]["results"]:
                rows.append({"key": f"L|{name}|{method}|{r['text'][:40]}", "kind": r["kind"], "text": r["text"], "items": [{"quote": q["quote"], "label": by_id.get(q["id"], {}).get("label", "")} for q in r["quotes"]]})
    for name, s in data["why"].items():
        for r in s["new"]["results"]:
            rows.append({"key": f"W|{name}|new|{r['text'][:40]}", "kind": r["kind"], "text": f"WHY [{s['story']['label'][:80]}] {r['text']}", "items": [{"quote": q["quote"], "label": s["new"]["items"].get(q["id"], {}).get("label", "")} for q in r["quotes"]]})
    random.Random(11).shuffle(rows)
    return rows


def sheet():
    labels = json.loads(LABELS.read_text(encoding="utf-8")) if LABELS.exists() else {}
    for r in _rows():
        if r["key"] in labels:
            continue  # already labelled
        print(f"\n{r['key']}\n  ({r['kind']}) {r['text']}")
        for q in r["items"]:
            print(f"   “{q['quote']}” ({q['label'][:70]})")


def score():
    data = json.loads(OUT.read_text(encoding="utf-8"))
    labels = json.loads(LABELS.read_text(encoding="utf-8")) if LABELS.exists() else {}
    rows = _rows()
    print("labels", len(labels), "of", len(rows))
    tally = defaultdict(lambda: [0, 0])
    for r in rows:
        lab = labels.get(r["key"])
        if lab is None:
            continue
        kind, _, method, _ = r["key"].split("|", 3)
        t = tally[f"{'library' if kind == 'L' else 'why'}/{method}"]
        t[1] += 1
        t[0] += 1 if lab["good"] else 0
    for k, (g, n) in sorted(tally.items()):
        print(f"{k}: good {g}/{n} = {g / n:.2f}" if n else k)
    for method in ("old", "new"):
        ss = [s[method] for s in data["library"].values()]
        print(f"library/{method}: sets {len(ss)}  results {sum(len(x['results']) for x in ss)}  sets with a result {sum(1 for x in ss if x['results'])}  calls {sum(x['calls'] for x in ss)}  mean seconds {sum(x['seconds'] for x in ss) / max(1, len(ss)):.1f}")
    ss = [s["new"] for s in data["why"].values()]
    print(f"why/new: sets {len(ss)}  results {sum(len(x['results']) for x in ss)}  sets with a result {sum(1 for x in ss if x['results'])}  calls {sum(x['calls'] for x in ss)}  mean seconds {sum(x['seconds'] for x in ss) / max(1, len(ss)):.1f}  searches {sum(len(x['tools']) for x in ss)}")
    print("dropped reasons", dict(_count_all(data)))


def _count_all(data):
    c = defaultdict(int)
    for s in data["library"].values():
        for d in s["new"]["dropped"]:
            c[d["why"]] += 1
    for s in data["why"].values():
        for d in s["new"]["dropped"]:
            c[d["why"]] += 1
    return c


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "run":
        asyncio.run(run())
    elif cmd == "sheet":
        sheet()
    else:
        score()
