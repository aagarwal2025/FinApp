// GET /api/tickers → US ticker universe for client-side search.
// Source: rreichel3/US-Stock-Symbols (auto-updated NASDAQ/NYSE/AMEX list) —
// "max ticker coverage" with zero storage on our side. Edge-cached ~24h.
// Falls back to a small bundled list of liquid names so search always works.

const DAY = 86400;
const SRC = "https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/all/all_tickers.txt";

const FALLBACK = [
  ["VTI", "Vanguard Total US Stock Market ETF"],
  ["VXUS", "Vanguard Total International Stock ETF"],
  ["VGIT", "Vanguard Intermediate-Term Treasury ETF"],
  ["VGSH", "Vanguard Short-Term Treasury ETF"],
  ["VSGX", "Vanguard ESG International Stock ETF"],
  ["BIL", "SPDR 1-3 Month T-Bill ETF"],
  ["SPY", "SPDR S&P 500 ETF"], ["VOO", "Vanguard S&P 500 ETF"],
  ["QQQ", "Invesco QQQ (Nasdaq-100)"], ["DIA", "SPDR Dow Jones ETF"],
  ["BND", "Vanguard Total Bond Market ETF"], ["AGG", "iShares Core US Aggregate Bond ETF"],
  ["GLD", "SPDR Gold Shares"], ["TLT", "iShares 20+ Year Treasury ETF"],
  ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["GOOGL", "Alphabet"], ["AMZN", "Amazon"],
  ["NVDA", "NVIDIA"], ["META", "Meta Platforms"], ["TSLA", "Tesla"], ["BRK-B", "Berkshire Hathaway B"],
  ["JPM", "JPMorgan Chase"], ["V", "Visa"], ["JNJ", "Johnson & Johnson"], ["WMT", "Walmart"],
  ["PG", "Procter & Gamble"], ["XOM", "Exxon Mobil"], ["KO", "Coca-Cola"], ["COST", "Costco"],
];

function json(body, store = true) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": store ? `public, max-age=${DAY}` : "no-store",
    },
  });
}

export async function onRequestGet({ request, waitUntil }) {
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  let tickers;
  try {
    const r = await fetch(SRC, { headers: { "user-agent": "FinApp" } });
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
    tickers = FALLBACK.map(([symbol, name]) => ({ symbol, name }));
    return json({ ok: true, source: "fallback", count: tickers.length, tickers }, false); // don't cache degraded list
  }

  const out = json({ ok: true, source: "github", count: tickers.length, tickers });
  waitUntil(cache.put(request, out.clone()));
  return out;
}
