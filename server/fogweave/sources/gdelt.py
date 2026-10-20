"""GDELT DOC 2.0 API (no key). Terms: free for any use; any use must cite
the GDELT Project and link https://www.gdeltproject.org/. We keep titles,
dates, outlet domains and links only. Paced at one request per ~5.5 s.
"""

from __future__ import annotations

from datetime import datetime, timezone

from ..http import SourceError
from .base import RawItem, SourceAdapter, domain_of, iso

API = "https://api.gdeltproject.org/api/v2/doc/doc"


def _date(seen: str) -> str:
    try:
        return iso(datetime.strptime(seen, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc))
    except (TypeError, ValueError):
        return ""


class GdeltAdapter(SourceAdapter):
    name = "gdelt"
    kinds = ("breaking", "archive")
    licence = "GDELT Project terms (free use with citation)"
    attribution = "Data: The GDELT Project, https://www.gdeltproject.org/"

    async def _query(self, query: str, limit: int, timespan: str | None = None, start: str | None = None, end: str | None = None):
        params = {"query": f"{query} sourcelang:english", "mode": "artlist", "maxrecords": str(limit), "format": "json", "sort": "hybridrel"}
        if timespan:
            params["timespan"] = timespan
        if start and end:
            params["startdatetime"], params["enddatetime"] = start, end
        data = await self.http.get(API, params=params, as_json=True, ttl=1800)
        if not isinstance(data, dict):
            raise SourceError("gdelt: unexpected payload")
        out = []
        for a in data.get("articles", []) or []:
            url = a.get("url") or ""
            title = (a.get("title") or "").strip()
            if not url or not title:
                continue
            out.append(
                RawItem(
                    source=self.name,
                    kind="breaking",
                    title=title,
                    url=url,
                    date=_date(a.get("seendate", "")),
                    outlet=a.get("domain") or domain_of(url),
                    licence=self.licence,
                    extra={"country": a.get("sourcecountry", "")},
                )
            )
        return out

    async def latest(self, limit: int = 10, query: str = "(economy OR technology OR climate OR science OR energy)") -> list[RawItem]:
        return await self._query(query, limit, timespan="1d")

    async def search(self, query: str, limit: int = 5, timespan: str = "2w") -> list[RawItem]:
        return await self._query(query, limit, timespan=timespan)
