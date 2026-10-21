# FogWeave evaluation (Phase 4)

Re-runnable with `/eval` in Claude Code (see `.claude/commands/eval.md`) or by hand:

```bash
cd server
python eval/collect.py        # eval sets from Wikipedia Current events (fixed window ending 2026-10-19)
python eval/run.py            # 30 live expansions with persona context (resumable)
python eval/cluster_eval.py   # story clustering vs Wikipedia story headings (no LLM)
python eval/auto_checks.py    # quotes verbatim, URLs resolve, ontology, SHACL, latency, tokens
python eval/special.py        # injection (hidden + visible), nonsense page, private people, quota exhaustion
python eval/verify_sample.py  # verifier pairs for hand labels
python eval/ablation.py       # 30 questions: search-only vs graph-grounded
python eval/sheets.py         # labelling sheets for impact links and "Touches me?"
python eval/report.py         # -> docs/EVAL_REPORT.md (uses eval/labels/*.json)
```

## Who labels

Hand labels in `eval/labels/` were made by **the build assistant (Claude)**, reading each link next to the facts or quote it rests on. They were not made by an independent human annotator, and there is no inter-annotator agreement. Each file keeps a reason per label so the owner can re-label any row and re-run `report.py`.

## Rubrics

**Impact links** (`impact_labels.json`):
- *correct*: the link follows from the cited quote (reported) or from the listed basis facts (inferred). For speculative links: plausible and clearly weaker.
- *partial*: the direction is right but it overstates, or the endpoint is vague or mistyped.
- *wrong*: it does not follow, is backwards, or names the wrong entity.

Precision counts correct = 1, partial = 0.5, wrong = 0.

**Verifier pairs** (`verifier_labels.json`): the gold stance (supports / contradicts / unclear) of the evidence text toward the claim. Agreement is the share of pairs where the model's stance equals gold, plus the confusion matrix.

**"Touches me?"** (`connection_labels.json`), per item and persona:
- *plausible_connection*: is there a real, grounded way this news touches the persona?
- *sensible*: is the result the app shows sensible? A grounded path that makes sense counts, and so does an honest "no clear connection" when there is none.

**Ablation** (`ablation_labels.json`), per answer:
- *accuracy*: correct / partial / wrong / no-answer, against what the item's reporting says.
- *citation correctness*: the share of cited facts that actually support their sentence.
