"""Evidence Pack: the client's JSON-LD parses as RDF, conforms to the SHACL
shapes, and the named SPARQL queries return sensible rows."""

import copy
import json
from pathlib import Path

import pytest

from fogweave.rdf import check_pack

SAMPLE = Path(__file__).resolve().parents[2] / "qa" / "fixtures" / "pack-sample.jsonld"


@pytest.fixture(scope="module")
def pack():
    if not SAMPLE.exists():
        pytest.skip("run `node scripts/sample-pack.mjs` first")
    return json.loads(SAMPLE.read_text(encoding="utf-8"))


def test_sample_pack_conforms_to_shapes(pack):
    r = check_pack(pack)
    assert r["triples"] > 100
    assert r["claims"] >= 3 and r["statements"] >= 10
    assert r["shacl"]["conforms"], r["shacl"]["problems"][:3]


def test_sparql_queries_return_rows(pack):
    r = check_pack(pack)["sparql"]
    assert set(r) == {"single_source_claims", "contradicted_claims", "well_backed_claims", "two_hop_chains", "story_timeline"}
    assert r["two_hop_chains"], "expected at least one grounded two-hop chain in the recorded runs"
    for row in r["single_source_claims"]:
        assert row["claim"].startswith("urn:fogweave:node:")


def test_reported_link_without_evidence_violates(pack):
    broken = copy.deepcopy(pack)
    for item in broken["@graph"]:
        if "fw:ReportedStatement" in item.get("@type", []) and "derivedFrom" in item:
            del item["derivedFrom"]
            break
    r = check_pack(broken)
    assert not r["shacl"]["conforms"]
    assert any("quoted, linked source" in p["message"] for p in r["shacl"]["problems"])


def test_inferred_link_without_reasoning_violates(pack):
    broken = copy.deepcopy(pack)
    hit = False
    for item in broken["@graph"]:
        if "fw:InferredStatement" in item.get("@type", []):
            item.pop("reasoning", None)
            hit = True
            break
    if not hit:
        pytest.skip("no inferred link in sample")
    assert not check_pack(broken)["shacl"]["conforms"]


def test_remote_context_is_refused(pack):
    bad = dict(pack)
    bad["@context"] = "https://example.org/evil-context.jsonld"
    with pytest.raises(ValueError):
        check_pack(bad)
