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


def parse_current_events(page_html: str, day: datetime) -> list[dict]:
    """Leaf <li> entries that cite at least one outside source."""
    entries = []
    for m in LI_OPEN.finditer(page_html):
        nxt = NEXT_TAG.search(page_html, m.end())
        frag = page_html[m.end() : nxt.start() if nxt else len(page_html)]
        if "<ul" in frag:
            continue  # a category heading with children, not a story
        cites = [u for u in HREF.findall(frag) if "wikipedia.org" not in u and "wikimedia.org" not in u]
        text = _clean(frag)
        if not cites or len(text) < 40:
            continue
        # drop the trailing "(Outlet) (Outlet)" citation labels from the text
        text = re.sub(r"(\s*\([^()]{2,60}\))+\s*$", "", text).strip()
        entries.append({"text": text, "citations": cites, "day": day})
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
                    extra={"portal": f"{page_url}#{i}"},
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
