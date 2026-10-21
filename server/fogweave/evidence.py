"""Evidence strength, computed by code from countable signals (see
docs/EVIDENCE.md). The LLM only labels each evidence item's stance
(supports / contradicts / unclear); it never produces a score."""

from __future__ import annotations

from datetime import datetime, timezone

# primary (filings, deposited datasets) > reputable news > aggregators (V2 master §6)
CLASS_WEIGHT = {"government": 1.0, "primary": 0.95, "education": 0.9, "organisation": 0.8, "news": 0.75, "reference": 0.6, "aggregator": 0.5, "blog": 0.4, "unknown": 0.3}

NEWS_OUTLETS = {
    "reuters.com", "apnews.com", "bbc.co.uk", "bbc.com", "afp.com", "france24.com", "aljazeera.com", "theguardian.com",
    "nytimes.com", "washingtonpost.com", "dw.com", "rfi.fr", "npr.org", "cnn.com", "ft.com", "bloomberg.com",
    "economist.com", "nature.com", "science.org", "timesofindia.indiatimes.com", "thehindu.com", "abc.net.au",
    "cbc.ca", "politico.eu", "politico.com", "euronews.com", "japantimes.co.jp", "scmp.com", "techcrunch.com",
    "theverge.com", "arstechnica.com", "wired.com", "brusselstimes.com", "indianexpress.com", "dawn.com",
}
AGGREGATORS = {"news.ycombinator.com", "news.google.com", "msn.com", "news.yahoo.com", "flipboard.com", "ground.news"}
BLOG_HOSTS = ("medium.com", "substack.com", "blogspot.", "wordpress.com", "tumblr.com", "github.io")
SECOND_LEVEL = {"co", "com", "ac", "gov", "org", "net", "edu", "go", "or", "ne"}


def registered_domain(host: str) -> str:
    """example.co.uk -> example.co.uk, news.example.com -> example.com (good enough
    for 'independent domains'; not a full public-suffix list)."""
    parts = [p for p in host.lower().split(".") if p]
    if parts and parts[0] == "www":
        parts = parts[1:]
    if len(parts) >= 3 and parts[-2] in SECOND_LEVEL and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def classify_source(domain: str, hint: str | None = None) -> str:
    d = domain.lower()
    reg = registered_domain(d)
    labels = d.split(".")
    if any(x in labels for x in ("gov", "mil")) or d.endswith((".gov", ".europa.eu", ".who.int", ".un.org", "un.org", "who.int", "europa.eu", ".int")):
        return "government"
    if "edu" in labels or (len(labels) >= 3 and labels[-2] == "ac") or "university" in d or d == "arxiv.org":
        return "education"
    if hint == "primary":
        return "primary"  # the adapter knows: a filing or a deposited dataset
    if d in AGGREGATORS or reg in AGGREGATORS:
        return "aggregator"
    if reg in ("wikipedia.org", "wikidata.org", "britannica.com"):
        return "reference"
    if any(b in d for b in BLOG_HOSTS):
        return "blog"
    if reg in NEWS_OUTLETS or d in NEWS_OUTLETS:
        return "news"
    if hint == "news":
        return "news"
    if d.endswith(".org"):
        return "organisation"
    return "unknown"


def _age_days(date: str | None, now: datetime) -> float | None:
    if not date:
        return None
    try:
        dt = datetime.fromisoformat(date.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0.0, (now - dt).total_seconds() / 86400)


def strength(items: list[dict], now: datetime | None = None) -> dict:
    """items: [{domain, source_class, stance, date}] -> verdict + breakdown.

    Mass per side = sum over independent registered domains of the best class
    weight seen for that domain (one outlet counts once, however many pages).
    """
    now = now or datetime.now(timezone.utc)
    best = {"supports": {}, "contradicts": {}}
    counts = {"supports": 0, "contradicts": 0, "unclear": 0}
    classes: dict[str, int] = {}
    newest = None
    for it in items:
        stance = it.get("stance", "unclear")
        counts[stance] = counts.get(stance, 0) + 1
        if stance not in best:
            continue
        dom = registered_domain(it.get("domain", ""))
        if not dom:
            continue
        cls = it.get("source_class") or classify_source(dom)
        w = CLASS_WEIGHT.get(cls, 0.3)
        if w > best[stance].get(dom, (0, ""))[0]:
            best[stance][dom] = (w, cls)
        age = _age_days(it.get("date"), now)
        if age is not None and (newest is None or age < newest[0]):
            newest = (age, it.get("date"))
    for side in best.values():
        for _, cls in side.values():
            classes[cls] = classes.get(cls, 0) + 1
    support = sum(w for w, _ in best["supports"].values())
    contra = sum(w for w, _ in best["contradicts"].values())
    n_support_domains = len(best["supports"])
    agreement = support / (support + contra) if support + contra else None

    if contra >= 1.0 and contra > support:
        verdict = "contradicted"
    elif contra >= 0.7 and support >= 0.7:
        verdict = "mixed"
    elif support >= 1.3 and n_support_domains >= 2 and contra < 0.7:
        verdict = "supported"
    else:
        verdict = "unverified"

    return {
        "verdict": verdict,
        "evidence": {
            "independentDomains": n_support_domains,
            "contradictingDomains": len(best["contradicts"]),
            "sourceClasses": classes,
            "supports": counts["supports"],
            "contradicts": counts["contradicts"],
            "unclear": counts["unclear"],
            "supportMass": round(support, 2),
            "contradictMass": round(contra, 2),
            "agreement": round(agreement, 2) if agreement is not None else None,
            "newest": newest[1][:10] if newest else None,
        },
    }
