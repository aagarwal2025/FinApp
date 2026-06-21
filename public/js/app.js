// app.js — bootstrap: service worker, tab navigation, and wiring for the five
// views (Markets, Portfolio, Backtest, Mentor, Claude's Desk).

import * as data from "./data.js";
import { renderChart } from "./chart.js";
import * as pf from "./portfolio.js";
import { runBacktest } from "./backtest.js";
import { BUILTIN_STRATEGIES, validateStrategy, symbolsOf, AVAILABLE_FACTORS } from "./strategy.js";
import { initMentor } from "./mentor.js";
import { renderDaily } from "./daily.js";

const { fmtMoney, fmtPct, signClass } = data;
const $ = (id) => document.getElementById(id);
const TITLES = { markets: "Markets", portfolio: "Portfolio", backtest: "Backtest", mentor: "Mentor", daily: "Claude's Desk" };

// ---- service worker ----
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// ---- tab navigation ----
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  $("view-title").textContent = TITLES[name];
  if (name === "portfolio") renderPortfolio();
  if (name === "backtest") rebuildStrategySelect();
  if (name === "daily") renderDaily();
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

// =================== MARKETS ===================
let tickerList = [];
let currentDetail = null;

const EXCHANGE_TICKERS = {
  BSE: [
    { symbol: "RELIANCE.BO", name: "Reliance Industries" }, { symbol: "TCS.BO", name: "Tata Consultancy" },
    { symbol: "HDFCBANK.BO", name: "HDFC Bank" }, { symbol: "INFY.BO", name: "Infosys" },
    { symbol: "ICICIBANK.BO", name: "ICICI Bank" }, { symbol: "HINDUNILVR.BO", name: "Hindustan Unilever" },
    { symbol: "SBIN.BO", name: "State Bank of India" }, { symbol: "BHARTIARTL.BO", name: "Bharti Airtel" },
    { symbol: "ITC.BO", name: "ITC" }, { symbol: "KOTAKBANK.BO", name: "Kotak Mahindra Bank" },
    { symbol: "LT.BO", name: "Larsen & Toubro" }, { symbol: "AXISBANK.BO", name: "Axis Bank" },
    { symbol: "BAJFINANCE.BO", name: "Bajaj Finance" }, { symbol: "MARUTI.BO", name: "Maruti Suzuki" },
    { symbol: "TITAN.BO", name: "Titan Company" }, { symbol: "SUNPHARMA.BO", name: "Sun Pharma" },
    { symbol: "ULTRACEMCO.BO", name: "UltraTech Cement" }, { symbol: "NESTLEIND.BO", name: "Nestlé India" },
    { symbol: "WIPRO.BO", name: "Wipro" }, { symbol: "HCLTECH.BO", name: "HCL Technologies" },
  ],
  DFM: [
    { symbol: "DFM.AE", name: "Dubai Financial Market" }, { symbol: "EMAAR.AE", name: "Emaar Properties" },
    { symbol: "DIB.AE", name: "Dubai Islamic Bank" }, { symbol: "DU.AE", name: "Emirates Integrated Telecom" },
    { symbol: "DEWA.AE", name: "Dubai Electricity & Water" }, { symbol: "EMIRATESNBD.AE", name: "Emirates NBD" },
  ],
};

async function initMarkets() {
  tickerList = await data.getTickers();
  $("topbar-note").textContent = tickerList.length ? `${tickerList.length.toLocaleString()} tickers` : "";
  loadMovers();
  renderExchangeList("US");
}

async function loadMovers() {
  const strip = $("movers-strip");
  const d = await data.getMovers();
  if (!d.ok) { strip.innerHTML = '<span class="muted" style="padding:12px">Movers unavailable.</span>'; return; }
  strip.innerHTML = "";
  const all = [...(d.gainers || []), ...(d.losers || [])];
  for (const m of all) {
    const card = document.createElement("div");
    card.className = "mover-card";
    const cls = m.changePct >= 0 ? "pos" : "neg";
    const sign = m.changePct >= 0 ? "+" : "";
    card.innerHTML =
      `<div class="mover-sym">${m.symbol}</div>` +
      `<div class="mover-price">${fmtMoney(m.price)}</div>` +
      `<div class="mover-chg ${cls}">${sign}${m.changePct.toFixed(1)}%</div>`;
    card.addEventListener("click", () => openTicker(m.symbol));
    strip.appendChild(card);
  }
}

