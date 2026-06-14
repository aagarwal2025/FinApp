// backtest.js — run a strategy (strategy.js shape) over fetched adjusted-close
// history. Ports Fin's dual-momentum decision (generate_report.py compute_signal)
// and trailing-return windowing into a forward, monthly/weekly-rebalanced sim.
//
// Conventions: $10,000 start, fills at each rebalance date's close, weights drift
// between rebalances. CASH = constant 1.0 (no yield — conservative). Benchmark =
// buy & hold of the first universe asset.

import { asOfIndex, trailingReturn } from "./data.js";
export { symbolsOf } from "./strategy.js";

const DAY = 86400;
const START = 10000;

function closeAt(data, t) {
  if (!data || !data.ok || !data.bars?.length) return null;
  const i = asOfIndex(data.bars, t);
  return i >= 0 ? data.bars[i].c : null;
}
function idxAt(data, t) {
  if (!data || !data.ok || !data.bars?.length) return -1;
  return asOfIndex(data.bars, t);
}

// Decide target weights {symbol: fraction} at time t. CASH allowed as a symbol.
function decide(strategy, priceMap, t) {
  const rule = strategy.rule;
  const safe = strategy.safe_asset || "CASH";

  if (rule.type === "buy_and_hold") {
    let w = {};
    if (Array.isArray(rule.weights) && rule.weights.length) {
      const sum = rule.weights.reduce((a, x) => a + (x.weight || 0), 0) || 1;
      rule.weights.forEach((x) => (w[x.symbol] = (x.weight || 0) / sum));
    } else {
      const u = strategy.universe;
      u.forEach((s) => (w[s] = 1 / u.length));
    }
    return w;
  }

  if (rule.type === "sma_cross") {
    const data = priceMap.get(rule.asset);
    const i = idxAt(data, t);
    if (i < 0 || i < rule.sma_days) return { [safe]: 1 };
    let sum = 0;
    for (let k = i - rule.sma_days + 1; k <= i; k++) sum += data.bars[k].c;
    const sma = sum / rule.sma_days;
    return data.bars[i].c > sma ? { [rule.asset]: 1 } : { [safe]: 1 };
  }

  if (rule.type === "relative_momentum") {
    let best = null, bestRet = -Infinity;
    for (const sym of strategy.universe) {
      const data = priceMap.get(sym);
      const i = idxAt(data, t);
      if (i < 0) continue;
      const r = trailingReturn(data.bars, rule.lookback_days, i);
      if (r == null) continue;
      if (r > bestRet) { bestRet = r; best = sym; }
    }
    if (best == null) return { [safe]: 1 };
    if (bestRet < 0 && rule.if_all_negative === "safe_asset") return { [safe]: 1 };
    return { [best]: 1 };
  }

  return { CASH: 1 };
}

function rebalanceKey(t, mode) {
  const d = new Date(t * 1000);
  if (mode === "weekly") return Math.floor(t / (7 * DAY));
  return d.getUTCFullYear() * 12 + d.getUTCMonth(); // monthly
}

function stats(equity) {
  if (equity.length < 2) return null;
  const first = equity[0].v, last = equity[equity.length - 1].v;
  const years = (equity[equity.length - 1].t - equity[0].t) / (365.25 * DAY) || 1;
  let peak = -Infinity, maxDD = 0, prev = null, sum = 0, sum2 = 0, n = 0;
  for (const p of equity) {
    peak = Math.max(peak, p.v);
    maxDD = Math.min(maxDD, p.v / peak - 1);
    if (prev != null && prev > 0) {
      const r = p.v / prev - 1;
      sum += r; sum2 += r * r; n++;
    }
    prev = p.v;
  }
  const mean = n ? sum / n : 0;
  const variance = n ? sum2 / n - mean * mean : 0;
  const vol = Math.sqrt(Math.max(0, variance)) * Math.sqrt(252);
  return {
    totalReturn: last / first - 1,
    cagr: Math.pow(last / first, 1 / years) - 1,
    maxDrawdown: maxDD,
    volatility: vol,
    finalValue: last,
    years,
  };
}

