"""Wikipedia (Wikimedia APIs). Text is CC BY-SA 4.0: we show short
excerpts with attribution and a link. A descriptive User-Agent with contact
is sent (Wikimedia User-Agent policy) and requests are made one at a time.

- latest(): entries from Portal:Current_events/<date>, each with the outlet
  links Wikipedia cites for it.
- search(): article search for corroboration and background.
"""

from __future__ import annotations

import html
import re
import unicodedata
from html.parser import HTMLParser
from datetime import datetime, timedelta, timezone

from ..http import SourceError
from .base import RawItem, SourceAdapter, domain_of, iso

API = "https://en.wikipedia.org/w/api.php"
DAY_TITLE = re.compile(r"^Portal:Current events/(?P<y>\d{4}) (?P<m>[A-Z][a-z]+) (?P<d>\d{1,2})$")


def _fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def _word(term: str):
    return re.compile(r"(?<![\w])" + re.escape(_fold(term)) + r"(?![\w])")
TAG = re.compile(r"<[^>]+>")
LI_OPEN = re.compile(r"<li[^>]*>")
NEXT_TAG = re.compile(r"<li[^>]*>|</li>")
HREF = re.compile(r'href="(https?://[^"]+)"')


def _clean(fragment: str) -> str:
    text = html.unescape(TAG.sub("", fragment))
    text = re.sub(r"\[\d+\]", "", text)
    return re.sub(r"\s+", " ", text).strip()