function renderExchangeList(exchange) {
  const ul = $("exchange-list");
  ul.innerHTML = "";
  if (exchange === "US") return;
  const list = EXCHANGE_TICKERS[exchange] || [];
  for (const t of list) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="sym">${t.symbol}</span><span class="nm">${t.name || ""}</span>`;
    li.addEventListener("click", () => openTicker(t.symbol));
    ul.appendChild(li);
  }
}

document.querySelectorAll(".ex-tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".ex-tab").forEach((b) => b.classList.toggle("active", b === t));
    renderExchangeList(t.dataset.exchange);
  }),
);

let searchTimer;
$("ticker-search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value;
  searchTimer = setTimeout(() => {
    const results = data.searchTickers(tickerList, q);
    const ul = $("search-results");
    ul.innerHTML = "";
    for (const t of results) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="sym">${t.symbol}</span><span class="nm">${t.name || ""}</span>`;
      li.addEventListener("click", () => openTicker(t.symbol));
      ul.appendChild(li);
    }
  }, 180);
});

async function openTicker(symbol) {
  const detail = $("ticker-detail");
  detail.classList.remove("hidden");
  $("detail-symbol").textContent = symbol;
  $("detail-price").textContent = "";
  $("detail-returns").innerHTML = '<span class="spinner"></span>';
  $("chart-host").innerHTML = '<p class="muted">Loading…</p>';
  $("detail-buy").classList.remove("hidden");
  $("detail-nobusd").classList.add("hidden");
  detail.scrollIntoView({ behavior: "smooth", block: "start" });

  const d = await data.getPrices(symbol);
  if (!d.ok) {
    $("detail-returns").textContent = "";
    $("chart-host").innerHTML = `<p class="muted">Price data unavailable: ${d.reason || "unknown"}.</p>`;
    currentDetail = null;
    return;
  }
  const currency = d.currency || "USD";
  const last = data.latestClose(d.bars);
  currentDetail = { symbol, price: last, currency };
  $("detail-price").textContent = fmtMoney(last, currency);

  if (currency !== "USD") {
    $("detail-buy").classList.add("hidden");
    $("detail-nobusd").classList.remove("hidden");
  }

  const r1 = data.trailingReturn(d.bars, 30), r3 = data.trailingReturn(d.bars, 90), r12 = data.trailingReturn(d.bars, 365);
  $("detail-returns").innerHTML =
    `1M <span class="${signClass(r1)}">${fmtPct(r1)}</span><br>` +
    `3M <span class="${signClass(r3)}">${fmtPct(r3)}</span><br>` +
    `12M <span class="${signClass(r12)}">${fmtPct(r12)}</span>`;

  renderChart($("chart-host"), [{ label: symbol, points: d.bars.map((b) => ({ t: b.t, v: b.c })) }], { log: true });
}

$("detail-buy").addEventListener("click", () => {
  if (!currentDetail) return;
  const sharesStr = prompt(`Paper buy ${currentDetail.symbol} at ${fmtMoney(currentDetail.price)} (last close).\nHow many shares?`, "1");
  if (sharesStr == null) return;
  const shares = parseFloat(sharesStr);
  const res = pf.buy(currentDetail.symbol, shares, currentDetail.price);
  if (!res.ok) alert("Could not buy: " + res.error);
  else alert(`Bought ${shares} ${currentDetail.symbol} @ ${fmtMoney(currentDetail.price)}.`);
});

