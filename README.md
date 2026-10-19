# FogWeave

Hands + voice VR knowledge graph for the **Meta VR Start Developer
Competition 2026**. Built with [IWSDK](https://developers.meta.com/horizon/documentation/iwsdk/)
(Immersive Web SDK) on the client and [Agno](https://docs.agno.com) +
Groq on the backend.

## The idea

You build a knowledge graph by hand, in a gray-fog space, with no
controllers and no menus:

- **Pinch empty space, speak a topic** -> a new node appears. An agentic
  AI (Agno + Groq, with live web search) researches it, writes a
  summary, and proposes links (dotted lines) to nodes it seems related
  to. **Pinch the small green marker** on a dotted line to confirm it.
- **Locket** (grab it, swing it near a node) -> reveals that node's
  **importance** (degree centrality in the graph).
- **Coin** (grab it, flip it near a node) -> reveals that node's
  **reliability** — a real/risky read on how trustworthy the AI judged
  its own summary to be. Flip it in open air -> reveals the single
  most important node in the whole graph instead.
- **Hold both tools at once and ask "A and B?"** -> finds and lights up
  the shortest confirmed path between those two nodes.

Every interaction is a pinch or a spoken word — nothing to type, no
controller required (per the competition's hands-first rule).

## Project layout

```
fogweave/
├── src/                  client (IWSDK / three.js / ECS)
│   ├── components/       GraphNode, GraphEdge, DivinationProp, ConfirmMarker
│   ├── systems/          node-spawn, divination, query, node-render, edge-render
│   ├── graph-store.js    plain-JS logical graph data (nodes/edges)
│   ├── graph-algorithms.js   shortestPath, mostCentralNode (pure client-side math)
│   ├── ai-bridge.js      fetch() calls to /server
│   └── voice-input.js    Web Speech API wrapper
├── server/               backend (Python, FastAPI + Agno + Groq)
│   └── main.py
└── public/scenes/main.iwsdk.scene.json   gray-fog lighting
```

## Running it

**1. Client dependencies** (this folder — could not be installed from
the build session, run it yourself):

```bash
npm install
npm run dev
```

Then open the printed `http://localhost:8081` URL on a Quest browser
(or the desktop emulator) to test.

**2. Backend** (in `server/`):

```bash
cd server
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env   # then paste in a free key from https://console.groq.com/keys
uvicorn main:app --reload --port 8787
```

Copy `.env.example` to `.env` in the project root too if you need to
point the client at a non-default backend URL.

## Known rough edges (flagged honestly, not hidden)

This was built without the ability to run `npm install` or test on a
real headset during the session (sandboxed network), so a few things
are **best-effort against the documented API and need your own
on-device pass**:

1. **Empty-space pinch detection** (`node-spawn-system.js`) listens to
   the raw WebXR `selectstart` event via `world.renderer.xr`. If your
   installed `@iwsdk/core` exposes the renderer/session differently,
   update `_pinchPosition()`/`_attachWhenReady()` accordingly — check
   `node_modules/@iwsdk/core`'s type definitions after `npm install`.
2. **Swing/flip gesture thresholds** (`divination-system.js`) are a
   cheap position-history heuristic, not real orientation tracking.
   They will need retuning once you can feel real pinch-grab weight —
   the constants are all at the top of the file.
3. **Scene fog property path** (`world.scene.fog` in `index.js`) is
   wrapped in a try/catch with a console warning if it's wrong for
   your installed version.
4. The graph is saved to the headset browser's `localStorage`
   (`fogweave.graph.v1`) and respawned on load. Call `clearAll()` from
   `src/graph-store.js` to start fresh while testing.
5. Rejecting a suggested edge isn't implemented yet (only confirming,
   via the green marker) — an unconfirmed edge just stays dotted
   forever, which is a fine MVP behavior but worth a follow-up.

None of these affect the architecture — graph-store, the algorithms,
the components, and the backend contract are all solid; what's flagged
is specifically the hand/XR-input glue that only a real headset can
validate.

## Competition fit

- **Track:** Productivity
- **Special awards targeted:** Best Agentic Interaction (Agno agent
  with live web search deciding what to research), Boldest Original
  Concept (a spatial, hands-driven research graph that only makes
  sense in VR), Reason to Come Back (graph grows across sessions).
