---
description: Re-run the FogWeave evaluation and regenerate docs/EVAL_REPORT.md
---
Re-run the FogWeave Phase 4 evaluation (see server/eval/README.md):

1. From `server/`, with the venv: run `python eval/run.py` (resumable; needs GROQ_API_KEY), then `python eval/cluster_eval.py`, `python eval/auto_checks.py`, `python eval/special.py`, `python eval/verify_sample.py`, `python eval/ablation.py`, `python eval/sheets.py`.
2. If new rows appeared in `eval/labels/*_sheet.json` that have no label in the matching `*_labels.json`, label them by hand following the rubric in `server/eval/README.md` (keep a short reason per label) and say clearly who labelled them.
3. Run `python eval/report.py` and show the headline numbers. Report honest numbers even if they are low, list the top failures, and do not change labels to improve results.
