# Course coverage: openHPI "Knowledge Graphs: Foundations and Applications"

This is an honest status as of 2026-10-20 (end of Phase 2). The status values are **implemented** (runs in the app or the pipeline), **partly** (a core idea is in, the full method is not) and **borrowed** (a concept used without the formal machinery).

| Concept | Status | Where | Notes |
|---|---|---|---|
| Triples with stable ids | implemented | `server/fogweave/pipeline.py`, `src/model/graph.js` | Ids such as `type:from->to`. Entities use `wd:Q…` when linked, or `type:canonical-name`. |
| Ontology with domain/range | implemented | `shared/ontology.v2.json`, validated on both sides | It is a JSON schema in code, not OWL. |
| Statement-level provenance (PROV-O ideas) | partly | evidence items on every link | The fields are present. The PROV-O JSON-LD serialisation comes with the Evidence Pack (Phase 3). |
| JSON-LD export | not yet | n/a | Phase 3. |
| RDF export with rdflib + SPARQL queries | not yet | n/a | Phase 3 (Tier 1). The named graph queries already exist as functions (paths, single-source claims via the evidence breakdown). |
| SHACL validation | partly | shapes enforced in code (`ontology.py`) | pySHACL over the exported RDF in Phase 3. |
| Entity linking (Wikidata) | implemented | `server/fogweave/linking.py` | Conservative (exact label/alias plus a type-fit description), behind a flag, cached. |
| Alias merging / identity | implemented | `linking.py` | Small alias table. Merged by QID or by canonical name and type. Unsure entities stay separate. |
| Text embeddings | implemented | `server/fogweave/embed.py` | bge-small-en-v1.5 (local ONNX), with a hashed bag-of-words fallback. |
| GraphRAG for answers | not yet | n/a | Phase 3 (Ask). |
| PageRank / personalized PageRank | implemented | client + server | Personalized from private context nodes. |
| Paths / shortest paths | implemented | client + server | Evidence-weighted, labelled hops. |
| Communities (Louvain) | implemented (server) | `graphalgo.py` | Not yet drawn as halos. |
| Betweenness | implemented | client + server | Locket "why". |
| Link prediction | borrowed | `graphalgo.link_suggestions` | Jaccard + text similarity, never trained; output is always speculative. |
| RDFS/OWL-RL inference (Tier 2) | not yet | n/a | Stretch. |
| KG embeddings (Tier 2) | not planned | n/a | Webs are too small to justify it. |

**What runs in production vs offline:** the whole Phase 2 engine runs in production (the live backend). The bundled snapshot is a recorded production run. The Phase 3 rdflib/SPARQL/SHACL pieces are planned to run at export time.
