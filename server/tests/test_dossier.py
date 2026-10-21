"""Node dossiers: real information about each node, from Wikidata and Wikipedia (no network)."""

import asyncio
import json

import httpx

from fogweave.dossier import BORN, DossierMaker, _amount, _span, _time
from fogweave.http import PoliteClient


def _claim(value, kind="wikibase-entityid", qualifiers=None, rank="normal"):
    return {"rank": rank, "mainsnak": {"datavalue": {"type": kind, "value": value}}, "qualifiers": qualifiers or {}}


ENT = {
    "Q902": {
        "descriptions": {"en": {"value": "country in South Asia"}},
        "sitelinks": {"enwiki": {"title": "Bangladesh"}},
        "claims": {
            "P31": [_claim({"id": "Q6256"})],
            "P17": [_claim({"id": "Q902"})],  # itself: must be skipped
            "P36": [_claim({"id": "Q1354"})],
            "P1082": [_claim({"amount": "+171466990", "unit": "1"}, "quantity", {"P585": [{"datavalue": {"value": {"time": "+2023-00-00T00:00:00Z", "precision": 9}}}]})],
        },
    },
    "Q46809": {
        "descriptions": {"en": {"value": "Cuban politician"}},
        "sitelinks": {"enwiki": {"title": "Raúl Castro"}},
        "claims": {
            "P39": [_claim({"id": "Q1"}, qualifiers={"P580": [{"datavalue": {"value": {"time": "+2008-02-24T00:00:00Z", "precision": 11}}}], "P582": [{"datavalue": {"value": {"time": "+2018-04-19T00:00:00Z", "precision": 11}}}]})],
            "P569": [_claim({"time": "+1931-06-03T00:00:00Z", "precision": 11}, "time")],  # birth: never used
        },
    },
}
ENT["Q789842"] = {
    "descriptions": {"en": {"value": "ministry of Italy"}},
    "sitelinks": {"enwiki": {"title": "Ministry of Foreign Affairs (Italy)"}},
    "claims": {"P17": [_claim({"id": "Q38"})]},
}
ENT["Q613883"] = {"descriptions": {"en": {"value": "defunct automobile brand of the Ford Motor Company"}}, "sitelinks": {"enwiki": {"title": "Mercury (automobile)"}}, "claims": {}}
LABELS = {"Q6256": "country", "Q902": "Bangladesh", "Q1354": "Dhaka", "Q1": "President of Cuba", "Q38": "Italy"}
LEADS = {
    "Bangladesh": "Bangladesh is a country in South Asia. It is the eighth-most populous country. It became independent in 1971 after a war.",
    "Raúl Castro": "Raúl Modesto Castro Ruz (born 3 June 1931) is a Cuban politician. He led Cuba from 2008 to 2018.",
}


def handler(req: httpx.Request) -> httpx.Response:
    q = dict(req.url.params)
    if q.get("action") == "wbgetentities":
        ids = q["ids"].split("|")
        if q.get("props") == "labels":
            return httpx.Response(200, json={"entities": {i: {"labels": {"en": {"value": LABELS[i]}}} for i in ids if i in LABELS}})
        return httpx.Response(200, json={"entities": {i: ENT[i] for i in ids if i in ENT}})
    if q.get("prop") == "extracts":
        titles = q["titles"].split("|")
        return httpx.Response(200, json={"query": {"pages": [{"title": t, "extract": LEADS[t]} for t in titles if t in LEADS]}})
    if q.get("list") == "search":
        return httpx.Response(200, json={"query": {"search": []}})
    if q.get("prop") == "pageprops" and "Mercury" in q.get("titles", ""):
        return httpx.Response(200, json={"query": {"pages": [{"title": "Mercury", "pageprops": {"wikibase_item": "Q613883"}}]}})
    return httpx.Response(200, json={})


class FakeLinker:
    async def link(self, name, typ):
        return None


