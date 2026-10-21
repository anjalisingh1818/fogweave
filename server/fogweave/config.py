"""Server settings. Keys come only from the environment (host settings or a
local, git-ignored .env); nothing secret lives in code."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path(os.getenv("FOGWEAVE_CACHE_DIR", ROOT / ".cache"))

USER_AGENT = "FogWeave/0.2 (https://github.com/anjalisingh1818/fogweave; research prototype) httpx"

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
# Free-tier chain, best first. Llama 3.3 70B is no longer served to this
# key (checked 2026-10-20), so the chain is gpt-oss-120b -> gpt-oss-20b -> qwen.
LLM_MODELS = [
    m.strip()
    for m in os.getenv("FOGWEAVE_LLM_MODELS", "openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b").split(",")
    if m.strip()
]

ENTITY_LINKING = os.getenv("FOGWEAVE_ENTITY_LINKING", "1") == "1"
EMBEDDINGS = os.getenv("FOGWEAVE_EMBEDDINGS", "1") == "1"

ALLOWED_ORIGINS = [
    o.strip().rstrip("/")
    for o in os.getenv("FOGWEAVE_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
] + ["https://localhost:8081", "http://localhost:8081"]

# per-expand budgets (keep a run inside the free tier and under ~60 s)
MAX_LLM_CALLS_PER_EXPAND = 6
MAX_CLAIMS_TO_VERIFY = 3
MAX_ARTICLE_CHARS = 9000  # ~2.3k tokens: the free tier allows 8k tokens/minute
