import os, time
from collections import defaultdict, deque
from starlette.responses import JSONResponse

MAX_BYTES = int(os.getenv("MAX_UPLOAD_MB", "50")) * 1024 * 1024
GEN_PER_MIN = int(os.getenv("RATE_PER_MIN", "60"))              # all /api/* per IP
AI_PER_MIN = int(os.getenv("AI_PER_MIN", "6"))                  # /api/ai per IP
AI_PER_DAY = int(os.getenv("AI_PER_DAY", "40"))                 # /api/ai per IP
AI_GLOBAL_PER_DAY = int(os.getenv("AI_GLOBAL_PER_DAY", "500"))  # all users combined


class _TooLarge(Exception):
    pass


def _allow(dq, limit, window, now):
    while dq and dq[0] <= now - window:
        dq.popleft()
    if len(dq) >= limit:
        return False, int(dq[0] + window - now) + 1
    dq.append(now)
    return True, 0


def _ip(scope):
    h = dict(scope["headers"])
    xff = h.get(b"x-forwarded-for")
    if xff:
        return xff.decode().split(",")[0].strip()
    return scope["client"][0] if scope.get("client") else "unknown"


class LimitsMiddleware:
    def __init__(self, app):
        self.app = app
        self.hits = defaultdict(deque)

    def _reject(self, status, msg, retry=None):
        headers = {"Retry-After": str(retry)} if retry else {}
        return JSONResponse({"detail": msg}, status_code=status, headers=headers)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] == "OPTIONS" \
                or not scope["path"].startswith("/api/"):
            return await self.app(scope, receive, send)

        now, ip, path = time.time(), _ip(scope), scope["path"]

        if len(self.hits) > 10000:  # prune idle keys
            for k in [k for k, v in self.hits.items() if not v]:
                del self.hits[k]

        checks = [((ip, "gen"), GEN_PER_MIN, 60)]
        if path.startswith("/api/ai"):
            checks += [((ip, "ai-min"), AI_PER_MIN, 60),
                       ((ip, "ai-day"), AI_PER_DAY, 86400),
                       (("*", "ai-global"), AI_GLOBAL_PER_DAY, 86400)]
        for key, limit, window in checks:
            ok, retry = _allow(self.hits[key], limit, window, now)
            if not ok:
                resp = self._reject(429, "Rate limit exceeded. Try again later.", retry)
                return await resp(scope, receive, send)

        too_big = f"File too large (max {MAX_BYTES // 1048576} MB)."
        cl = dict(scope["headers"]).get(b"content-length")
        if cl and cl.isdigit() and int(cl) > MAX_BYTES:
            resp = self._reject(413, too_big)
            return await resp(scope, receive, send)

        received, started = 0, False

        async def limited_receive():
            nonlocal received
            msg = await receive()
            if msg["type"] == "http.request":
                received += len(msg.get("body", b""))
                if received > MAX_BYTES:
                    raise _TooLarge()
            return msg

        async def tracking_send(msg):
            nonlocal started
            if msg["type"] == "http.response.start":
                started = True
            await send(msg)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _TooLarge:
            if not started:
                resp = self._reject(413, too_big)
                await resp(scope, receive, send)
