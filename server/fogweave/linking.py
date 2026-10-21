"""Entity linking and alias merging. Conservative by design: a wrong merge is
worse than none, so we only link when the Wikidata label/alias matches the
name exactly AND the description fits the entity type. Otherwise the entity
stays a plain string. Behind FOGWEAVE_ENTITY_LINKING; failures degrade
silently. Wikidata data is CC0; requests are cached and paced."""

from __future__ import annotations

import re

from .config import ENTITY_LINKING
from .http import SourceError

ALIASES = {
    "usa": "United States", "us": "United States", "u.s.": "United States", "u.s": "United States",
    "united states of america": "United States", "america": "United States",
    "uk": "United Kingdom", "u.k.": "United Kingdom", "britain": "United Kingdom", "great britain": "United Kingdom",
    "eu": "European Union", "e.u.": "European Union", "un": "United Nations", "u.n.": "United Nations",
    "uae": "United Arab Emirates", "prc": "China", "people's republic of china": "China",
    "nato": "NATO", "who": "World Health Organization", "imf": "International Monetary Fund",
}

TYPE_HINTS = {
    "Place": ("country", "city", "capital", "state", "province", "region", "island", "town", "municipality", "district", "strait", "sea", "river", "continent", "territory", "county", "village", "area"),
    "Organisation": ("company", "organization", "organisation", "agency", "party", "university", "ministry", "government", "bank", "corporation", "union", "alliance", "group", "force", "army", "institute", "council", "court", "association", "programme", "program", "authority", "enterprise", "manufacturer", "airline", "operator", "parliament"),
    "PublicFigure": ("politician", "president", "minister", "prime minister", "chancellor", "businessperson", "chief executive", "executive", "king", "queen", "monarch", "diplomat", "member of parliament", "senator", "governor", "mayor", "official", "leader", "economist", "scientist"),
    "Technology": ("technology", "software", "protocol", "spacecraft", "vehicle", "model", "chip", "device", "programming", "language", "standard", "system", "rocket", "satellite", "aircraft", "battery", "method", "technique"),
    "Event": ("war", "conflict", "election", "crisis", "summit", "disaster", "earthquake", "attack", "pandemic", "protest", "festival", "tournament", "event", "mission"),
    "Topic": (),  # topics are broad: accept any non-human description
}


def canonical(name: str) -> str:
    raw = re.sub(r"\s+", " ", name).strip()
    n = raw.strip(".,;:")
    return ALIASES.get(raw.lower()) or ALIASES.get(n.lower()) or n


def key(name: str) -> str:
    return canonical(name).lower()


# fiction and creative works share names with real things ("Phobos": the Marvel
# character is Wikidata's first hit, the moon of Mars the second); names in news
# are never linked to them
FICTION = re.compile(r"\b(fictional|character in|comics?|manga|anime|video game|film|television series|tv series|novel|album|song|single by|band|episode|board game|play by|opera)\b", re.I)


def fits(entity_type: str, description: str) -> bool:
    d = (description or "").lower()
    if not d or FICTION.search(d):
        return False
    if entity_type == "Topic":
        return "human" not in d and not any(h in d for h in TYPE_HINTS["PublicFigure"])
    return any(h in d for h in TYPE_HINTS.get(entity_type, ()))


class WikidataLinker:
    API = "https://www.wikidata.org/w/api.php"

    def __init__(self, http, enabled: bool = ENTITY_LINKING):
        self.http = http
        self.enabled = enabled

    async def link(self, name: str, entity_type: str) -> dict | None:
        if not self.enabled or entity_type == "PublicFigure" and len(name.split()) < 2:
            return None  # a single word is too ambiguous for a person
        label = canonical(name)
        try:
            data = await self.http.get(
                self.API,
                params={"action": "wbsearchentities", "search": label, "language": "en", "uselang": "en", "type": "item", "limit": "3", "format": "json"},
                as_json=True,
                ttl=7 * 86400,
                retries=1,
            )
        except SourceError:
            return None
        for hit in (data or {}).get("search", []):
            names = {str(hit.get("label", "")).lower()} | {str(a).lower() for a in hit.get("aliases", []) or []}
            match = hit.get("match", {})
            if match.get("text"):
                names.add(str(match["text"]).lower())
            if label.lower() in names and fits(entity_type, hit.get("description", "")):
                return {"qid": hit["id"], "label": hit.get("label", label), "description": hit.get("description", "")}
        return None


def merge_entities(entities: list[dict]) -> tuple[list[dict], dict[str, str]]:
    """Merge entities that share a Wikidata id, or the same canonical name and
    type. Returns (merged list, map original-name-key -> merged id)."""
    merged: dict[str, dict] = {}
    alias_to_id: dict[str, str] = {}
    for e in entities:
        mid = f"wd:{e['qid']}" if e.get("qid") else f"e:{e['type'].lower()}:{key(e['name'])}"
        if mid not in merged:
            merged[mid] = {**e, "id": mid, "name": e.get("wd_label") or canonical(e["name"])}
        alias_to_id[key(e["name"])] = mid
    return list(merged.values()), alias_to_id
