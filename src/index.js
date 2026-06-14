// FinApp Worker entry (Cloudflare Workers Static Assets model).
// Static files in /public are served by the platform; this Worker runs only for
// /api/* (see run_worker_first in wrangler.toml). Routes:
//   GET  /api/prices/:symbol  → normalized daily adjusted-close history
//   GET  /api/tickers         → US ticker universe for client-side search
//   POST /api/mentor          → Claude Opus 4.8 mentor (chat stream + propose JSON)
// Never throws to the client — returns {ok:false, ...} so the UI shows a
// placeholder, not fake data (Fin's graceful-degradation discipline).

const DAY = 86400;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function dataJson(body, status = 200, store = true) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": store ? `public, max-age=${DAY}` : "no-store",
    },
  });
}
const apiJson = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

// ============================ PRICES ============================
async function fromYahoo(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    sym,
  )}?range=max&interval=1d&includeAdjustedClose=true`;
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!r.ok) throw new Error(`yahoo ${r.status}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const ts = res?.timestamp;
  if (!ts?.length) throw new Error("yahoo empty");
  const adj = res.indicators?.adjclose?.[0]?.adjclose;
  const close = res.indicators?.quote?.[0]?.close;
  const series = adj || close || [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const c = series[i];
    if (c != null && isFinite(c)) bars.push({ t: ts[i], c: +c.toFixed(4) });
  }
  if (!bars.length) throw new Error("yahoo no valid bars");
  return { source: "yahoo", currency: res.meta?.currency || "USD", bars };
}

async function fromStooq(sym) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym.toLowerCase())}.us&i=d`;
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`stooq ${r.status}`);
  const text = await r.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2 || !/Date,/.test(lines[0])) throw new Error("stooq no data");
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, , , , close] = lines[i].split(",");
    const c = parseFloat(close);
    const t = Math.floor(Date.parse(date + "T00:00:00Z") / 1000);
    if (isFinite(c) && isFinite(t)) bars.push({ t, c: +c.toFixed(4) });
  }
  if (!bars.length) throw new Error("stooq no valid bars");
  return { source: "stooq", currency: "USD", bars };
}

async function handlePrices(request, rawSym, ctx) {
  const sym = String(rawSym || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  if (!sym) return dataJson({ ok: false, reason: "no symbol" }, 400, false);

  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  let out;
  for (const fetcher of [fromYahoo, fromYahoo, fromStooq]) {
    try {
      const data = await fetcher(sym);
      out = dataJson({ ok: true, symbol: sym, ...data });
      break;
    } catch (_) {
      /* try next */
    }
  }
  if (!out) {
    return dataJson(
      { ok: false, symbol: sym, reason: "no data from Yahoo or Stooq (ticker may be unsupported)" },
      200,
      false,
    );
  }
  ctx.waitUntil(cache.put(request, out.clone()));
  return out;
}

// ============================ TICKERS ============================
const TICKERS_SRC = "https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/all/all_tickers.txt";
const TICKER_FALLBACK = [
  ["VTI", "Vanguard Total US Stock Market ETF"], ["VXUS", "Vanguard Total International Stock ETF"],
  ["VGIT", "Vanguard Intermediate-Term Treasury ETF"], ["VGSH", "Vanguard Short-Term Treasury ETF"],
  ["VSGX", "Vanguard ESG International Stock ETF"], ["BIL", "SPDR 1-3 Month T-Bill ETF"],
  ["SPY", "SPDR S&P 500 ETF"], ["VOO", "Vanguard S&P 500 ETF"], ["QQQ", "Invesco QQQ (Nasdaq-100)"],
  ["DIA", "SPDR Dow Jones ETF"], ["BND", "Vanguard Total Bond Market ETF"], ["AGG", "iShares Core US Aggregate Bond ETF"],
  ["GLD", "SPDR Gold Shares"], ["TLT", "iShares 20+ Year Treasury ETF"],
  ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["GOOGL", "Alphabet"], ["AMZN", "Amazon"],
  ["NVDA", "NVIDIA"], ["META", "Meta Platforms"], ["TSLA", "Tesla"], ["BRK-B", "Berkshire Hathaway B"],
  ["JPM", "JPMorgan Chase"], ["V", "Visa"], ["JNJ", "Johnson & Johnson"], ["WMT", "Walmart"],
  ["PG", "Procter & Gamble"], ["XOM", "Exxon Mobil"], ["KO", "Coca-Cola"], ["COST", "Costco"],
];

async function handleTickers(request, ctx) {
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  let tickers;
  try {
    const r = await fetch(TICKERS_SRC, { headers: { "user-agent": "FinApp" } });
    if (!r.ok) throw new Error(`src ${r.status}`);
    const text = (await r.text()).trim();
    let syms;
    try {
      const parsed = JSON.parse(text);
      syms = Array.isArray(parsed) ? parsed : null;
    } catch {
      syms = text.split(/[\s,]+/).map((s) => s.replace(/["'\[\]]/g, ""));
    }
    syms = (syms || []).map((s) => String(s).toUpperCase().trim()).filter((s) => /^[A-Z0-9.\-]{1,8}$/.test(s));
    if (syms.length < 100) throw new Error("too few symbols");
    tickers = syms.map((symbol) => ({ symbol }));
  } catch {
    tickers = TICKER_FALLBACK.map(([symbol, name]) => ({ symbol, name }));
    return dataJson({ ok: true, source: "fallback", count: tickers.length, tickers }, 200, false);
  }
  const out = dataJson({ ok: true, source: "github", count: tickers.length, tickers });
  ctx.waitUntil(cache.put(request, out.clone()));
  return out;
}

// ============================ MOVERS ============================
const MOVERS_SYMS = TICKER_FALLBACK.slice(14).map(([s]) => s);

async function computeMovers() {
  const results = await Promise.all(
    MOVERS_SYMS.map(async (sym) => {
      try {
        const d = await fromYahoo(sym);
        if (d.bars.length < 2) return null;
        const last = d.bars[d.bars.length - 1].c;
        const prev = d.bars[d.bars.length - 2].c;
        return { symbol: sym, price: last, changePct: +((last / prev - 1) * 100).toFixed(2) };
      } catch { return null; }
    }),
  );
  const valid = results.filter(Boolean);
  valid.sort((a, b) => b.changePct - a.changePct);
  return {
    ok: true,
    source: "computed",
    gainers: valid.filter((m) => m.changePct > 0).slice(0, 5),
    losers: valid.filter((m) => m.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, 5),
  };
}

async function handleMovers(request, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/movers", request.url).href, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let body;
  try {
    body = await computeMovers();
  } catch {
    body = { ok: false, reason: "could not compute movers" };
  }

  const out = new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=3600",
    },
  });
  if (body.ok) ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

// ============================ MENTOR ============================
const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM = `You are a patient quantitative-finance tutor inside FinApp, a paper-trading learning app on the user's phone. The user is an aspiring quant: strong in Python, but new to designing trading strategies.

