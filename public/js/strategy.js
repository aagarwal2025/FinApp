// strategy.js — the single source of truth for what a "strategy" is.
// The backtester (backtest.js) executes objects of this shape, and the mentor
// (mentor.js → /api/mentor) is constrained to emit exactly this shape via the
// Claude structured-output schema below. Keep STRATEGY_SCHEMA and the executor
// in lockstep.

// JSON Schema for Claude `output_config.format` (structured outputs).
// Constraints honored: additionalProperties:false on every object; no numeric
// min/max or string length (unsupported); discriminated union via anyOf + const.
export const STRATEGY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", description: "Short human-readable strategy name" },
    description: {
      type: "string",
      description: "1-2 sentence plain-English summary of the rule and its intent",
    },
    universe: {
      type: "array",
      items: { type: "string" },
      description: "Tradable tickers the rule chooses among, e.g. ['VTI','VXUS']",
    },
    safe_asset: {
      type: "string",
      description: "Ticker to rotate into defensively, or 'CASH' for no position",
    },
    rebalance: { type: "string", enum: ["monthly", "weekly"] },
    rule: {
      description: "The decision rule. Exactly one of the supported types.",
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          description: "Antonacci dual momentum: hold the universe asset with the highest trailing return; if the winner's return is negative, rotate to safe_asset.",
          properties: {
            type: { type: "string", enum: ["relative_momentum"] },
            lookback_days: { type: "integer", description: "Trailing window, e.g. 365" },
            if_all_negative: { type: "string", enum: ["safe_asset", "best_anyway"] },
          },
          required: ["type", "lookback_days", "if_all_negative"],
        },
        {
          type: "object",
          additionalProperties: false,
          description: "Trend filter: hold `asset` while its price is above its N-day simple moving average, else hold safe_asset.",
          properties: {
            type: { type: "string", enum: ["sma_cross"] },
            asset: { type: "string" },
            sma_days: { type: "integer", description: "SMA window, e.g. 200" },
          },
          required: ["type", "asset", "sma_days"],
        },
        {
          type: "object",
          additionalProperties: false,
          description: "Static allocation rebalanced to fixed weights. Omit weights to equal-weight the universe.",
          properties: {
            type: { type: "string", enum: ["buy_and_hold"] },
            weights: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  symbol: { type: "string" },
                  weight: { type: "number", description: "Fraction 0..1; weights should sum to 1" },
                },
                required: ["symbol", "weight"],
              },
            },
          },
          required: ["type"],
        },
      ],
    },
  },
  required: ["name", "universe", "safe_asset", "rebalance", "rule"],
};

// Built-in strategies — the first ports the Fin dual-momentum signal exactly.
export const BUILTIN_STRATEGIES = [
  {
    name: "Dual Momentum (VTI / VXUS / VGIT)",
    description:
      "Antonacci dual momentum from the Fin project: hold whichever of US (VTI) or ex-US (VXUS) equity has the higher 12-month return; if the winner is negative, rotate to intermediate treasuries (VGIT).",
    universe: ["VTI", "VXUS"],
    safe_asset: "VGIT",
    rebalance: "monthly",
    rule: { type: "relative_momentum", lookback_days: 365, if_all_negative: "safe_asset" },
  },
  {
    name: "SPY 200-day Trend",
    description:
      "Classic trend filter: hold the S&P 500 (SPY) while it is above its 200-day moving average, otherwise sit in short T-bills (BIL).",
    universe: ["SPY"],
    safe_asset: "BIL",
    rebalance: "weekly",
    rule: { type: "sma_cross", asset: "SPY", sma_days: 200 },
  },
  {
    name: "60/40 Buy & Hold",
    description: "Static 60% US equity (VTI) / 40% intermediate treasuries (VGIT), rebalanced monthly. A passive benchmark.",
    universe: ["VTI", "VGIT"],
    safe_asset: "CASH",
    rebalance: "monthly",
    rule: {
      type: "buy_and_hold",
      weights: [
        { symbol: "VTI", weight: 0.6 },
        { symbol: "VGIT", weight: 0.4 },
      ],
    },
  },
];

// Every ticker a strategy could trade — used to know which price series to load.
export function symbolsOf(s) {
  const set = new Set();
  (s.universe || []).forEach((x) => set.add(x));
  if (s.safe_asset && s.safe_asset !== "CASH") set.add(s.safe_asset);
  if (s.rule?.asset) set.add(s.rule.asset);
  (s.rule?.weights || []).forEach((w) => set.add(w.symbol));
  return [...set];
}

// Light structural validation (the schema enforces shape server-side; this
// catches hand-edited / malformed strategies before a backtest run).
export function validateStrategy(s) {
  const errs = [];
  if (!s || typeof s !== "object") return { ok: false, errors: ["not an object"] };
  if (!s.name) errs.push("missing name");
  if (!Array.isArray(s.universe) || s.universe.length === 0) errs.push("universe must be a non-empty array");
  if (!s.safe_asset) errs.push("missing safe_asset");
  const t = s.rule?.type;
  if (!["relative_momentum", "sma_cross", "buy_and_hold"].includes(t)) {
    errs.push(`unknown rule.type: ${t}`);
  }
  if (t === "relative_momentum" && !(s.rule.lookback_days > 0)) errs.push("lookback_days must be > 0");
  if (t === "sma_cross" && (!s.rule.asset || !(s.rule.sma_days > 0))) errs.push("sma_cross needs asset and sma_days");
  return { ok: errs.length === 0, errors: errs };
}
