"""arXiv API. Metadata (titles, abstracts, authors) is CC0; e-prints are not
redistributed. Terms: at most one request every 3 seconds, one connection;
do not imply endorsement by arXiv. We link to the abstract page."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from ..http import SourceError
from .base import RawItem, SourceAdapter

API = "https://export.arxiv.org/api/query"
NS = {"a": "http://www.w3.org/2005/Atom"}


def parse_feed(xml_text: str) -> list[RawItem]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise SourceError("arxiv: bad XML") from exc
    out = []
    for e in root.findall("a:entry", NS):
        url = (e.findtext("a:id", default="", namespaces=NS) or "").strip()
        title = re.sub(r"\s+", " ", e.findtext("a:title", default="", namespaces=NS) or "").strip()
        if not url or not title:
            continue
        summary = re.sub(r"\s+", " ", e.findtext("a:summary", default="", namespaces=NS) or "").strip()
        out.append(
            RawItem(
                source="arxiv",
                kind="paper",
                title=title,
                url=url.replace("http://", "https://"),
                date=(e.findtext("a:published", default="", namespaces=NS) or "").strip(),
                snippet=summary[:1200],
                outlet="arxiv.org",
                licence="arXiv metadata, CC0",
                extra={"authors": [a.findtext("a:name", default="", namespaces=NS) for a in e.findall("a:author", NS)][:4]},
            )
        )
    return out


class ArxivAdapter(SourceAdapter):
    name = "arxiv"
    kinds = ("paper",)
    licence = "arXiv metadata, CC0"
    attribution = "Paper metadata from arXiv (not endorsed by arXiv)"

    async def latest(self, limit: int = 4, categories: str = "cat:cs.AI OR cat:physics.soc-ph OR cat:econ.GN OR cat:q-bio.PE") -> list[RawItem]:
        text = await self.http.get(
            API,
            params={"search_query": categories, "sortBy": "submittedDate", "sortOrder": "descending", "max_results": str(limit)},
            ttl=3600,
        )
        return parse_feed(text)

    async def search(self, query: str, limit: int = 3) -> list[RawItem]:
        text = await self.http.get(API, params={"search_query": f"all:{query}", "max_results": str(limit)}, ttl=86400)
        return parse_feed(text)
