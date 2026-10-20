# Course coverage: openHPI "Knowledge Graphs: Foundations and Applications"

This is an honest status as of 2026-10-20 (V2, after N3). The status values are **implemented** (runs in the app or the pipeline), **partly** (a core idea is in, the full method is not) and **borrowed** (a concept used without the formal machinery).

| Concept | Status | Where | Notes |
|---|---|---|---|
| Triples with stable ids | implemented | `server/fogweave/pipeline.py`, `src/model/graph.js` | Ids such as `type:from->to`. Entities use `wd:Q…` when linked, or `type:canonical-name`. |
| Ontology with domain/range | implemented | `shared/ontology.v2.json`, validated on both sides | It is a JSON schema in code, not OWL. |
| Statement-level provenance (PROV-O) | implemented | `src/export/pack.js` | Each link is a reified `rdf:Statement` / `prov:Entity` with `prov:wasDerivedFrom` evidence entities (`prov:value` quote, `prov:hadPrimarySource` link, `prov:generatedAtTime`) and `prov:wasGeneratedBy` the tool. |
| JSON-LD export | implemented | `src/export/pack.js` | Inline `@context` (fw:, prov:, schema:, dct:). Built on the device, so it works offline. |
| RDF with rdflib + SPARQL queries | implemented | `server/fogweave/rdf.py` | The pack's JSON-LD is parsed with rdflib. Five named SPARQL queries (single-source claims, contradicted claims, well-backed claims, grounded two-hop chains, story timeline) run at export and their results go into the pack. The same ideas run in JavaScript as insights, which also work offline. |
| SHACL validation | implemented | `server/fogweave/rdf.py` (pySHACL) | Shapes cover NewsItem (link, date, outlet), Claim (quote, verdict), reported links (a quoted, linked source), inferred links (reasoning and basis), affects links, and statements. They also stay enforced in code before anything is drawn. |
| Entity linking (Wikidata) | implemented | `server/fogweave/linking.py` | Conservative (exact label/alias plus a type-fit description), behind a flag, cached. |
| Reusing an open KG (Wikidata statements) | implemented | `server/fogweave/explore.py` | Exploring a node reads a fixed set of Wikidata properties (part of, subclass of, parent organisation, located in, country, has part, industry, continent, capital, party, employer, member of) and draws each as a Reported link that cites the statement. |
| Alias merging / identity | implemented | `linking.py` | Small alias table. Merged by QID or by canonical name and type. Unsure entities stay separate. |
| Text embeddings | implemented | `server/fogweave/embed.py` | bge-small-en-v1.5 (local ONNX), with a hashed bag-of-words fallback. |
| GraphRAG for answers | implemented | `server/fogweave/answer.py` | Facts come from the reader's web (speculative links and private context excluded) plus a small fresh search, ranked by embeddings. Every sentence must cite retrieved facts; code drops other citations and otherwise says "The web doesn't tell us." |
| PageRank / personalized PageRank | implemented | client + server | Personalized from private context nodes. |
| Paths / shortest paths | implemented | client + server | Evidence-weighted, labelled hops. |
| Communities (Louvain) | implemented (server) | `graphalgo.py` | Not yet drawn as halos. |
| Betweenness | implemented | client + server | Locket "why". |
| Link prediction | borrowed | `graphalgo.link_suggestions` | Jaccard + text similarity, never trained; output is always speculative. |
| RDFS/OWL-RL inference (Tier 2) | not yet | n/a | Stretch. |
| KG embeddings (Tier 2) | not planned | n/a | Webs are too small to justify it. |

**What runs in production vs offline:**
- The engine, GraphRAG and the RDF, SPARQL and SHACL checks run on the live backend.
- Offline, the app replays recorded production runs and recorded answers.
- Offline, the JSON-LD pack is still built on the device; it is labelled "not validated" until the server can check it.
