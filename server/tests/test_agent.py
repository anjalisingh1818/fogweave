"""The thinking agent: thoughts branch and deepen, but code decides what survives."""

import asyncio

from fogweave.agent import MAX_CALLS, Doubt, Doubts, main_name, Idea, Ideas, NextStep, NextSteps, Quote, Verdict, Verdicts, next_steps, patterns_task, tree_of_thoughts, why_task
from fogweave.llm import QuotaExhausted

ITEMS = [
    {"id": "n:a", "type": "NewsItem", "label": "Envoy arrives in Saint Petersburg", "date": "2026-10-19", "text": "The special envoy arrives in Saint Petersburg to talk about the war."},
    {"id": "n:b", "type": "NewsItem", "label": "Prisoner released", "date": "2026-10-20", "text": "A prisoner is released after a meeting between the envoy and officials."},
    {"id": "n:c", "type": "NewsItem", "label": "Agency launches probe", "date": "2026-10-18", "text": "The agency launches a probe to the moons of Mars."},
]
STORY = {"id": "n:s", "type": "NewsItem", "label": "Envoy returns to Moscow", "date": "2026-10-19", "text": "The envoy returns to Moscow for a second round of talks."}
EARLIER = {"id": "n:e", "type": "NewsItem", "label": "First round of talks", "date": "2026-09-01", "text": "The first round of talks ends without agreement in Geneva."}
LATER = {"id": "n:l", "type": "NewsItem", "label": "Talks collapse", "date": "2026-11-01", "text": "The talks collapse after a dispute over the border."}


class FakeLLM:
    def __init__(self, **by_role):
        self.by_role = by_role
        self.calls = []

    async def json(self, *, role, **kw):
        self.calls.append(role)
        out = self.by_role.get(role)
        if isinstance(out, list):
            out = out.pop(0) if out else Verdicts(items=[])
        if isinstance(out, Exception):
            raise out
        return out


def run(llm, task, search=None):
    async def go():
        return [ev async for ev in tree_of_thoughts(llm, task, search=search)]

    return asyncio.run(go())


def result_of(events):
    return next(e for e in events if e["type"] == "result")


def good_pattern(tid="T1", text="The envoy appears in both.", conf="high"):
    return Verdict(thought=tid, kind="same_actor", text=text, confidence=conf, quotes=[Quote(id="I1", quote="special envoy arrives in Saint Petersburg"), Quote(id="I2", quote="meeting between the envoy and officials")])


def ideas(n=2):
    return Ideas(items=[Idea(kind="same_actor", text=f"Idea {i}", search="") for i in range(n)])


def test_invented_quote_is_dropped_and_says_why():
    bad = Verdict(thought="T2", kind="recurring", text="Launches keep happening.", confidence="high", quotes=[Quote(id="I3", quote="launches a probe"), Quote(id="I1", quote="the envoy launches a rocket")])
    llm = FakeLLM(agent_propose=ideas(), agent_judge=Verdicts(items=[good_pattern(), bad]), agent_deepen=Verdicts(items=[]))
    ev = run(llm, patterns_task([dict(i) for i in ITEMS]))
    r = result_of(ev)
    assert [x["kind"] for x in r["results"]] == ["same_actor"]
    assert r["results"][0]["label"] == "inferred" and r["results"][0]["items"] == ["n:a", "n:b"]
    assert r["dropped"] == [{"thought": "T2", "why": "no quote found in two items"}]
    states = [(e["id"], e["state"]) for e in ev if e["type"] == "thought"]
    assert ("T2", "dropped") in states and ("T1", "chosen") in states


def test_the_skeptic_drops_a_real_quote_with_a_bad_argument():
    llm = FakeLLM(agent_propose=ideas(1), agent_judge=Verdicts(items=[good_pattern()]), agent_skeptic=Doubts(items=[Doubt(thought="T1", holds=False, why="they only share a name")]))
    ev = run(llm, patterns_task([dict(i) for i in ITEMS]))
    r = result_of(ev)
    assert r["results"] == [] and r["dropped"] == [{"thought": "T1", "why": "a second look: they only share a name"}]
    assert "agent_deepen" not in llm.calls


def test_without_a_second_look_what_passed_stays():
    llm = FakeLLM(agent_propose=ideas(1), agent_judge=Verdicts(items=[good_pattern()]), agent_skeptic=ValueError("bad"), agent_deepen=Verdicts(items=[]))
    assert len(result_of(run(llm, patterns_task([dict(i) for i in ITEMS])))["results"]) == 1