class FakeEngine:
    def __init__(self, tmp_path):
        self.http = PoliteClient(min_interval={"www.wikidata.org": 0, "en.wikipedia.org": 0}, transport=httpx.MockTransport(handler))
        self.http.cache.dir = tmp_path
        self.linker = FakeLinker()


def test_value_helpers():
    assert _time({"time": "+1931-06-03T00:00:00Z", "precision": 11}) == ("3 June 1931", "1931-06-03")
    assert _time({"time": "+2023-00-00T00:00:00Z", "precision": 9}) == ("2023", "2023")
    assert _amount({"amount": "+147570", "unit": "http://www.wikidata.org/entity/Q712226"}) == "147,570 km²"
    assert _span({"qualifiers": {"P580": [{"datavalue": {"value": {"time": "+2011-01-01T00:00:00Z", "precision": 9}}}]}}) == "since 2011"
    assert BORN.sub("", "X (born 3 June 1931) is. The bank (founded 1870) is.") == "X is. The bank (founded 1870) is."


def test_dossiers_give_real_facts_by_type_and_say_when_nothing_is_found(tmp_path):
    eng = FakeEngine(tmp_path)
    out = asyncio.run(DossierMaker(eng).make([
        {"id": "wd:Q902", "type": "Place", "label": "Bangladesh"},
        {"id": "wd:Q46809", "type": "PublicFigure", "label": "Raul Castro"},
        {"id": "place:nowhere", "type": "Place", "label": "Nowhereville"},
        {"id": "n:1", "type": "NewsItem", "label": "a news item"},  # not a dossier type
    ]))
    bd = out["wd:Q902"]
    assert bd["overview"].startswith("Bangladesh is a country in South Asia.")
    assert bd["overviewSource"]["url"] == "https://en.wikipedia.org/wiki/Bangladesh"
    facts = {(f["label"], f["value"], f["date"]) for f in bd["facts"]}
    assert ("population", "171,466,990", "2023") in facts and ("capital", "Dhaka", "") in facts
    assert not any(f["value"] == "Bangladesh" for f in bd["facts"])  # no self-reference
    assert all(f["url"] == "https://www.wikidata.org/wiki/Q902" and f["quote"] for f in bd["facts"])
    rc = out["wd:Q46809"]
    assert "born" not in rc["overview"] and "1931" not in json.dumps(rc)  # public role only
    assert rc["facts"][0]["value"] == "President of Cuba (2008–2018)"
    assert out["place:nowhere"]["found"] is False and "Not enough information" in out["place:nowhere"]["note"]
    assert "n:1" not in out


class MinistryLinker:
    async def link(self, name, typ):
        return {"qid": "Q789842"} if "Ministry" in name else None


def test_same_named_bodies_must_fit_the_story(tmp_path):
    eng = FakeEngine(tmp_path)
    eng.linker = MinistryLinker()
    node = {"id": "org:mofa", "type": "Organisation", "label": "Ministry of Foreign Affairs and International Cooperation"}
    away = asyncio.run(DossierMaker(eng).make([node], places=["Abyei", "South Sudan"]))["org:mofa"]
    assert away["found"] is False and "Several bodies share this name" in away["note"] and "Italy" not in json.dumps(away)
    home = asyncio.run(DossierMaker(eng).make([node], places=["Rome", "Italy"]))["org:mofa"]
    assert home["found"] is True and home["qid"] == "Q789842"


def test_a_name_only_match_must_fit_the_node_type(tmp_path):
    out = asyncio.run(DossierMaker(FakeEngine(tmp_path)).make([{"id": "place:mercury", "type": "Place", "label": "Mercury"}]))
    assert out["place:mercury"]["found"] is False  # the place is not the car brand


def test_fiction_is_never_linked():
    """'Phobos' in a space story is the moon, not the Marvel character (Wikidata's first hit)."""
    from fogweave.linking import fits

    assert not fits("Topic", "fictional character in Marvel Comics")
    assert not fits("Technology", "2020 video game")
    assert not fits("Organisation", "American rock band")
    assert fits("Topic", "natural satellite of Mars")
