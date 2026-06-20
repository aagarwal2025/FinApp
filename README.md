# FinApp

A phone-installable PWA for learning quant trading: search tickers, view price history, **backtest** rule-based strategies, run a **paper portfolio**, chat with an AI **mentor** (Claude Opus 4.8) that explains concepts and emits runnable strategies, and follow **Claude's Desk** — a daily, fully autonomous AI paper-trader.

Built as a sibling to [Fin](../Fin) — same disciplines (config-as-data, graceful degradation, honest labeling), evolved into an interactive app. **No bulk data storage**: all market data is pulled programmatically, on demand.

## Architecture ($0 except API credits)

Deployed on **Cloudflare Workers** using the Static Assets model (Pages is in maintenance mode; Workers is the recommended path for new projects).

```
Private repo aagarwal2025/FinApp ── auto-deploy ──▶ Cloudflare Worker "finapp" (free, HTTPS)
  public/         static PWA (installable on Android, offline shell) — served as static assets
  src/index.js    the Worker — runs only for /api/* (run_worker_first):
                    GET  /api/prices/:symbol  Yahoo chart API → Stooq fallback, edge-cached ~24h
                    GET  /api/tickers         rreichel3/US-Stock-Symbols universe, edge-cached
                    GET  /api/movers          top gainers/losers over a popular-stock watchlist
                    GET  /api/paper-run       Claude's Desk ledger, read from Cloudflare D1
                    POST /api/mentor          Claude Opus 4.8 (chat stream + structured strategy JSON)
  client state    paper portfolio + saved strategies in localStorage
  D1 (finapp-desk) Claude's Desk ledger, written daily by a scheduled Claude routine
```

No bundler, no framework — vanilla ES modules + a single Worker entry. `wrangler` (run by Cloudflare's cloud build) uploads `public/` and deploys the Worker in one step, so **no local Node toolchain is required to deploy**.

## Deploy (one-time)

1. **Push this repo** to `github.com/aagarwal2025/FinApp` (private).
2. Cloudflare dashboard → Workers & Pages → **Import a repository** → pick the repo. It creates a Worker (named **`finapp`** — must match `name` in `wrangler.toml`).
   - **Deploy command:** `npx wrangler deploy` (the default — leave it).
   - Build command: *(none needed)*. The `wrangler.toml` declares `[assets] directory = "./public"` and `run_worker_first = ["/api/*"]`, so `wrangler deploy` uploads the static site and deploys the Worker together.
3. After the first deploy, set two **secrets** (the Worker → Settings → Variables and Secrets → add as *Secret*, then redeploy):
   - `ANTHROPIC_API_KEY` — your prepaid Anthropic key ([console.anthropic.com](https://console.anthropic.com), Billing → buy credits)
   - `MENTOR_PIN` — any passphrase; you'll enter it once in the app to unlock the mentor
4. Open the deployed `*.workers.dev` URL on your Android phone → browser menu → **Add to Home Screen**.

## Local dev (optional, needs Node + wrangler)

```bash
npm install -g wrangler
cp .dev.vars.example .dev.vars   # fill in ANTHROPIC_API_KEY + MENTOR_PIN
wrangler dev                     # serves public/ + src/index.js locally
```

Without Node, just push and use Cloudflare's automatic **preview deployments** as the test loop.

## Strategy model

A strategy is the JSON contract in [`public/js/strategy.js`](public/js/strategy.js) — the backtester executes it and the mentor is constrained (via Claude structured outputs) to emit exactly it. Rule types in v1:

- `relative_momentum` — Antonacci dual momentum (the Fin signal: hold the higher-trailing-return asset; rotate to a safe asset if negative)
- `sma_cross` — hold while above an N-day moving average, else the safe asset
- `buy_and_hold` — static weights, rebalanced
- `factor_score` — weighted blend of price factors (z-scored cross-sectionally), allocating top-1 or score-weighted (built in the **Factor Composer** on the Backtest tab)

## Claude's Desk — the daily AI paper-trader

A tab where Claude runs its **own** simulated account with full discretion. A scheduled Claude Code routine (weekdays after the US close) picks a strategy, decides trades, marks to the latest EOD close, and saves a JSON ledger — including a self-authored, evolving **playbook** it keeps for its future runs.

Because the repo is ruleset-locked and the routine's cloud sandbox blocks direct network egress, the ledger is **not** committed to git: the routine writes it to **Cloudflare D1** (`finapp-desk`, table `ledger`) via the Cloudflare MCP connector, and the Worker serves it at `/api/paper-run` (falling back to the committed seed `public/data/paper-run.json` before the first run). Prices come from cross-verified web search. Fully simulated, non-reproducible by design, not advice.

## Costs

Everything is free except Anthropic API usage: prepaid, ~$5 minimum, roughly 3–4¢ per Opus 4.8 mentor turn. Data endpoints and hosting are keyless/free.

The Mentor tab shows an **estimated** remaining balance: it prices the exact token `usage` returned by each call at Opus 4.8 rates and subtracts from a baseline you enter. There is no Anthropic API for the real dollar balance — that lives at console.anthropic.com → Billing. Tap **Set balance** to re-sync the estimate to the Console's real number anytime.

## Disclaimer

Educational tool. Hypothetical backtests assume frictionless EOD-close fills and are not predictive. Not financial advice.
