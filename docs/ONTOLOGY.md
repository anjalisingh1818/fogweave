# Ontology (v2.0.0)

One versioned file, [`shared/ontology.v2.json`](../shared/ontology.v2.json), is read by both the server (`server/fogweave/ontology.py`) and the client (`src/model/schema.js`). Every node and link is validated before it is emitted or drawn. Invalid statements are rejected with a reason (and counted in the run stats), never silently drawn.

**Classes:** NewsItem, Event, Organisation, Place, Topic, Technology, PublicFigure, ContextNode, Claim, Source. *Entity* = Event, Organisation, Place, Topic, Technology, PublicFigure.

| Relation | Domain → Range | Typical label |
|---|---|---|
| mentions | NewsItem → Entity | reported (quote around the name) |
| about | NewsItem → Event, Topic | reported (headline) |
| reports | NewsItem, Source → Claim, Event | reported |
| happened_in | Event → Place | reported |
| involves | Event → Organisation, PublicFigure, Technology, Place, Topic | reported |
| affects | Entity, Claim, NewsItem → Entity, ContextNode | inferred / speculative (impact chains) |
| depends_on | Entity, ContextNode → Entity | reported / inferred |
| part_of | Entity → Entity | reported |
| competes_with | Organisation, Technology → Organisation, Technology | reported |
| follows | NewsItem, Event → NewsItem, Event | inferred (story timeline) |
| supports / contradicts | Source, NewsItem, Claim → Claim | reported (corroboration) |
| same_as | ContextNode → Entity | inferred, computed **on the device** |
| relates_to | Entity, NewsItem, Claim → same | **speculative only** (link suggestions) |

`same_as` and `relates_to` were added to the V2 list. The first links private context without sending it anywhere; the second gives link suggestions a relation that can never be mistaken for a finding.

**Labels:**
- **reported:** needs at least one evidence item with a verbatim quote and a URL.
- **inferred:** needs a reasoning step and the ids it rests on. An "inferred" link whose basis does not exist is demoted to speculative by code.
- **speculative:** faint, never ranked.

**Provenance per statement (PROV-O-ready):** `source`, `url`, `quote` (25 words or fewer, checked verbatim against the text it came from), `date`, `retrievedAt` and `extractor` version. The JSON-LD / PROV-O export comes with the Evidence Pack in Phase 3.

**SHACL-style shapes (enforced in code today; pySHACL in Phase 3):**
- every NewsItem has an outlet and a date;
- every Claim has a quote;
- every reported link has a quoted, linked source;
- every inferred link has reasoning and a basis;
- every affects link has a quote or reasoning.

**Privacy:** ContextNodes are private. They are never sealed, never exported, and stored only on the device.
