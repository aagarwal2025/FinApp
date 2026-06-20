# FinApp — Claude Code Routing Table

**Milestone:** Claude's Desk (daily AI paper-trader) on D1 · **Last refreshed:** 2026-06-20 · **Commit:** `3d27341`

## Refresh protocol

When conversation message tokens reach ~120k, refresh this file before continuing work:
1. Read every source file listed below (targeted ranges, not full files).
2. Run `git log --oneline -5` and `git diff --stat HEAD` to capture current state.
3. Update the file map, line ranges, API contracts, and version/commit fields.
4. Bump the refresh date.

This is cheaper than re-reading the codebase from scratch in a new session.

---

## Architecture (3-sentence summary)

Phone-installable PWA on Cloudflare Workers (Static Assets model). One Worker (`src/index.js`) handles `/api/*`; everything else served static from `public/`. Vanilla ES modules, no build step, no npm — Cloudflare cloud-builds via `npx wrangler deploy`.

**Persistent state:** the paper portfolio + saved strategies live in browser `localStorage`; the **Claude's Desk** ledger lives in **Cloudflare D1** — the only server-side state (see the Claude's Desk section).

## File map

### Worker (server)

| File | Lines | What's there |
|---|---|---|
| `src/index.js` | 359 | **All server logic.** Router at L326-358. |
| `src/index.js:28-95` | | `fromYahoo()`, `fromStooq()`, `handlePrices()` — price fetching + edge cache |
| `src/index.js:98-139` | | `handleTickers()` — US ticker universe from GitHub, fallback list |
| `src/index.js:142-188` | | `computeMovers()`, `handleMovers()` — top 5 gainers/losers, 1hr cache |
| `src/index.js:191-308` | | `handleMentor()` — Claude Opus 4.8 chat/propose, SSE streaming, web search |
| `src/index.js:195-211` | | `SYSTEM` prompt — the mentor's persona + strategy shape |
| `src/index.js:310-324` | | `handlePaperRun()` — Claude's Desk ledger: reads D1 (`DESK_DB`), falls back to the seed file |
| `wrangler.toml` | 40 | `name="finapp"`, `[assets]`, `run_worker_first=["/api/*"]`, `[[d1_databases]]` `DESK_DB` |

### Client JS (all in `public/js/`)

