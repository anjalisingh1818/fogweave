"""Node dossiers, fast: real information about every node in the web.

For a batch of nodes (places, organisations, public figures, topics,
technologies, events) this returns, in one or two seconds:
  overview   what it is: the Wikipedia lead (CC BY-SA, attributed) or the
             Wikidata description, with the link
  facts      key facts from Wikidata statements (CC0), chosen by node type,
             each with its own text (the statement), date when given, link
  background one or two more lead sentences (origin, history)

Everything is batched (one Wikidata call for up to 50 items, one for the
labels they point to, one Wikipedia call per 20 titles) and cached by the
HTTP layer, so a whole web costs a few requests and repeats cost none.

Privacy: for public figures only public-role facts are used (positions,
party, occupation); no birth dates, family or addresses. Nodes of other
types (claims, news items, context) get no dossier here.
"""

from __future__ import annotations

import asyncio
import re
import unicodedata
from datetime import datetime, timezone

from .http import SourceError
from .linking import fits, key

WD_API = "https://www.wikidata.org/w/api.php"
WIKI_API = "https://en.wikipedia.org/w/api.php"
DOSSIER_TYPES = ("Place", "Organisation", "PublicFigure", "Topic", "Technology", "Event", "Concept")

# property id -> label shown; per node type, in the order they matter
FACTS = {
    "Place": [("P31", "is a"), ("P17", "country"), ("P131", "located in"), ("P36", "capital"), ("P1082", "population"), ("P2046", "area"), ("P30", "continent"), ("P571", "founded")],
    "Organisation": [("P31", "is a"), ("P571", "founded"), ("P159", "headquarters"), ("P17", "country"), ("P452", "industry"), ("P749", "parent organisation"), ("P169", "chief executive"), ("P1128", "employees")],
    "PublicFigure": [("P39", "position held"), ("P102", "party"), ("P106", "occupation"), ("P463", "member of")],
    "Event": [("P31", "is a"), ("P585", "date"), ("P580", "started"), ("P582", "ended"), ("P276", "location"), ("P17", "country"), ("P1120", "deaths"), ("P1339", "injured")],
    "Topic": [("P31", "is a"), ("P279", "a kind of"), ("P361", "part of"), ("P571", "since"), ("P61", "discovered or invented by"), ("P575", "discovered")],
}
FACTS["Technology"] = FACTS["Topic"]
FACTS["Concept"] = FACTS["Topic"]
UNITS = {"Q712226": "km²", "Q11573": "m", "Q828224": "km"}
MAX_FACTS = 6
# names many countries share ("Ministry of Foreign Affairs", "Federal Police"):
# accepted only when the item fits the places in the story
GENERIC = re.compile(r"\b(ministry|department|police|army|armed forces|government|agency|court|parliament|council|office|administration|authority|navy|air force|military|senate|congress|commission|bureau|cabinet|tribunal)\b", re.I)
# a name-only match must fit the node's type, or a close neighbour (extraction
# sometimes types a country as an organisation); people are matched strictly
NEAR_TYPES = {"Organisation": ("Place",), "Technology": ("Topic",), "Topic": ("Technology",), "Event": ("Topic",), "Concept": ("Topic", "Technology")}
AMBIGUOUS = "Several bodies share this name; FogWeave could not tell which one is meant here."



def _fold(s: str) -> str:
    return unicodedata.normalize("NFKD", key(s or "")).encode("ascii", "ignore").decode()


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9“\"(])", text or "") if len(s.strip()) > 20]


MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def _time(value: dict) -> tuple[str, str]:
    """('3 June 1931', '1931-06-03') from a Wikidata time value, at its precision."""
    m = re.match(r"([+-])(\d+)-(\d{2})-(\d{2})", str((value or {}).get("time", "")))
    if not m:
        return "", ""
    year, month, day = int(m.group(2)), int(m.group(3)), int(m.group(4))
    precision = int((value or {}).get("precision", 11))
    bc = " BC" if m.group(1) == "-" else ""
    if precision >= 11 and 1 <= month <= 12 and day:
        return f"{day} {MONTHS[month - 1]} {year}{bc}", f"{year:04d}-{month:02d}-{day:02d}"
    if precision == 10 and 1 <= month <= 12:
        return f"{MONTHS[month - 1]} {year}{bc}", f"{year:04d}-{month:02d}"
    return f"{year}{bc}", f"{year:04d}"


