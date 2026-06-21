// chart.js — dependency-free SVG line chart. Tufte-clean: thin lines, muted
// labels, no heavy gridlines, the latest value called out. Handles one series
// (price) or several (equity curve vs benchmark), linear or log scale.

const NS = "http://www.w3.org/2000/svg";
const W = 340, H = 168, PADL = 4, PADR = 46, PADT = 10, PADB = 18;

function el(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function downsample(points, max = 700) {
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / max);
  const out = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

const fmtDate = (t) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric" });
function fmtVal(v) {
  if (v >= 1000) return "$" + Math.round(v).toLocaleString("en-US");
  return "$" + v.toFixed(2);
}

// series: [{ label, color, points: [{t, v}] }]
export function renderChart(host, series, opts = {}) {
  host.innerHTML = "";
  const clean = series
    .map((s) => ({ ...s, points: downsample((s.points || []).filter((p) => p.v != null && isFinite(p.v))) }))
    .filter((s) => s.points.length > 1);
  if (!clean.length) {
    host.innerHTML = '<p class="muted">No data to chart.</p>';
    return;
  }

  const log = !!opts.log;
  const tx = (v) => (log ? Math.log(v) : v);
  let tMin = Infinity, tMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const s of clean)
    for (const p of s.points) {
      tMin = Math.min(tMin, p.t); tMax = Math.max(tMax, p.t);
      vMin = Math.min(vMin, p.v); vMax = Math.max(vMax, p.v);
    }
  const yLo = tx(vMin), yHi = tx(vMax), ySpan = yHi - yLo || 1, tSpan = tMax - tMin || 1;
  const X = (t) => PADL + ((t - tMin) / tSpan) * (W - PADL - PADR);
  const Y = (v) => PADT + (1 - (tx(v) - yLo) / ySpan) * (H - PADT - PADB);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img",
    style: "display:block;font-family:inherit" });

  // baseline + top reference (light)
  for (const v of [vMin, vMax]) {
    svg.appendChild(el("line", { x1: PADL, y1: Y(v), x2: W - PADR, y2: Y(v),
      stroke: "#242424", "stroke-width": 1 }));
    svg.appendChild(el("text", { x: W - PADR + 4, y: Y(v) + 3, fill: "#7d7d7d", "font-size": 10, "font-family": "'Space Mono', ui-monospace, monospace" })).textContent = fmtVal(v);
  }

  clean.forEach((s, idx) => {
    const color = s.color || (idx === 0 ? "#ff2d2d" : "#6a6a6a");
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");
    svg.appendChild(el("path", { d, fill: "none", stroke: color, "stroke-width": 1.6,
      "stroke-linejoin": "round" }));
    const last = s.points[s.points.length - 1];
    svg.appendChild(el("circle", { cx: X(last.t), cy: Y(last.v), r: 2.5, fill: color }));
  });

  // x labels: first & last date
  svg.appendChild(el("text", { x: PADL, y: H - 4, fill: "#7d7d7d", "font-size": 10, "font-family": "'Space Mono', ui-monospace, monospace" })).textContent = fmtDate(tMin);
  const xr = el("text", { x: W - PADR, y: H - 4, fill: "#7d7d7d", "font-size": 10, "text-anchor": "end", "font-family": "'Space Mono', ui-monospace, monospace" });
  xr.textContent = fmtDate(tMax);
  svg.appendChild(xr);

  host.appendChild(svg);

  // legend (only when >1 series)
  if (clean.length > 1) {
    const leg = document.createElement("div");
    leg.style.cssText = "display:flex;gap:14px;flex-wrap:wrap;font-size:12px;margin-top:6px";
    clean.forEach((s, idx) => {
      const color = s.color || (idx === 0 ? "#ff2d2d" : "#6a6a6a");
      const item = document.createElement("span");
      item.innerHTML = `<span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:2px;margin-right:5px;vertical-align:middle"></span>${s.label || ""}`;
      leg.appendChild(item);
    });
    host.appendChild(leg);
  }
}
