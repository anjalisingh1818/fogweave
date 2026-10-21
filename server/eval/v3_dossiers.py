"""V3 eval: are dossier facts supported by their sources? (V3 §11: 15 nodes)

  python eval/v3_dossiers.py

Takes 15 nodes with a dossier from the Demo snapshot (spread over types) and
checks each against its source, fetched again by another route:
  - the overview ("What it is") must appear verbatim in the article's lead
    (Wikipedia, plain-text intro); parentheticals are set aside, because the
    dossier drops a person's "(born …)"
  - each key fact must match a statement in the item's Wikidata entry
    (Special:EntityData JSON): same property, same value (an item's English
    label, a year, or a number)
Fully automatic: no hand labels. Writes eval/results/v3_dossiers.json.
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fogweave.dossier import FACTS  # noqa: E402  (property ids by fact label; the values are re-read)
from fogweave.http import PoliteClient  # noqa: E402

SNAP = ROOT.parent / "public" / "demo" / "snapshot" / "index.json"
OUT = ROOT / "eval" / "results" / "v3_dossiers.json"
WANT = 15


def _norm(s: str) -> str:
    return " ".join(str(s or "").replace(" ", " ").split()).lower()


def pick(dossiers: dict) -> list[dict]:
    """Up to 15 informed, non-event dossiers, round-robin over types."""
    by = defaultdict(list)
    for d in dossiers.values():
        if d.get("found") and d.get("qid") and d.get("kind") != "event" and (d.get("facts") or d.get("overview")):
            by[d.get("type")].append(d)
    out = []
    while len(out) < WANT and any(by.values()):
        for t in sorted(by):
            if by[t] and len(out) < WANT:
                out.append(by[t].pop(0))
    return out


async def values_of(http, entity: dict, pid: str) -> list[str]:
    """The English forms a statement's values can take: item labels, years and dates, numbers."""
    out, ids = [], []
    for c in (entity.get("claims") or {}).get(pid, []):
        v = ((c.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(v, dict) and v.get("id"):
            ids.append(v["id"])
        elif isinstance(v, dict) and "time" in v:
            m = re.match(r"[+-](\d+)-(\d\d)-(\d\d)", v["time"])
            if m:
                out.append(str(int(m.group(1))))
        elif isinstance(v, dict) and "amount" in v:
            n = float(v["amount"].lstrip("+"))
            out += [f"{int(n):,}" if n == int(n) else f"{n:,.1f}", str(int(n))]
        elif isinstance(v, str):
            out.append(v)
    for i in range(0, len(ids), 50):
        data = await http.get("https://www.wikidata.org/w/api.php", params={"action": "wbgetentities", "ids": "|".join(ids[i : i + 50]), "props": "labels", "languages": "en", "format": "json"}, as_json=True, ttl=3600)
        for e in ((data or {}).get("entities") or {}).values():
            lab = ((e.get("labels") or {}).get("en") or {}).get("value")
            if lab:
                out.append(lab)
    return out


async def check(http, d: dict) -> dict:
    row = {"id": d["id"], "label": d.get("label"), "type": d.get("type"), "qid": d["qid"], "overview": None, "facts": []}
    data = await http.get(f"https://www.wikidata.org/wiki/Special:EntityData/{d['qid']}.json", as_json=True, ttl=3600)
    entity = ((data or {}).get("entities") or {}).get(d["qid"]) or next(iter(((data or {}).get("entities") or {}).values()), {})
    # overview: verbatim in the article's lead
    url = (d.get("overviewSource") or {}).get("url") or ""
    if d.get("overview") and "wikipedia.org/wiki/" in url:
        title = unquote(url.rsplit("/wiki/", 1)[1]).replace("_", " ")
        w = await http.get("https://en.wikipedia.org/w/api.php", params={"action": "query", "prop": "extracts", "exintro": "1", "explaintext": "1", "titles": title, "redirects": "1", "format": "json", "formatversion": "2"}, as_json=True, ttl=3600)
        lead = ((((w or {}).get("query") or {}).get("pages") or [{}])[0]).get("extract", "")
        sentences = [s for s in re.split(r"(?<=[.!?])\s+", d["overview"]) if len(s) > 15]
        # the dossier drops a person's "(born …)" parenthetical; compare with parentheticals set aside
        bare = lambda t: _norm(re.sub(r"\s*\([^()]*\)", "", t))  # noqa: E731
        row["overview"] = {"ok": bool(sentences) and all(bare(s) in bare(lead) for s in sentences), "sentences": len(sentences)}
    pids = {label: pid for pid, label in FACTS.get(d.get("type"), [])}
    for f in d.get("facts") or []:
        pid = pids.get(f["label"])
        if not pid:
            row["facts"].append({"fact": f"{f['label']}: {f['value']}", "ok": False, "why": "no property for this label"})
            continue
        vals = await values_of(http, entity, pid)
        main = re.sub(r"\s*\((?:since |\d{4}).*\)$", "", f["value"]).strip()  # "Republican Party (since 2012)" -> "Republican Party"
        year = re.search(r"\b(\d{3,4})(?: BC)?$", main)  # a date value: "24 August 1991" matches the year 1991
        ok = any(_norm(main) == _norm(v) or _norm(main).startswith(_norm(v) + " ") or (year and year.group(1) == v) for v in vals)
        row["facts"].append({"fact": f"{f['label']}: {f['value']}", "property": pid, "ok": ok, **({} if ok else {"source_values": vals[:8]})})
    return row


async def main():
    dossiers = json.loads(SNAP.read_text(encoding="utf-8")).get("dossiers") or {}
    http = PoliteClient()
    rows = [await check(http, d) for d in pick(dossiers)]
    facts = [f for r in rows for f in r["facts"]]
    overviews = [r["overview"] for r in rows if r["overview"]]
    out = {
        "nodes": len(rows),
        "types": dict(sorted({r["type"]: sum(1 for x in rows if x["type"] == r["type"]) for r in rows}.items())),
        "facts": len(facts), "facts_supported": sum(f["ok"] for f in facts),
        "overviews": len(overviews), "overviews_verbatim": sum(o["ok"] for o in overviews),
        "rows": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in out.items() if k != "rows"}))
    for r in rows:
        for f in r["facts"]:
            if not f["ok"]:
                print("  UNSUPPORTED", r["label"], "|", f["fact"], "|", f.get("source_values") or f.get("why"))
        if r["overview"] and not r["overview"]["ok"]:
            print("  OVERVIEW NOT VERBATIM", r["label"])


if __name__ == "__main__":
    asyncio.run(main())
