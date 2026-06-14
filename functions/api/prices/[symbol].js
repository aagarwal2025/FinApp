// GET /api/prices/:symbol  → normalized daily adjusted-close history.
// Primary: Yahoo chart API (keyless, decades of history — same source as Fin's
// yfinance). Fallback: Stooq per-ticker CSV. Edge-cached ~24h. Never throws —
// returns {ok:false, reason} so the UI can render a placeholder, not fake data.

const DAY = 86400;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function json(body, status = 200, store = true) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": store ? `public, max-age=${DAY}` : "no-store",
    },
  });
}

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

export async function onRequestGet(context) {
  const { request, params, waitUntil } = context;
  const sym = String(params.symbol || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  if (!sym) return json({ ok: false, reason: "no symbol" }, 400);

  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  let out;
  for (const fetcher of [fromYahoo, fromYahoo, fromStooq]) {
    // two Yahoo attempts (transient blips), then Stooq fallback
    try {
      const data = await fetcher(sym);
      out = json({ ok: true, symbol: sym, ...data });
      break;
    } catch (_) {
      /* try next */
    }
  }
  if (!out) {
    // Don't cache failures — let the next request retry the upstreams.
    return json(
      { ok: false, symbol: sym, reason: "no data from Yahoo or Stooq (ticker may be unsupported)" },
      200,
      false,
    );
  }

  waitUntil(cache.put(request, out.clone()));
  return out;
}
