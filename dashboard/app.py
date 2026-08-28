"""vllm-metrics-dashboard — thin proxy over Prometheus + static server.

Keeps the browser off Prometheus directly (no CORS, Prom stays internal).
GET /api/q?expr=<promql>          -> instant query
GET /api/qr?expr=<promql>&mins=N  -> range query (N-minute window, 5s step)

Config: PROM_URL env var (default http://prometheus:9090, the compose service).
"""
import os
import httpx
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

PROM = os.environ.get("PROM_URL", "http://prometheus:9090")
app = FastAPI(title="vllm-metrics-dashboard")


@app.middleware("http")
async def no_cache(request, call_next):
    # Live dashboard — never let a browser serve a stale index.html/config.js.
    # StaticFiles sends an ETag, so this is a cheap 304 revalidation, not a refetch.
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/api/q")
async def instant(expr: str = Query(...)):
    async with httpx.AsyncClient(timeout=5) as c:
        r = await c.get(f"{PROM}/api/v1/query", params={"query": expr})
    return JSONResponse(r.json())


@app.get("/api/qr")
async def range_(expr: str = Query(...), mins: int = 3):
    import time  # server clock; browser sends no time
    now = int(time.time())
    async with httpx.AsyncClient(timeout=8) as c:
        r = await c.get(f"{PROM}/api/v1/query_range", params={
            "query": expr, "start": now - mins * 60, "end": now, "step": "5s"})
    return JSONResponse(r.json())


app.mount("/", StaticFiles(directory="static", html=True), name="static")