// =================== PORTFOLIO ===================
async function renderPortfolio() {
  const state = pf.getState();
  const syms = Object.keys(state.positions);
  const priceMap = new Map();
  if (syms.length) {
    const got = await data.getManyPrices(syms);
    for (const [s, d] of got) priceMap.set(s, d.ok ? data.latestClose(d.bars) : null);
  }
  const sum = pf.summarize(state, priceMap);

  $("pf-summary").innerHTML = `
    <div class="big ${signClass(sum.totalReturn)}">${fmtMoney(sum.total)}</div>
    <div class="kv">Cash<b>${fmtMoney(sum.cash)}</b></div>
    <div class="kv">Holdings<b>${fmtMoney(sum.holdings)}</b></div>
    <div class="kv">Total return<b class="${signClass(sum.totalReturn)}">${fmtPct(sum.totalReturn)}</b></div>
    <div class="kv">Start<b>${fmtMoney(sum.startCash)}</b></div>`;

  if (!sum.rows.length) {
    $("pf-holdings").innerHTML = '<p class="muted">No holdings yet. Buy something from the Markets tab.</p>';
  } else {
    let rows = "";
    for (const r of sum.rows) {
      rows += `<tr>
        <td>${r.symbol}</td>
        <td>${r.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
        <td>${r.price != null ? fmtMoney(r.price) : "—"}</td>
        <td>${r.value != null ? fmtMoney(r.value) : "—"}</td>
        <td class="${signClass(r.gainPct)}">${fmtPct(r.gainPct)}</td>
        <td><button class="btn btn-quiet sell-btn" data-sym="${r.symbol}" data-shares="${r.shares}" data-price="${r.price ?? ""}">Sell</button></td>
      </tr>`;
    }
    $("pf-holdings").innerHTML =
      `<table class="data"><thead><tr><th>Symbol</th><th>Shares</th><th>Price</th><th>Value</th><th>Gain</th><th></th></tr></thead><tbody>${rows}</tbody></table>
       <p class="muted" style="margin-top:8px">Marked to the latest EOD close (simulated fills).</p>`;
    document.querySelectorAll(".sell-btn").forEach((b) => b.addEventListener("click", onSell));
  }

  const txns = state.txns.slice(0, 25);
  $("pf-activity").innerHTML = txns.length
    ? `<table class="data"><tbody>${txns
        .map((t) => `<tr><td>${new Date(t.ts).toLocaleDateString()}</td><td>${t.type} ${t.shares} ${t.symbol}</td><td>@ ${fmtMoney(t.price)}</td><td class="${t.amount >= 0 ? "pos" : "neg"}">${fmtMoney(t.amount)}</td></tr>`)
        .join("")}</tbody></table>`
    : '<p class="muted">No activity yet.</p>';
}

function onSell(e) {
  const { sym, shares, price } = e.target.dataset;
  if (!price) { alert("No current price to sell at."); return; }
  const qtyStr = prompt(`Sell ${sym} at ${fmtMoney(+price)} (last close).\nHow many shares? (you hold ${shares})`, shares);
  if (qtyStr == null) return;
  const res = pf.sell(sym, parseFloat(qtyStr), +price);
  if (!res.ok) alert("Could not sell: " + res.error);
  else renderPortfolio();
}

$("pf-reset").addEventListener("click", () => {
  if (confirm("Reset the paper account to $10,000 and clear all positions?")) {
    pf.resetAccount();
    renderPortfolio();
  }
});

// =================== BACKTEST ===================
const SAVED_KEY = "finapp.strategies.v1";
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; } catch { return []; } };
const saveSaved = (arr) => localStorage.setItem(SAVED_KEY, JSON.stringify(arr));

function allStrategies() {
  return [...BUILTIN_STRATEGIES, ...loadSaved()];
}

function rebuildStrategySelect(selectName) {
  const sel = $("bt-strategy");
  const list = allStrategies();
  sel.innerHTML = list
    .map((s, i) => `<option value="${i}">${s.name}${i >= BUILTIN_STRATEGIES.length ? " (saved)" : ""}</option>`)
    .join("");
  if (selectName) {
    const idx = list.findIndex((s) => s.name === selectName);
    if (idx >= 0) sel.value = String(idx);
  }
  showStrategyJson();
}

function currentStrategy() {
  return allStrategies()[+$("bt-strategy").value] || BUILTIN_STRATEGIES[0];
}
function showStrategyJson() {
  $("bt-strategy-json").textContent = JSON.stringify(currentStrategy(), null, 2);
}
$("bt-strategy").addEventListener("change", showStrategyJson);

function saveStrategy(strategy) {
  const arr = loadSaved();
  const i = arr.findIndex((s) => s.name === strategy.name);
  if (i >= 0) arr[i] = strategy; else arr.push(strategy);
  saveSaved(arr);
}

let lastBacktestSummary = "";

$("bt-run").addEventListener("click", runCurrentBacktest);