Teach concretely and numbers-first: momentum, mean reversion, trend-following, risk management, position sizing, drawdown, diversification, regime shifts. Explain the *why*, not just the *what*. Be honest about uncertainty — say when something can't be known without a backtest, and never overstate what a rule can do. This is education, NOT financial advice: present reasoning and tradeoffs, then let the user decide. Keep answers focused and easy to read on a small screen (short paragraphs, occasional bullet lists).

FinApp can backtest and paper-trade strategies of this exact shape:
- universe: tickers the rule chooses among (prefer liquid US ETFs)
- safe_asset: a defensive ticker to rotate into, or "CASH"
- rebalance: "monthly" or "weekly"
- rule, one of:
  - relative_momentum { lookback_days, if_all_negative: "safe_asset" | "best_anyway" } — hold the universe asset with the highest trailing return; rotate to safe_asset if the winner is negative (Antonacci dual momentum)
  - sma_cross { asset, sma_days } — hold asset while above its N-day moving average, else safe_asset
  - buy_and_hold { weights?: [{symbol, weight}] } — static allocation, rebalanced
  - factor_score { factors: [{factor, weight, direction, params: {lookback_days}}], combine: "rank_top1" | "score_weighted" } — score each universe asset by a weighted combination of z-score-normalized price factors. rank_top1 holds the highest-scoring asset; score_weighted allocates proportionally to positive scores. Falls to safe_asset when all scores are negative. Supported factors (all price-computable, no fundamentals): momentum, risk_adj_momentum, volatility, trend_sma, sma_cross, mean_reversion, max_drawdown, downside_dev, high_52w, autocorrelation. direction: +1 = higher is better, -1 = lower is better. Example: momentum(+1) + volatility(-1) = quality momentum.

