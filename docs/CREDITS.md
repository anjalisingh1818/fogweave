# Credits

## Data sources (see [SOURCES.md](SOURCES.md) for terms and limits)

- **Wikipedia** (Current events, search, article leads): text CC BY-SA 4.0, Wikipedia contributors.
- **Wikidata**: CC0.
- **The GDELT Project**: https://www.gdeltproject.org/ (cited as its terms require).
- **Hacker News API**: titles and links.
- **arXiv**: metadata CC0. FogWeave is not endorsed by arXiv.

## Client libraries

| Library | Version | Licence |
|---|---|---|
| IWSDK `@iwsdk/core`, `@iwsdk/vite-plugin-dev` (Meta) | 1.0.1 | MIT |
| three.js (super-three, via IWSDK) | r181 | MIT |
| IWER (Immersive Web Emulation Runtime, via IWSDK dev plugin) | 2.6.0 | MIT |
| @pmndrs/pointer-events, @pmndrs/uikit (via IWSDK) | bundled | MIT |
| fflate (Evidence Pack zip) | 0.8.3 | MIT |
| WebXR input profile models (`@webxr-input-profiles/assets`; hand and Quest controller models, vendored in `public/vendor/input-profiles`) | 1.0.20 | MIT |
| Vite | 7.3.7 | MIT |
| Playwright (QA only) | 1.64.1 | Apache-2.0 |

## Server libraries

| Library | Version | Licence |
|---|---|---|
| FastAPI | 0.149.0 | MIT |
| Uvicorn | 0.54.0 | BSD-3-Clause |
| Pydantic | 2.14.1 | MIT |
| httpx | 0.28.1 | BSD-3-Clause |
| groq (SDK) | 1.7.0 | Apache-2.0 |
| networkx | 3.7 | BSD-3-Clause |
| SciPy / NumPy | 1.18.1 / 2.5.4 | BSD-3-Clause |
| trafilatura (+ lxml_html_clean) | 2.3.1 | Apache-2.0 (BSD for lxml_html_clean) |
| fastembed + onnxruntime | 0.9.0 / 1.31.0 | Apache-2.0 / MIT |
| BAAI/bge-small-en-v1.5 (embedding model) | n/a | MIT |
| rdflib | 7.6.0 | BSD-3-Clause |
| pySHACL | 0.40.1 | Apache-2.0 |
| python-dotenv | 1.2.4 | BSD-3-Clause |
| pytest | 9.1.1 | MIT |

## Models

The language models are open-weight models served on the Groq free tier: `openai/gpt-oss-120b`, `openai/gpt-oss-20b` and `qwen/qwen3.8-27b`.

## Assets

None. Every texture, shape, sound and font in the app is procedural or a system font.

## Ideas

- The knowledge-graph methods follow the openHPI course "Knowledge Graphs: Foundations and Applications" ([COURSE_COVERAGE.md](COURSE_COVERAGE.md)).
- The prop mechanic (a locket and a coin for reading a web) is inspired by a novel. No names, characters or branding from it are used.