async function runCurrentBacktest() {
  const strategy = currentStrategy();
  const v = validateStrategy(strategy);
  const out = $("bt-results");
  if (!v.ok) { out.innerHTML = `<div class="card"><p class="neg">Invalid strategy: ${v.errors.join("; ")}</p></div>`; return; }

  out.innerHTML = '<div class="card"><span class="spinner"></span> Fetching history & running…</div>';
  const startYear = parseInt($("bt-start").value, 10) || 2008;
  const syms = symbolsOf(strategy);
  const priceMap = await data.getManyPrices(syms);

  const r = runBacktest(strategy, priceMap, { startYear });
  if (!r.ok) { out.innerHTML = `<div class="card"><p class="neg">Backtest failed: ${r.reason}</p></div>`; return; }

  const s = r.stats;
  const stat = (label, val, cls = "") => `<div class="stat"><div class="label">${label}</div><div class="value ${cls}">${val}</div></div>`;
  const period = `${new Date(r.start * 1000).getFullYear()}–${new Date(r.end * 1000).getFullYear()}`;

  out.innerHTML = `
    <div class="card">
      <h2 class="section-h" style="margin-top:0">${strategy.name} · ${period}</h2>
      <div id="bt-chart" class="chart-host"></div>
      <div class="stats" style="margin-top:12px">
        ${stat("CAGR", fmtPct(s.cagr), signClass(s.cagr))}
        ${stat("Total return", fmtPct(s.totalReturn), signClass(s.totalReturn))}
        ${stat("Max drawdown", fmtPct(s.maxDrawdown), "neg")}
        ${stat("Volatility (ann.)", fmtPct(s.volatility))}
        ${stat("Final value", fmtMoney(s.finalValue))}
        ${stat("Rebalances", String(r.rebalances))}
      </div>
      ${r.benchStats ? `<p class="muted" style="margin-top:10px">Benchmark — buy &amp; hold ${r.benchmarkSymbol}: CAGR ${fmtPct(r.benchStats.cagr)}, max DD ${fmtPct(r.benchStats.maxDrawdown)}.</p>` : ""}
      <p class="muted">Hypothetical: $10,000 start, fills at EOD close, weights drift between rebalances. CASH assumes 0% yield. Not advice.</p>
    </div>`;

  const series = [{ label: strategy.name, color: "#2d4ef5", points: r.equity }];
  if (r.benchmark) series.push({ label: `${r.benchmarkSymbol} (B&H)`, color: "#141414", points: r.benchmark });
  renderChart($("bt-chart"), series, { log: true });

  lastBacktestSummary =
    `Backtest of "${strategy.name}" (${period}): CAGR ${fmtPct(s.cagr)}, total return ${fmtPct(s.totalReturn)}, ` +
    `max drawdown ${fmtPct(s.maxDrawdown)}, annualized vol ${fmtPct(s.volatility)}, ${r.rebalances} rebalances.` +
    (r.benchStats ? ` Benchmark ${r.benchmarkSymbol} buy&hold CAGR ${fmtPct(r.benchStats.cagr)}, max DD ${fmtPct(r.benchStats.maxDrawdown)}.` : "") +
    ` Strategy JSON: ${JSON.stringify(strategy)}.`;
}

// =================== FACTOR COMPOSER ===================
const composerEl = $("factor-composer");
const fcFactorsEl = $("fc-factors");
const fcExprEl = $("fc-expression");

$("bt-new-factor").addEventListener("click", () => {
  composerEl.classList.toggle("hidden");
  if (!composerEl.classList.contains("hidden") && !fcFactorsEl.children.length) addFactorCard();
});
$("fc-cancel").addEventListener("click", () => composerEl.classList.add("hidden"));
$("fc-add").addEventListener("click", addFactorCard);
$("fc-save").addEventListener("click", () => saveFactorStrategy(false));
$("fc-run").addEventListener("click", () => saveFactorStrategy(true));

