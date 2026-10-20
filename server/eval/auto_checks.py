"""Automatic checks over the recorded eval runs (no LLM calls).

  python eval/auto_checks.py   ->  eval/results/auto.json

- every claim has a quoted, linked source; quotes appear verbatim in the
  source text (re-extracted from the HTTP cache, or the item's own summary)
- evidence URLs resolve (status of a polite GET; 401/403 = exists but blocks bots)
- no statement without evidence/reasoning; ontology rejections per run
- SHACL validity of a pack built (by the client code) from all runs
- latency to first node and to done; LLM calls and tokens per item
"""

from __future__ import annotations

import asyncio
import json
import statistics
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fogweave import ontology  # noqa: E402
from fogweave.http import PoliteClient, SourceError  # noqa: E402
from fogweave.rdf import check_pack  # noqa: E402
from fogweave.safety import verify_quote  # noqa: E402

RUNS = ROOT / "eval" / "runs"
OUT = ROOT / "eval" / "results"


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * (len(xs) - 1) + 0.5))] if xs else None


async def source_text(http: PoliteClient, url: str) -> str | None:
    import trafilatura

    key = None
    try:
        html = await http.get(url, ttl=10 * 86400, retries=0)
    except SourceError:
        return None
    del key
    return trafilatura.extract(html, include_comments=False, include_tables=False, favor_precision=True)


async def main():
    runs = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(RUNS.glob("*.json"))]
    http = PoliteClient()
    res = {"runs": len(runs), "done": sum(r["done"] for r in runs)}
    lat_first, lat_done, calls, tokens = [], [], [], []
    labels = {"reported": 0, "inferred": 0, "speculative": 0}
    claims_total = claims_with_source = 0
    quotes_checked = quotes_verbatim = 0
    bad_statements, rejected = [], 0
    urls = set()
    degraded = 0
    text_how = {}
    texts: dict[str, str | None] = {}
    for r in runs:
        st = (r["events"][-1].get("stats", {}) if r["events"] else {}) or {}
        if r.get("firstNodeMs") is not None:
            lat_first.append(r["firstNodeMs"])
        if st.get("ms"):
            lat_done.append(st["ms"])
        calls.append(st.get("llmCalls", 0))
        tokens.append(st.get("llmTokens", 0))
        rejected += len(st.get("rejected", []))
        degraded += bool(st.get("notes"))
        text_how[st.get("textHow")] = text_how.get(st.get("textHow"), 0) + 1
        item = r["item"]
        nodes = {e["node"]["id"]: e["node"] for e in r["events"] if e["type"] == "node"}
        edges = [e["edge"] for e in r["events"] if e["type"] == "edge"]
        for e in edges:
            labels[e["label"]] = labels.get(e["label"], 0) + 1
            problem = ontology.validate_edge(e, nodes)
            if problem:
                bad_statements.append({"edge": e["id"], "problem": problem})
            for ev in e.get("evidence", []):
                if ev.get("url"):
                    urls.add(ev["url"])
        for n in nodes.values():
            if n["type"] != "Claim":
                continue
            claims_total += 1
            rep = [e for e in edges if e["to"] == n["id"] and e["type"] == "reports" and e.get("evidence")]
            if rep:
                claims_with_source += 1
            # verbatim check against the text the quote came from
            ev = rep[0]["evidence"][0] if rep else {}
            src = ev.get("url", "")
            if "wikipedia.org/wiki/Portal:Current_events" in src:
                text = f"{item['title']}. {item['snippet']}"
            else:
                if src not in texts:
                    texts[src] = await source_text(http, src)
                text = texts[src]
            if text:
                quotes_checked += 1
                quotes_verbatim += bool(verify_quote(n.get("quote", ""), text))

    # do the evidence links resolve? (one polite GET each; blocked != missing)
    status = {"ok": 0, "blocked": 0, "missing": 0, "error": 0}
    for u in sorted(urls)[:150]:
        try:
            r = await http.client.get(u, timeout=12)
            code = r.status_code
            status["ok" if code < 400 else "blocked" if code in (401, 402, 403, 451) else "missing" if code in (404, 410) else "error"] += 1
        except Exception:  # noqa: BLE001
            status["error"] += 1
    await http.aclose()

    # SHACL over a pack built by the client code from all runs
    pack_path = OUT / "pack-eval.jsonld"
    OUT.mkdir(parents=True, exist_ok=True)
    built = subprocess.run(["node", "scripts/pack-from-runs.mjs", str(RUNS), str(pack_path)], cwd=ROOT.parent, capture_output=True, text=True)
    pack = check_pack(json.loads(pack_path.read_text(encoding="utf-8")))

    res.update(
        {
            "latency_ms": {"first_node_p50": pct(lat_first, 0.5), "first_node_p95": pct(lat_first, 0.95), "done_p50": pct(lat_done, 0.5), "done_p95": pct(lat_done, 0.95)},
            "llm_per_item": {"calls_mean": round(statistics.mean(calls), 2) if calls else 0, "tokens_mean": int(statistics.mean(tokens)) if tokens else 0, "tokens_max": max(tokens or [0])},
            "labels": labels,
            "claims": {"total": claims_total, "with_quoted_source": claims_with_source, "quotes_rechecked": quotes_checked, "quotes_verbatim": quotes_verbatim},
            "statements_failing_ontology": bad_statements[:10],
            "statements_failing_ontology_count": len(bad_statements),
            "rejected_before_emit": rejected,
            "runs_with_degraded_notes": degraded,
            "text_how": text_how,
            "evidence_urls": {"checked": min(150, len(urls)), **status},
            "pack": {"client_build": json.loads(built.stdout or "{}"), "triples": pack["triples"], "shacl": {"conforms": pack["shacl"]["conforms"], "violations": pack["shacl"]["violations"], "problems": pack["shacl"]["problems"][:5]}, "sparql_counts": {k: len(v) for k, v in pack["sparql"].items()}},
        }
    )
    (OUT / "auto.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    asyncio.run(main())
