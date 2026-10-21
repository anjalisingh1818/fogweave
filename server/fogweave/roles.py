"""Role agents: narrow jobs behind one interface, `await Role(llm).run(...) ->
Pydantic model`. Code does everything that does not need language (quote
checks, evidence strength, graph building, label demotion).

The interface is deliberately small so an agent framework (e.g. Agno) can be
swapped in later without touching the pipeline.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .safety import UNTRUSTED_RULES, wrap_untrusted

EntityType = Literal["Event", "Organisation", "Place", "Topic", "Technology", "PublicFigure"]
ReportedRelation = Literal["happened_in", "involves", "affects", "depends_on", "part_of", "competes_with"]
Stance = Literal["supports", "contradicts", "unclear"]


# ---------- Summarizer (lights) ----------


class Summary(BaseModel):
    id: str
    summary: str = Field(description="1-2 plain sentences in our own words, only what the given text says")


class Summaries(BaseModel):
    items: list[Summary]


class Summarizer:
    def __init__(self, llm):
        self.llm = llm

    async def run(self, items: list[dict]) -> Summaries:
        body = "\n\n".join(f"id: {it['id']}\ntitle: {it['title']}\ntext: {it.get('snippet', '')[:400]}" for it in items)
        return await self.llm.json(
            role="summarizer",
            system=(
                "You write neutral 1-2 sentence summaries of news items in your own words. "
                "Use only what the given title and text say; if there is only a title, restate it plainly without adding facts. "
                "No opinions, no predictions. " + UNTRUSTED_RULES
            ),
            user="Summarize each item:\n" + wrap_untrusted(body, 9000),
            schema=Summaries,
            max_tokens=1600,
            prefer="openai/gpt-oss-20b",
        )


# ---------- Extractor (expand) ----------


class XEntity(BaseModel):
    name: str
    type: EntityType
    public_role: str | None = Field(description="for PublicFigure only: the public role they act in")


class XClaim(BaseModel):
    text: str = Field(description="one atomic factual claim in plain words")
    quote: str = Field(description="verbatim words copied from the text that state it, at most 25 words")


class XRelation(BaseModel):
    subject: str
    relation: ReportedRelation
    object: str
    quote: str = Field(description="verbatim words from the text that state this relation, at most 25 words")


class XEvent(BaseModel):
    name: str = Field(description="short name of the main event, 3-8 words")
    place: str | None
    when: str | None


class Extraction(BaseModel):
    event: XEvent
    entities: list[XEntity]
    claims: list[XClaim]
    relations: list[XRelation]


class Extractor:
    def __init__(self, llm):
        self.llm = llm

    async def run(self, title: str, text: str, limit: int) -> Extraction:
        return await self.llm.json(
            role="extractor",
            system=(
                "You extract structured facts from one news text for a knowledge graph. "
                "Return the main event, up to 10 entities (organisations, places, topics, technologies, events, "
                "and public figures acting in a public role), up to 5 atomic claims, and up to 8 relations stated in the text. "
                "Every quote must be copied word for word from the text (at most 25 words); if you cannot quote it, leave it out. "
                "Use entity names exactly as they appear in your entities list for relation subjects and objects. "
                "Types: countries, cities and regions are Place (not Organisation); governments, ministries, companies and armies are Organisation. "
                "Relation rules: happened_in and involves start at the main event (use the event name as subject); "
                "happened_in ends at a Place; competes_with links two Organisations or two Technologies; "
                "affects, depends_on and part_of link any two entities. " + UNTRUSTED_RULES
            ),
            user=f"Title: {title}\n\n" + wrap_untrusted(text, limit),
            schema=Extraction,
            max_tokens=2000,
        )


# ---------- Verifier (stance only) ----------


class Judgement(BaseModel):
    claim_id: str
    evidence_id: str
    stance: Stance


class Judgements(BaseModel):
    items: list[Judgement]


class Verifier:
    def __init__(self, llm):
        self.llm = llm

    async def run(self, claims: list[dict], evidence: list[dict]) -> Judgements:
        c = "\n".join(f"{x['id']}: {x['text']}" for x in claims)
        e = "\n".join(f"{x['id']} [{x['domain']}]: {x['text'][:700]}" for x in evidence)
        return await self.llm.json(
            role="verifier",
            system=(
                "For each claim and each evidence snippet about the same subject, judge the snippet's stance. "
                "'supports': the snippet states the claim's core fact (same who/what/when), possibly in other words; "
                "numbers and dates must match when the snippet gives them. "
                "'contradicts': the snippet states something incompatible with the claim (e.g. a different number, date or outcome). "
                "'unclear': same subject but the snippet neither confirms nor denies the claim. "
                "Skip pairs where the snippet is about something else. " + UNTRUSTED_RULES
            ),
            user=f"Claims:\n{c}\n\nEvidence snippets:\n" + wrap_untrusted(e, 7000),
            schema=Judgements,
            max_tokens=1200,
            prefer="openai/gpt-oss-20b",
        )


# ---------- Impact analyst ----------


class ImpactLink(BaseModel):
    source: str = Field(description="an entity/event name from the facts, or a 'target' produced by an earlier link")
    relation: Literal["affects", "depends_on"]
    target: str = Field(description="what is affected (an organisation, place, group, sector, technology or topic)")
    target_type: Literal["Organisation", "Place", "Technology", "Topic"] = Field(description="Topic for groups, sectors, relations, prices and other abstract things")
    label: Literal["inferred", "speculative"]
    basis: list[str] = Field(description="ids of the facts this rests on, e.g. F1, F3 (empty only for speculative)")
    reasoning: str = Field(description="one short sentence: why this follows from the facts")
    hop: int = Field(description="1 = directly from the event, 2 = from a hop-1 target, 3 = from a hop-2 target")


class Impact(BaseModel):
    links: list[ImpactLink]


class ImpactAnalyst:
    def __init__(self, llm):
        self.llm = llm

    async def run(self, event: str, facts: list[dict], context: list[str], max_hop: int = 2) -> Impact:
        f = "\n".join(f"{x['id']}: {x['text']}" for x in facts)
        ctx = (
            "\nThe reader's coarse context: " + "; ".join(context[:8])
            + ". Link to it ONLY when a listed fact directly involves it; never build chains just to reach it. "
            "If nothing in the facts touches it, leave it out."
            if context
            else ""
        )
        return await self.llm.json(
            role="impact",
            system=(
                "You map possible effects of a news event as short chains (event -> affected thing -> second-order effect). "
                f"Use at most {max_hop} hops and at most 8 links. "
                "Label a link 'inferred' only when it follows directly from the listed facts, and list those fact ids in basis; "
                "generic effects such as attention, interest, perception, morale or media coverage are 'speculative'. "
                "Label it 'speculative' when it is plausible but not grounded in the facts. "
                "These are possible effects, not predictions or advice. Do not invent facts. " + UNTRUSTED_RULES
            ),
            user=f"Event: {event}\nFacts:\n" + wrap_untrusted(f, 6000) + ctx,
            schema=Impact,
            max_tokens=1600,
        )


# ---------------------------------------------------------------- Relation Reasoner
RELATION_KINDS = ("same_event", "follow_up", "background", "cause_of", "effect_of", "precedent_of", "similar_pattern", "corroborates", "contradicts", "shares_entity", "possible_consequence", "unrelated")


class PairJudgement(BaseModel):
    id: str = Field(description="the candidate id, as given")
    relation: Literal["same_event", "follow_up", "background", "cause_of", "effect_of", "precedent_of", "similar_pattern", "corroborates", "contradicts", "shares_entity", "possible_consequence", "unrelated"]
    quote_focus: str = Field(description="a short exact quote (25 words or fewer) from the FOCUS text that shows the link")
    quote_other: str = Field(description="a short exact quote (25 words or fewer) from the CANDIDATE text that shows the link")
    reason: str = Field(description="one or two plain sentences: how the two are related; for similar_pattern also what differs")
    confidence: Literal["low", "medium", "high"]


class PairJudgements(BaseModel):
    items: list[PairJudgement]


class RelationReasoner:
    """Decides how each candidate news item relates to the focus item. Code checks the quotes and dates."""

    def __init__(self, llm):
        self.llm = llm

    async def run(self, focus: dict, candidates: list[dict]) -> PairJudgements:
        cands = "\n\n".join(f"[{c['id']}] ({c['date'][:10]}) {c['text']}" for c in candidates)
        return await self.llm.json(
            role="relation",
            system=(
                "You decide how each CANDIDATE news item relates to the FOCUS news item. Relations, from the candidate's side: "
                "same_event (reports the same event), follow_up (a later development of it), background (earlier news that explains it), "
                "cause_of (the candidate's event caused the focus event), effect_of (the candidate's event is a result of the focus event), "
                "precedent_of (an earlier similar case), similar_pattern (the same kind of event elsewhere; say what differs), "
                "corroborates (independently reports the same facts), contradicts (reports conflicting facts), "
                "shares_entity (only shares a person, place or organisation), possible_consequence (something the focus may lead to), "
                "unrelated (none of these). Choose cause_of or effect_of only when the texts state the causal link. "
                "Answer once for every candidate. Each quote is ONE continuous exact span copied from its text (25 words or fewer, no '...'). "
                "If unsure, say low confidence or unrelated. " + UNTRUSTED_RULES
            ),
            user="FOCUS (" + focus["date"][:10] + "):\n" + wrap_untrusted(focus["text"], 2500) + "\n\nCANDIDATES:\n" + wrap_untrusted(cands, 6000),
            schema=PairJudgements,
            max_tokens=1600,
        )
