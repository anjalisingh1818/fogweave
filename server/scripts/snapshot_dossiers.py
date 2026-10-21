"""Add node dossiers (what each node is, key facts, sources) to the bundled
snapshot, for every place, organisation, public figure, topic, technology and
event in its recorded webs, so the Demo scene shows real information too.

  python scripts/snapshot_dossiers.py      (also run at the end of snapshot.py)
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fogweave.dossier import DOSSIER_TYPES, DossierMaker  # noqa: E402
from fogweave.pipeline import Engine  # noqa: E402

SNAP = ROOT.parent / "public" / "demo" / "snapshot"


def webs(snapshot_dir: Path, index: dict) -> list[tuple[list[dict], list[str]]]:
    """Per recorded web: its dossier nodes and its place names (to tell same-named bodies apart)."""
    out = []
    for rel in list(index.get("expansions", {}).values()) + list(index.get("explores", {}).values()):
        rec = json.loads((snapshot_dir / rel).read_text(encoding="utf-8"))
        nodes = {}
        places = []
        for ev in rec.get("events", []):
            n = ev.get("node") if ev.get("type") == "node" else None
            if not n or not n.get("label"):
                continue
            if n.get("type") in ("Place", "Organisation", "Event") and not n.get("derived"):
                places.append(n["label"])
            if n.get("type") in DOSSIER_TYPES and not n.get("derived"):
                nodes.setdefault(n["id"], {"id": n["id"], "type": n["type"], "label": n["label"], "qid": n.get("qid")})
        out.append((list(nodes.values()), places))
    return out


async def add_dossiers(snapshot_dir: Path = SNAP, engine: Engine | None = None) -> int:
    index_path = snapshot_dir / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    own = engine is None
    eng = engine or Engine()
    maker = DossierMaker(eng)
    dossiers = {}
    for nodes, places in webs(snapshot_dir, index):
        todo = [n for n in nodes if n["id"] not in dossiers]
        for i in range(0, len(todo), 30):
            dossiers.update(await maker.make(todo[i : i + 30], places))
    index["dossiers"] = dossiers
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    found = sum(1 for d in dossiers.values() if d.get("found"))
    print(f"dossiers: {len(dossiers)} nodes, {found} with real information, {len(dossiers) - found} 'not enough information'", flush=True)
    if own:
        await eng.http.aclose()
    return len(dossiers)


if __name__ == "__main__":
    asyncio.run(add_dossiers())
