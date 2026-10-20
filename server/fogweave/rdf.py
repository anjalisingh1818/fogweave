"""Evidence Pack as RDF (course Tier 1): parse the client's JSON-LD (PROV-O
provenance), validate it with SHACL shapes derived from the ontology, and run
a few named SPARQL queries. The client builds the JSON-LD (it works offline);
this module checks it and adds the query results to the pack.

Vocabulary: urn:fogweave:ontology:2# (fw:), PROV-O (prov:), schema.org,
Dublin Core terms. Statements are reified (rdf:Statement) so each one can
carry its label (reported / inferred / speculative) and provenance.
"""

from __future__ import annotations

import json

from pyshacl import validate
from rdflib import Graph, Namespace
from rdflib.namespace import PROV, RDF, RDFS

FW = Namespace("urn:fogweave:ontology:2#")

SHAPES_TTL = """
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix fw: <urn:fogweave:ontology:2#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix schema: <https://schema.org/> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .

fw:NewsItemShape a sh:NodeShape ; sh:targetClass fw:NewsItem ;
  sh:property [ sh:path schema:url ; sh:minCount 1 ; sh:message "NewsItem needs a link" ] ;
  sh:property [ sh:path dct:date ; sh:minCount 1 ; sh:message "NewsItem needs a date" ] ;
  sh:property [ sh:path fw:outlet ; sh:minCount 1 ; sh:message "NewsItem needs an outlet (source)" ] .

fw:ClaimShape a sh:NodeShape ; sh:targetClass fw:Claim ;
  sh:property [ sh:path fw:quote ; sh:minCount 1 ; sh:maxLength 400 ; sh:message "Claim needs a short quote" ] ;
  sh:property [ sh:path fw:verdict ; sh:minCount 1 ; sh:in ( "supported" "contradicted" "mixed" "unverified" ) ] .

fw:EvidenceShape a sh:NodeShape ;
  sh:property [ sh:path prov:value ; sh:minCount 1 ; sh:message "evidence needs a quote" ] ;
  sh:property [ sh:path prov:hadPrimarySource ; sh:minCount 1 ; sh:message "evidence needs a link" ] .

fw:ReportedShape a sh:NodeShape ; sh:targetClass fw:ReportedStatement ;
  sh:property [ sh:path prov:wasDerivedFrom ; sh:minCount 1 ; sh:node fw:EvidenceShape ;
                sh:message "reported link without a quoted, linked source" ] .

fw:InferredShape a sh:NodeShape ; sh:targetClass fw:InferredStatement ;
  sh:property [ sh:path fw:reasoning ; sh:minCount 1 ; sh:message "inferred link needs a reasoning step" ] ;
  sh:property [ sh:path fw:basis ; sh:minCount 1 ; sh:message "inferred link needs the facts it rests on" ] .

fw:AffectsShape a sh:NodeShape ; sh:targetClass fw:AffectsStatement ;
  sh:or ( [ sh:path prov:wasDerivedFrom ; sh:minCount 1 ] [ sh:path fw:reasoning ; sh:minCount 1 ] ) ;
  sh:message "affects link needs an evidence quote or a reasoning step" .

fw:StatementShape a sh:NodeShape ; sh:targetClass rdf:Statement ;
  sh:property [ sh:path rdf:subject ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path rdf:object ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path fw:label ; sh:minCount 1 ; sh:in ( "reported" "inferred" "speculative" ) ] .
"""

PREFIXES = """
PREFIX fw: <urn:fogweave:ontology:2#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <https://schema.org/>
"""

