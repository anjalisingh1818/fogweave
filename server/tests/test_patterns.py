"""Connect the dots: code keeps only patterns it can show (quotes, items, dates)."""

import asyncio

from fogweave.llm import QuotaExhausted
from fogweave.patterns import Pattern, PatternQuote, Patterns, find_patterns

ITEMS = [
    {"id": "n:a", "type": "NewsItem", "label": "Witkoff arrives in Saint Petersburg", "date": "2026-10-19", "text": "United States special envoy Steve Witkoff arrives in Saint Petersburg to talk to Putin."},
    {"id": "n:b", "type": "NewsItem", "label": "Hubbard released", "date": "2026-10-20", "text": "Stephen Hubbard is released during a meeting between Putin and Witkoff."},
    {"id": "n:c", "type": "NewsItem", "label": "JAXA launches MMX", "date": "2026-10-18", "text": "JAXA launches the Martian Moons eXploration spacecraft."},
]


class FakeLLM:
    def __init__(self, out):
        self.out = out

    async def json(self, **kw):
        if isinstance(self.out, Exception):
            raise self.out
        return self.out


def run(out, items=ITEMS):
    return asyncio.run(find_patterns(FakeLLM(out), [dict(i) for i in items]))


def test_kept_only_with_verbatim_quotes_from_two_items():
    good = Pattern(kind="same_actor", text="Witkoff appears in both.", confidence="high", quotes=[
        PatternQuote(id="I1", quote="special envoy Steve Witkoff arrives"), PatternQuote(id="I2", quote="a meeting between Putin and Witkoff")])
    invented = Pattern(kind="recurring", text="Launches keep happening.", confidence="high", quotes=[
        PatternQuote(id="I3", quote="JAXA launches the Martian Moons"), PatternQuote(id="I1", quote="Witkoff launches a rocket")])
    low = Pattern(kind="common_theme", text="Space and diplomacy.", confidence="low", quotes=[
        PatternQuote(id="I1", quote="Steve Witkoff"), PatternQuote(id="I3", quote="JAXA launches")])
    r = run(Patterns(items=[good, invented, low]))
    assert [p["kind"] for p in r["patterns"]] == ["same_actor"]
    p = r["patterns"][0]
    assert p["label"] == "inferred" and p["items"] == ["n:a", "n:b"] and len(p["quotes"]) == 2
    assert "2 suggested patterns dropped" in r["note"]


def test_sequence_runs_in_date_order():
    seq = Pattern(kind="sequence", text="The visit came before the release.", confidence="medium", quotes=[
        PatternQuote(id="I2", quote="Stephen Hubbard is released"), PatternQuote(id="I1", quote="Steve Witkoff arrives in Saint Petersburg")])
    p = run(Patterns(items=[seq]))["patterns"][0]
    assert p["items"] == ["n:a", "n:b"]


def test_too_few_items_and_quota():
    assert run(Patterns(items=[]), ITEMS[:1])["patterns"] == []
    r = run(QuotaExhausted("spent"))
    assert r["patterns"] == [] and r["degraded"]
