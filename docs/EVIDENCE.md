# Evidence strength

The verdict on a claim is computed **by code** (`server/fogweave/evidence.py`) from signals that can be counted. The LLM only labels each evidence item's *stance* toward the claim: supports, contradicts or unclear. It never produces a score. The UI always shows the breakdown, never a bare percentage.

## Inputs

For each claim, the evidence items are:
1. the outlet that reported it (one supporting item);
2. other outlets the source itself cites for the same story (for example, Wikipedia's Current events entries cite several);
3. one GDELT news search for the event, when GDELT is not rate-limiting;
4. Wikipedia articles found by search (their leads).

Each item gets a **registered domain** (`news.example.co.uk` becomes `example.co.uk`) and a **source class**:

| Class | Weight | Rule (domain heuristics) |
|---|---|---|
| government | 1.0 | `.gov`, `.mil`, `.int`, `europa.eu`, `who.int`, `un.org` |
| education | 0.9 | `.edu`, `.ac.xx`, "university", `arxiv.org` |
| organisation | 0.8 | other `.org` |
| news | 0.75 | known outlets list, or hinted by a news feed (GDELT, Wikipedia citations) |
| reference | 0.6 | Wikipedia, Wikidata, Britannica |
| blog | 0.4 | medium, substack, blogspot, wordpress.com, github.io, … |
| unknown | 0.3 | everything else |

## Formula

For each side (supports / contradicts), **mass = sum over independent registered domains of the best class weight seen for that domain**. One outlet counts once, however many of its pages agree. Unclear items count toward the "unclear" tally only.

| Verdict | Condition (checked in this order) |
|---|---|
| **Contradicted** (red, double ring) | contradict mass ≥ 1.0 and contradict mass > support mass |
| **Mixed** (violet, dashed ring) | contradict mass ≥ 0.7 and support mass ≥ 0.7 |
| **Well supported** (blue, solid ring) | support mass ≥ 1.3 and ≥ 2 independent supporting domains and contradict mass < 0.7 |
| **Unverified** (gray, dotted ring) | everything else: **the default** |

**Examples:**
- Two independent news outlets: 1.5, so Well supported.
- News plus Wikipedia: 1.35, so Well supported.
- News plus a blog: 1.15, so Unverified.
- One government source contradicting one blog: Contradicted.
- One news item for and one news item against: Mixed.

The 1.3 threshold was lowered from 1.6 after the first live runs (2026-10-20). At 1.6, even two independent news outlets (1.5) stayed Unverified, which contradicts the plain meaning of "independently confirmed".

## Breakdown shown (Coin and node card)

- independent supporting domains;
- independent contradicting domains;
- source classes;
- support / contradict / unclear counts;
- support and contradict mass;
- agreement (support mass ÷ total; shown only when both are known);
- newest evidence date;
- a one-line risk note ("Only one source: a weak spot", "Sources disagree", …).

## What it cannot tell you

- **Independent domains are not independent reporting.** Many outlets rewrite the same wire story.
- **Domain heuristics are coarse.** A `.org` can be a lobby group; a news outlet can be partisan.
- **The stance labels come from a free LLM** and can be wrong. Phase 4 measures agreement with hand labels.
- **Only public, robots-allowed pages are read.** Paywalled corroboration is invisible, so many true claims stay Unverified.
