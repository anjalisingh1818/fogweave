"""Polite HTTP: per-host minimum interval (each source's documented rate
limit), retries with backoff on 429/5xx (honouring Retry-After), a
descriptive User-Agent, robots.txt checks for article pages, and caching.

Only public pages are fetched. No logins, no paywall tricks: if robots.txt
disallows a page, or it answers 401/402/403, we skip it.
"""

from __future__ import annotations

import asyncio
import time
import urllib.robotparser
from urllib.parse import urlsplit

import httpx

from .cache import DiskCache, key_of
from .config import USER_AGENT


class SourceError(Exception):
    """A source failed (network, rate limit after retries, bad payload)."""


class RateLimited(SourceError):
    pass


class PoliteClient:
    def __init__(self, min_interval: dict[str, float] | None = None, transport: httpx.AsyncBaseTransport | None = None):
        self.min_interval = {"export.arxiv.org": 3.1, "api.gdeltproject.org": 5.5, "en.wikipedia.org": 0.2, "www.wikidata.org": 0.2}
        self.min_interval.update(min_interval or {})
        self._last: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._cooldown: dict[str, float] = {}  # host -> monotonic time it may be asked again
        self.cache = DiskCache("http")
        self.client = httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
            timeout=httpx.Timeout(15.0, connect=8.0),
            follow_redirects=True,
            transport=transport,
        )
        self.sleep = asyncio.sleep  # swapped in tests

    async def aclose(self):
        await self.client.aclose()

    async def _pace(self, host: str):
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            gap = self.min_interval.get(host, 0.0)
            wait = self._last.get(host, 0.0) + gap - time.monotonic()
            if wait > 0:
                await self.sleep(wait)
            self._last[host] = time.monotonic()

    async def get(self, url: str, *, params: dict | None = None, ttl: float | None = 1800, retries: int = 2, as_json: bool = False):
        ck = key_of("GET", url, params)
        if ttl:
            hit = self.cache.get(ck, max_age=ttl)
            if hit is not None:
                return hit
        host = urlsplit(url).hostname or ""
        if self._cooldown.get(host, 0) > time.monotonic():
            raise RateLimited(f"{host}: cooling down after a rate-limit answer")
        delay = 2.0
        for attempt in range(retries + 1):
            await self._pace(host)
            try:
                r = await self.client.get(url, params=params)
            except httpx.HTTPError as exc:
                if attempt == retries:
                    raise SourceError(f"{host}: {exc}") from exc
                await self.sleep(delay)
                delay *= 2
                continue
            if r.status_code == 200 and r.text[:40].lower().startswith("please limit requests"):
                # GDELT answers a rate limit with HTTP 200 and a plain-text notice
                self._cooldown[host] = time.monotonic() + 90
                raise RateLimited(f"{host}: asked us to slow down")
            if r.status_code == 429 or r.status_code >= 500:
                if attempt == retries:
                    raise (RateLimited if r.status_code == 429 else SourceError)(f"{host}: HTTP {r.status_code}")
                retry_after = r.headers.get("retry-after")
                await self.sleep(float(retry_after) if retry_after and retry_after.isdigit() else delay)
                delay *= 2
                continue
            if r.status_code >= 400:
                raise SourceError(f"{host}: HTTP {r.status_code}")
            try:
                value = r.json() if as_json else r.text
            except ValueError as exc:
                raise SourceError(f"{host}: bad JSON") from exc
            if ttl:
                self.cache.set(ck, value)
            return value
        raise SourceError(f"{host}: gave up")

    async def allowed_by_robots(self, url: str) -> bool:
        parts = urlsplit(url)
        base = f"{parts.scheme}://{parts.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                text = await self.get(base + "/robots.txt", ttl=86400, retries=0)
                rp.parse(text.splitlines())
            except SourceError:
                rp = None  # no robots.txt reachable: treated as allowed
            self._robots[base] = rp
        rp = self._robots[base]
        return True if rp is None else rp.can_fetch(USER_AGENT, url)

    async def fetch_article(self, url: str) -> str | None:
        """Main text of a public article page, or None (robots/paywall/failure)."""
        try:
            if not await self.allowed_by_robots(url):
                return None
            html = await self.get(url, ttl=86400, retries=1)
        except SourceError:
            return None
        import trafilatura  # heavy import, only when needed

        text = trafilatura.extract(html, include_comments=False, include_tables=False, favor_precision=True)
        return text or None