| File | Lines | What's there |
|---|---|---|
| `app.js` | 433 | **Main wiring.** Tab nav (Markets/Portfolio/Backtest/Mentor/**Desk**), inits. `showView()` L21. |
| `app.js:34-53` | | `EXCHANGE_TICKERS` — BSE (20) and DFM (6) non-US ticker lists |
| `app.js:54-99` | | `initMarkets()`, `loadMovers()`, exchange tabs |
| `app.js:166-226` | | Portfolio rendering, sell handler, reset |
| `app.js:229-312` | | Backtest tab: strategy select, `runCurrentBacktest()` |
| `app.js:315-416` | | Factor Composer: `addFactorCard()`, `buildFactorStrategy()`, `saveFactorStrategy()` |
| `daily.js` | 164 | **Claude's Desk** read-only view. `renderDaily()` fetches `/api/paper-run`; renders summary, playbook, equity curve, holdings, Daily ledger table. |
| `strategy.js` | 223 | **Strategy contract.** `AVAILABLE_FACTORS`, `STRATEGY_SCHEMA`, `BUILTIN_STRATEGIES`, `validateStrategy()` |
| `backtest.js` | 361 | **Backtester.** Factor fns, `zScoreNormalize()`, `decide()`, `runBacktest()` |
| `data.js` | 104 | Price/ticker fetching, `searchTickers()`, `getMovers()`, `fmtMoney(n, currency)` |
| `mentor.js` | 186 | Mentor chat UI, SSE stream parser, strategy card renderer |
| `portfolio.js` | 97 | Paper account: `buy()`, `sell()`, `summarize()` — localStorage persistence |
| `credits.js` | 73 | Estimated Anthropic credit tracker (Opus 4.8 pricing) |
| `chart.js` | 91 | Dependency-free SVG line chart, log/linear, multi-series |

### HTML / CSS / Config

| File | Lines | What's there |
|---|---|---|
| `public/index.html` | 174 | Single-page shell: Markets → Portfolio → Backtest → Mentor → **Claude's Desk** (`#view-daily`, "Desk" tab). |
| `public/css/app.css` | 233 | Mobile-first Tufte-clean styles. Factor composer + Claude's Desk styles. |
| `public/sw.js` | 56 | Service worker: cache-first shell (`finapp-shell-v8`), network-only for `/api/*` |
| `public/data/paper-run.json` | | Seed Desk ledger (`days:[]`) — the Worker's fallback before D1 has a row. |
| `.claude/launch.json` | 11 | Local preview: `python -m http.server 8787 --directory public` |

### Claude's Desk — routine + D1

| File | Lines | What's there |
|---|---|---|
| `routines/daily-paper-trader.md` | 129 | Instructions the daily cloud routine follows: read ledger from D1, prices via WebSearch, discretionary trades, bookkeeping, maintain its `playbook`, write back to D1. Contains the user-owned **Mandate**. |

- **D1 database `finapp-desk`** (`database_id 580c8596-00bc-45a1-bf52-1187f91c1ec8`), table `ledger(id INTEGER PRIMARY KEY, doc TEXT, updated_at)` — the whole paper-run JSON blob lives in `doc` at `id=1`.

## API contracts

All endpoints return `{ok: false, reason}` on failure (graceful degradation).

```
GET  /api/prices/:symbol  → {ok, symbol, source, currency, bars: [{t, c}]}   Edge-cached 1 day. Yahoo → Stooq.
GET  /api/tickers          → {ok, source, count, tickers: [{symbol, name?}]}  Edge-cached 1 day.
GET  /api/movers           → {ok, gainers: [...], losers: [...]}              Edge-cached 1 hour.
GET  /api/paper-run        → {ok, as_of, inception, start_cash, account, equity_curve, days, playbook}
                             Claude's Desk ledger, read from D1 (no-store); falls back to the seed file.
POST /api/mentor           → SSE stream (chat) or {ok, strategy, usage} (propose)
     Headers: x-mentor-pin · Body: {mode, messages, context?, schema?}
     Model: claude-opus-4.8, web search enabled (max 3/turn), adaptive thinking.
```

## Strategy schema (the single contract)

```
{name, description?, universe: string[], safe_asset, rebalance: "monthly"|"weekly",
 rule: relative_momentum | sma_cross | buy_and_hold | factor_score}

rule types:
  relative_momentum: {lookback_days, if_all_negative: "safe_asset"|"best_anyway"}
  sma_cross:         {asset, sma_days}
  buy_and_hold:      {weights?: [{symbol, weight}]}
  factor_score:      {factors: [{factor, weight, direction(±1), params:{lookback_days}}],
                      combine: "rank_top1"|"score_weighted"}

factors: momentum, risk_adj_momentum, volatility, trend_sma, sma_cross,
         mean_reversion, max_drawdown, downside_dev, high_52w, autocorrelation
```

## Claude's Desk (the daily autonomous AI paper-trader)

The **Desk** tab shows a $10k simulated account that a scheduled **Claude Code routine** runs with full discretion — it picks the strategy and trades itself.

- **Routine** `trig_01QceuTTwJTCfsx7n7z6DJJ2`, cron `0 22 * * 1-5` UTC (weekdays after US close), model `claude-sonnet-4-6`. Manage at https://claude.ai/code/routines/trig_01QceuTTwJTCfsx7n7z6DJJ2
- **Why D1, not git:** the routine **cannot push to the repo** — the "Main" ruleset blocks its GitHub-App token (admin-role bypass does NOT apply to app tokens), and its cloud sandbox **blocks direct network egress** (Yahoo/Stooq/Worker URL all 403). So it writes the ledger to **D1 via the Cloudflare MCP connector** and sources prices via **WebSearch** (cross-verified). The Worker reads D1 for `/api/paper-run`; `daily.js` renders it.
- **Playbook:** the routine maintains a self-authored `playbook` field — its evolving trading philosophy — read at the start and revised before saving (cross-run memory, since each run starts cold). The user-owned **Mandate** lives in `routines/daily-paper-trader.md`.
- Full background + IDs in memory `claude-desk-d1`.

## Key grep targets

| What | Grep pattern | Primary file |
|---|---|---|
| Strategy validation | `validateStrategy` | `strategy.js` |
| Factor compute fns | `FACTOR_FNS` | `backtest.js:43` |
| Z-score normalization | `zScoreNormalize` | `backtest.js:135` |
| Backtest decision | `function decide` | `backtest.js:151` |
| Backtest entry | `runBacktest` | `backtest.js:270` |
| Price fetch (server) | `fromYahoo\|fromStooq` | `src/index.js:28` |
| Desk ledger endpoint | `handlePaperRun` | `src/index.js:314` |
| Desk render | `renderDaily` | `daily.js` |
| Mentor system prompt | `const SYSTEM` | `src/index.js:195` |
| Exchange tickers | `EXCHANGE_TICKERS` | `app.js:34` |
| Factor composer UI | `addFactorCard\|updateExpression` | `app.js` |
| Currency formatting | `fmtMoney` | `data.js:94` |
| Paper buy/sell | `export function buy\|sell` | `portfolio.js:30,47` |
| SW cache version | `const CACHE` | `sw.js:4` |

## Secrets (Cloudflare Worker encrypted)

- `ANTHROPIC_API_KEY` — prepaid Anthropic key (the mentor)
- `MENTOR_PIN` — passphrase gating `/api/mentor`
- Set via Dashboard → Worker → Settings → Variables and Secrets (as **Secret**, not Variable); **redeploy after changing a secret**.
- The D1 `DESK_DB` binding needs no secret (declared in `wrangler.toml`).

## Constraints

- **No local Node/npm** — Python 3.11, git, `gh` only. See memory `dev-toolchain`.
- **Non-US tickers (.BO, .AE)** — browse/chart ONLY. No portfolio/backtest until an FX layer exists.
- **No bulk data** — all prices fetched on-demand via Worker, edge-cached.
- **Claude's Desk ledger lives in D1, not git** (the routine can't push — see above). The Worker reads D1, falling back to the seed `public/data/paper-run.json`.
- **Deploying `main` is gated by the repo ruleset** (`update`/`deletion`/`non_fast_forward`, all branches). Push as admin `aagarwal2025` to bypass; from an automated shell use the gh-token header workaround (see memory `claude-desk-d1`).
- **Deploy** — `git push` to `main` triggers Cloudflare cloud build (`npx wrangler deploy`).
- **Local preview** — `python -m http.server 8787 --directory public` (no `/api/*` routes; the Desk tab falls back to `/data/paper-run.json`).

## Repo / deploy

- GitHub: `aagarwal2025/FinApp`, branch `main`
- Cloudflare Worker: `finapp` · D1: `finapp-desk`
- SW cache key: `finapp-shell-v8` — bump on any static file change
