# Phase 0 audit (2026-10-20)

Scaffold at commit `650dc87` (about 1.6k lines). Ran on Windows 11, Node 24.11.1, Python 3.12.1.
`npm install` (0 vulnerabilities), `npm run build` and `pip install -r server/requirements.txt` all succeed.
Emulator checks were scripted through `window.IWER_DEVICE` (IWER 2.6.0). They are not real hands.

| Area | Status | Where | Notes |
|---|---|---|---|
| IWSDK scene + hand tracking | DONE | `iwsdk.config.json`, `src/index.js` | `@iwsdk/core` 1.0.1, three r181. Session enables `hand-tracking`. |
| Emulator hand mode | DONE (manual) | runtime | `IWER_DEVICE.primaryInputMode = 'hand'` works, and both inputs report `hand` + `oculus-hand`. Nothing sets it automatically yet. |
| Fog / lighting | PARTIAL | `src/index.js`, `public/scenes/main.iwsdk.scene.json` | FogExp2 + gradient dome only: no particles, glow, layered fog or audio. |
| Node creation (pinch empty space) | PARTIAL | `src/systems/node-spawn-system.js` | The pinch spawns a draft node. **The topic can only come from voice** (Web Speech), so there is no hands-only path. That breaks the competition rule. |
| Link confirm | PARTIAL | `src/systems/edge-render-system.js` | The confirm marker exists. There is no reject, and no seal layer (fog vs sealed). |
| Locket | PARTIAL | `src/systems/divination-system.js` | Uses degree centrality only. It is swing-detect only, with **no pinch-tap fallback**. Its readout is a % instead of a rank. |
| Coin | PARTIAL | same | Flip-detect only, with no fallback. It shows an **LLM-guessed reliability %**, which breaks the evidence rules. |
| Relation query | PARTIAL | `src/systems/query-system.js`, `src/graph-algorithms.js` | BFS path works, but it is voice-only. Two-node select + link mark is missing. |
| Card UI / Seal / Library / export | MISSING | n/a | There is only a canvas sprite label. |
| Pinch keypad, suggestion cards, onboarding | MISSING | n/a | |
| Force layout / LOD / instancing | MISSING | n/a | Nodes sit where they were pinched. 50 nodes overlap, and labels collide. |
| Bundled offline graphs | MISSING | n/a | The take-it-away test fails: an empty scene with no backend. |
| FastAPI endpoints | PARTIAL | `server/main.py` | `/health` and `/summarize-and-link` (sync, about 9.6 s) work. No streaming, claims, sources, verify or answer. |
| Agno agent + Groq call | DONE (single agent) | `server/main.py` | `openai/gpt-oss-120b` + parser model. The real call succeeded. There is no sub-agent team, budget or quota governor. |
| Search tools | PARTIAL | `server/main.py` | DuckDuckGo only. No Wikipedia, cache or backoff. |
| Schemas | PARTIAL | `server/main.py` | One Pydantic model. No Claim, Source or Evidence ontology. |
| Error handling | PARTIAL | `src/ai-bridge.js`, `server/main.py` | The client falls back to neutral. The server returns 502 with no degrade path. |
| Hard-coded results | none found | n/a | |
| Secrets | OK | `.gitignore` | `server/.env` is ignored. History scan for keys found 0 hits. |
| Inspiring-novel branding | FIXED | `src/index.js`, `src/systems/divination-system.js` | Two code comments named it and were removed. |

**FPS with 50 nodes:** not measurable reliably here. The Browser pane was hidden, so frames were throttled to 29.9 fps (p95 33.5 ms). That is a host cap, not app cost. Phase 1 adds an in-app frame-time meter (`?debug`).

**Dev note:** `FW_HTTP=1 npm run dev` serves plain `http://localhost:8081` for desktop emulator QA. The default HTTPS cert is still used for the headset.