def _amount(value: dict) -> str:
    try:
        n = float(str(value.get("amount", "")).lstrip("+"))
    except ValueError:
        return ""
    unit = str(value.get("unit", "")).rsplit("/", 1)[-1]
    num = f"{int(n):,}" if n == int(n) else f"{n:,.1f}"
    return f"{num} {UNITS[unit]}".strip() if unit in UNITS else num


def _point_in_time(claim: dict) -> str:
    """The date a value refers to (qualifier P585), e.g. a population count's year."""
    for q in (claim.get("qualifiers") or {}).get("P585", [])[:1]:
        v = (q.get("datavalue") or {}).get("value") or {}
        return _time(v)[1]
    return ""


def _span(claim: dict) -> str:
    """'2008–2018' from start/end qualifiers (P580/P582), e.g. for a position held."""
    q = claim.get("qualifiers") or {}
    start = _time(((q.get("P580") or [{}])[0].get("datavalue") or {}).get("value") or {})[1][:4]
    end = _time(((q.get("P582") or [{}])[0].get("datavalue") or {}).get("value") or {})[1][:4]
    if start and end:
        return f"{start}–{end}"
    return f"since {start}" if start else ""


BORN = re.compile(r"\s*\((?:[^()]*?[\s;,])?(?:born|b\.)\s[^()]*\)")


def _best_claims(claims: list[dict]) -> list[dict]:
    """Preferred-rank statements first; deprecated ones never."""
    good = [c for c in claims if c.get("rank") != "deprecated"]
    pref = [c for c in good if c.get("rank") == "preferred"]
    return pref or good


