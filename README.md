# vllm-metrics-dashboard

A single-screen, real-time dashboard for one or more [vLLM](https://github.com/vllm-project/vllm)
servers. Live throughput, latency (TTFT / ITL), KV-cache pressure, prefix-cache
hit rate, speculative-decoding stats — plus a **cost / ROI panel** that shows
what your traffic *would* have cost on a hosted API (DeepSeek / OpenAI /
Anthropic), so you can see the money you're saving by self-hosting.

It's deliberately tiny: a ~40-line FastAPI proxy in front of Prometheus, and one
static HTML page. No Grafana, no database, no build step for the UI. Point it at
a vLLM server and open a browser.

- **Standalone** — one vLLM server. This is the common case; start here.
- **Fleet** — several vLLM servers on one screen, each with its own panel, plus
  a combined cost/ROI. Same dashboard, more entries in one config file.

---

## How it works

```
 vLLM /metrics ──scrape──> Prometheus ──HTTP──> dashboard (FastAPI) ──> your browser
   (:8000)                   (:9090)              (:8091)                 (polls 2s)
```

- **vLLM** already exposes Prometheus metrics at `/metrics` on its API port.
- **Prometheus** scrapes and stores them (so you get lifetime totals and history).
- **The dashboard** is a thin proxy: the browser calls `/api/q` / `/api/qr`, the
  server forwards to Prometheus and returns JSON. Prometheus never has to be
  exposed to the browser, and there's no CORS to fight.

Everything the dashboard shows is driven by
[`dashboard/static/config.js`](dashboard/static/config.js) — engines, labels,
the lifetime window, and the API prices used for the ROI panel. You edit that
file; you never touch the app code.

---

## Requirements

- Docker + Docker Compose (v2, i.e. `docker compose`).
- One or more vLLM servers reachable from where you run this, each exposing
  `/metrics`. Recent vLLM enables the metrics endpoint by default; if yours
  doesn't, start it with `--enable-metrics` (an OpenAI-API server already has
  it on). Quick check:
  ```bash
  curl -s http://YOUR_VLLM_HOST:8000/metrics | grep '^vllm:' | head
  ```
  If that prints `vllm:...` lines, you're good.

---

## Quick start — standalone (one vLLM server)

```bash
git clone https://github.com/hazyumps/vllm-metrics-dashboard.git
cd vllm-metrics-dashboard

# 1. Prometheus: copy the example and point it at your vLLM server.
cp prometheus/prometheus.example.yml prometheus/prometheus.yml
#    edit prometheus/prometheus.yml  ->  targets: ['YOUR_VLLM_HOST:8000']

# 2. Dashboard: name your engine (optional — the default works).
#    edit dashboard/static/config.js

# 3. Up.
docker compose up -d --build
```

Open **http://localhost:8091**. Data starts filling in within a couple of
seconds; lifetime totals and the cost/ROI panel grow as Prometheus accumulates
history.

For a single server you can leave `config.js` almost untouched — the default
engine uses an empty selector (`selector: ''`) which matches whatever your
single Prometheus target reports. Just set the `title`/`meta` to your model if
you like.

> **Different UI port?** Set `DASHBOARD_PORT` (see `.env.example`) or edit the
> `ports:` line in `docker-compose.yml`.

---

## Quick start — fleet (several vLLM servers)

Same two files, more entries.

**1. `prometheus/prometheus.yml`** — one scrape job per server, each with a
distinct `job_name`:

```yaml
global:
  scrape_interval: 2s
  scrape_timeout: 1s
scrape_configs:
  - job_name: vllm-a
    static_configs:
      - targets: ['10.0.0.11:8000']
  - job_name: vllm-b
    static_configs:
      - targets: ['10.0.0.12:8000']
```

**2. `dashboard/static/config.js`** — one engine per server, its `selector`
matching the job name:

```js
window.FLEET_CONFIG = {
  brand: 'MY VLLM FLEET',
  life: '[30d]',
  engines: [
    { key:'a', selector:'{job="vllm-a"}', title:'LLAMA-3.1-70B',
      meta:'TP=2 · 2× A100 · node-a',
      sectionLeft:'NODE-A · VLLM ENGINE', sectionRight:'LLAMA-3.1-70B' },
    { key:'b', selector:'{job="vllm-b"}', title:'QWEN2.5-32B',
      meta:'1× H100 · node-b',
      sectionLeft:'NODE-B · VLLM ENGINE', sectionRight:'QWEN2.5-32B' },
  ],
  prices: [
    { name:'DEEPSEEK',  in:0.27, cin:0.07, out:1.10 },
    { name:'OPENAI',    in:2.50, cin:1.25, out:10.00 },
    { name:'ANTHROPIC', in:3.00, cin:0.30, out:15.00 },
  ],
};
```

