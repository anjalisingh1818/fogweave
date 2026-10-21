# FogWeave plan (V1 master prompt + V2 delta, merged 2026-10-20)

Source of truth: the V1 master prompt (rules in section 0, hands-first, honesty, legal and safe, the take-it-away test, release gates) **plus** [FOGWEAVE_V2_DELTA.md](FOGWEAVE_V2_DELTA.md). Where they conflict, V2 wins.

**V2 in one line:** a hands-first VR **news impact graph** in a gray fog. News arrives as drifting lights. Touch one to see what it connects to, what it may affect, and how it may reach the user's own world. Every link is labelled Reported, Inferred or Speculative.

## What carries over from Phase 0/1 (kept as built)

| Built | V2 use |
|---|---|
| Fog world, atmosphere, quality governor | unchanged |
| Instanced web view, label LOD, worker layout | renders the news and entity graph |
| Cards (uv hit-test), card arc, keypad, suggestion cards, help, tour | reader card, Ask, context entry |
| Fog/Sealed layers, seal cascade, Library | sealed news and chains feed the Library and Evidence Pack |
| Coin (evidence strength, computed by code) | unchanged; it also reads link labels |
| Locket (PageRank rank + why) | becomes **personalized** PageRank from context nodes (Phase 2) |
| Path (BFS) + path highlight | becomes the evidence-weighted path news → context node ("how does this touch me") |
| Research event stream + replay | the news ingest streams the same way |
| Scripted-hands QA, unit tests | extended with every new feature |

## Parked (do not build)

System Mode, Blueprint Mode, the dataset workshop, the detective idea, QRNG (now ordinary seeded random, see DECISIONS).

## Phases (no restart)

**Phase 1 (finish now):** the light object (drifting news lights: kind, relevance glow, age mark) and the reader-card shell (headline, source, date, summary, key claims, quotes, link, Seal). It runs on dated bundled data; test fixtures until Phase 2 has real snapshots.

**Phase 2: news engine.**
- V2 ontology in code (NewsItem, Event, Organisation, Place, Topic, Technology, PublicFigure, ContextNode, Claim, Source; relations with domain/range), versioned.
- Link labels Reported / Inferred / Speculative on every edge. Speculative is drawn faint and never ranked.
- Source router with one adapter per source; each source is verified first and recorded in `docs/SOURCES.md`.
- Ingest, dedupe and story clustering (embeddings), entity linking (Wikidata, behind a flag; when unsure, keep entities separate), claim extraction, impact chains (2 hops, plus 1 on tap), provenance (PROV-O).
- Personal context graph, stored on the device only, with "clear my context".
- Algorithms: personalized PageRank, evidence-weighted path, communities, betweenness, `follows` timeline, link suggestion (Speculative only). Each gets a test and an entry in `docs/ALGORITHMS.md`.
- Free LLM chain with a quota governor.
- Replace the fixtures with dated real snapshots: lights plus 2–3 expanded items.

**Phase 3:**
- The reader card in full: Expand, Ask (GraphRAG and fresh search, with citations), "How does this touch me?" thread, timeline.
- Daily briefing: 3–5 lights plus 1 outside the bubble, never Speculative.
- Library / Evidence Pack export (JSON-LD + PROV-O, JSONL, Markdown); workspace panels (Map, Library, Notes, Lights).
- Optional read aloud (text-to-speech output, verified on Quest Browser); optional voice; polish.

**Phase 4/5:**
- V2 evals:
  - impact-chain precision per label on 30–40 items;
  - connection eval on 15 items, including the "no clear connection" rate;
  - story clustering on 20 stories;
  - ablation of search context vs graph context on 30 questions;
  - the hands path timed in the emulator.
- QA, preview rehearsal on 6 Nov, final release 12–13 Nov. **Feature freeze 13 Nov.**

## Dates

- Phase 1: by 28 Oct.
- Phase 2: by 5 Nov.
- Phase 3: by 9 Nov.
- Decision gate, 2 Nov: news ingest from 2+ sources, a graph with labelled links, and one working touch → card → expand flow with emulator hands. If it is not met, FogWeave becomes a side project and ClayMind gets the time.

## Cut order and never-cut

**Cut in this order:** read aloud, then timeline, then link suggestions, then extra sources, then community halos.

**Never cut:**
- the hands-only path;
- the dated offline snapshot of real pipeline output;
- labels on every link;
- the evidence breakdown;
- the privacy rules;
- Seal/Library export;
- the release gates.

## Docs to keep

README, DECISIONS, PLAN, SOURCES, ALGORITHMS, ONTOLOGY, EVIDENCE, COURSE_COVERAGE, KNOWN_LIMITS (including the V2 section 11 limits), CREDITS, QA_REPORT, EVAL_REPORT.