class DossierMaker:
    def __init__(self, engine):
        self.e = engine
        self.http = engine.http
        self._by_search: set[str] = set()  # ids found by name only (need an English Wikipedia article)

    async def _entities(self, qids: list[str], props: str) -> dict:
        out = {}
        for i in range(0, len(qids), 50):
            chunk = qids[i : i + 50]
            try:
                data = await self.http.get(WD_API, params={"action": "wbgetentities", "ids": "|".join(chunk), "props": props, "sitefilter": "enwiki", "languages": "en", "format": "json"}, as_json=True, ttl=7 * 86400)
            except SourceError:
                continue
            out.update((data or {}).get("entities") or {})
        return out

    async def _intros(self, titles: list[str]) -> dict[str, str]:
        """Lead sections keyed by the title we asked for (redirects followed)."""
        out = {}
        for i in range(0, len(titles), 20):
            chunk = titles[i : i + 20]
            try:
                data = await self.http.get(
                    WIKI_API,
                    params={"action": "query", "prop": "extracts", "exintro": "1", "explaintext": "1", "exlimit": str(len(chunk)), "titles": "|".join(chunk), "format": "json", "formatversion": "2", "redirects": "1"},
                    as_json=True,
                    ttl=7 * 86400,
                )
            except SourceError:
                continue
            q = (data or {}).get("query") or {}
            back = {}
            for m in (q.get("normalized") or []) + (q.get("redirects") or []):
                back[m["to"]] = back.get(m["from"], m["from"])
            for p in q.get("pages") or []:
                if p.get("extract"):
                    out[back.get(p["title"], p["title"])] = p["extract"]
                    out[p["title"]] = p["extract"]
        return out

    async def _resolve(self, node: dict) -> str | None:
        """Wikidata id: from the node, else a conservative label match."""
        if node.get("qid"):
            return node["qid"]
        nid = str(node.get("id", ""))
        if nid.startswith("wd:Q"):
            return nid[3:]
        try:
            hit = await self.e.linker.link(node.get("label", ""), node.get("type", "Topic"))
        except Exception:  # noqa: BLE001
            hit = None
        if hit and hit.get("qid"):
            return hit["qid"]
        label = node.get("label", "")
        want = _fold(label)
        # a Wikipedia article or redirect with exactly this name ("Sudanese army" -> Sudanese Armed Forces)
        try:
            variants = list(dict.fromkeys([label, label.title()]))
            data = await self.http.get(WIKI_API, params={"action": "query", "titles": "|".join(variants), "redirects": "1", "prop": "pageprops", "format": "json", "formatversion": "2"}, as_json=True, ttl=7 * 86400)
            for page in ((data or {}).get("query") or {}).get("pages") or []:
                q = (page.get("pageprops") or {}).get("wikibase_item")
                if q and "disambiguation" not in (page.get("pageprops") or {}):
                    self._by_search.add(q)
                    return q
        except SourceError:
            pass
        # an item whose label or alias is exactly this name
        try:
            data = await self.http.get(WD_API, params={"action": "wbsearchentities", "search": label, "language": "en", "type": "item", "limit": 5, "format": "json"}, as_json=True, ttl=7 * 86400)
            for r in (data or {}).get("search") or []:
                names = [r.get("label", "")] + list((r.get("aliases") or [])) + [(r.get("match") or {}).get("text", "")]
                if any(_fold(x) == want for x in names if x):
                    self._by_search.add(r.get("id"))
                    return r.get("id")
        except SourceError:
            pass
        # else the Wikipedia article with exactly this name ("H3 (rocket)" = "H3 rocket"; accents aside)
        try:
            data = await self.http.get(WIKI_API, params={"action": "query", "list": "search", "srsearch": label, "srlimit": 3, "format": "json", "srprop": ""}, as_json=True, ttl=7 * 86400)
            for hit in ((data or {}).get("query") or {}).get("search") or []:
                t = hit.get("title", "")
                if _fold(t) == want or _fold(re.sub(r"\s*\(([^)]*)\)", r" \1", t)) == want or _fold(re.sub(r"\s*\([^)]*\)", "", t)) == want:
                    pp = await self.http.get(WIKI_API, params={"action": "query", "prop": "pageprops", "titles": hit["title"], "format": "json", "formatversion": "2"}, as_json=True, ttl=7 * 86400)
                    q = ((pp or {}).get("query", {}).get("pages") or [{}])[0].get("pageprops", {}).get("wikibase_item")
                    if q:
                        self._by_search.add(q)
                    return q
        except SourceError:
            return None
        return None

    async def make(self, nodes: list[dict], places: list[str] | None = None) -> dict[str, dict]:
        """`places`: names in the story's web (places, organisations, events), to tell same-named bodies apart."""
        place_keys = {_fold(p) for p in (places or []) if p}
        nodes = [n for n in nodes if n.get("type") in DOSSIER_TYPES and n.get("label")][:30]
        resolved = await asyncio.gather(*(self._resolve(n) for n in nodes))
        qid_of = {n["id"]: q for n, q in zip(nodes, resolved) if q}
        ents = await self._entities(sorted(set(qid_of.values())), "labels|descriptions|claims|sitelinks")
        # labels of the items the facts point to (one more batch)
        refs = set()
        picked: dict[str, list[tuple[str, str, dict]]] = {}
        for n in nodes:
            ent = ents.get(qid_of.get(n["id"], ""), {})
            claims = ent.get("claims") or {}
            rows = []
            for pid, plabel in FACTS.get(n["type"], FACTS["Topic"]):
                best = _best_claims(claims.get(pid, []))
                # one value is enough for most; "is a" / positions may have a few
                for c in best[: 2 if pid in ("P31", "P39", "P106") else 1]:
                    dv = (c.get("mainsnak") or {}).get("datavalue") or {}
                    v = dv.get("value")
                    if isinstance(v, dict) and v.get("id"):
                        refs.add(v["id"])
                    rows.append((pid, plabel, c))
            picked[n["id"]] = rows
        ref_ents = await self._entities(sorted(refs)[:200], "labels")
        titles = {n["id"]: (ents.get(qid_of.get(n["id"], ""), {}).get("sitelinks") or {}).get("enwiki", {}).get("title") for n in nodes}
        # a name-only match without an English article is likely a generic class
        # ("Federal Police" -> "national police of a country"): better none than the wrong thing
        for n in nodes:
            q = qid_of.get(n["id"])
            if q not in self._by_search:
                continue
            desc = ((ents.get(q, {}).get("descriptions") or {}).get("en") or {}).get("value", "")
            fit = any(fits(t, desc) for t in (n["type"], *NEAR_TYPES.get(n["type"], ())))
            if not titles.get(n["id"]) or not fit:  # "Mercury" the place is not the car brand
                qid_of.pop(n["id"], None)
        intros = await self._intros([t for t in titles.values() if t])
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        out = {}
        ambiguous = set()
        for n in nodes:
            q = qid_of.get(n["id"])
            if not q or not GENERIC.search(n["label"]) or not place_keys:
                continue
            ent = ents.get(q, {})
            said = " ".join([((ent.get("descriptions") or {}).get("en") or {}).get("value", ""), intros.get(titles.get(n["id"]) or "", "")[:600]]
                            + [r[2].get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id", "") for r in picked.get(n["id"], []) if r[0] == "P17"])
            country_labels = [((ref_ents.get(r[2].get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id", ""), {}).get("labels") or {}).get("en") or {}).get("value", "") for r in picked.get(n["id"], []) if r[0] == "P17"]
            text = _fold(said + " " + " ".join(country_labels))
            own = _fold(n["label"])
            if not any(pk and pk != own and pk in text for pk in place_keys):
                ambiguous.add(n["id"])
                qid_of.pop(n["id"], None)
        for n in nodes:
            q = qid_of.get(n["id"])
            ent = ents.get(q or "", {})
            wd_url = f"https://www.wikidata.org/wiki/{q}" if q else ""
            title = titles.get(n["id"])
            lead = intros.get(title or "", "")
            sents = _sentences(lead)
            overview = " ".join(sents[:2])[:420]
            if n["type"] == "PublicFigure":
                overview = BORN.sub("", overview)  # public role only: no birth details
            desc = ((ent.get("descriptions") or {}).get("en") or {}).get("value", "")
            facts = []
            seen = set()
            for pid, plabel, c in picked.get(n["id"], []):
                dv = (c.get("mainsnak") or {}).get("datavalue") or {}
                v = dv.get("value")
                date = _point_in_time(c)
                if isinstance(v, dict) and v.get("id"):
                    text = ((ref_ents.get(v["id"], {}).get("labels") or {}).get("en") or {}).get("value", "")
                elif dv.get("type") == "time":
                    text, date = _time(v)
                elif dv.get("type") == "quantity":
                    text = _amount(v)
                else:
                    text = ""
                if not text or (pid, text) in seen or _fold(text) == _fold(n["label"]):
                    continue
                span = _span(c)
                if span:
                    text = f"{text} ({span})"
                seen.add((pid, text))
                facts.append({"label": plabel, "value": text, "date": date, "quote": f"{n['label']}: {plabel} {text}", "source": "wikidata.org", "url": wd_url, "kind": "reference"})
                if len(facts) >= MAX_FACTS:
                    break
            background = [s for s in sents[2:6] if len(s) < 300][:2]
            if not q:  # unresolved or ambiguous: nothing from a possibly wrong item
                overview, desc, facts, background, title = "", "", [], [], None
            found = bool(overview or desc or facts)
            out[n["id"]] = {
                "id": n["id"],
                "qid": q,
                "label": n["label"],
                "type": n["type"],
                "description": desc,
                "overview": overview or desc,
                "overviewSource": {"source": "en.wikipedia.org", "url": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}", "licence": "Wikipedia, CC BY-SA 4.0"} if overview else ({"source": "wikidata.org", "url": wd_url, "licence": "Wikidata, CC0"} if desc else None),
                "facts": facts,
                "background": [{"text": s, "source": "en.wikipedia.org", "url": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"} for s in background] if title else [],
                "found": found,
                "note": "" if found else (AMBIGUOUS if n["id"] in ambiguous else "Not enough information found in open sources."),
                "retrievedAt": now,
            }
        return out
