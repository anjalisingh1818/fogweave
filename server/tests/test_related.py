"""Related-News Finder + Relation Reasoner: code checks decide what the model may not (no network)."""

import asyncio

from fogweave.ontology import validate_edge
from fogweave import related
from fogweave.llm import QuotaExhausted
from fogweave.related import RelatedFinder, date_fits, mention
from fogweave.roles import PairJudgement, PairJudgements
from fogweave.sources.base import RawItem

FOCUS = RawItem("wikipedia", "breaking", "A drone strike kills 73 people at a market in Abyei", "https://news.example/abyei-strike", "2026-10-19T00:00:00Z", snippet="The strike hit Amiet market in the disputed Abyei area between Sudan and South Sudan.", outlet="news.example")
OLD = RawItem("wikipedia", "archive", "Fighting over a land feud kills 37 in Abyei", "https://old.example/abyei-2024", "2024-02-04T00:00:00Z", snippet="Thirty-seven people are killed during fights over a land feud in Abyei.", outlet="old.example")
LATER = RawItem("wikipedia", "breaking", "Death toll in the Abyei market attack rises to 220", "https://later.example/toll", "2026-10-20T00:00:00Z", snippet="The death toll in the market drone attack in Abyei rises to 220.", outlet="later.example")
OTHER = RawItem("wikipedia", "breaking", "Sudan signs a trade deal", "https://other.example/trade", "2026-10-18T00:00:00Z", snippet="Sudan signs a trade agreement with Egypt.", outlet="other.example")
FOCUS_TEXT = f"{FOCUS.title}. {FOCUS.snippet}"


class Items:
    def __init__(self):
        self.d = {}

    def set(self, k, v):
        self.d[k] = v


class FakeLLM:
    def __init__(self, items=None, fail=False):
        self.items, self.fail = items or [], fail

    async def json(self, **kw):
        if self.fail:
            raise QuotaExhausted("spent")
        return PairJudgements(items=self.items)


class FakeEngine:
    def __init__(self, llm):
        self.llm = llm
        self.items = Items()
        self.router = type("R", (), {"adapters": {}})()


def collect(finder, cands):
    async def fake_candidates(item, names, broad=frozenset()):
        return cands

    finder.candidates = fake_candidates
    nodes, edges = {}, []

    def node(n):
        nodes[n["id"]] = n
        return {"type": "node", "node": n}

    def edge(e):
        e.setdefault("id", f"{e['type']}:{e['from']}->{e['to']}")
        # the real ontology check (as in the pipeline): a link it rejects never reaches the scene
        problem = validate_edge(e, {**nodes, FOCUS.id: {"id": FOCUS.id, "type": "NewsItem"}})
        assert problem is None, (problem, e)
        edges.append(e)
        return {"type": "edge", "edge": e}

    async def go():
        async for _ in finder.run(FOCUS, FOCUS_TEXT, ["Abyei", "Sudan"], node, edge, "2026-10-21T00:00:00Z"):
            pass

    asyncio.run(go())
    return nodes, edges


def test_helpers():
    assert date_fits("precedent_of", "2026-10-19", "2024-02-04") and not date_fits("precedent_of", "2026-10-19", "2026-10-20")
    assert date_fits("follow_up", "2026-10-19", "2026-10-20") and not date_fits("follow_up", "2026-10-19", "2024-02-04")
    assert not date_fits("cause_of", "2026-10-19", "") and date_fits("same_event", "2026-10-19", "")
    assert "Abyei" in mention("The strike hit Amiet market in the disputed Abyei area", "Abyei")


def test_code_checks_decide_what_the_model_may_not(monkeypatch):
    monkeypatch.setattr(related, "embed", lambda texts: None)
    j = [
        # a good precedent: earlier, both quotes real
        PairJudgement(id=OLD.id, relation="precedent_of", quote_focus="A drone strike kills 73 people", quote_other="Thirty-seven people are killed during fights", reason="An earlier deadly clash in Abyei.", confidence="medium"),
        # a follow-up claimed with a made-up quote: dropped, then the code-only shared-entity link comes instead
        PairJudgement(id=LATER.id, relation="follow_up", quote_focus="A drone strike kills 73 people", quote_other="the toll keeps climbing every hour", reason="Later toll.", confidence="high"),
        # unrelated: dropped, and no fallback link either (the model looked and found none)
        PairJudgement(id=OTHER.id, relation="unrelated", quote_focus="x", quote_other="y", reason="none", confidence="high"),
    ]
    nodes, edges = collect(RelatedFinder(FakeEngine(FakeLLM(j))), [OLD, LATER, OTHER])
    by_other = {(e["from"] if e["to"] == FOCUS.id else e["to"]): e for e in edges}
    prec = by_other[OLD.id]
    assert prec["type"] == "precedent_of" and prec["from"] == OLD.id and prec["label"] == "inferred"
    assert [ev["side"] for ev in prec["evidence"]] == ["focus", "other"] and all(ev["quote"] for ev in prec["evidence"])
    assert nodes[OLD.id]["kind"] == "archive"  # older than 30 days
    assert by_other[LATER.id]["type"] == "shares_entity" and by_other[LATER.id]["label"] == "reported"
    assert OTHER.id not in by_other


def test_dates_and_labels_are_enforced(monkeypatch):
    monkeypatch.setattr(related, "embed", lambda texts: None)
    j = [
        # a "precedent" that is later than the focus: dropped
        PairJudgement(id=LATER.id, relation="precedent_of", quote_focus="A drone strike kills 73 people", quote_other="The death toll in the market drone attack", reason="x", confidence="high"),
        # low confidence: dropped
        PairJudgement(id=OLD.id, relation="background", quote_focus="A drone strike kills 73 people", quote_other="Thirty-seven people are killed", reason="x", confidence="low"),
        # a possible consequence is always speculative
        PairJudgement(id=OTHER.id, relation="possible_consequence", quote_focus="the disputed Abyei area between Sudan", quote_other="Sudan signs a trade agreement", reason="x", confidence="medium"),
    ]
    _, edges = collect(RelatedFinder(FakeEngine(FakeLLM(j))), [OLD, LATER, OTHER])
    types = {(e["type"], e["label"]) for e in edges}
    assert ("precedent_of", "inferred") not in types and ("background_of", "inferred") not in types
    assert ("possible_consequence_of", "speculative") in types


def test_without_the_model_shared_entities_still_link(monkeypatch):
    monkeypatch.setattr(related, "embed", lambda texts: None)
    _, edges = collect(RelatedFinder(FakeEngine(FakeLLM(fail=True))), [OLD, OTHER])
    assert {e["type"] for e in edges} == {"shares_entity"} and len(edges) == 2


def test_ellipsis_quotes_and_weak_places():
    from fogweave.related import verify_parts

    text = "Russia released a 74-year-old American. The release followed talks between Putin and Witkoff in St Petersburg."
    assert verify_parts("Russia released a 74-year-old American ... talks between Putin and Witkoff", text)
    assert not verify_parts("Russia released a teacher ... talks between Putin and Witkoff", text)
    f = RelatedFinder(FakeEngine(FakeLLM()))
    broad = {"Russia"}
    assert not f._strong("A fire in a shopping centre in Kemerovo, Russia, kills 64.", ["Russia", "Vladimir Putin"], broad)
    assert f._strong("Witkoff meets Vladimir Putin in St Petersburg.", ["Russia", "Vladimir Putin"], broad)
    assert mention("The talks were held in Saint Petersburg, Russia.", "Russia").endswith("Russia.")
