# Sources

Every source was checked on **2026-10-20** before use. FogWeave stores only titles, its own short summaries, short verbatim quotes (25 words or fewer), dates and links. It keeps more only where the licence allows it, such as Wikipedia text under CC BY-SA. Full article text is fetched transiently for extraction and is never stored or sent to the client. robots.txt is respected, there is no paywall bypass and no login scraping. A page that answers 401, 402 or 403 is skipped.

All requests send `User-Agent: FogWeave/0.2 (https://github.com/shubham123sing/fogweave; research prototype)`, which the Wikimedia User-Agent policy requires (descriptive, with contact). Pacing, retries with backoff, `Retry-After` handling and caching live in `server/fogweave/http.py`. Every adapter has failure and rate-limit tests in `server/tests/test_sources.py`.

| Source | Used for | Terms / licence (checked 2026-10-20) | Limits encoded | Stored | Status |
|---|---|---|---|---|---|
| **Wikipedia: Portal:Current events** (MediaWiki API `action=parse`) | Latest and archive news lights. Each entry carries the outlets Wikipedia cites | Text is CC BY-SA 4.0. Attribution "Text from Wikipedia, CC BY-SA 4.0" is shown with a link. User-Agent policy followed | Serial requests, 0.2 s per host, cached 1 h | Entry text excerpt (400 characters or fewer) with a link to the portal | Live |
| **Wikipedia search, article leads and page props** (`list=search`, `prop=extracts&exintro`, `prop=pageprops`) | Corroboration and background; the definition and origin of an explored node; finding its Wikidata item | CC BY-SA 4.0 | Cached 24 h | Lead excerpt (1,500 characters or fewer) used transiently; only short quotes kept | Live |
| **Wikidata** (`wbsearchentities`, `wbgetentities`) | Entity linking (behind `FOGWEAVE_ENTITY_LINKING`). Exploring a node: its parts and context from a fixed list of properties (P361, P279, P749, P131, P17, P527, P452, P30, P36, P102, P108, P463), each drawn as a Reported link citing the Wikidata statement | CC0 | Cached 7 days, 0.2 s per host | QID, label, description, the statements used | Live |
| **GDELT DOC 2.0 API** (`mode=artlist`) | News lights and one corroboration search per expand | "Unlimited and unrestricted use for any academic, commercial, or governmental use of any kind without fee", citing the GDELT Project with a link. API rate limit is one request per 5 s; the API asks heavy users to move to its NGrams dataset | 5.5 s per request. A rate-limit notice (sent as HTTP 200 text) triggers a 90 s cooldown | Title, outlet domain, date, link | Live, but often rate-limited from one IP |
| **Hacker News API** (Firebase) | Tech news lights | Official API, MIT-licensed repository; "currently no rate limit" | Cached 15 min (lists) and 1 h (items) | Title, link, score, discussion link | Live |
| **arXiv API** | Research-paper lights, by the arXiv categories the reader picks under Interests | Metadata is CC0. One request every 3 s, one connection. No implied endorsement. Link to the abstract page | 3.1 s per request, cached 1 h | Title, abstract (as metadata), authors, link | Live, with an occasional 429 |
| Article pages of outlets | Transient text for extraction and corroboration | Each site's robots.txt and terms | robots.txt checked; 10 s timeout | Short verbatim quotes only | Many outlets (e.g. Reuters, AP) block bots, so items fall back to the source's own summary and say so |

**Evaluated and not used (yet):**
- **OpenAlex:** now needs an API key for its own daily budget. Without one, requests share a tiny per-IP budget.
- **Wikimedia featured feed:** returned no "news" entries for the dates tested.
- **Crossref / Semantic Scholar / PubMed:** not needed for the news focus yet.
- **News APIs with free tiers:** their terms restrict reuse, or they need keys the project does not have.
- **Common Crawl news:** too heavy for a free host.

**LLM:** Groq free tier, with `openai/gpt-oss-120b`, `openai/gpt-oss-20b` and `qwen/qwen3.8-27b`. Llama 3.3 70B is no longer served to this key. Published Developer base limits are 30 req/min, 1,000 req/day, 8,000 tokens/min and 200,000 tokens/day per model. They are encoded in `server/fogweave/llm.py`, and daily use is persisted across restarts.

**Attribution shown in the app and Evidence Pack:** Wikipedia (CC BY-SA 4.0), The GDELT Project (with link), Hacker News, arXiv (metadata CC0; not endorsed by arXiv).
