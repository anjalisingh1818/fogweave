# FogWeave

A hands-first VR **news impact graph** set in a gray fog. News arrives as drifting lights. Touch one to see what it connects to, what it may affect, and how it may reach your own world. Every link is labelled by how well supported it is, and you seal only what you trust into a cited, exportable Library. (V2 direction: see [docs/PLAN.md](docs/PLAN.md).)

Built with [IWSDK](https://developers.meta.com/horizon/documentation/iwsdk/) (WebXR, three.js and ECS) for the Meta VR Start Developer Competition 2026. It is seated and works with hands only; voice is an optional extra.

> **Status (Phase 2 done, 2026-10-20).** The live news engine runs on four free sources: news lights, reader claims with verbatim quotes, and streaming Expand into a labelled impact web. Your private context, the personalized Locket and the "Touches me?" thread work too. Offline, the app replays a dated snapshot of real pipeline runs. Still to come (Phase 3): Ask, the timeline, the daily briefing, the Evidence Pack export, read-aloud and voice.

## Reading the fog

| Colour | Ring | Meaning |
|---|---|---|
| Blue | solid | Well supported |
| Violet | dashed | Mixed |
| Red | double | Contradicted |
| Gray | dotted | Unverified (the default) |

Translucent, drifting items are **fog**: found this session, and gone afterwards unless sealed. Solid items are **sealed** and form your Library.

## What you do (hands only)

- **Pinch a light** to open its reader card (headline, source, date, summary, key claims with short verbatim quotes, link). **Expand** grows it into the web: who and what it involves, and what it may affect. Every link is labelled **Reported**, **Inferred** or **Speculative**.
- **"Touches me?"** on a news node draws a grounded thread to your context, or says "no clear connection found". Your context (city, field, tools, interests; nothing sensitive) lives only on the device ("?" → My context).
- **Pinch a node** to open its card, with evidence lines (independent domains, source classes, support and contradiction counts) and a risk note.
- **Seal** on a card keeps the item. Sealing a claim also seals the sources and edges that back it.
- **Pinch empty space** to name a topic with the pinch keypad, or pick a suggestion card.
- **Coin:** flip it near a node, or tap it (a quick pinch on the coin, or a pinch on its tag). It shows the verdict and its breakdown. Flipped in open air, it finds the most central node.
- **Locket:** swing it near a node, or tap it. It shows the node's rank ("3rd of 12") and why.
- **Link** on two cards, or hold both props, highlights the shortest path between the two nodes.
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
npm run qa             # scripted-hands emulator run, live + offline; needs the dev server and backend running
npm run qa:offline     # offline part only
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
server/        FastAPI news engine: sources, LLM roles, evidence, ontology, graph algorithms
shared/        ontology.v2.json (one file for client and server)
qa/            scripted emulator QA
docs/          PLAN, DECISIONS, SOURCES, EVIDENCE, ALGORITHMS, ONTOLOGY, COURSE_COVERAGE, KNOWN_LIMITS
```

See [docs/DECISIONS.md](docs/DECISIONS.md) for the technology choices.
