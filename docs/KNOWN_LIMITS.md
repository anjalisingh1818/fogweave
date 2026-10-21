# Known limits

## Content and reasoning

- **Impact is inference and can be wrong.** Inferred links are reasoned by a free LLM from reported facts, and Speculative links are plausible at best. Measured on 30 items (hand labels by Claude, see [EVAL_REPORT.md](EVAL_REPORT.md)): Reported 0.84, Inferred 0.58, Speculative 0.88 precision. Inferred links most often restate a place, actor or victim as an effect, or point the wrong way. The UI says "possible effects, check sources". Nothing here is financial, medical or legal advice.
- **Free sources are limited; this is not "all news".**
  - Live feeds: Wikipedia Current events, GDELT, Hacker News and arXiv.
  - Many outlets (Reuters, AP, …) block bots. For those, only the headline and the citing source's summary can be read, and the card says so.
  - Archive coverage is partial: a few Current events pages from earlier dates.
- **Corroboration is thin.**
  - GDELT rate-limits a single IP quickly, so in practice corroboration often comes only from the outlets a source cites, plus Wikipedia.
  - As a result, many claims stay **Unverified**: in the first live runs on 2026-10-20, most claims were Unverified. That is the honest default, not proof the claims are false.
- **Free LLM quotas and quality vary.**
  - Groq's free tier allows 8,000 tokens per minute per model, so an expansion takes about 30–40 s.
  - When quota runs out, the app degrades (fewer checks, then the bundled snapshot) and says so in one line.
  - The verifier uses the smaller model to spread quota. It agreed with hand labels on 38 of 41 claim–evidence pairs.
- **Entity linking can err.** It is conservative: a wrong merge is worse than none, so near-duplicates may stay separate. Entity types from extraction are sometimes off (e.g. a country typed as an organisation); the ontology rejects the resulting invalid triples rather than drawing them.
- **Story clustering is moderate:** pairwise F1 0.48 on held-out days against Wikipedia's own story headings (single-link baseline 0.31).
- **The ontology is checked before drawing, but one statement in 607 slipped through** in the eval, when entity linking re-typed a node after its edge was checked. The SHACL shapes do not check relation ranges.
- **"Touches me?" finds only short threads.** In the eval, every path found was one hop (a shared place or organisation), and one real connection was missed.

- **Answers are only as good as the web around the item.** Ask is GraphRAG over the reader's web plus a small fresh search, using a free LLM. Answers can be incomplete. Sentences without a retrieved citation are marked as guesses. Offline, only the suggested questions have recorded answers.
- **"Is this reliable?" is computed locally** from the evidence breakdown. It reports what was checked, not whether the story is true.

## V2 feed and exploring

- **The feed is a sample, not everything.** Lights are drawn at random (weighted by quality) from a pool of a few dozen recent items. A good story can be missing from the 16 shown; **New lights** draws again. Quality scores are simple heuristics (source class, recency, usefulness, novelty), not editorial judgement.
- **Interest tags come from keywords and sections**, so tagging is coarse. Word boundaries prevent the worst mismatches ("space" no longer matches "workspace"), but a story can still be tagged by an incidental word.
- **Exploring a node draws on Wikipedia and Wikidata only** for its definition, origin and parts. Related news comes from the last ten days of Wikipedia Current events, plus papers whose text names the node. Obscure entities may have little to show.
- **Impact chains can drift toward the reader's context.** A guard drops inferred chains whose only purpose is to reach a context node, and generic effects are demoted to Speculative. The before/after numbers are in [EVAL_REPORT.md](EVAL_REPORT.md).
- **The offline snapshot covers what was recorded:** 6 expansions and 8 explores (dated 2026-10-20). Other nodes say exploring needs the live engine.

## Hands, headset, platform

- **Emulated hands are not a real Quest.** All QA so far uses IWER scripted hands in headless Chromium. Gesture thresholds (swing, flip, flick, tap) are untested on a headset; every gesture has a pinch fallback. In the V2 acceptance script, a pinch on a node that is still settling can miss (it opens the keypad, as pinching empty space does); the script then closes the keypad and opens the node through the same handler a hit would call. A person would simply re-aim.
- **The keypad is pinch-only.** Fingertip poke was disabled because it swallowed ray pinches in IWSDK 1.0.1. Retest on a device.
- **Frame rates are desktop emulator numbers**, not Quest numbers. Measured: 43–60 fps at 150 nodes in headless Chromium (V1). The V2 look adds light trails, up to 300 link pulses and 300 motes; at most 60 nodes are visible at once, and calm mode reduces the effects. During V2 acceptance runs, the headless emulator showed 30–48 fps with p95 frame times up to about 105 ms while a web was growing. **Quest frame rate for V2 is unverified.**
- **Voice input and read-aloud are optional extras.** They exist in the desktop browser (Web Speech API, speechSynthesis) but are **unverified on Quest Browser**. Voice is off by default and always lands in the keypad for confirmation. Everything works with hands only.
- **Evidence Pack download inside an immersive session is unverified on a Quest.** It downloads in desktop Chromium; on a headset the browser may need you to leave VR to save it.
- **Opening and closing many cards quickly causes brief frame dips** while canvases are allocated (seen once as 20 fps in the emulator). Steady state with five cards open measured 17.2 ms per frame.
- **No headset camera or passthrough features are used.**

## Open deep sources

- **"Deep web" here means open, legal sources that search engines rarely show** (an encyclopedia's news archive, a research data repository, a regulator's filings), not secrets, leaks, paywalls or anything behind a login.
- **Older news comes only from Wikipedia's Current events archive** (back to 2005). It is broad but selective: a small company or a local story may have no older entries, and then the node shows none.
- **Filings are off unless the owner sets a contact email** (the SEC requires one, and FogWeave never sends the user's own). Only U.S.-listed companies have EDGAR filings, matched by exact name.
- **Datasets are matched by the node's name in the title or description.** A dataset that uses another word for the same thing is missed.

## Node information (dossiers)

- **It is only as good as Wikipedia and Wikidata.** Little-known local officials, small places and new organisations often have no entry, and the card then says "Not enough information found in open sources."
- **Matching a name to an entry can still go wrong.** FogWeave prefers no answer to a wrong one: name-only matches must fit the node's type, and names many countries share must fit the story. A match can still be mistaken; every overview and fact links to its source.
- **Key facts are encyclopedia statements, not checked against the news.** A population or a leader may be out of date; each fact shows its date when Wikidata gives one.

## Demo scene

- **The Demo scene is a dated snapshot** of real pipeline runs (2026-10-21), not live news, and it says so. Only the recorded stars can show related items, and only recorded nodes can open up. Ask the fog gives an honest "needs the live engine" there.

## Desktop (flat page)

- **The flat page is a development and demo fallback, not the main experience.** It works with a mouse (click lights and nodes, cards at the screen edges), but the product is designed for hands in VR. At most two cards show at a time, and lights are squeezed into the window's view.
- **Nodes stacked exactly behind another node cannot be clicked** until the web is turned or the front node is closed. Aimed picking solves neighbours that are merely close.

## Privacy

- The personal context is coarse by design. Addresses, numbers, health and money terms are refused. It is stored only on the device and sent only with a request that needs it; the server does not log or keep it.
- The bundled demo uses a **fictional sample persona** and labels it as one.
