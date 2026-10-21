# FogWeave

A hands-first VR **news impact graph** set in a gray fog. News arrives as drifting lights. Touch one to see what it connects to, what it may affect, and how it may reach your own world. Every link is labelled by how well supported it is, and you seal only what you trust into a cited, exportable Library. (Plan: [docs/FOGWEAVE_V3_BEST_PROMPT.md](docs/FOGWEAVE_V3_BEST_PROMPT.md); older prompts in docs/old-prompts.)

Built with [IWSDK](https://developers.meta.com/horizon/documentation/iwsdk/) (WebXR, three.js and ECS) for the Meta VR Start Developer Competition 2026. It is seated and works with hands only; voice is an optional extra.

> **Status (V2 N3 done, 2026-10-20; N4 evaluation and release QA in progress).** V2 adds a curated-random feed shaped by your interests, exploring any node (definition, origin, parts, related news and papers, labelled impact) with a breadcrumb trail, and the new look. The V2 acceptance run (§12.5) passes 14/14 with scripted emulator hands, live and offline. Earlier: The live news engine runs on four free sources: news lights, reader claims with verbatim quotes, and streaming Expand into a labelled impact web. Your private context, the personalized Locket and the "Touches me?" thread work too. Also built: Ask with citations, insights, the story timeline, the daily briefing, workspace panels (Library, Notes, Lights), settings, ambient sound, optional read-aloud and voice, and the Evidence Pack export (JSON-LD + PROV-O, validated with SHACL and SPARQL). Offline, the app replays a dated snapshot of real pipeline runs. Next: evaluation (Phase 4) and release QA (Phase 5).

## Reading the fog

| Colour | Ring | Meaning |
|---|---|---|
| Blue | solid | Well supported |
| Violet | dashed | Mixed |
| Red | double | Contradicted |
| Gray | dotted | Unverified (the default) |

Translucent, drifting items are **fog**: found this session, and gone afterwards unless sealed. Solid items are **sealed** and form your Library.

## What you do (hands only)

- **Lights are a curated-random feed**, not a ranked list: about 16 at a time, drawn by seeded weighted sampling from a scored pool (source class, recency, usefulness, novelty). There is at most one per story, papers are capped, and about one in four is deliberately outside your interests. **"?" → Interests** sets news types, paper types (arXiv categories) and topics, or mutes some; the lights change, and change back when you undo. **More / Less like this** on a reader card tunes topics. **New lights** reshuffles.
- Light shape and glow show the kind: **Latest** is a steady star, **Research** a slowly breathing orb, **Archive** a small, dimmer orb. Lights are warm white-gold; evidence colours appear only on node rings and links. Small pulses run along links from cause to affected, faster for better-supported links. The faint coloured specks in the fog are decoration only.
- **Pinch any node** (a place, organisation, topic…) and it **opens up**: a definition and origin (Wikipedia lead), its parts and context (Wikidata statements), related news and papers that name it, and labelled impact. About eight new nodes come per step; **Show more**, **Pin** and **Collapse** are on its card. The status bar shows your trail ("Bangladesh › Rajshahi Division"), and **‹ Back** returns.
- **Pinch a light** to open its reader card (headline, source, date, summary, key claims with short verbatim quotes, link). **Expand** grows it into the web: who and what it involves, and what it may affect. Every link is labelled **Reported**, **Inferred** or **Speculative**.
- **"Touches me?"** on a news node draws a grounded thread to your context, or says "no clear connection found". Your context (city, field, tools, interests; nothing sensitive) lives only on the device ("?" → My context).
- **Pinch a node** to open its card, with evidence lines (independent domains, source classes, support and contradiction counts) and a risk note.
- **Seal** on a card keeps the item. Sealing a claim also seals the sources and edges that back it.
- **Pinch empty space** to name a topic with the pinch keypad, or pick a suggestion card.
- **Coin:** flip it near a node, or tap it (a quick pinch on the coin, or a pinch on its tag). It shows the verdict and its breakdown. Flipped in open air, it finds the most central node.
- **Locket:** swing it near a node, or tap it. It shows the node's rank ("3rd of 12") and why.
- **Link** on two cards, or hold both props, highlights the shortest path between the two nodes.
- **Ask** (reader or node card): a suggestion card or the keypad. Answers cite where each sentence comes from; pinch a citation to see it. "Is this reliable?" is answered from the evidence itself.
- **Library → Export pack** saves a zip: `pack.jsonld` (PROV-O), `claims.jsonl`, `README.md`, and `validation.json` when online.
- **"?" on the wrist**: Library, Notes, Lights, Interests, My context, Briefing, Settings (the Tour is in Settings). Panels can be pinned and moved.
- **Flick** a card away, or press Close. The **"?"** on your left wrist opens help and the Library.

## Run it

```bash
npm install
npm run dev            # https://localhost:8081 (self-signed; use this on a Quest on the same network)
```

For the desktop emulator over plain HTTP:

```bash
FW_HTTP=1 npm run dev  # http://localhost:8081  (add ?debug for an fps meter and window.__fw)
```

The emulator (IWER, Meta Quest 3 profile) is injected on localhost only.

**Without the backend:** the app uses the dated snapshot of real runs in `public/demo/snapshot/`, and the status line says so. Recorded expansions replay; lights without a recording say Expand needs the live engine.

**Backend** (news engine):

```bash
cd server
python -m venv .venv && .venv\Scripts\activate   # or: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # add a free Groq key; never commit .env
uvicorn app:app --port 8787
python scripts/snapshot.py   # refresh the offline snapshot from real runs
```

## Tests

```bash
npm test               # model, algorithms, layout (node:test)
npm run qa             # Phase 2 + 3 scripted-hands runs, live + offline; needs the dev server and backend running
npm run qa:offline     # offline parts only
node qa/v2-accept.mjs  # V2 acceptance (§12.5), live + offline; add 'offline' or 'live' for one
node qa/stage-a.mjs    # Stage A: mouse on the flat page + emulator hands, card layout at 3 sizes, labels; add 'live' for live
node qa/no-third-party.mjs  # no request leaves localhost (hands and controllers in XR)
node qa/stage-b.mjs    # Stage B: more/less like this + Undo, kept on device, datasets, older news; add 'live' for live
node qa/prod-smoke.mjs # production build check: run `npm run build` and `npx vite preview --port 4173` first
cd server && python -m pytest   # backend: sources, LLM governor, evidence, ontology, algorithms
```

QA writes screenshots and `phase2-results.json` to `qa/recordings/` (git-ignored). These are scripted hands in headless Chromium, not a person on a Quest.

## Layout

```
src/
  model/       schema (ontology + colour language), GraphStore (fog/sealed layers), algorithms
  layout/      deterministic 3D force layout + worker + cache
  render/      instanced graph view, atmosphere, canvas cards, textures
  ui/          card manager, node/reveal cards, keypad, help/library, onboarding
  research/    event stream (live research and bundled replays share it)
  props.js     Locket and Coin (gestures + pinch-tap fallback)
  app.js       all user actions go through here
  context.js   private context (on device)
  feed.js      curated-random light sampling; interests.js: interests (on device)
server/        FastAPI news engine: sources, LLM roles, evidence, ontology, graph algorithms
shared/        ontology.v2.json (one file for client and server)
qa/            scripted emulator QA
docs/          PLAN, DECISIONS, SOURCES, EVIDENCE, ALGORITHMS, ONTOLOGY, COURSE_COVERAGE, KNOWN_LIMITS
```

See [docs/DECISIONS.md](docs/DECISIONS.md) for the technology choices.
