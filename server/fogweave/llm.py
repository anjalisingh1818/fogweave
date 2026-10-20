"""Free LLM chain with a quota governor.

- Models are tried best-first (config.LLM_MODELS). A model whose daily quota
  is spent, or that keeps rate-limiting, is skipped for the rest of the day.
- Free-tier limits (Groq Developer base limits as published 2026-10-20 for
  gpt-oss-120b / gpt-oss-20b / qwen3.8-27b): 30 req/min, 1,000 req/day,
  8,000 tokens/min, 200,000 tokens/day. Remaining-quota headers refine them.
- Output is strict JSON validated by Pydantic; at most 2 retries.
- Results are cached by input hash, so replays and evals cost nothing.
- When every model is out of quota we raise QuotaExhausted; callers degrade
  (fewer verifications, bundled webs) and say so in one plain line.

The LLM only writes language (summaries, extraction, labels). Every number
the user sees is computed by code.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from dataclasses import dataclass, field

from pydantic import BaseModel, ValidationError

from .cache import DiskCache, key_of
from .config import GROQ_API_KEY, LLM_MODELS


class QuotaExhausted(Exception):
    """No model in the chain can take another call right now."""


class LLMFailed(Exception):
    pass


DEFAULT_LIMITS = {"rpm": 30, "rpd": 1000, "tpm": 8000, "tpd": 200000}


@dataclass
class ModelQuota:
    name: str
    rpm: int = 30
    rpd: int = 1000
    tpm: int = 8000
    tpd: int = 200000
    minute: deque = field(default_factory=deque)  # (t, tokens)
    day_requests: int = 0
    day_tokens: int = 0
    day: str = ""
    blocked_until: float = 0.0

    def _roll(self, now: float):
        today = time.strftime("%Y-%m-%d", time.gmtime(now))
        if today != self.day:
            self.day, self.day_requests, self.day_tokens = today, 0, 0
        while self.minute and now - self.minute[0][0] > 60:
            self.minute.popleft()

    def wait_needed(self, est_tokens: int, now: float | None = None) -> float | None:
        """Seconds to wait before this call fits, or None if it cannot today."""
        now = now or time.time()
        self._roll(now)
        if now < self.blocked_until:
            return self.blocked_until - now
        if self.day_requests >= self.rpd or self.day_tokens + est_tokens > self.tpd:
            return None
        used_tokens = sum(t for _, t in self.minute)
        if len(self.minute) < self.rpm and used_tokens + est_tokens <= self.tpm:
            return 0.0
        if not self.minute:
            return 0.0 if est_tokens <= self.tpm else None
        return max(0.0, 60 - (now - self.minute[0][0]) + 0.5)

    def record(self, tokens: int, now: float | None = None):
        now = now or time.time()
        self._roll(now)
        self.minute.append((now, tokens))
        self.day_requests += 1
        self.day_tokens += tokens


def strict_schema(model: type[BaseModel]) -> dict:
    """Pydantic schema -> strict structured-output schema (all required,
    no extra properties), as the provider's strict mode demands."""
    schema = model.model_json_schema()

    def fix(node):
        if isinstance(node, dict):
            node.pop("default", None)
            node.pop("title", None)
            if node.get("type") == "object" or "properties" in node:
                node["additionalProperties"] = False
                node["required"] = list(node.get("properties", {}).keys())
            for v in node.values():
                fix(v)
        elif isinstance(node, list):
            for v in node:
                fix(v)

    fix(schema)
    return schema


class LLMChain:
    def __init__(self, models: list[str] | None = None, client=None, max_wait: float = 25.0):
        self.models = models or LLM_MODELS
        self.quotas = {m: ModelQuota(m, **DEFAULT_LIMITS) for m in self.models}
        self.cache = DiskCache("llm")
        self.max_wait = max_wait
        self._client = client
        self.stats = {"calls": 0, "cached": 0, "tokens": 0, "retries": 0, "by_model": {}}
        self.sleep = asyncio.sleep

    @property
    def client(self):
        if self._client is None:
            if not GROQ_API_KEY:
                raise QuotaExhausted("no GROQ_API_KEY configured")
            from groq import AsyncGroq

            self._client = AsyncGroq(api_key=GROQ_API_KEY, timeout=45.0, max_retries=0)
        return self._client

    def available(self) -> bool:
        return bool(GROQ_API_KEY or self._client) and any(q.wait_needed(500) is not None for q in self.quotas.values())

    async def json(self, *, role: str, system: str, user: str, schema: type[BaseModel], max_tokens: int = 1800, prefer: str | None = None) -> BaseModel:
        ck = key_of("llm", role, system, user, schema.__name__, json.dumps(schema.model_json_schema(), sort_keys=True))
        hit = self.cache.get(ck)
        if hit is not None:
            self.stats["cached"] += 1
            return schema.model_validate(hit)

        est = int((len(system) + len(user)) / 3.5) + max_tokens
        last_error: Exception | None = None
        # each model has its own free quota: roles prefer different models to spread load
        order = ([prefer] if prefer in self.quotas else []) + [m for m in self.models if m != prefer]
        for model in order:
            q = self.quotas[model]
            for attempt in range(3):  # first try + max 2 retries
                wait = q.wait_needed(est)
                if wait is None or wait > self.max_wait:
                    break  # this model cannot take it now: next model
                if wait > 0:
                    await self.sleep(wait)
                try:
                    data, used = await self._call(model, system, user, schema, max_tokens)
                    q.record(used)
                    self.stats["calls"] += 1
                    self.stats["tokens"] += used
                    self.stats["by_model"][model] = self.stats["by_model"].get(model, 0) + 1
                    result = schema.model_validate(data)
                    self.cache.set(ck, result.model_dump())
                    return result
                except (ValidationError, json.JSONDecodeError, LLMFailed) as exc:
                    last_error = exc
                    self.stats["retries"] += 1
                    continue
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    status = getattr(exc, "status_code", None)
                    if status == 429:
                        retry_after = _retry_after(exc)
                        q.blocked_until = time.time() + (retry_after or 30)
                        break  # rate-limited: move down the chain
                    if status and 400 <= status < 500 and status != 408:
                        break
                    self.stats["retries"] += 1
                    await self.sleep(1.5 * (attempt + 1))
        if last_error is None:
            raise QuotaExhausted("all free models are out of quota for now")
        raise QuotaExhausted(f"LLM chain failed: {type(last_error).__name__}: {str(last_error)[:200]}")

    async def _call(self, model: str, system: str, user: str, schema: type[BaseModel], max_tokens: int):
        kwargs = dict(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.2,
            max_completion_tokens=max_tokens,
            response_format={"type": "json_schema", "json_schema": {"name": schema.__name__, "strict": True, "schema": strict_schema(schema)}},
        )
        if model.startswith("openai/gpt-oss"):
            kwargs["reasoning_effort"] = "low"
        resp = await self.client.chat.completions.create(**kwargs)
        text = resp.choices[0].message.content or ""
        used = getattr(resp.usage, "total_tokens", None) or int(len(text) / 3.5)
        if not text.strip():
            raise LLMFailed("empty response")
        return json.loads(text), used


def _retry_after(exc) -> float | None:
    try:
        v = exc.response.headers.get("retry-after")
        return float(v) if v else None
    except Exception:  # noqa: BLE001
        return None
