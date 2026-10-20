# Graph algorithms

Two implementations of the same ideas:

- **Client (JavaScript, `src/model/algorithms.js`):** everything that depends on the reader's private context or must work offline, such as the Locket, light glow and "Touches me?".
- **Server (networkx, `server/fogweave/graphalgo.py`):** pipeline and evaluation work, such as stories, bridges, timelines and suggestions.

**Speculative links are excluded from every ranking, path and insight on both sides.** Each algorithm has unit tests (`tests/model.test.js`, `server/tests/test_core.py`).

| Algorithm | Computes | Shown as | What it cannot say |
|---|---|---|---|
| **Personalized PageRank** (seeds = the reader's context nodes; plain PageRank without context) | How strongly a node is connected to *your* context through reported and inferred links | Locket ("2nd of 14 · for you", plus the nearest context and its hop count); glow of expanded lights | It says nothing about truth. Unexpanded lights fall back to text similarity to your context. |
| **Evidence-weighted best path** (Dijkstra: Reported 1, Inferred 2, Speculative not walkable) | The most grounded chain from a news item to any context node, with the label of every hop | "Touches me?" thread of light, with each hop's quote or reasoning | When no such chain exists it says **"No clear connection found"** and never invents one. A path is a *possible* effect, not a prediction. |
| **BFS shortest path** (unweighted, stable tie-break) | Fewest links between two chosen nodes | Link on two cards, or both props held | Shorter does not mean stronger. |
| **Betweenness** (Brandes, normalised) | Nodes that bridge parts of the web | Locket "why" ("a bridge between parts of the web"); bridge stories on the server | Bridges in a small web can be artefacts of what was expanded. |
| **Communities** (Louvain, seed 42; server) | Stories and themes | Story id per light (also from embedding clusters); later the colour halo | Communities depend on what was expanded. They are not a newsroom's definition of a story. |
| **Timeline via `follows`** (topological order, ties by date; server) | Story order over time | Timeline (Phase 3) | Only as complete as the `follows` links found. |
| **Link suggestion** (Jaccard of shared neighbours + text similarity; server) | Pairs that might be related | Always **Speculative** `relates_to`, drawn faint | Never used for ranking or insights. |
| **Story clustering** (bge-small embeddings, average-link with shared names; evaluated in Phase 4) and **near-duplicate removal** (above 0.93) | Groups similar lights, drops repeats | `story` on each light | Similar wording is not the same event. Test F1 0.475 against Wikipedia story headings (single-link baseline 0.305); see EVAL_REPORT. |
| **Feed quality score** (0.40 source class + 0.30 recency + 0.20 usefulness + 0.10 novelty; server) | A score per pooled item | Which items can become lights (floor 0.45) | A heuristic, not editorial judgement. |
| **Curated-random sampling** (seeded mulberry32, weighted by quality and interest match; client, `src/feed.js`) | The 16 lights shown | The lights | At most one per story and three per type; papers capped at a quarter (half with paper interests); about 1 in 4 picks from outside your interests; muted topics never. Same seed and pool give the same lights, so undoing an interest brings them back. |
| **Explore ranking** (client) | Which new nodes show first when a node opens | About eight per step, then "Show more" | Order is parts, then news, papers and impact as they arrive; hidden nodes are still in the web, just not drawn. |
| **Focus-aware visibility** (graph distance from the focused node + score; client) | Which 60 nodes are drawn | The web around what you are looking at | Far parts of a big web fade until you go back to them. |
