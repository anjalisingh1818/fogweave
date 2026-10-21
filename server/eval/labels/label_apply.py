"""Apply a batch of index-based hand labels to impact_sheet rows, storing them
by stable key in impact_labels.json (who: build assistant, Claude).
  python eval/labels/label_apply.py _batch1 [offset_title_check]"""

import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
batch = sys.argv[1]
spec = importlib.util.spec_from_file_location(batch, HERE / f"{batch}.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
sheet = json.loads((HERE / f"{getattr(mod, 'SHEET', 'impact_sheet')}.json").read_text(encoding="utf-8"))
labels_path = HERE / "impact_labels.json"
labels = json.loads(labels_path.read_text(encoding="utf-8")) if labels_path.exists() else {}
rows = getattr(mod, "ROWS", None) or sheet
for i, (verdict, why) in mod.L.items():
    r = rows[i]
    key = r["key"] if r["key"].count("|") >= 2 else f"{r['key']}|{r['label']}"
    labels[key] = {"verdict": verdict, "why": why, "label": r["label"], "link": r["link"], "by": "build assistant (Claude)"}
labels_path.write_text(json.dumps(labels, indent=1, ensure_ascii=False), encoding="utf-8")
print(f"labelled {len(mod.L)} rows; total {len(labels)}")
