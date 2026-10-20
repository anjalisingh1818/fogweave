"""V2 ontology: loads shared/ontology.v2.json (the same file the client
uses) and validates nodes, triples (domain/range) and the SHACL-style
shapes. Invalid statements are rejected with a reason, never drawn."""

from __future__ import annotations

import json
from pathlib import Path

_PATH = Path(__file__).resolve().parents[2] / "shared" / "ontology.v2.json"
ONTOLOGY = json.loads(_PATH.read_text(encoding="utf-8"))
VERSION = ONTOLOGY["version"]
CLASSES = set(ONTOLOGY["classes"])
LABELS = set(ONTOLOGY["labels"])
ENTITY_CLASSES = set(ONTOLOGY["groups"]["Entity"])


def _expand(types: list[str]) -> set[str]:
    out: set[str] = set()
    for t in types:
        out |= set(ONTOLOGY["groups"][t[1:]]) if t.startswith("@") else {t}
    return out


RELATIONS = {
    name: {"domain": _expand(r["domain"]), "range": _expand(r["range"]), "labels": set(r.get("labels", LABELS))}
    for name, r in ONTOLOGY["relations"].items()
}


def validate_node(node: dict) -> str | None:
    if not node.get("id"):
        return "missing id"
    if node.get("type") not in CLASSES:
        return f"unknown class {node.get('type')}"
    if not str(node.get("label", "")).strip():
        return "missing label"
    if node["type"] == "NewsItem" and (not node.get("outlet") or not node.get("date")):
        return "NewsItem needs an outlet and a date"
    if node["type"] == "Claim" and not node.get("quote"):
        return "Claim needs a quote"
    return None


def validate_edge(edge: dict, nodes: dict[str, dict]) -> str | None:
    rel = RELATIONS.get(edge.get("type"))
    if not rel:
        return f"unknown relation {edge.get('type')}"
    s, o = nodes.get(edge.get("from")), nodes.get(edge.get("to"))
    if not s or not o:
        return "dangling endpoint"
    if edge["from"] == edge["to"]:
        return "self loop"
    if s["type"] not in rel["domain"]:
        return f"{edge['type']} cannot start at {s['type']}"
    if o["type"] not in rel["range"]:
        return f"{edge['type']} cannot end at {o['type']}"
    label = edge.get("label")
    if label not in LABELS:
        return f"unknown label {label}"
    if label not in rel["labels"]:
        return f"{edge['type']} must be {sorted(rel['labels'])}"
    if label == "reported" and not any(ev.get("quote") and ev.get("url") for ev in edge.get("evidence", [])):
        return "reported link without a quoted, linked source"
    if label == "inferred" and (not edge.get("reasoning") or not edge.get("basis")):
        return "inferred link without reasoning and basis"
    return None
