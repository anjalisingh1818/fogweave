"""Source router: picks sources by item kind, isolates failures (one broken
source never breaks the others), and reports per-source status so the UI can
say plainly what is missing. Degradation order: HTTP cache -> fewer sources
-> the bundled snapshot (client side)."""

from __future__ import annotations

import asyncio
import time

from ..http import PoliteClient, SourceError
from .arxiv import ArxivAdapter
from .base import RawItem
from .gdelt import GdeltAdapter
from .hn import HackerNewsAdapter
from .wikipedia import WikipediaAdapter


class SourceRouter:
    def __init__(self, http: PoliteClient | None = None, adapters=None):
        self.http = http or PoliteClient()
        self.adapters = adapters or {
            a.name: a
            for a in (WikipediaAdapter(self.http), GdeltAdapter(self.http), HackerNewsAdapter(self.http), ArxivAdapter(self.http))
        }
        self.status: dict[str, dict] = {}

    async def _safe(self, name: str, coro):
        t0 = time.monotonic()
        try:
            items = await coro
            self.status[name] = {"ok": True, "count": len(items), "ms": int((time.monotonic() - t0) * 1000)}
            return items
        except (SourceError, Exception) as exc:  # noqa: BLE001 — a source must never take the app down
            self.status[name] = {"ok": False, "error": str(exc)[:160]}
            return []

    async def lights(self, per_source: dict[str, int] | None = None, archive_days: tuple[int, ...] = (35, 400)) -> list[RawItem]:
        want = {"wikipedia": 8, "gdelt": 6, "hackernews": 4, "arxiv": 4}
        want.update(per_source or {})
        jobs = [self._safe(name, a.latest(limit=want[name])) for name, a in self.adapters.items() if want.get(name)]
        wiki = self.adapters.get("wikipedia")
        if wiki:
            for d in archive_days:
                jobs.append(self._safe(f"wikipedia-archive-{d}", wiki.archive(d, limit=2)))
        batches = await asyncio.gather(*jobs)
        return dedupe([it for b in batches for it in b])

    async def corroborate(self, query: str, limit: int = 6) -> list[RawItem]:
        jobs = []
        if "gdelt" in self.adapters:
            jobs.append(self._safe("gdelt-search", self.adapters["gdelt"].search(query, limit=limit)))
        if "wikipedia" in self.adapters:
            jobs.append(self._safe("wikipedia-search", self.adapters["wikipedia"].search(query, limit=2)))
        batches = await asyncio.gather(*jobs)
        return [it for b in batches for it in b]


def dedupe(items: list[RawItem]) -> list[RawItem]:
    """Exact-URL and same-title duplicates out (near-duplicates: embed.py)."""
    seen_url, seen_title, out = set(), set(), []
    for it in items:
        t = " ".join(it.title.lower().split())
        if it.url in seen_url or t in seen_title:
            continue
        seen_url.add(it.url)
        seen_title.add(t)
        out.append(it)
    return out