When the user asks how to express an idea, describe it in those terms so they can build it here.

You can search the web. Use it for things that change — current prices/quotes, recent market events, or a fund's current holdings/yield — and say when you've searched. For timeless concepts (how momentum works, math, definitions, or analyzing data already provided), answer directly without searching.`;

function prepMessages(messages) {
  const clean = (messages || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20);
  while (clean.length && clean[0].role !== "user") clean.shift();
  return clean;
}

async function handleMentor(request, env) {
  if (!env.MENTOR_PIN) return apiJson({ ok: false, error: "Mentor not configured: set MENTOR_PIN in Cloudflare." }, 500);
  if (!env.ANTHROPIC_API_KEY) return apiJson({ ok: false, error: "Mentor not configured: set ANTHROPIC_API_KEY in Cloudflare." }, 500);
  if (request.headers.get("x-mentor-pin") !== env.MENTOR_PIN) return apiJson({ ok: false, error: "Wrong passphrase." }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return apiJson({ ok: false, error: "bad request body" }, 400);
  }

  const mode = body.mode === "propose" ? "propose" : "chat";
  const messages = prepMessages(body.messages);
  if (!messages.length) return apiJson({ ok: false, error: "no message" }, 400);

  let system = SYSTEM;
  if (body.context && typeof body.context === "string") {
    system += `\n\n--- Current app context (for grounding your answer) ---\n${body.context.slice(0, 4000)}`;
  }

  const payload = {
    model: MODEL,
    max_tokens: 8192,
    system,
    messages,
    thinking: { type: "adaptive" },
  };
  if (mode === "propose") {
    const schema = body.schema && typeof body.schema === "object" ? body.schema : null;
    if (!schema) return apiJson({ ok: false, error: "propose mode requires a schema" }, 400);
    payload.output_config = { effort: "high", format: { type: "json_schema", schema } };
  } else {
    payload.output_config = { effort: "medium" };
    payload.stream = true;
    // Web search (server-side). code_execution enables dynamic filtering, which
    // trims result tokens — and is free when paired with web search. max_uses
    // bounds the per-turn search fee ($0.01/search). Claude only searches when
    // the question needs current data (steered in SYSTEM).
    payload.tools = [
      { type: "web_search_20260209", name: "web_search", max_uses: 3 },
      { type: "code_execution_20260120", name: "code_execution" },
    ];
  }

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC, {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return apiJson({ ok: false, error: "could not reach Anthropic API" }, 502);
  }

  if (!upstream.ok) {
    let detail = "";
    try {
      const err = await upstream.json();
      detail = err?.error?.message || JSON.stringify(err);
    } catch {
      detail = await upstream.text();
    }
    const hint = upstream.status === 400 && /credit|balance/i.test(detail) ? " (check your Anthropic credit balance)" : "";
    return apiJson({ ok: false, error: `Claude API error ${upstream.status}: ${detail}${hint}` }, 502);
  }

  if (mode === "chat") {
    return new Response(upstream.body, {
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" },
    });
  }

  try {
    const data = await upstream.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) return apiJson({ ok: false, error: "model returned no strategy" }, 502);
    const strategy = JSON.parse(textBlock.text);
    return apiJson({ ok: true, strategy, usage: data.usage });
  } catch (e) {
    return apiJson({ ok: false, error: "could not parse strategy JSON from model" }, 502);
  }
}

// ============================ ROUTER ============================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path.startsWith("/api/prices/")) {
      return handlePrices(request, decodeURIComponent(path.slice("/api/prices/".length)), ctx);
    }
    if (request.method === "GET" && path === "/api/tickers") {
      return handleTickers(request, ctx);
    }
    if (request.method === "GET" && path === "/api/movers") {
      return handleMovers(request, ctx);
    }
    if (request.method === "POST" && path === "/api/mentor") {
      return handleMentor(request, env);
    }
    // Defensive fallback: only /api/* reaches the Worker (run_worker_first),
    // so anything else is an unknown API route.
    if (path.startsWith("/api/")) return apiJson({ ok: false, error: "not found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
