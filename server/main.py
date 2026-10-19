"""
FogWeave backend — an actual agentic AI (Agno), not a single raw
completion call. Given a brand-new node's topic, the agent can search
the web for context (DuckDuckGoTools) before answering, then returns a
strict structured result:

  - summary            short factual summary of the topic
  - suggestions        which existing graph nodes it's likely related to
  - reliability        0..1 — revealed by the COIN divination
  - riskNote           one-line reason behind the reliability score

importance (revealed by the LOCKET) is NOT computed here — it's pure
graph-structure math (degree centrality) and is computed client-side
in src/graph-algorithms.js, since it depends only on confirmed edges,
not on anything the AI needs to judge.

Setup:
  pip install -r requirements.txt
  cp .env.example .env   # then fill in GROQ_API_KEY
  uvicorn main:app --reload --port 8787
"""

import os
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agno.agent import Agent
from agno.models.groq import Groq
from agno.tools.duckduckgo import DuckDuckGoTools

load_dotenv()

GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_PARSER_MODEL = os.getenv("GROQ_PARSER_MODEL", "openai/gpt-oss-20b")
if not os.getenv("GROQ_API_KEY"):
    print("[fogweave-server] WARNING: GROQ_API_KEY is not set — see .env.example")


class Suggestion(BaseModel):
    nodeId: Optional[str] = Field(
        default=None,
        description="id of an EXISTING node this topic relates to, copied exactly from the provided list. Omit if none apply.",
    )
    confidence: float = Field(..., description="0.0-1.0 confidence the two topics are genuinely related")
    reason: str = Field(..., description="very short phrase explaining the relation")


class NodeAnalysis(BaseModel):
    summary: str = Field(..., description="3-5 sentence factual summary of the topic, most important facts first")
    suggestions: List[Suggestion] = Field(
        default_factory=list,
        description="0 or more links to existing nodes. Only include ones you're reasonably confident about.",
    )
    reliability: float = Field(
        ...,
        description="0.0-1.0: how trustworthy/verifiable this summary is, based on what you found",
    )
    riskNote: str = Field(
        ...,
        description="one short sentence on why, e.g. 'well-established, corroborated by multiple sources' or 'single vague source, verify independently'",
    )


# One agent instance, reused across requests. It can search the web
# before answering — this is what makes it "agentic" rather than a
# single prompt->completion call: it decides whether/what to search.
# Groq can't combine JSON mode with tool calls in one request, so the
# research model runs free-form (searching as it likes) and a second,
# tool-less pass (parser_model) turns its findings into NodeAnalysis.
research_agent = Agent(
    model=Groq(id=GROQ_MODEL),
    parser_model=Groq(id=GROQ_PARSER_MODEL),
    tools=[DuckDuckGoTools(enable_search=True, enable_news=False)],
    instructions=(
        "You are the research engine behind a VR spatial knowledge-graph app. "
        "When given a topic, use web search if you need current or specific facts, "
        "then summarize it accurately and judge how reliable/verifiable your own "
        "summary is. Be conservative with the reliability score — vague, "
        "single-source, or speculative information should score low."
    ),
    output_schema=NodeAnalysis,
    markdown=False,
)

# Comma-separated list of browser origins allowed to call this API,
# e.g. "https://<user>.github.io". Local dev origins are always allowed.
ALLOWED_ORIGINS = [
    o.strip().rstrip("/")
    for o in os.getenv("FOGWEAVE_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
] + ["https://localhost:8081", "http://localhost:8081"]

app = FastAPI(title="FogWeave backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ExistingNode(BaseModel):
    id: str
    topic: str


class SummarizeRequest(BaseModel):
    topic: str
    existingNodes: List[ExistingNode] = Field(default_factory=list)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/summarize-and-link", response_model=NodeAnalysis)
def summarize_and_link(req: SummarizeRequest):
    if not req.topic.strip():
        raise HTTPException(status_code=400, detail="topic is required")

    node_list = (
        "\n".join(f'- id="{n.id}" topic="{n.topic}"' for n in req.existingNodes)
        or "(graph is empty so far)"
    )
    prompt = (
        f'New node topic: "{req.topic}"\n\n'
        f"Existing nodes already in the graph:\n{node_list}\n\n"
        "Analyze the new topic and respond with the structured fields you were configured for."
    )

    try:
        result = research_agent.run(prompt)
        analysis = result.content
        if not isinstance(analysis, NodeAnalysis):
            raise ValueError(f"model did not return structured output: {analysis!r}")
        # keep only suggestions that reference a real existing node id
        valid_ids = {n.id for n in req.existingNodes}
        analysis.suggestions = [s for s in analysis.suggestions if s.nodeId in valid_ids]
        return analysis
    except Exception as exc:  # noqa: BLE001 — surface as a clean 502 to the client
        print(f"[fogweave-server] agent run failed: {exc}")
        raise HTTPException(status_code=502, detail="agent run failed") from exc
