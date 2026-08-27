/* =============================================================================
 *  vllm-metrics-dashboard — deployment config
 *  Edit this file, then reload the page. No rebuild needed if you bind-mount it
 *  (the docker-compose in this repo already does).
 * ---------------------------------------------------------------------------
 *  Most people run ONE vLLM server. That is the default below — leave `engines`
 *  as a single entry. If you run several vLLM servers (a "fleet"), add one entry
 *  per engine; the dashboard renders a panel for each plus a combined cost/ROI.
 * ========================================================================== */
window.FLEET_CONFIG = {

  // Shown top-left and in the browser tab.
  brand: 'VLLM METRICS',

  // Lifetime counters are increase() over this window. Keep it <= your
  // Prometheus retention (docker-compose default is 30d). Widen both together
  // (e.g. '[365d]' + --storage.tsdb.retention.time=365d) for a longer history.
  life: '[30d]',

  // ---- ENGINES ------------------------------------------------------------
  // One entry = one vLLM server = one panel.
  //   selector : a Prometheus label matcher picking THIS engine's series.
  //              '' (empty) matches every series — correct when Prometheus
  //              scrapes only one vLLM target. With multiple targets, pin each
  //              engine to its scrape job: selector: '{job="vllm"}'.
  //              (Use a label that exists for the engine's whole history; the
  //              scrape `job` is ideal. A brand-new label forks the series and
  //              zeroes the lifetime counters.)
  //   title    : big label on the panel.
  //   meta     : small line under the title (HTML allowed). Optional.
  //   key      : short unique id (a-z0-9). Optional; auto-generated if omitted.
  engines: [
    {
      key: 'vllm',
      selector: '',                 // single Prometheus target → matches all
      title: 'VLLM ENGINE',
      meta: 'single node',          // e.g. 'Llama-3.1-70B · 2× A100'
      sectionLeft: 'NODE · VLLM ENGINE',
      sectionRight: 'MODEL',
    },

    // ---- FLEET EXAMPLE (uncomment & adapt for multiple servers) ----------
    // Each needs its own scrape job in prometheus.yml (job_name: <name>), and
    // the selector here must match that job. See prometheus/prometheus.example.yml.
    // {
    //   key: 'a', selector: '{job="vllm-a"}',
    //   title: 'LLAMA-3.1-70B', meta: 'TP=2 · 2× A100 · node-a',
    //   sectionLeft: 'NODE-A · VLLM ENGINE', sectionRight: 'LLAMA-3.1-70B',
    // },
    // {
    //   key: 'b', selector: '{job="vllm-b"}',
    //   title: 'QWEN2.5-32B', meta: '1× H100 · node-b',
    //   sectionLeft: 'NODE-B · VLLM ENGINE', sectionRight: 'QWEN2.5-32B',
    // },
  ],

  // ---- COST / ROI PRICING -------------------------------------------------
  // USD per 1M tokens for hosted APIs you'd otherwise pay for. The dashboard
  // shows what your lifetime tokens WOULD have cost on each — the ROI of
  // self-hosting. Input is split cached/fresh by the engine's measured vLLM
  // prefix-cache hit rate; cached input is priced at `cin`.
  //   in = fresh (cache-miss) input   cin = cached input   out = output
  // Update these to current list prices; they're only shown, never fetched.
  prices: [
    { name: 'DEEPSEEK',  in: 0.27, cin: 0.07, out: 1.10 },
    { name: 'OPENAI',    in: 2.50, cin: 1.25, out: 10.00 },
    { name: 'ANTHROPIC', in: 3.00, cin: 0.30, out: 15.00 },
  ],
};