// priceMap: Map<symbol, {ok, bars}>. Returns a result object (never throws).
export function runBacktest(strategy, priceMap, opts = {}) {
  const startYear = opts.startYear || 2008;
  const need = _symbolsOfStrategy(strategy);
  const tradeable = need.filter((s) => s !== "CASH");

  // Determine the overlapping window where every needed symbol has data.
  let inception = -Infinity, endBound = Infinity;
  const missing = [];
  for (const s of tradeable) {
    const d = priceMap.get(s);
    if (!d || !d.ok || !d.bars?.length) { missing.push(s); continue; }
    inception = Math.max(inception, d.bars[0].t);
    endBound = Math.min(endBound, d.bars[d.bars.length - 1].t);
  }
  if (missing.length) return { ok: false, reason: `no price data for: ${missing.join(", ")}` };

  const startBound = Math.max(inception, Date.UTC(startYear, 0, 1) / 1000);
  if (startBound >= endBound) return { ok: false, reason: "not enough overlapping history for these tickers" };

  // Calendar = union of all trading days in range (dedup, sorted).
  const dateSet = new Set();
  for (const s of tradeable) {
    for (const b of priceMap.get(s).bars) if (b.t >= startBound && b.t <= endBound) dateSet.add(b.t);
  }
  const calendar = [...dateSet].sort((a, b) => a - b);
  if (calendar.length < 30) return { ok: false, reason: "too few trading days in range" };

  // Walk forward. Start fully in cash so the first-day mark-to-market is START,
  // not 0 (the first calendar day is always a rebalance).
  let holdings = {}, cash = START, value = START, lastKey = null, rebalances = 0;
  const equity = [];
  for (const t of calendar) {
    // mark to market
    let mv = cash;
    for (const [sym, sh] of Object.entries(holdings)) {
      const px = closeAt(priceMap.get(sym), t);
      if (px != null) mv += sh * px;
    }
    value = mv;

    const key = rebalanceKey(t, strategy.rebalance);
    if (key !== lastKey) {
      lastKey = key;
      rebalances++;
      const target = decide(strategy, priceMap, t);
      holdings = {}; cash = 0;
      for (const [sym, frac] of Object.entries(target)) {
        const alloc = value * frac;
        if (sym === "CASH") { cash += alloc; continue; }
        const px = closeAt(priceMap.get(sym), t);
        if (px != null && px > 0) holdings[sym] = alloc / px;
        else cash += alloc; // can't price it → park in cash this period
      }
    }
    equity.push({ t, v: value });
  }

  // Benchmark: buy & hold first universe asset over the same window.
  const benchSym = opts.benchmark || strategy.universe[0];
  let benchmark = null, benchStats = null;
  const bd = priceMap.get(benchSym);
  if (bd && bd.ok) {
    const p0 = closeAt(bd, calendar[0]);
    if (p0 > 0) {
      benchmark = calendar.map((t) => ({ t, v: START * (closeAt(bd, t) / p0) }));
      benchStats = stats(benchmark);
    }
  }

  return {
    ok: true,
    strategy,
    equity,
    stats: stats(equity),
    benchmark,
    benchmarkSymbol: benchSym,
    benchStats,
    rebalances,
    start: calendar[0],
    end: calendar[calendar.length - 1],
  };
}

// local copy to avoid import name clash with the re-export above
function _symbolsOfStrategy(s) {
  const set = new Set();
  (s.universe || []).forEach((x) => set.add(x));
  if (s.safe_asset) set.add(s.safe_asset);
  if (s.rule?.asset) set.add(s.rule.asset);
  (s.rule?.weights || []).forEach((w) => set.add(w.symbol));
  return [...set];
}
