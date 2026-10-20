"""Tiny JSON disk cache keyed by a hash of the request. Survives restarts,
so repeated demos and evals do not spend free quota twice."""

import hashlib
import json
import time
from pathlib import Path

from .config import CACHE_DIR


def key_of(*parts) -> str:
    raw = json.dumps(parts, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class DiskCache:
    def __init__(self, namespace: str, root: Path = CACHE_DIR):
        self.dir = Path(root) / namespace
        self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        if len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
            key = hashlib.sha256(key.encode("utf-8")).hexdigest()  # ids like "n:abc" are not path-safe
        return self.dir / f"{key[:2]}" / f"{key}.json"

    def get(self, key: str, max_age: float | None = None):
        p = self._path(key)
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if max_age is not None and time.time() - data.get("t", 0) > max_age:
            return None
        return data.get("v")

    def set(self, key: str, value) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps({"t": time.time(), "v": value}, ensure_ascii=False), encoding="utf-8")
        tmp.replace(p)

    def clear(self) -> int:
        n = 0
        for f in self.dir.rglob("*.json"):
            f.unlink(missing_ok=True)
            n += 1
        return n
