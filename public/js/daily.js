// daily.js — "Claude's Desk": read-only view of the discretionary paper account
// that the daily Claude Code routine commits to public/data/paper-run.json.
// Decisions are Claude's own judgment (non-reproducible); we render the committed
// artifact only and never fabricate numbers — same graceful-degradation discipline
// as the rest of the app.

import { fmtMoney, fmtPct, signClass } from "./data.js";
import { renderChart } from "./chart.js";

const $ = (id) => document.getElementById(id);

// Network-only via /api (the service worker passes /api/* straight through, so the
// ledger never goes stale). Falls back to the static file for local preview, where
// the Worker route doesn't exist.
async function fetchRun() {
  for (const url of ["/api/paper-run", "/data/paper-run.json"]) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      if (j && j.ok !== false) return j;
    } catch {}
  }
  return { ok: false };
}

export async function renderDaily() {
  const asof = $("daily-asof");
  const summary = $("daily-summary");
  const chart = $("daily-chart");
  const latest = $("daily-latest");
  const holdings = $("daily-holdings");
  const log = $("daily-log");

  summary.innerHTML = '<span class="spinner"></span>';
  asof.textContent = "";
  chart.innerHTML = "";
  latest.innerHTML = "";
  holdings.innerHTML = "";
  log.innerHTML = "";

  const run = await fetchRun();
  if (!run.ok) {
    summary.innerHTML = '<p class="muted" style="grid-column:1/-1">Daily run unavailable. Check back after the next scheduled run.</p>';
    return;
  }

  const startCash = run.start_cash || 10000;
  const days = run.days || [];
  if (!days.length) {
    summary.innerHTML =
      `<p class="muted" style="grid-column:1/-1">Awaiting Claude's first run. The account starts at ${fmtMoney(startCash)}; ` +
      `the daily routine will pick a strategy and begin trading at the next EOD close.</p>`;
    return;
  }

  const today = days[days.length - 1];
  const snap = today.snapshot || {};
  const value = snap.value;
  const totalReturn = value != null ? value / startCash - 1 : null;

  asof.textContent = run.as_of
    ? `As of ${run.as_of} · inception ${run.inception || "—"}`
    : "";

  summary.innerHTML = `
    <div class="big ${signClass(totalReturn)}">${fmtMoney(value)}</div>
    <div class="kv">Cash<b>${fmtMoney(snap.cash)}</b></div>
    <div class="kv">Total return<b class="${signClass(totalReturn)}">${fmtPct(totalReturn)}</b></div>
    <div class="kv">Start<b>${fmtMoney(startCash)}</b></div>
    <div class="kv">Strategy<b>${esc(today.strategy || "—")}</b></div>`;

  const points = (run.equity_curve || []).filter((p) => p && isFinite(p.v));
  if (points.length > 1) {
    renderChart(chart, [{ label: "Claude's account", color: "#1f3a5f", points }]);
  } else {
    chart.innerHTML = '<p class="muted">Equity curve will appear after a few runs.</p>';
  }

  latest.innerHTML =
    `<h2 class="section-h">${esc(today.date)} — today's decision</h2>` +
    renderTrades(today.trades) +
    (today.commentary ? `<p class="daily-commentary">${esc(today.commentary)}</p>` : "");

  holdings.innerHTML = renderHoldings(today);

  const ledgerRows = days
    .slice()
    .reverse()
    .map((d) => {
      const v = d.snapshot && d.snapshot.value;
      const ret = v != null ? v / startCash - 1 : null;
      const n = (d.trades || []).length;
      return (
        `<tr><td>${esc(d.date)}</td><td>${fmtMoney(v)}</td>` +
        `<td class="${signClass(ret)}">${fmtPct(ret)}</td><td>${n || "—"}</td></tr>`
      );
    })
    .join("");
  log.innerHTML =
    '<h2 class="section-h">Daily ledger</h2>' +
    `<table class="data"><thead><tr><th>Date</th><th>Value</th><th>Return</th><th>Trades</th></tr></thead>` +
    `<tbody>${ledgerRows}</tbody></table>`;
}

function renderTrades(trades) {
  if (!trades || !trades.length) return '<p class="muted">No trades today — held existing positions.</p>';
  const rows = trades
    .map(
      (t) =>
        `<tr><td class="${t.side === "sell" ? "neg" : "pos"}">${esc((t.side || "").toUpperCase())}</td>` +
        `<td>${esc(t.symbol)}</td><td>${fmtNum(t.shares)}</td><td>${fmtMoney(t.price)}</td></tr>`,
    )
    .join("");
  const reasons = trades
    .filter((t) => t.reason)
    .map((t) => `<p class="daily-reason"><b>${esc(t.symbol)}</b> ${esc(t.reason)}</p>`)
    .join("");
  return (
    `<table class="data"><thead><tr><th>Action</th><th>Symbol</th><th>Shares</th><th>Price</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>${reasons}`
  );
}

function renderHoldings(today) {
  const positions = (today.snapshot && today.snapshot.positions) || {};
  const markBy = {};
  for (const m of today.marks || []) markBy[m.symbol] = m.price;
  const syms = Object.keys(positions);
  if (!syms.length) return '<h2 class="section-h">Holdings</h2><p class="muted">All cash.</p>';
  const rows = syms
    .map((sym) => {
      const pos = positions[sym];
      const px = markBy[sym];
      const val = px != null ? pos.shares * px : null;
      const gainPct = px != null && pos.cost > 0 ? val / pos.cost - 1 : null;
      return (
        `<tr><td>${esc(sym)}</td><td>${fmtNum(pos.shares)}</td><td>${fmtMoney(px)}</td>` +
        `<td>${fmtMoney(val)}</td><td class="${signClass(gainPct)}">${fmtPct(gainPct)}</td></tr>`
      );
    })
    .join("");
  return (
    `<h2 class="section-h">Holdings</h2><table class="data"><thead><tr>` +
    `<th>Symbol</th><th>Shares</th><th>Price</th><th>Value</th><th>Gain</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

const fmtNum = (n) =>
  n == null || !isFinite(n) ? "—" : (+n).toLocaleString(undefined, { maximumFractionDigits: 4 });

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]),
  );
}
