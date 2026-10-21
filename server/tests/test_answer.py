import asyncio

from fogweave.answer import NO_ANSWER, AnswerOut, answer, facts_from_graph


class FakeLLM:
    def __init__(self, out):
        self.out = out
        self.calls = 0

    async def json(self, **kw):
        self.calls += 1
        return AnswerOut.model_validate(self.out)


class NoRouter:
    adapters = {}


GRAPH = {
    "nodes": [
        {"id": "n1", "type": "NewsItem", "label": "Port strike halts shipping", "outlet": "a.com", "date": "2026-10-19", "url": "https://a.com/x"},
        {"id": "ev", "type": "Event", "label": "Port strike"},
        {"id": "ship", "type": "Organisation", "label": "Shipping lines"},
        {"id": "c1", "type": "Claim", "label": "The port is closed", "quote": "the port is closed", "verdict": "supported", "evidence": {"independentDomains": 2}},
        {"id": "ctx:rotterdam", "type": "ContextNode", "label": "Rotterdam", "private": True},
        {"id": "far", "type": "Topic", "label": "Far thing"},
    ],
    "edges": [
        {"id": "e1", "type": "affects", "from": "ev", "to": "ship", "label": "inferred", "reasoning": "ships cannot dock"},
        {"id": "e2", "type": "affects", "from": "ev", "to": "far", "label": "speculative", "reasoning": "maybe"},
        {"id": "e3", "type": "same_as", "from": "ctx:rotterdam", "to": "ship", "label": "inferred", "reasoning": "x"},
    ],
}


def run(llm, q="Who is affected?"):
    return asyncio.run(answer(llm, NoRouter(), q, GRAPH, fresh=False))


def test_facts_exclude_speculative_and_private_context():
    texts = " | ".join(f["text"] for f in facts_from_graph(GRAPH))
    assert "Far thing" not in texts
    assert "Rotterdam" not in texts
    assert "ships cannot dock" in texts


def test_answer_keeps_only_real_citations():
    llm = FakeLLM({"answerable": True, "sentences": [
        {"text": "Shipping lines are affected because ships cannot dock.", "cites": ["F1", "F99"], "kind": "supported"},
        {"text": "Prices will surely double.", "cites": [], "kind": "supported"},
    ]})
    r = run(llm)
    assert r["answerable"]
    assert r["sentences"][0]["cites"] and "F99" not in r["sentences"][0]["cites"]
    assert r["sentences"][1]["kind"] == "guess"  # no citation -> marked as a guess
    assert all(c in r["citations"] for c in r["sentences"][0]["cites"])


def test_unanswerable_says_the_web_does_not_tell_us():
    llm = FakeLLM({"answerable": False, "sentences": [{"text": "Unknown.", "cites": [], "kind": "guess"}]})
    r = run(llm)
    assert r["text"] == NO_ANSWER and not r["answerable"]


def test_private_person_question_is_refused_without_llm():
    llm = FakeLLM({"answerable": True, "sentences": []})
    r = run(llm, "where does the port manager live")
    assert r["refused"] and llm.calls == 0