class _CEParser(HTMLParser):
    """Walks the portal HTML keeping the section (<p><b>Domain</b>) and the
    story path (headings of enclosing list items) for every leaf entry."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.section = ""
        self.in_b = False
        self.in_p = False
        self.stack: list[dict] = []  # open <li>: {"text": [...], "links": [...], "has_child": bool, "heading": str}
        self.entries: list[dict] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "p":
            self.in_p = True
        elif tag == "b" and self.in_p:
            self.in_b = True
            self._b = []
        elif tag == "li":
            self.stack.append({"text": [], "links": [], "has_child": False})
        elif tag == "ul" and self.stack:
            top = self.stack[-1]
            top["has_child"] = True
            top["heading"] = re.sub(r"\s+", " ", "".join(top["text"])).strip()
        elif tag == "a" and self.stack:
            href = a.get("href", "")
            if href.startswith("http") and "wikipedia.org" not in href and "wikimedia.org" not in href:
                self.stack[-1]["links"].append(href)

    def handle_endtag(self, tag):
        if tag == "p":
            self.in_p = False
        elif tag == "b" and self.in_b:
            self.in_b = False
            self.section = "".join(self._b).strip()
        elif tag == "li" and self.stack:
            li = self.stack.pop()
            if not li["has_child"]:
                path = [x.get("heading", "") for x in self.stack if x.get("heading")]
                self.entries.append({"text": "".join(li["text"]), "citations": li["links"], "section": self.section, "path": path})

    def handle_data(self, data):
        if self.in_b:
            self._b.append(data)
        if self.stack and not self.stack[-1]["has_child"]:
            self.stack[-1]["text"].append(data)


def parse_current_events(page_html: str, day: datetime) -> list[dict]:
    """Leaf entries that cite at least one outside source, with their
    section (e.g. 'Business and economy') and story path (e.g. ['2026 Iran war'])."""
    p = _CEParser()
    p.feed(page_html)
    entries = []
    for e in p.entries:
        text = re.sub(r"\[\d+\]", "", e["text"])
        text = re.sub(r"\s+", " ", text).strip()
        if not e["citations"] or len(text) < 40:
            continue
        text = re.sub(r"(\s*\([^()]{2,60}\))+\s*$", "", text).strip()
        entries.append({"text": text, "citations": e["citations"], "day": day, "section": e["section"], "path": e["path"]})
    return entries


class WikipediaAdapter(SourceAdapter):
    name = "wikipedia"
    kinds = ("breaking", "archive")
    licence = "CC BY-SA 4.0 (Wikipedia contributors)"
    attribution = "Text from Wikipedia, CC BY-SA 4.0"

    async def current_events(self, day: datetime) -> list[RawItem]:
        title = f"Portal:Current_events/{day.year}_{day.strftime('%B')}_{day.day}"
        data = await self.http.get(
            API,
            params={"action": "parse", "page": title, "prop": "text", "format": "json", "formatversion": "2"},
            as_json=True,
            ttl=3600,
        )
        if not isinstance(data, dict) or "parse" not in data:
            return []
        page_url = "https://en.wikipedia.org/wiki/" + title.replace(" ", "_")
        items = []
        for i, e in enumerate(parse_current_events(data["parse"].get("text", ""), day)):
            first = e["citations"][0]
            items.append(
                RawItem(
                    source=self.name,
                    kind="breaking",
                    title=_headline(e["text"]),
                    url=first,  # the cited outlet story is the item
                    date=iso(day),
                    snippet=e["text"][:400],
                    outlet=domain_of(first),
                    licence=self.licence,
                    citations=e["citations"][:4],
                    extra={"portal": f"{page_url}#{i}", "section": e["section"], "storyPath": e["path"]},
                )
            )
        return items

    async def latest(self, limit: int = 10) -> list[RawItem]:
        today = datetime.now(timezone.utc)
        out: list[RawItem] = []
        error = None
        for back in range(0, 3):  # today's page may still be empty
            try:
                out += await self.current_events(today - timedelta(days=back))
            except SourceError as exc:
                error = exc
                continue
            if len(out) >= limit:
                break
        if not out and error:
            raise error
        return out[:limit]

    async def archive(self, days_ago: int, limit: int = 3) -> list[RawItem]:
        day = datetime.now(timezone.utc) - timedelta(days=days_ago)
        items = (await self.current_events(day))[:limit]
        for it in items:
            it.kind = "archive"
        return items

    async def archive_search(self, term: str, limit: int = 3, min_age_days: int = 30, pages: int = 4) -> list[RawItem]:
        """Older news that names `term`: Current events day pages back to 2005, found
        with Wikipedia search, parsed like today's page, and filtered to entries that
        name the term. Spread over years so one busy month does not take every slot."""
        data = await self.http.get(
            API,
            params={"action": "query", "list": "search", "srsearch": f'"{term}" prefix:Portal:Current_events/2', "srnamespace": 100, "srlimit": 20, "format": "json", "srprop": ""},
            as_json=True,
            ttl=24 * 3600,
        )
        days = []
        now = datetime.now(timezone.utc)
        for hit in ((data or {}).get("query") or {}).get("search") or []:
            m = DAY_TITLE.match(hit.get("title", ""))
            if not m:
                continue
            try:
                day = datetime.strptime(f"{m['y']} {m['m']} {m['d']}", "%Y %B %d").replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            if (now - day).days >= min_age_days:
                days.append(day)
        # one page per year first, newest years first, then fill
        by_year: dict[int, datetime] = {}
        for d in sorted(days, reverse=True):
            by_year.setdefault(d.year, d)
        chosen = list(by_year.values())[:pages]
        chosen += [d for d in sorted(days, reverse=True) if d not in chosen][: max(0, pages - len(chosen))]
        want = _word(term)
        out: list[RawItem] = []
        for day in chosen:
            try:
                items = await self.current_events(day)
            except SourceError:
                continue
            for it in items:
                if want.search(_fold(it.snippet)):
                    it.kind = "archive"
                    it.extra["sourceType"] = "archive"
                    it.extra["foundBy"] = f"archive search: {term}"
                    out.append(it)
                    break  # one entry per day
            if len(out) >= limit:
                break
        return out

    async def intros(self, titles: list[str]) -> dict[str, str]:
        """Plain-text lead sections (CC BY-SA) for a few article titles."""
        if not titles:
            return {}
        data = await self.http.get(
            API,
            params={"action": "query", "prop": "extracts", "exintro": "1", "explaintext": "1", "exlimit": str(len(titles)),
                    "titles": "|".join(titles), "format": "json", "formatversion": "2", "redirects": "1"},
            as_json=True,
            ttl=86400,
        )
        return {p.get("title", ""): p.get("extract", "") for p in (data or {}).get("query", {}).get("pages", []) if p.get("extract")}

    async def search(self, query: str, limit: int = 5) -> list[RawItem]:
        data = await self.http.get(
            API,
            params={"action": "query", "list": "search", "srsearch": query, "srlimit": str(limit), "format": "json", "formatversion": "2"},
            as_json=True,
            ttl=86400,
        )
        out = []
        for r in (data or {}).get("query", {}).get("search", []):
            t = r.get("title", "")
            out.append(
                RawItem(
                    source=self.name,
                    kind="archive",
                    title=t,
                    url="https://en.wikipedia.org/wiki/" + t.replace(" ", "_"),
                    date=r.get("timestamp", ""),
                    snippet=_clean(r.get("snippet", "")),
                    outlet="en.wikipedia.org",
                    licence=self.licence,
                )
            )
        return out


ABBREV = re.compile(r"^(?:(?:[A-Z]\.){1,3}|(?:Dr|Mr|Ms|Mrs|St|No|Gen|Lt|Col|Sgt|Jr|Sr|Inc|Ltd|Co|vs)\.)$")


def _headline(text: str, limit: int = 110) -> str:
    # a sentence ends at . ! ? followed by a space, but not after an abbreviation
    # such as "U.S." or "Dr." ("U.S. envoys ..." used to become the headline "U.S")
    first = text
    for m in re.finditer(r"[.!?]\s", text):
        word = re.search(r"(\S+)$", text[: m.start() + 1])
        if word and ABBREV.match(word.group(1)):
            continue
        first = text[: m.start() + 1]
        break
    if len(first) <= limit:
        return first.rstrip(".")
    cut = first[:limit].rsplit(" ", 1)[0]
    return cut + "…"
