// portfolio.js — simulated (paper) account persisted in localStorage.
// Fills are at the latest EOD close (honest labeling: not realistic intraday
// fills). Pure-ish: state lives in localStorage; price I/O is the caller's job.

const KEY = "finapp.portfolio.v1";
const START_CASH = 10000;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s.cash === "number") return s;
  } catch {}
  return { cash: START_CASH, positions: {}, txns: [], created: Date.now() };
}
function save(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function getState() {
  return load();
}

export function resetAccount() {
  const fresh = { cash: START_CASH, positions: {}, txns: [], created: Date.now() };
  save(fresh);
  return fresh;
}

// Buy `shares` of `symbol` at `price` (latest EOD close). Returns {ok, error}.
export function buy(symbol, shares, price) {
  shares = +shares; price = +price;
  if (!(shares > 0) || !(price > 0)) return { ok: false, error: "invalid shares/price" };
  const cost = shares * price;
  const s = load();
  if (cost > s.cash + 1e-9) return { ok: false, error: "insufficient cash" };
  s.cash -= cost;
  const pos = s.positions[symbol] || { shares: 0, cost: 0 };
  pos.cost += cost; // running cost basis
  pos.shares += shares;
  s.positions[symbol] = pos;
  s.txns.unshift({ ts: Date.now(), type: "BUY", symbol, shares, price, amount: -cost });
  save(s);
  return { ok: true };
}

// Sell `shares` of `symbol` at `price`. Returns {ok, error}.
export function sell(symbol, shares, price) {
  shares = +shares; price = +price;
  const s = load();
  const pos = s.positions[symbol];
  if (!pos || pos.shares < shares - 1e-9) return { ok: false, error: "not enough shares" };
  const proceeds = shares * price;
  const fraction = shares / pos.shares;
  pos.cost -= pos.cost * fraction; // reduce basis proportionally
  pos.shares -= shares;
  s.cash += proceeds;
  if (pos.shares <= 1e-9) delete s.positions[symbol];
  else s.positions[symbol] = pos;
  s.txns.unshift({ ts: Date.now(), type: "SELL", symbol, shares, price, amount: proceeds });
  save(s);
  return { ok: true };
}

// Summary given a Map<symbol, latestClose|null>. Missing prices count as 0
// value but are flagged so the UI can show "price unavailable" not a fake $0.
export function summarize(state, priceMap) {
  let holdings = 0, basis = 0;
  const rows = [];
  for (const [sym, pos] of Object.entries(state.positions)) {
    const px = priceMap.get(sym);
    const value = px != null ? pos.shares * px : null;
    if (value != null) holdings += value;
    basis += pos.cost;
    rows.push({
      symbol: sym,
      shares: pos.shares,
      price: px,
      value,
      cost: pos.cost,
      gain: value != null ? value - pos.cost : null,
      gainPct: value != null && pos.cost > 0 ? value / pos.cost - 1 : null,
    });
  }
  rows.sort((a, b) => (b.value || 0) - (a.value || 0));
  const total = state.cash + holdings;
  return {
    cash: state.cash,
    holdings,
    total,
    invested: basis,
    totalReturn: total / START_CASH - 1,
    rows,
    startCash: START_CASH,
  };
}

export { START_CASH };
