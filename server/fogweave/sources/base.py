"""Shared shape for every source adapter.

Adapters return RawItems: titles, short snippets, dates and links only.
Full article text is fetched transiently for extraction and never stored
or sent to the client (only short quotes are kept).
"""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from urllib.parse import urlsplit


@dataclass
class RawItem:
    source: str  # adapter name, e.g. "gdelt"
    kind: str  # breaking | paper | archive
    title: str
    url: str
    date: str  # ISO 8601 UTC
    snippet: str = ""  # short text the source itself provides
    outlet: str = ""  # publishing domain
    licence: str = ""
    citations: list[str] = field(default_factory=list)  # outlet links the source cites
    extra: dict = field(default_factory=dict)

    @property
    def id(self) -> str:
        return "n:" + hashlib.sha1(self.url.encode("utf-8")).hexdigest()[:12]

    def to_dict(self) -> dict:
        d = asdict(self)
        d["id"] = self.id
        return d


def domain_of(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class SourceAdapter:
    name = "base"
    kinds: tuple[str, ...] = ()
    licence = ""
    attribution = ""

    def __init__(self, http):
        self.http = http

    async def latest(self, limit: int = 10) -> list[RawItem]:
        raise NotImplementedError

    async def search(self, query: str, limit: int = 5) -> list[RawItem]:
        return []
