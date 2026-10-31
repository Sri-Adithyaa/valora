"""Small in-process sliding-window rate limiter for sensitive endpoints.

It is per process: behind several workers or replicas, swap it for a shared store such as Redis.
"""
import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import AppError


class RateLimited(AppError):
    status_code = 429
    code = "rate_limited"


_hits: dict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()
_enabled = True


def set_enabled(value: bool) -> None:
    global _enabled
    _enabled = value


def reset() -> None:
    with _lock:
        _hits.clear()


def limiter(bucket: str, limit_attr: str):
    def dependency(request: Request) -> None:
        if not _enabled:
            return
        s = get_settings()
        limit = getattr(s, limit_attr)
        window = s.rate_limit_window_seconds
        client = request.client.host if request.client else "unknown"
        key = f"{bucket}:{client}"
        now = time.monotonic()
        with _lock:
            q = _hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                retry = int(window - (now - q[0])) + 1
                raise RateLimited(f"Too many requests. Try again in {retry} seconds.")
            q.append(now)

    return dependency
