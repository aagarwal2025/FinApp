// credits.js — ESTIMATED Anthropic credit tracking.
//
// The Anthropic API exposes no endpoint for your remaining dollar balance — the
// real number lives at console.anthropic.com → Billing. So we estimate: every
// mentor call returns exact token `usage`; we price it at Opus 4.8 rates,
// accumulate the spend, and subtract from a baseline you enter. Always labeled
// "est." Honest-labeling discipline carried over from Fin — never a fake exact.

const KEY = "finapp.credits.v1";

// Opus 4.8 pricing, $ per 1M tokens (input $5 / output $25; cache write 1.25x,
// cache read 0.1x). Keep in sync with console.anthropic.com pricing.
const PRICE = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s.baseline === "number") return s;
  } catch {}
  return { baseline: 8, spent: 0, at: Date.now() }; // user said $8 to start
}
const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));

// Dollar cost of one Anthropic `usage` object.
export function costOf(u) {
  if (!u) return 0;
  return (
    (u.input_tokens || 0) * PRICE.input +
    (u.output_tokens || 0) * PRICE.output +
    (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite +
    (u.cache_read_input_tokens || 0) * PRICE.cacheRead
  ) / 1e6;
}

export function addUsage(u) {
  const s = load();
  s.spent += costOf(u);
  save(s);
  return s.spent;
}

// Re-baseline to the real balance you read off the Console (resets the estimate).
export function setBaseline(x) {
  save({ baseline: x, spent: 0, at: Date.now() });
}

export function state() {
  const s = load();
  return { ...s, remaining: Math.max(0, s.baseline - s.spent) };
}

export function render(el) {
  if (!el) return;
  const s = state();
  const low = s.remaining < s.baseline * 0.15;
  el.innerHTML =
    `<span>Claude credits ≈ <b class="${low ? "neg" : ""}">$${s.remaining.toFixed(2)}</b> left ` +
    `<span class="muted">of $${s.baseline.toFixed(2)} · est. from usage · ≈$${s.spent.toFixed(2)} spent</span></span>` +
    `<button id="credits-set" class="btn btn-quiet">Set balance</button>`;
  el.querySelector("#credits-set").addEventListener("click", () => {
    const v = prompt(
      "Enter your CURRENT Anthropic credit balance (from console.anthropic.com → Billing).\nThis re-baselines the estimate to $0 spent.",
      s.baseline.toFixed(2),
    );
    if (v == null) return;
    const n = parseFloat(v);
    if (isFinite(n) && n >= 0) { setBaseline(n); render(el); }
  });
}
