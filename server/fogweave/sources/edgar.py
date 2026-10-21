"""SEC EDGAR filings (U.S. public companies): primary documents.

Terms checked 2026-10-21 (sec.gov "Accessing EDGAR data", "EDGAR APIs"): no key;
at most 10 requests per second; automated access must declare a User-Agent
with a name and an admin contact email; download only what is needed. EDGAR
documents are U.S. government records (public); we keep the form, date,
company, the SEC's own document description and the link.

The contact email must be the owner's choice: FogWeave never sends the user's
own address anywhere. Without FW_CONTACT_EMAIL this adapter is off and says so.
"""

from __future__ import annotations

import os
import re

from ..http import SourceError
from .base import RawItem, SourceAdapter

TICKERS = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
FORMS = ("10-K", "10-Q", "8-K", "20-F", "6-K", "40-F", "S-1", "DEF 14A")
SUFFIX = re.compile(r"\b(inc|incorporated|corp|corporation|co|company|ag|plc|ltd|limited|group|holdings?|sa|nv|se|the)\b\.?", re.I)


def norm_company(name: str) -> str:
    return " ".join(SUFFIX.sub(" ", re.sub(r"[^\w\s&]", " ", name.lower())).split())


def recent_filings(sub: dict, cik: int, limit: int) -> list[RawItem]:
    rec = (sub.get("filings") or {}).get("recent") or {}
    company = sub.get("name") or ""
    out = []
    for i, form in enumerate(rec.get("form") or []):
        if form not in FORMS:
            continue
        acc = (rec.get("accessionNumber") or [""])[i]
        doc = (rec.get("primaryDocument") or [""])[i]
        date = (rec.get("filingDate") or [""])[i]
        desc = (rec.get("primaryDocDescription") or [""])[i] or form
        if not acc or not doc:
            continue
        url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{doc}"
        out.append(
            RawItem(
                source="edgar",
                kind="filing",
                title=f"{company}: {form} filed {date}",
                url=url,
                date=f"{date}T00:00:00Z" if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date or "") else "",
                snippet=f"{form} ({desc}) filed with the U.S. SEC by {company} on {date}.",
                outlet="sec.gov",
                licence="U.S. SEC EDGAR (public record)",
                extra={"sourceType": "filing", "sourceClass": "primary", "form": form, "cik": cik, "company": company},
            )
        )
        if len(out) >= limit:
            break
    return out


class EdgarAdapter(SourceAdapter):
    name = "edgar"
    kinds = ("filing",)
    licence = "U.S. SEC EDGAR (public record)"
    attribution = "Filings from SEC EDGAR"

    def __init__(self, http, contact: str | None = None):
        super().__init__(http)
        self.contact = contact if contact is not None else os.environ.get("FW_CONTACT_EMAIL", "").strip()

    @property
    def enabled(self) -> bool:
        return bool(self.contact)

    def _headers(self) -> dict:
        return {"User-Agent": f"FogWeave research prototype {self.contact}"}

    async def _tickers(self) -> dict[str, int]:
        data = await self.http.get(TICKERS, as_json=True, ttl=7 * 86400, headers=self._headers())
        out = {}
        for row in (data or {}).values():
            try:
                out.setdefault(norm_company(row["title"]), int(row["cik_str"]))
            except (KeyError, TypeError, ValueError):
                continue
        return out

    async def find_cik(self, name: str) -> int | None:
        """Exact match on the normalised company name only (a wrong company is worse than none)."""
        return (await self._tickers()).get(norm_company(name))

    async def search(self, query: str, limit: int = 3) -> list[RawItem]:
        if not self.enabled:
            raise SourceError("edgar: off (set FW_CONTACT_EMAIL to the owner's contact address, as the SEC requires)")
        cik = await self.find_cik(query)
        if not cik:
            return []
        sub = await self.http.get(SUBMISSIONS.format(cik=cik), as_json=True, ttl=6 * 3600, headers=self._headers())
        return recent_filings(sub or {}, cik, limit)

    async def latest(self, limit: int = 3) -> list[RawItem]:
        return []  # filings appear when an organisation is explored, not as lights
