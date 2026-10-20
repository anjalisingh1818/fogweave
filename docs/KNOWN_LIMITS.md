# Known limits

## Content and reasoning

- **Impact is inference and can be wrong.** Inferred links are reasoned by a free LLM from reported facts, and Speculative links are plausible at best. The UI says "possible effects, check sources". Nothing here is financial, medical or legal advice.
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
  - The verifier uses the smaller model to spread quota; its accuracy is measured in Phase 4.
- **Entity linking can err.** It is conservative: a wrong merge is worse than none, so near-duplicates may stay separate. Entity types from extraction are sometimes off (e.g. a country typed as an organisation); the ontology rejects the resulting invalid triples rather than drawing them.
- **Story clustering and dedupe thresholds are untuned** until the Phase 4 eval.

- **Answers are only as good as the web around the item.** Ask is GraphRAG over the reader's web plus a small fresh search, using a free LLM. Answers can be incomplete. Sentences without a retrieved citation are marked as guesses. Offline, only the suggested questions have recorded answers.
- **"Is this reliable?" is computed locally** from the evidence breakdown. It reports what was checked, not whether the story is true.

## Hands, headset, platform

- **Emulated hands are not a real Quest.** All QA so far uses IWER scripted hands in headless Chromium. Gesture thresholds (swing, flip, flick, tap) are untested on a headset; every gesture has a pinch fallback.
- **The keypad is pinch-only.** Fingertip poke was disabled because it swallowed ray pinches in IWSDK 1.0.1. Retest on a device.
- **Frame rates are desktop emulator numbers**, not Quest numbers. Measured: 43–60 fps at 150 nodes in headless Chromium.
- **Voice input and read-aloud are optional extras.** They exist in the desktop browser (Web Speech API, speechSynthesis) but are **unverified on Quest Browser**. Voice is off by default and always lands in the keypad for confirmation. Everything works with hands only.
- **Evidence Pack download inside an immersive session is unverified on a Quest.** It downloads in desktop Chromium; on a headset the browser may need you to leave VR to save it.
- **Opening and closing many cards quickly causes brief frame dips** while canvases are allocated (seen once as 20 fps in the emulator). Steady state with five cards open measured 17.2 ms per frame.
- **No headset camera or passthrough features are used.**

## Privacy

- The personal context is coarse by design. Addresses, numbers, health and money terms are refused. It is stored only on the device and sent only with a request that needs it; the server does not log or keep it.
- The bundled demo uses a **fictional sample persona** and labels it as one.
