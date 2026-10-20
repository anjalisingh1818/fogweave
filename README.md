# FogWeave

A hands-first VR **news impact graph** set in a gray fog. News arrives as drifting lights. Touch one to see what it connects to, what it may affect, and how it may reach your own world. Every link is labelled by how well supported it is, and you seal only what you trust into a cited, exportable Library. (V2 direction: see [docs/PLAN.md](docs/PLAN.md).)

Built with [IWSDK](https://developers.meta.com/horizon/documentation/iwsdk/) (WebXR, three.js and ECS) for the Meta VR Start Developer Competition 2026. It is seated and works with hands only; voice is an optional extra.

> **Status (Phase 1 done, 2026-10-20).** The world, the web renderer, news lights, the reader-card shell, cards, sealing, the props, paths, the keypad and onboarding all work in the emulator. The news engine (Phase 2) is not wired in yet. The bundled webs and lights are **synthetic test fixtures** (badged TEST FIXTURE) until a dated real snapshot replaces them.

## Reading the fog

| Colour | Ring | Meaning |
|---|---|---|
| Blue | solid | Well supported |
| Violet | dashed | Mixed |
| Red | double | Contradicted |
| Gray | dotted | Unverified (the default) |

Translucent, drifting items are **fog**: found this session, and gone afterwards unless sealed. Solid items are **sealed** and form your Library.

## What you do (hands only)

- **Pinch a light** to open its reader card (headline, source, date, summary, key claims with short quotes, link). Seal keeps it.
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

**Without the backend:** everything above works on the bundled webs in `public/demo/`. A new topic is planted, unresearched, with a plain note.

**Backend** (Phase 2 will replace the current single-agent endpoint):

```bash
cd server
python -m venv .venv && .venv\Scripts\activate   # or: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # add a free Groq key; never commit .env
uvicorn main:app --port 8787
```

## Tests

```bash
npm test               # model, algorithms, layout (node:test)
npm run qa:phase1      # scripted-hands emulator run; needs `FW_HTTP=1 npm run dev` running
```

QA writes screenshots and `phase1-results.json` to `qa/recordings/` (git-ignored). These are scripted hands in headless Chromium, not a person on a Quest.

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
server/        FastAPI backend (Phase 2)
qa/            scripted emulator QA
docs/          DECISIONS, PHASE0_AUDIT, ...
```

See [docs/DECISIONS.md](docs/DECISIONS.md) for the technology choices.
