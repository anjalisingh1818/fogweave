"""Compute metrics from eval results + hand labels and write docs/EVAL_REPORT.md.

  python eval/report.py
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "eval" / "results"
LAB = ROOT / "eval" / "labels"
QA = ROOT.parent / "qa" / "recordings"
OUT = ROOT.parent / "docs" / "EVAL_REPORT.md"


def load(p, default=None):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def prec(verdicts):
    score = {"correct": 1.0, "partial": 0.5, "wrong": 0.0}
    v = [score[x] for x in verdicts if x in score]
    return (round(sum(v) / len(v), 3), len(v)) if v else (None, 0)


def ck(c):
    """connection label key: the same item can be judged with two personas"""
    return f"{c['id']}|{c['persona']}"


def main():
    auto = load(RES / "auto.json", {})
    special = load(RES / "special.json", {})
    cluster = load(RES / "cluster.json", {})
    pairs = load(RES / "verifier_pairs.json", [])
    ablation = load(RES / "ablation.json", [])
    sheet = load(LAB / "impact_sheet.json", [])  # before the persona-chasing fix (eval/runs)
    sheet_mid = load(LAB / "impact_sheet_after.json", [])  # after the persona fix (eval/runs_after)
    sheet_after = load(LAB / "impact_sheet_after2.json", []) or sheet_mid  # + structure rule = current pipeline (eval/runs_after2)
    impact_l = load(LAB / "impact_labels.json", {})
    ver_l = load(LAB / "verifier_labels.json", [])
    # "Touches me?": current pipeline, round-robin personas + matched personas
    conn_sheet = (load(LAB / "connection_sheet_after2.json", []) or load(LAB / "connection_sheet_after.json", [])) + load(LAB / "connection_sheet_matched.json", [])
    conn_l = load(LAB / "connection_labels.json", {})
    abl_l = load(LAB / "ablation_labels.json", [])
    qa2 = load(QA / "phase2-results.json", {})
    qa3 = load(QA / "phase3-results.json", {})
    hands = load(RES / "hands_timing.json", {})

    md = []
    add = md.append
    add("# FogWeave evaluation report")
    add("")
    add(f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC by `server/eval/report.py` (re-run with `/eval`). "
        "News window: Wikipedia Current events, 2026-10-06 to 2026-10-19. LLMs: Groq free tier (gpt-oss-120b / gpt-oss-20b / qwen3.8-27b).")
    add("")
    add("> **Honesty notes.**")
    add(">")
    add("> - Hand labels were made by the build assistant (Claude), not by an independent human; there is no inter-annotator agreement. Each label keeps a reason in `server/eval/labels/` so the owner can re-label any row and re-run.")
    add("> - Hands-path numbers come from scripted IWER hands in headless Chromium, not from a person on a Quest.")
    add("")

    # ---------------------------------------------------------------- summary
    rows = []
    LABS = ("reported", "inferred", "speculative")

    def by_label_of(sh):
        return {lab: [impact_l.get(r["key"], {}).get("verdict") for r in sh if r["label"] == lab] for lab in LABS}

    def chasing(sh):
        # wrong links whose reason is a chain toward the reader's context (persona-chasing)
        return sum(1 for r in sh if impact_l.get(r["key"], {}).get("verdict") == "wrong" and "persona" in impact_l[r["key"]].get("why", ""))

    by_before = by_label_of(sheet)
    by_mid = by_label_of(sheet_mid)
    by_after = by_label_of(sheet_after)
    for lab in LABS:
        pa, na = prec([v for v in by_after[lab] if v])
        pb, nb = prec([v for v in by_before[lab] if v])
        cell = f"{pa:.2f} (n={na})" if pa is not None else "not labelled"
        if pb is not None:
            cell += f"; before the fixes {pb:.2f} (n={nb})"
        rows.append((f"Impact-link precision, {lab}", cell))
    if sheet_after:
        rows.append(("Persona-chasing links (wrong, toward the reader's context)", f"{chasing(sheet_after)} after vs {chasing(sheet)} before"))
    if ver_l and pairs:
        agree = sum(1 for p, l in zip(pairs, ver_l) if l.get("gold") == p["model"])
        rows.append(("Verifier agreement with hand labels", f"{agree / len(ver_l):.2f} (n={len(ver_l)})"))
    if conn_l:
        vals = [conn_l[ck(c)] for c in conn_sheet if ck(c) in conn_l]
        sens = sum(v["sensible"] for v in vals)
        rows.append(("\"Touches me?\" result sensible", f"{sens / len(vals):.2f} (n={len(vals)})"))
        none_cases = [v for c, v in ((c, conn_l.get(ck(c))) for c in conn_sheet) if v and c["result"] == "no clear connection"]
        if none_cases:
            rows.append(("\"No clear connection\" was correct", f"{sum(not v['plausible'] for v in none_cases) / len(none_cases):.2f} (n={len(none_cases)})"))
    if cluster:
        t = cluster["production_avg_link_names"]["test"]
        b = cluster["baseline_single_link_test_at_0.72"]
        rows.append(("Story clustering, test pairwise F1 / ARI", f"{t['f1']:.2f} / {t['ari']:.2f} (baseline {b['f1']:.2f} / {b['ari']:.2f})"))
    if abl_l and ablation:
        acc = {"correct": 1, "partial": 0.5, "wrong": 0, "no-answer": 0}
        a = [acc[l["A"]["acc"]] for l in abl_l]
        g = [acc[l["B"]["acc"]] for l in abl_l]
        rows.append(("Ablation accuracy: search-only vs graph", f"{sum(a) / len(a):.2f} vs {sum(g) / len(g):.2f} (n={len(abl_l)})"))
    if auto:
        c = auto["claims"]
        rows.append(("Claims with a quoted, linked source", f"{c['with_quoted_source']}/{c['total']}"))
        rows.append(("Quotes found verbatim on re-check", f"{c['quotes_verbatim']}/{c['quotes_rechecked']}"))
        rows.append(("Pack conforms to SHACL shapes", f"{auto['pack']['shacl']['conforms']} ({auto['pack']['triples']} triples)"))
        lat = auto["latency_ms"]
        rows.append(("Latency: first node p50 / done p50 (p95)", f"{lat['first_node_p50']} ms / {lat['done_p50'] / 1000:.0f} s ({lat['done_p95'] / 1000:.0f} s)"))
        rows.append(("LLM per item: calls / tokens (mean)", f"{auto['llm_per_item']['calls_mean']} / {auto['llm_per_item']['tokens_mean']}"))
    if special:
        rows.append(("Safety cases passed", f"{sum(1 for v in special.values() if v.get('pass'))}/{len(special)}"))
    add("## Summary")
    add("")
    add("| Measure | Result |")
    add("|---|---|")
    for k, v in rows:
        add(f"| {k} | {v} |")
    add("")

    # ---------------------------------------------------------------- impact
    add("## 1. Impact chains (V2 §9)")
    add("")
    sections = Counter(r["section"] for r in sheet)
    add(f"The same {auto.get('runs', '?')} news items, expanded live with a persona context, in three versions of the pipeline. Items span {len(sections)} Current-events sections. "
        "Labelled rows: every inferred and speculative impact link, plus every reported relation.")
    add("")
    add("1. **Before the fixes** (`eval/runs`).")
    add("2. **Persona fix** (`eval/runs_after`): no chains whose only purpose is to reach a context node, generic effects become Speculative, amounts are not entities. "
        "Speculative precision and persona-chasing improved, but Inferred precision fell: the impact step began restating structure (actor, place, victims, parts) as \"affects\".")
    add("3. **Persona fix + structure rule = current pipeline** (`eval/runs_after2`): code drops an inferred or speculative link between two nodes that a reported link already joins. "
        "Same cached LLM output as version 2, so its rows are a labelled subset of version 2.")
    add("")
    add("Version 2 and 3 re-used cached reads, extraction and verification from version 1; only the impact step re-ran (version 2) or was re-filtered (version 3).")
    add("")
    for name, sh, by in (("3. Current pipeline (persona fix + structure rule)", sheet_after, by_after), ("2. Persona fix only", sheet_mid if sheet_mid is not sheet_after else [], by_mid), ("1. Before the fixes", sheet, by_before)):
        if not sh:
            continue
        add(f"**{name}**")
        add("")
        add("| Label | correct | partial | wrong | unlabelled | precision |")
        add("|---|---|---|---|---|---|")
        for lab in LABS:
            cnt = Counter(v for v in by[lab] if v)
            p, n = prec([v for v in by[lab] if v])
            add(f"| {lab} | {cnt['correct']} | {cnt['partial']} | {cnt['wrong']} | {sum(1 for v in by[lab] if not v)} | {p if p is not None else '–'} |")
        add("")
        add(f"{len(sh)} rows.")
        add("")
    add(f"Persona-chasing links (labelled wrong because they chase the reader's context): **{chasing(sheet)} before, {chasing(sheet_mid)} after the persona fix, {chasing(sheet_after)} now**.")
    add("")
    wrongs = [(r, impact_l[r["key"]]) for r in (sheet_after or sheet) if impact_l.get(r["key"], {}).get("verdict") == "wrong"]
    if wrongs:
        add("Typical failures:")
        add("")
        for r, l in wrongs[:6]:
            add(f"- *{r['label']}* `{r['link']}`: {l.get('why', '')}")
        add("")

    # ---------------------------------------------------------------- verifier
    if pairs:
        add("## 2. Verifier (claim stance) agreement")
        add("")
        if ver_l:
            conf = Counter((l["gold"], p["model"]) for p, l in zip(pairs, ver_l))
            add(f"{len(ver_l)} claim–evidence pairs, captured from the production verification step (`eval/verify_sample.py`).")
            add("")
            add("| gold \\ model | supports | contradicts | unclear |")
            add("|---|---|---|---|")
            for g in ("supports", "contradicts", "unclear"):
                add(f"| {g} | {conf[(g, 'supports')]} | {conf[(g, 'contradicts')]} | {conf[(g, 'unclear')]} |")
            add("")
        else:
            add("Pairs captured; not yet labelled.")
            add("")

    # ---------------------------------------------------------------- connection
    if conn_sheet:
        add("## 3. \"How does this touch me?\" (connection eval)")
        add("")
        paths = [c for c in conn_sheet if c["result"] != "no clear connection"]
        add(f"{len(conn_sheet)} cases: each item with its round-robin persona (A Rotterdam/logistics, B Uttar Pradesh/farming, C Seoul/software; mostly unrelated), plus items re-run with a hand-picked matching persona (`eval/connection_matched.py`). "
            f"The app found a grounded path for {len(paths)} and said \"no clear connection\" for {len(conn_sheet) - len(paths)}.")
        add("")
        if conn_l:
            tp = sum(1 for c in conn_sheet if ck(c) in conn_l and c["result"] != "no clear connection" and conn_l[ck(c)]["sensible"])
            fn = sum(1 for c in conn_sheet if ck(c) in conn_l and c["result"] == "no clear connection" and conn_l[ck(c)]["plausible"])
            add(f"- Paths shown that are sensible: {tp}/{len(paths) or 1}")
            add(f"- \"No clear connection\" when a grounded link plausibly exists (missed): {fn}")
            add("")
        for c in paths[:5]:
            add(f"- Persona {c['persona']}: *{c['item'][:80]}* → {c['result']} ({', '.join(c['hops'])})")
        add("")

    # ---------------------------------------------------------------- clustering
    if cluster:
        add("## 4. Story clustering")
        add("")
        add(f"Gold: Wikipedia story headings. {cluster['n']['stories']} stories, {cluster['n']['dev']} dev entries (tuning) and {cluster['n']['test']} test entries (reported). Embeddings: {cluster['backend']}.")
        add("")
        add("| Method (test days) | precision | recall | F1 | ARI |")
        add("|---|---|---|---|---|")
        for name, key in (("Single-link embeddings, 0.72 (old production)", "baseline_single_link_test_at_0.72"), (f"Single-link, threshold tuned on dev ({cluster['baseline_tuned_threshold']})", "baseline_single_link_test_at_tuned")):
            m = cluster[key]
            add(f"| {name} | {m['precision']} | {m['recall']} | {m['f1']} | {m['ari']} |")
        m = cluster["production_avg_link_names"]["test"]
        add(f"| **Average-link, embeddings + shared names (new production)** | {m['precision']} | {m['recall']} | {m['f1']} | {m['ari']} |")
        add("")
        add(f"Near-duplicate removal (0.93) merged {cluster['dedupe']['cross_story_pairs_above_0.93']} pairs from different stories.")
        add("")

    # ---------------------------------------------------------------- ablation
    if ablation:
        add("## 5. Ablation: plain search context vs graph-grounded context")
        add("")
        add(f"{len(ablation)} questions (10 expanded items × 3 questions). The story title is in the question, so search-only has a fair chance.")
        add("")
        if abl_l:
            def cite_rate(side):
                ok = sum(l[side].get("cite_ok", 0) for l in abl_l)
                n = sum(l[side].get("cite_n", 0) for l in abl_l)
                return f"{ok}/{n} = {ok / n:.2f}" if n else "–"

            for side, name in (("A", "search-only"), ("B", "graph-grounded")):
                cnt = Counter(l[side]["acc"] for l in abl_l)
                add(f"- **{name}**: correct {cnt['correct']}, partial {cnt['partial']}, wrong {cnt['wrong']}, no answer {cnt['no-answer']}; citations that support their sentence: {cite_rate(side)}")
            add("")
        answerable = Counter((x["search_only"].get("answerable"), x["graph"].get("answerable")) for x in ablation)
        add(f"Answerable (search-only, graph): {dict((str(k), v) for k, v in answerable.items())}")
        add("")

    # ---------------------------------------------------------------- automatic
    if auto:
        add("## 6. Automatic checks")
        add("")
        add(f"- Runs finished: {auto['done']}/{auto['runs']}. Runs with a degraded note (quota): {auto['runs_with_degraded_notes']}.")
        add(f"- Text read: {auto['text_how']} (headline-only = the outlet blocked bots or paywalled, so only the source's own summary was used, and the app says so).")
        add(f"- Link labels: {auto['labels']}.")
        add(f"- Statements failing the ontology after emit: {auto['statements_failing_ontology_count']}. Rejected before emit (invalid triples the LLM proposed): {auto['rejected_before_emit']}.")
        u = auto["evidence_urls"]
        add(f"- Evidence URLs (one GET each): {u['ok']} ok, {u['blocked']} blocked bots (401/403), {u['missing']} missing (404/410), {u['error']} errors, of {u['checked']}.")
        add(f"- Pack from all runs: built by the client code ({auto['pack']['client_build']}), {auto['pack']['triples']} triples, SHACL conforms = {auto['pack']['shacl']['conforms']}. SPARQL rows: {auto['pack']['sparql_counts']}.")
        add("")

    if special:
        add("## 7. Safety and honesty cases")
        add("")
        for k, v in special.items():
            detail = {kk: vv for kk, vv in v.items() if kk not in ("pass", "claims", "answer")}
            add(f"- **{k}**: {'PASS' if v.get('pass') else 'FAIL'} — {json.dumps(detail, ensure_ascii=False)[:300]}")
        add("")

    if hands or qa2 or qa3:
        add("## 8. Hands path (scripted IWER hands, emulator)")
        add("")
        if hands:
            add("| Step | ms |")
            add("|---|---|")
            for k, v in hands.get("steps", {}).items():
                add(f"| {k} | {v} |")
            add("")
        for name, q in (("Phase 2 QA", qa2), ("Phase 3 QA", qa3)):
            if q:
                res = q.get("results", [])
                add(f"- {name}: {sum(r['pass'] for r in res)}/{len(res)} steps passed ({q.get('when', '')[:10]}).")
        add("")

    notes = load(LAB / "notes.json", {})
    if notes:
        add("## 9. Top failures and what was changed")
        add("")
        for n in notes.get("failures", []):
            add(f"- {n}")
        add("")
        add("## 10. Which knowledge-graph pieces run where")
        add("")
        for n in notes.get("tiers", []):
            add(f"- {n}")
        add("")
    OUT.write_text("\n".join(md), encoding="utf-8")
    print(f"wrote {OUT}")
    for k, v in rows:
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