def test_a_slow_search_is_skipped():
    import fogweave.agent as agent

    async def slow(q):
        await asyncio.sleep(5)
        return [dict(EARLIER)]

    keep = agent.SEARCH_SECONDS
    agent.SEARCH_SECONDS = 0.05
    try:
        llm = FakeLLM(agent_propose=Ideas(items=[Idea(kind="background", text="One", search="geneva")]), agent_judge=Verdicts(items=[]))
        ev = run(llm, why_task(dict(STORY), []), search=slow)
    finally:
        agent.SEARCH_SECONDS = keep
    assert [e["found"] for e in ev if e["type"] == "tool" and e["state"] == "done"] == [0]


def test_blaming_a_name_the_items_do_not_mention_is_dropped():
    blame = Verdict(thought="T1", kind="same_actor", text="The envoy works for the Rapid Support Forces in both.", confidence="high", quotes=[Quote(id="I1", quote="special envoy arrives in Saint Petersburg"), Quote(id="I2", quote="meeting between the envoy and officials")])
    named = Verdict(thought="T2", kind="same_actor", text="The envoy goes to Saint Petersburg and meets officials.", confidence="high", quotes=[Quote(id="I1", quote="special envoy arrives in Saint Petersburg"), Quote(id="I2", quote="meeting between the envoy and officials")])
    llm = FakeLLM(agent_propose=ideas(2), agent_judge=Verdicts(items=[blame, named]), agent_deepen=Verdicts(items=[]))
    r = result_of(run(llm, patterns_task([dict(i) for i in ITEMS])))
    assert r["dropped"] == [{"thought": "T1", "why": "names Rapid Support Forces, which its items do not"}]
    assert [x["text"] for x in r["results"]] == ["The envoy goes to Saint Petersburg and meets officials."]


def test_low_confidence_is_dropped():
    llm = FakeLLM(agent_propose=ideas(1), agent_judge=Verdicts(items=[good_pattern(conf="low")]))
    r = result_of(run(llm, patterns_task([dict(i) for i in ITEMS])))
    assert r["results"] == [] and r["dropped"][0]["why"] == "too unsure"


def test_a_thought_the_judge_skipped_is_dropped():
    llm = FakeLLM(agent_propose=ideas(2), agent_judge=Verdicts(items=[good_pattern()]), agent_deepen=Verdicts(items=[]))
    r = result_of(run(llm, patterns_task([dict(i) for i in ITEMS])))
    assert {"thought": "T2", "why": "the items do not show it"} in r["dropped"]


def test_a_sharper_child_replaces_its_parent_only_if_it_stands():
    sharper = good_pattern(tid="", text="The same envoy arrives and then meets officials.")
    invented = Verdict(thought="", kind="same_actor", text="Made up.", confidence="high", quotes=[Quote(id="I1", quote="not in the text at all"), Quote(id="I2", quote="nor this one here")])
    llm = FakeLLM(agent_propose=ideas(1), agent_judge=Verdicts(items=[good_pattern()]), agent_deepen=Verdicts(items=[sharper, invented]))
    ev = run(llm, patterns_task([dict(i) for i in ITEMS]))
    r = result_of(ev)
    assert [x["text"] for x in r["results"]] == ["The same envoy arrives and then meets officials."]
    assert ("T1a", "chosen") in [(e["id"], e["state"]) for e in ev if e["type"] == "thought"]
    assert {"thought": "T1b", "why": "no quote found in two items"} in r["dropped"]


def test_budget_is_never_passed():
    three = Ideas(items=[Idea(kind="background", text=f"Idea {i}", search=f"topic {i}") for i in range(3)])
    judged = Verdicts(items=[why_verdict("T1"), why_verdict("T2"), why_verdict("T3")])
    llm = FakeLLM(agent_propose=three, agent_judge=judged, agent_deepen=Verdicts(items=[why_verdict("")]))

    async def search(q):
        return []

    ev = run(llm, why_task(dict(STORY), [dict(EARLIER)]), search=search)
    done = next(e for e in ev if e["type"] == "done")
    assert done["stats"]["calls"] <= MAX_CALLS
    assert len(llm.calls) <= MAX_CALLS