`docker compose up -d --build`, open the UI — you get a panel per engine and one
combined **FLEET · COST / ROI** panel summing them all.

> **Tensor-parallel note:** a single model sharded across N GPUs/nodes with `TP=N`
> is **one** vLLM engine — scrape only the head/rank-0 metrics endpoint, and give
> it one engine entry. Two *separate* model servers are two engines.

---

## Configuration reference (`config.js`)

| Field | What it is |
|-------|-----------|
| `brand` | Title text, top-left and in the browser tab. |
| `life` | Lifetime window for `increase()`, e.g. `'[30d]'`. Keep it ≤ your Prometheus retention. |
| `engines[]` | One entry per vLLM engine (see below). |
| `prices[]` | API prices for the ROI panel, USD per 1M tokens. |

**Engine entry:**

| Field | What it is |
|-------|-----------|
| `selector` | Prometheus label matcher for this engine's series. `''` = match everything (single-target Prometheus). Otherwise `'{job="..."}'`. Use a label stable across the engine's whole life — a new label forks the series and **zeroes lifetime counters**. |
| `title` | Big label on the panel. |
| `meta` | Small line under the title (HTML allowed). Optional. |
| `key` | Short unique id (`a-z0-9`). Optional; auto-generated if omitted. |
| `sectionLeft` / `sectionRight` | Section-header captions. Optional. |

**Price entry:** `{ name, in, cin, out }` — `in` = fresh (cache-miss) input,
`cin` = cached input, `out` = output, all USD per 1M tokens. The dashboard splits
your lifetime input tokens into cached vs fresh using each engine's **measured**
vLLM prefix-cache hit rate, prices each part accordingly, and sums output at
`out`. Update these to whatever the current list prices are; they're only
displayed, never fetched.

---

## What each metric means

Every `?` marker in the UI has a hover tooltip. In short:

- **Tokens** — lifetime prompt + generated tokens (cumulative, survives restarts).
- **Running / Waiting** — requests decoding now vs queued for a KV-cache slot.
  Persistently high Waiting = the engine is saturated.
- **Cache Hit** — prefix-cache hit rate; prompt tokens reused from a prior
  request instead of recomputed. Higher = cheaper, faster prompts. Drives the
  cost panel.
- **KV Cache** — live GPU KV-cache utilisation. Near 100% forces preemptions.
- **Preemptions** — lifetime count of running requests evicted under memory
  pressure (and recomputed later).
- **Spec Accept / Spec Depth** — speculative-decoding acceptance rate and
  per-position accepted-token depth. Blank if you're not running speculative
  decoding — that's expected, not a bug.
- **TTFT / ITL** — time-to-first-token and inter-token latency, P50/P95.
- **Cost / ROI** — equivalent hosted-API spend for your lifetime tokens.

---

## Running without Compose

The pieces are independent — run your own Prometheus and just the dashboard
container:

```bash
docker build -t vllm-metrics-dashboard ./dashboard
docker run -d -p 8091:8080 \
  -e PROM_URL=http://YOUR_PROMETHEUS:9090 \
  -v "$PWD/dashboard/static/config.js:/app/static/config.js:ro" \
  vllm-metrics-dashboard
```

`PROM_URL` defaults to `http://prometheus:9090` (the Compose service name).

Or run the proxy straight from Python for local hacking:

```bash
cd dashboard
pip install -r requirements.txt
PROM_URL=http://localhost:9090 uvicorn app:app --port 8080
```

---

## Tuning & notes

- **Scrape interval.** The example uses a 2s scrape for a smooth live view. That
  writes a lot of samples — if you keep a long retention, raise
  `scrape_interval` to 5–15s and bump `--storage.tsdb.retention.time` to match
  `life`.
- **Retention vs `life`.** `life: '[30d]'` only works if Prometheus keeps 30d.
  The Compose file sets `--storage.tsdb.retention.time=30d`; change both together.
- **Series continuity.** Lifetime totals rely on the same series existing across
  restarts. Don't rename scrape jobs or relabel targets once deployed, or the
  lifetime counters restart from zero.
- **Security.** The dashboard has no auth. Keep it on a trusted network, or put
  it behind your own reverse proxy / auth. Only the UI port is published;
  Prometheus stays internal to the Compose network.

---

## Layout

```
vllm-metrics-dashboard/
├── docker-compose.yml            # Prometheus + dashboard, one command
├── .env.example                  # optional: DASHBOARD_PORT
├── prometheus/
│   └── prometheus.example.yml    # copy to prometheus.yml, point at vLLM
└── dashboard/
    ├── Dockerfile
    ├── app.py                    # FastAPI proxy (/api/q, /api/qr) + static
    ├── requirements.txt
    └── static/
        ├── index.html            # the whole UI (config-driven)
        └── config.js             # YOUR config — engines, prices, brand
```

## License

MIT — see [LICENSE](LICENSE).
