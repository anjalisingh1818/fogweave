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
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from fogweave import embed, ontology
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


class ReadReq(BaseModel):
    id: str = Field(max_length=40)


class ExpandReq(BaseModel):
    id: str = Field(max_length=40)
    context: list[str] = Field(default_factory=list, max_length=12)
    deep: bool = False


class CheckReq(BaseModel):
    text: str = Field(max_length=300)


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


@app.post("/read")
async def read(req: ReadReq):
    return await engine.read(req.id)


@app.post("/check")
def check(req: CheckReq):
    refusal = check_request(req.text)
    return {"ok": refusal is None, "message": refusal}


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
