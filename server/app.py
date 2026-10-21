"""FogWeave backend (FastAPI).

  GET  /health          liveness + quota and source status
  POST /lights          news lights {context?: [coarse labels]}
  POST /read            reader-card details {id}
  POST /expand          streamed graph events (text/event-stream) {id, context?, deep?}
  POST /check           safety check for typed requests {text}

The reader's context labels arrive only with the request that needs them and
are never stored or logged.

Run: uvicorn app:app --port 8787
"""

from __future__ import annotations

import json
import re
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from fogweave import embed, ontology
from fogweave.answer import answer as answer_question
from fogweave.llm import QuotaExhausted
from fogweave.rdf import check_pack
from fogweave.config import ALLOWED_ORIGINS, GROQ_API_KEY
from fogweave.pipeline import Engine
from fogweave.safety import check_request

app = FastAPI(title="FogWeave backend", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
engine = Engine()
STARTED = time.time()


class LightsReq(BaseModel):
    context: list[str] = Field(default_factory=list, max_length=12)


class PoolReq(BaseModel):
    interests: dict = Field(default_factory=dict)  # labels only: topics, newsTypes, paperTypes


class ReadReq(BaseModel):
    id: str = Field(max_length=40)


class ExpandReq(BaseModel):
    id: str = Field(max_length=40)
    context: list[str] = Field(default_factory=list, max_length=12)
    deep: bool = False


class CheckReq(BaseModel):
    text: str = Field(max_length=300)


class AskReq(BaseModel):
    question: str = Field(min_length=3, max_length=300)
    graph: dict = Field(default_factory=dict)  # compact web around the focus (no private context)
    fresh: bool = True


class ExploreReq(BaseModel):
    node: dict  # {id, type, label, qid?}
    context: list[str] = Field(default_factory=list, max_length=12)
    paperTypes: list[str] = Field(default_factory=list, max_length=10)


class DossierReq(BaseModel):
    nodes: list[dict] = Field(default_factory=list, max_length=30)  # [{id, type, label, qid?}]
    places: list[str] = Field(default_factory=list, max_length=20)  # place names in the story's web (public)


class PackReq(BaseModel):
    pack: dict  # the client's JSON-LD Evidence Pack


@app.get("/health")
def health():
    quotas = {m: {"requestsToday": q.day_requests, "tokensToday": q.day_tokens, "rpd": q.rpd, "tpd": q.tpd} for m, q in engine.llm.quotas.items()}
    return {
        "ok": True,
        "uptimeS": int(time.time() - STARTED),
        "llmConfigured": bool(GROQ_API_KEY),
        "llmAvailable": engine.llm.available(),
        "quotas": quotas,
        "sources": engine.router.status,
        "embeddings": embed.BACKEND,
        "ontology": ontology.VERSION,
    }


@app.post("/lights")
async def lights(req: LightsReq):
    return await engine.lights(context=[c for c in req.context if 0 < len(c) < 60])


@app.post("/pool")
async def pool(req: PoolReq):
    i = req.interests or {}
    clean = {
        "topics": [t for t in i.get("topics", []) if isinstance(t, dict) and isinstance(t.get("label"), str)][:8],
        "newsTypes": [t for t in i.get("newsTypes", []) if isinstance(t, str)][:10],
        "paperTypes": [t for t in i.get("paperTypes", []) if isinstance(t, str)][:10],
        "sourceTypes": [t for t in i.get("sourceTypes", []) if t in ("dataset", "archive")],
    }
    return await engine.pool(clean)


@app.post("/read")
async def read(req: ReadReq):
    return await engine.read(req.id)


@app.post("/check")
def check(req: CheckReq):
    refusal = check_request(req.text)
    return {"ok": refusal is None, "message": refusal}


@app.post("/ask")
async def ask(req: AskReq):
    graph = {"nodes": req.graph.get("nodes", [])[:80], "edges": req.graph.get("edges", [])[:160]}
    try:
        return await answer_question(engine.llm, engine.router, req.question, graph, fresh=req.fresh)
    except QuotaExhausted:
        return {"refused": False, "answerable": False, "text": "Free model quota is spent for now; try again later.", "sentences": [], "citations": {}, "degraded": True}


@app.post("/pack")
def pack(req: PackReq):
    """Validate an Evidence Pack: JSON-LD -> RDF (rdflib), SHACL (pySHACL), SPARQL."""
    try:
        return check_pack(req.pack)
    except Exception as exc:  # noqa: BLE001 — report, don't crash
        raise HTTPException(status_code=422, detail=f"not valid JSON-LD: {type(exc).__name__}") from exc


@app.post("/dossiers")
async def dossiers(req: DossierReq):
    """Real information about each node (what it is, key facts with sources), fast and cached."""
    from fogweave.dossier import DossierMaker

    nodes = []
    for n in req.nodes:
        if isinstance(n, dict) and isinstance(n.get("id"), str) and isinstance(n.get("label"), str) and n["label"].strip():
            nodes.append({"id": n["id"][:120], "label": n["label"][:120], "type": str(n.get("type", "Topic"))[:20], "qid": n.get("qid") if isinstance(n.get("qid"), str) and re.fullmatch(r"Q\d+", n.get("qid") or "") else None})
    places = [p[:80] for p in req.places if isinstance(p, str)]
    return {"dossiers": await DossierMaker(engine).make(nodes, places)}


@app.post("/explore")
async def explore(req: ExploreReq):
    from fogweave.explore import Explorer

    n = req.node or {}
    if not isinstance(n.get("id"), str) or not isinstance(n.get("label"), str) or not n["label"].strip():
        raise HTTPException(status_code=400, detail="node needs id and label")
    node = {"id": n["id"][:120], "label": n["label"][:120], "type": n.get("type", "Topic"), "qid": n.get("qid") if isinstance(n.get("qid"), str) else None}

    async def stream():
        try:
            async for ev in Explorer(engine).run(node, context=req.context, paper_types=req.paperTypes):
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'done', 'stats': {'error': str(exc)[:160]}})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/expand")
async def expand(req: ExpandReq):
    if not req.id.startswith("n:"):
        raise HTTPException(status_code=400, detail="unknown item id")

    async def stream():
        try:
            async for ev in engine.expand(req.id, context=req.context, deep=req.deep):
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except Exception as exc:  # noqa: BLE001 — the client must always get a 'done'
            yield f"data: {json.dumps({'type': 'note', 'level': 'error', 'text': 'Research stopped: ' + type(exc).__name__})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'stats': {'error': str(exc)[:160]}})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
