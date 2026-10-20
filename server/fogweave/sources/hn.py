"""Hacker News official API (Firebase, no key, MIT-licensed repo, "no rate
limit" stated; we still fetch sparingly and cache). Titles + links only."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from ..http import SourceError
from .base import RawItem, SourceAdapter, domain_of, iso

API = "https://hacker-news.firebaseio.com/v0"


class HackerNewsAdapter(SourceAdapter):
    name = "hackernews"
    kinds = ("breaking",)
    licence = "Hacker News API (titles and links)"
    attribution = "Via Hacker News"

    async def latest(self, limit: int = 8, min_score: int = 80) -> list[RawItem]:
        ids = await self.http.get(f"{API}/topstories.json", as_json=True, ttl=900)
        if not isinstance(ids, list):
            raise SourceError("hackernews: unexpected payload")
        items = await asyncio.gather(*(self._item(i) for i in ids[: limit * 3]), return_exceptions=True)
        out = []
        for it in items:
            if isinstance(it, RawItem) and it.extra.get("score", 0) >= min_score:
                out.append(it)
        return out[:limit]

    async def _item(self, item_id: int) -> RawItem | None:
        d = await self.http.get(f"{API}/item/{item_id}.json", as_json=True, ttl=3600)
        if not d or d.get("type") != "story" or not d.get("url"):
            return None  # Ask HN / jobs have no outside article
        return RawItem(
            source=self.name,
            kind="breaking",
            title=d.get("title", "").strip(),
            url=d["url"],
            date=iso(datetime.fromtimestamp(d.get("time", 0), tz=timezone.utc)),
            outlet=domain_of(d["url"]),
            licence=self.licence,
            extra={"score": d.get("score", 0), "discussion": f"https://news.ycombinator.com/item?id={item_id}"},
        )
