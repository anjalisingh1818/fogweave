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
from html.parser import HTMLParser
from datetime import datetime, timedelta, timezone

from ..http import SourceError
from .base import RawItem, SourceAdapter, domain_of, iso

API = "https://en.wikipedia.org/w/api.php"
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


def _headline(text: str, limit: int = 110) -> str:
    first = re.split(r"(?<=[.!?])\s", text, maxsplit=1)[0]
    if len(first) <= limit:
        return first.rstrip(".")
    cut = first[:limit].rsplit(" ", 1)[0]
    return cut + "…"
