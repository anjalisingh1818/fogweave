"""Small open text embeddings (BAAI/bge-small-en-v1.5 via fastembed, MIT /
Apache-2.0, ONNX on CPU) for story clustering, related items and
near-duplicate removal. If the model is unavailable (low-memory host,
offline) a hashed bag-of-words vector is used instead and reported."""

from __future__ import annotations

import hashlib
import re

import numpy as np

from .config import EMBEDDINGS

_MODEL = None
BACKEND = "none"


def _hash_vec(text: str, dim: int = 512) -> np.ndarray:
    v = np.zeros(dim, dtype=np.float32)
    for w in re.findall(r"[a-z0-9]{3,}", text.lower()):
        h = int(hashlib.md5(w.encode()).hexdigest()[:8], 16)
        v[h % dim] += 1.0
    return v


def embed(texts: list[str]) -> np.ndarray:
    global _MODEL, BACKEND
    if EMBEDDINGS and _MODEL is None:
        try:
            from fastembed import TextEmbedding

            _MODEL = TextEmbedding("BAAI/bge-small-en-v1.5")
            BACKEND = "bge-small-en-v1.5"
        except Exception:  # noqa: BLE001 — degrade to hashing
            _MODEL = False
    if _MODEL:
        vecs = np.array(list(_MODEL.embed(texts)), dtype=np.float32)
    else:
        BACKEND = "hashed-bow"
        vecs = np.stack([_hash_vec(t) for t in texts]) if texts else np.zeros((0, 512), dtype=np.float32)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1
    return vecs / norms


def cluster(vectors: np.ndarray, threshold: float = 0.72) -> list[int]:
    """Stories = connected components of the 'similar enough' graph
    (single-link). Returns a story index per item."""
    n = len(vectors)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    if n:
        sims = vectors @ vectors.T
        for i in range(n):
            for j in range(i + 1, n):
                if sims[i, j] >= threshold:
                    parent[find(i)] = find(j)
    roots: dict[int, int] = {}
    return [roots.setdefault(find(i), len(roots)) for i in range(n)]


def near_duplicates(vectors: np.ndarray, threshold: float = 0.93) -> set[int]:
    """Indexes to drop because an earlier item says the same thing."""
    drop: set[int] = set()
    if len(vectors) < 2:
        return drop
    sims = vectors @ vectors.T
    for i in range(len(vectors)):
        if i in drop:
            continue
        for j in range(i + 1, len(vectors)):
            if sims[i, j] >= threshold:
                drop.add(j)
    return drop
