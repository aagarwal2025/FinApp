// data.js — client access to price/ticker endpoints + return math.
// Mirrors Fin's trailing-return windowing (generate_report.py fetch_quotes):
// trailing return = adjClose[asof] / adjClose[asof - N days] - 1, via as-of lookup.

const DAY = 86400;
const _priceCache = new Map(); // symbol -> {ok, symbol, bars, currency} (session-scoped)
let _tickers = null;

export async function getPrices(symbol) {
  const sym = symbol.toUpperCase();
  if (_priceCache.has(sym)) return _priceCache.get(sym);
  let data;
  try {
    const r = await fetch(`/api/prices/${encodeURIComponent(sym)}`);
    data = await r.json();
  } catch (e) {
    data = { ok: false, symbol: sym, reason: "network error" };
  }
  _priceCache.set(sym, data);
  return data;
}

// Fetch several symbols in parallel; returns Map<symbol, data>.
export async function getManyPrices(symbols) {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const results = await Promise.all(uniq.map(getPrices));
  return new Map(uniq.map((s, i) => [s, results[i]]));
}

export async function getTickers() {
  if (_tickers) return _tickers;
  try {
    const r = await fetch("/api/tickers");
    const j = await r.json();
    _tickers = j.tickers || [];
  } catch {
    _tickers = [];
  }
  return _tickers;
}

export function searchTickers(list, query, limit = 30) {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const starts = [], contains = [];
  for (const t of list) {
    const s = t.symbol;
    if (s === q) starts.unshift(t);
    else if (s.startsWith(q)) starts.push(t);
    else if (s.includes(q) || (t.name && t.name.toUpperCase().includes(q))) contains.push(t);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

// --- bar helpers (bars are ascending by .t unix seconds) ---

export function latestClose(bars) {
  return bars && bars.length ? bars[bars.length - 1].c : null;
}

// Largest index with bars[i].t <= t (binary search). -1 if none.
export function asOfIndex(bars, t) {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// Trailing total return over `days` ending at the last bar (or at index `endIdx`).
export function trailingReturn(bars, days, endIdx) {
  if (!bars || bars.length < 2) return null;
  const end = endIdx == null ? bars.length - 1 : endIdx;
  const target = bars[end].t - days * DAY;
  const i = asOfIndex(bars, target);
  if (i < 0 || i >= end) return null;
  return bars[end].c / bars[i].c - 1;
}

// --- formatting ---
export const fmtMoney = (n) =>
  n == null || !isFinite(n) ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPct = (x) =>
  x == null || !isFinite(x) ? "—" : (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
export const signClass = (x) => (x == null || !isFinite(x) ? "" : x >= 0 ? "pos" : "neg");
