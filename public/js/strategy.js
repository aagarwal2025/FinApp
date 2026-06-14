// strategy.js — the single source of truth for what a "strategy" is.
// The backtester (backtest.js) executes objects of this shape, and the mentor
// (mentor.js → /api/mentor) is constrained to emit exactly this shape via the
// Claude structured-output schema below. Keep STRATEGY_SCHEMA and the executor
// in lockstep.

export const AVAILABLE_FACTORS = [
  { id: "momentum", label: "Momentum", short: "mom", desc: "Trailing return", defaultLookback: 252 },
  { id: "risk_adj_momentum", label: "Risk-adj Mom", short: "riskMom", desc: "Return / volatility", defaultLookback: 252 },
  { id: "volatility", label: "Volatility", short: "vol", desc: "Annualized std dev", defaultLookback: 63 },
  { id: "trend_sma", label: "Trend (SMA)", short: "trend", desc: "Distance from moving avg", defaultLookback: 200 },
  { id: "sma_cross", label: "SMA Cross", short: "smaCross", desc: "Above/below moving avg", defaultLookback: 200 },
  { id: "mean_reversion", label: "Mean Reversion", short: "meanRev", desc: "Buy-low z-score", defaultLookback: 63 },
  { id: "max_drawdown", label: "Max Drawdown", short: "maxDD", desc: "Trailing peak-to-trough", defaultLookback: 252 },
  { id: "downside_dev", label: "Downside Dev", short: "downDev", desc: "Downside-only volatility", defaultLookback: 63 },
  { id: "high_52w", label: "52W High", short: "52wH", desc: "Proximity to 52-week high", defaultLookback: 252 },
  { id: "autocorrelation", label: "Autocorrelation", short: "autoCorr", desc: "Return serial correlation", defaultLookback: 63 },
];

const FACTOR_IDS = AVAILABLE_FACTORS.map((f) => f.id);

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
        {
          type: "object",
          additionalProperties: false,
          description: "Factor model: score each universe asset by a weighted combination of z-score-normalized price factors. rank_top1 holds the highest-scoring asset; score_weighted allocates proportionally to positive scores. Falls to safe_asset when all scores are negative. Supported factors: momentum, risk_adj_momentum, volatility, trend_sma, sma_cross, mean_reversion, max_drawdown, downside_dev, high_52w, autocorrelation.",
          properties: {
            type: { type: "string", enum: ["factor_score"] },
            factors: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  factor: {
                    type: "string",
                    enum: FACTOR_IDS,
                    description: "Which price-based factor to compute",
                  },
                  weight: { type: "number", description: "Relative weight, positive" },
                  direction: { type: "integer", description: "+1 = higher is better, -1 = lower is better" },
                  params: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      lookback_days: { type: "integer", description: "Lookback window in calendar days" },
                    },
                    required: ["lookback_days"],
                  },
                },
                required: ["factor", "weight", "direction", "params"],
              },
            },
            combine: {
              type: "string",
              enum: ["rank_top1", "score_weighted"],
              description: "rank_top1 = hold the single highest-scoring asset; score_weighted = allocate proportionally to positive-scoring assets",
            },
          },
          required: ["type", "factors", "combine"],
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
  {
    name: "Quality Momentum",
    description:
      "Factor model: rank VTI, VXUS, SPY, QQQ, GLD by a blend of 12-month momentum, low volatility, and proximity to 52-week highs. Hold the top-scoring asset; rotate to VGIT when all scores are negative.",
    universe: ["VTI", "VXUS", "SPY", "QQQ", "GLD"],
    safe_asset: "VGIT",
    rebalance: "monthly",
    rule: {
      type: "factor_score",
      factors: [
        { factor: "momentum", weight: 0.5, direction: 1, params: { lookback_days: 252 } },
        { factor: "volatility", weight: 0.3, direction: -1, params: { lookback_days: 63 } },
        { factor: "high_52w", weight: 0.2, direction: 1, params: { lookback_days: 252 } },
      ],
      combine: "rank_top1",
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
  if (!["relative_momentum", "sma_cross", "buy_and_hold", "factor_score"].includes(t)) {
    errs.push(`unknown rule.type: ${t}`);
  }
  if (t === "relative_momentum" && !(s.rule.lookback_days > 0)) errs.push("lookback_days must be > 0");
  if (t === "sma_cross" && (!s.rule.asset || !(s.rule.sma_days > 0))) errs.push("sma_cross needs asset and sma_days");
  if (t === "factor_score") {
    if (!Array.isArray(s.rule.factors) || s.rule.factors.length === 0) errs.push("factor_score needs at least one factor");
    else for (const f of s.rule.factors) {
      if (!FACTOR_IDS.includes(f.factor)) errs.push(`unknown factor: ${f.factor}`);
      if (!(f.weight > 0)) errs.push(`factor ${f.factor}: weight must be > 0`);
      if (f.direction !== 1 && f.direction !== -1) errs.push(`factor ${f.factor}: direction must be +1 or -1`);
      if (!(f.params?.lookback_days > 0)) errs.push(`factor ${f.factor}: lookback_days must be > 0`);
    }
    if (!["rank_top1", "score_weighted"].includes(s.rule.combine)) errs.push("combine must be rank_top1 or score_weighted");
  }
  return { ok: errs.length === 0, errors: errs };
}