function addFactorCard(preset) {
  const card = document.createElement("div");
  card.className = "factor-card";
  const f = preset || { factor: "momentum", weight: 0.5, direction: 1, params: { lookback_days: 252 } };
  const opts = AVAILABLE_FACTORS.map(
    (af) => `<option value="${af.id}" ${af.id === f.factor ? "selected" : ""}>${af.label}</option>`
  ).join("");
  card.innerHTML = `
    <div class="factor-card-head">
      <select class="fc-type">${opts}</select>
      <button class="fc-dir" data-dir="${f.direction}">${f.direction === -1 ? "−" : "+"}</button>
      <button class="fc-remove">×</button>
    </div>
    <div class="factor-card-body">
      <label>Wt</label>
      <input type="range" class="fc-weight-slider" min="1" max="100" value="${Math.round((f.weight || 0.5) * 100)}" />
      <span class="fc-weight-val">${(f.weight || 0.5).toFixed(2)}</span>
      <label>Days</label>
      <input type="number" class="fc-lookback" value="${f.params?.lookback_days || 252}" min="5" max="1260" />
    </div>
    <div class="fc-factor-desc">${AVAILABLE_FACTORS.find((af) => af.id === f.factor)?.desc || ""}</div>`;
  card.querySelector(".fc-dir").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const d = btn.dataset.dir === "1" ? -1 : 1;
    btn.dataset.dir = String(d);
    btn.textContent = d === -1 ? "−" : "+";
    updateExpression();
  });
  card.querySelector(".fc-remove").addEventListener("click", () => { card.remove(); updateExpression(); });
  card.querySelector(".fc-weight-slider").addEventListener("input", (e) => {
    card.querySelector(".fc-weight-val").textContent = (e.target.value / 100).toFixed(2);
    updateExpression();
  });
  card.querySelector(".fc-type").addEventListener("change", (e) => {
    const af = AVAILABLE_FACTORS.find((a) => a.id === e.target.value);
    card.querySelector(".fc-factor-desc").textContent = af?.desc || "";
    card.querySelector(".fc-lookback").value = af?.defaultLookback || 252;
    updateExpression();
  });
  card.querySelector(".fc-lookback").addEventListener("input", updateExpression);
  fcFactorsEl.appendChild(card);
  updateExpression();
}

function updateExpression() {
  const parts = [];
  for (const card of fcFactorsEl.children) {
    const factor = card.querySelector(".fc-type").value;
    const weight = (parseInt(card.querySelector(".fc-weight-slider").value, 10) / 100).toFixed(2);
    const dir = card.querySelector(".fc-dir").dataset.dir;
    const lookback = card.querySelector(".fc-lookback").value;
    const af = AVAILABLE_FACTORS.find((a) => a.id === factor);
    const sign = dir === "-1" ? " − " : (parts.length ? " + " : " ");
    parts.push(`${sign}${weight}·z(${af?.short || factor}${lookback})`);
  }
  fcExprEl.textContent = parts.length ? `y =${parts.join("")}` : "Add factors above";
}

function buildFactorStrategy() {
  const name = $("fc-name").value.trim() || `Factor Strategy ${Date.now() % 10000}`;
  const universe = $("fc-universe").value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const factors = [];
  for (const card of fcFactorsEl.children) {
    factors.push({
      factor: card.querySelector(".fc-type").value,
      weight: parseInt(card.querySelector(".fc-weight-slider").value, 10) / 100,
      direction: parseInt(card.querySelector(".fc-dir").dataset.dir, 10),
      params: { lookback_days: parseInt(card.querySelector(".fc-lookback").value, 10) || 252 },
    });
  }
  return {
    name,
    description: `Factor model: ${factors.map((f) => f.factor).join(", ")} over ${universe.join(", ")}.`,
    universe,
    safe_asset: $("fc-safe").value.trim().toUpperCase() || "CASH",
    rebalance: $("fc-rebalance").value,
    rule: { type: "factor_score", factors, combine: $("fc-combine").value },
  };
}

function saveFactorStrategy(run) {
  const strategy = buildFactorStrategy();
  const v = validateStrategy(strategy);
  if (!v.ok) { alert("Invalid: " + v.errors.join("; ")); return; }
  saveStrategy(strategy);
  composerEl.classList.add("hidden");
  rebuildStrategySelect(strategy.name);
  if (run) runCurrentBacktest();
}

// =================== MENTOR ===================
initMentor({
  getContext: () => lastBacktestSummary,
  onStrategy: (strategy, run) => {
    saveStrategy(strategy);
    showView("backtest");
    rebuildStrategySelect(strategy.name);
    if (run) runCurrentBacktest();
  },
});

// ---- start ----
initMarkets();
showView("markets");