QUERIES = {
    # claims whose only support is the outlet that reported them (weak spots)
    "single_source_claims": PREFIXES + """
SELECT ?claim ?label WHERE {
  ?claim a fw:Claim ; rdfs:label ?label ; fw:independentDomains ?n .
  FILTER (?n <= 1)
} ORDER BY ?label""",
    # claims some independent source contradicts
    "contradicted_claims": PREFIXES + """
SELECT DISTINCT ?claim ?label ?source WHERE {
  ?st a rdf:Statement ; rdf:predicate fw:contradicts ; rdf:subject ?source ; rdf:object ?claim .
  ?claim rdfs:label ?label .
} ORDER BY ?label""",
    # claims backed by at least N independent domains
    "well_backed_claims": PREFIXES + """
SELECT ?claim ?label ?n WHERE {
  ?claim a fw:Claim ; rdfs:label ?label ; fw:independentDomains ?n .
  FILTER (?n >= 2)
} ORDER BY DESC(?n) ?label""",
    # two-hop grounded chains (no speculative statements): A -> X -> B
    "two_hop_chains": PREFIXES + """
SELECT ?a ?p1 ?x ?p2 ?b WHERE {
  ?s1 a rdf:Statement ; rdf:subject ?a ; rdf:predicate ?p1 ; rdf:object ?x ; fw:label ?l1 .
  ?s2 a rdf:Statement ; rdf:subject ?x ; rdf:predicate ?p2 ; rdf:object ?b ; fw:label ?l2 .
  FILTER (?l1 != "speculative" && ?l2 != "speculative" && ?a != ?b)
  FILTER (?p1 IN (fw:affects, fw:depends_on, fw:involves, fw:happened_in, fw:about))
  FILTER (?p2 IN (fw:affects, fw:depends_on, fw:part_of, fw:happened_in))
} LIMIT 50""",
    # story order through follows links
    "story_timeline": PREFIXES + """
SELECT ?earlier ?later WHERE {
  ?st a rdf:Statement ; rdf:predicate fw:follows ; rdf:subject ?later ; rdf:object ?earlier ; fw:label ?l .
  FILTER (?l != "speculative")
}""",
}


def load_jsonld(doc: dict | str) -> Graph:
    g = Graph()
    data = doc if isinstance(doc, str) else json.dumps(doc)
    g.parse(data=data, format="json-ld")
    return g


def shacl_report(g: Graph) -> dict:
    shapes = Graph().parse(data=SHAPES_TTL, format="turtle")
    conforms, results_graph, _ = validate(g, shacl_graph=shapes, inference="none", abort_on_first=False, allow_warnings=True)
    problems = []
    SH = Namespace("http://www.w3.org/ns/shacl#")
    for r in results_graph.subjects(RDF.type, SH.ValidationResult):
        problems.append(
            {
                "focus": str(results_graph.value(r, SH.focusNode)),
                "path": str(results_graph.value(r, SH.resultPath) or ""),
                "message": str(results_graph.value(r, SH.resultMessage) or ""),
            }
        )
    return {"conforms": bool(conforms), "violations": len(problems), "problems": problems[:30]}


def run_queries(g: Graph) -> dict:
    out = {}
    for name, q in QUERIES.items():
        rows = []
        for row in g.query(q):
            rows.append({str(k): str(v) for k, v in row.asdict().items()})
        out[name] = rows
    return out


def _inline_contexts_only(node) -> bool:
    """Remote @context URLs would make the server fetch addresses a client chose."""
    if isinstance(node, dict):
        ctx = node.get("@context")
        if ctx is not None and (isinstance(ctx, str) or (isinstance(ctx, list) and any(isinstance(c, str) for c in ctx))):
            return False
        return all(_inline_contexts_only(v) for v in node.values())
    if isinstance(node, list):
        return all(_inline_contexts_only(v) for v in node)
    return True


def check_pack(doc: dict) -> dict:
    if not _inline_contexts_only(doc):
        raise ValueError("remote @context is not allowed; embed the context")
    g = load_jsonld(doc)
    return {
        "triples": len(g),
        "claims": len(set(g.subjects(RDF.type, FW.Claim))),
        "statements": len(set(g.subjects(RDF.type, RDF.Statement))),
        "provEntities": len(set(g.subjects(RDF.type, PROV.Entity))),
        "shacl": shacl_report(g),
        "sparql": run_queries(g),
    }