def why_verdict(tid, other="E1", quote="first round of talks ends without agreement"):
    return Verdict(thought=tid, kind="background", text="An earlier round failed.", confidence="high", quotes=[Quote(id="S", quote="second round of talks"), Quote(id=other, quote=quote)])


def test_why_needs_earlier_evidence_and_the_story():
    later = why_verdict("T1", quote="talks collapse after a dispute")
    no_story = Verdict(thought="T2", kind="background", text="Only one side.", confidence="high", quotes=[Quote(id="E2", quote="first round of talks ends")])
    ok = why_verdict("T3", other="E2")
    llm = FakeLLM(agent_propose=Ideas(items=[Idea(kind="background", text=f"Idea {i}", search="") for i in range(3)]), agent_judge=Verdicts(items=[later, no_story, ok]), agent_deepen=Verdicts(items=[]))
    r = result_of(run(llm, why_task(dict(STORY), [dict(LATER), dict(EARLIER)])))
    assert r["dropped"] == [{"thought": "T1", "why": "the evidence is later than the story"}, {"thought": "T2", "why": "no quote from the story"}]
    assert len(r["results"]) == 1 and r["results"][0]["items"] == ["n:s", "n:e"] and r["results"][0]["label"] == "inferred"
    assert set(r["items"]) == {"n:s", "n:e"}


def test_search_finds_evidence_and_a_restricted_query_is_not_run():
    asked = []

    async def search(q):
        asked.append(q)
        return [dict(EARLIER)]

    three = Ideas(items=[Idea(kind="background", text="One", search=""), Idea(kind="precedent", text="Two", search=""), Idea(kind="trigger", text="Three", search="")])
    llm = FakeLLM(agent_propose=three, agent_judge=Verdicts(items=[why_verdict("T1")]), agent_deepen=Verdicts(items=[]))
    ev = run(llm, why_task(dict(STORY), []), search=search)
    assert asked == ["Envoy"] or asked == ["Moscow"]
    assert [e["found"] for e in ev if e["type"] == "tool" and e["state"] == "done"] == [1]
    assert result_of(ev)["results"][0]["items"] == ["n:s", "n:e"]


def test_a_restricted_query_is_never_run():
    asked = []

    async def search(q):
        asked.append(q)
        return []

    three = Ideas(items=[Idea(kind="background", text="One", search="how to get past a paywall login")])
    llm = FakeLLM(agent_propose=three, agent_judge=Verdicts(items=[]))
    run(llm, why_task({**STORY, "label": "talks resume"}, []), search=search)
    assert asked == []


def test_main_name():
    assert main_name("A judge in Miami-Dade County, Florida, issues a warrant") == "Miami-Dade County"
    assert main_name("The European Central Bank authorizes UniCredit to raise its stake") == "European Central Bank"
    assert main_name("talks resume") == ""


def test_quota_out_at_the_start_says_so():
    llm = FakeLLM(agent_propose=QuotaExhausted("none"))
    ev = run(llm, patterns_task([dict(i) for i in ITEMS]))
    r = result_of(ev)
    assert r["results"] == [] and "quota" in r["note"].lower()
    assert ev[-1]["type"] == "done"


def test_quota_out_while_deepening_keeps_what_was_shown():
    llm = FakeLLM(agent_propose=ideas(1), agent_judge=Verdicts(items=[good_pattern()]), agent_deepen=QuotaExhausted("none"))
    r = result_of(run(llm, patterns_task([dict(i) for i in ITEMS])))
    assert len(r["results"]) == 1 and "quota" in r["note"].lower()


def test_a_broken_answer_does_not_break_the_stream():
    llm = FakeLLM(agent_propose=ValueError("bad"))
    ev = run(llm, patterns_task([dict(i) for i in ITEMS]))
    assert result_of(ev)["results"] == [] and ev[-1]["type"] == "done"


def test_next_steps_only_uses_real_nodes():
    nodes = [{"id": "wd:Q1", "label": "Geneva", "type": "Place"}, {"id": "wd:Q2", "label": "The envoy", "type": "PublicFigure"}]
    out = NextSteps(items=[NextStep(id="wd:Q1", question="Why Geneva?"), NextStep(id="wd:Q9", question="Invented?"), NextStep(id="wd:Q1", question="Again?")])
    r = asyncio.run(next_steps(FakeLLM(agent_next=out), STORY, nodes))
    assert r == [{"id": "wd:Q1", "label": "Geneva", "question": "Why Geneva?"}]
