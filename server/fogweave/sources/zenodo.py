"""Zenodo (CERN) open research repository: datasets.

Terms checked 2026-10-21 (developers.zenodo.org): public records can be
searched without a token; guests get 60 requests/min and 30 searches/min
(HTTP 429 beyond). All metadata is CC0; each record's files carry their own
licence, which we show. We keep the title, our own short text from the
description, the date, the DOI link and the data licence. No creator names
are stored (they are researchers, not the subject).
"""

from __future__ import annotations

import html
import re

from ..http import SourceError
from .base import RawItem, SourceAdapter

API = "https://zenodo.org/api/records"
TAG = re.compile(r"<[^>]+>")


def _iso_day(value) -> str:
    """'2026-09-30' -> '2026-09-30T00:00:00Z' (every item date is ISO 8601 UTC)."""
    d = str(value or "")[:10]
    return f"{d}T00:00:00Z" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) else ""


def parse_records(data: dict) -> list[RawItem]:
    if not isinstance(data, dict) or "hits" not in data:
        raise SourceError("zenodo: unexpected answer")
    out = []
    for rec in (data.get("hits") or {}).get("hits") or []:
        md = rec.get("metadata") or {}
        title = " ".join(str(md.get("title") or "").split())
        url = rec.get("doi_url") or (rec.get("links") or {}).get("self_html") or (rec.get("links") or {}).get("html")
        if not title or not url:
            continue
        desc = " ".join(html.unescape(TAG.sub(" ", md.get("description") or "")).split())
        lic = (md.get("license") or {}).get("id") or (md.get("license") or {}).get("title") or "see record"
        out.append(
            RawItem(
                source="zenodo",
                kind="dataset",
                title=title[:200],
                url=url,
                date=_iso_day(md.get("publication_date") or rec.get("created")),
                snippet=desc[:400],
                outlet="zenodo.org",
                licence=f"Zenodo metadata CC0; data licence: {lic}",
                extra={"sourceType": "dataset", "sourceClass": "primary", "resourceType": (md.get("resource_type") or {}).get("type", "dataset"), "doi": rec.get("doi")},
            )
        )
    return out


class ZenodoAdapter(SourceAdapter):
    name = "zenodo"
    kinds = ("dataset",)
    licence = "Zenodo metadata, CC0"
    attribution = "Dataset metadata from Zenodo (CERN), CC0"

    async def search(self, query: str, limit: int = 3) -> list[RawItem]:
        data = await self.http.get(
            API,
            params={"q": f'"{query}"', "type": "dataset", "size": max(1, min(limit, 10)), "sort": "bestmatch"},
            as_json=True,
            ttl=6 * 3600,
        )
        return parse_records(data)[:limit]

    async def latest(self, limit: int = 3) -> list[RawItem]:
        data = await self.http.get(API, params={"type": "dataset", "size": max(1, min(limit, 10)), "sort": "mostrecent"}, as_json=True, ttl=3 * 3600)
        return parse_records(data)[:limit]
