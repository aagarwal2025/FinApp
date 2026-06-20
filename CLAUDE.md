# FinApp — Claude Code Routing Table

**Version:** v5b · **Last refreshed:** 2026-06-14 · **Commit:** `86ce857`

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

## File map

### Worker (server)

| File | Lines | What's there |
|---|---|---|
| `src/index.js` | 334 | **All server logic.** Router at L311-333. |
| `src/index.js:28-95` | | `fromYahoo()`, `fromStooq()`, `handlePrices()` — price fetching + edge cache |
| `src/index.js:98-139` | | `handleTickers()` — US ticker universe from GitHub, fallback list at L99-110 |
| `src/index.js:142-188` | | `computeMovers()`, `handleMovers()` — top 5 gainers/losers, 1hr cache |
| `src/index.js:191-308` | | `handleMentor()` — Claude Opus 4.8 chat/propose, SSE streaming, web search |
| `src/index.js:195-211` | | `SYSTEM` prompt — the mentor's persona + strategy shape description |
| `wrangler.toml` | 31 | Worker config: `name="finapp"`, `[assets]`, `run_worker_first=["/api/*"]` |

### Client JS (all in `public/js/`)

| File | Lines | What's there |
|---|---|---|
| `app.js` | 431 | **Main wiring.** Tab nav, Markets, Portfolio, Backtest, Factor Composer, Mentor init. |
| `app.js:34-53` | | `EXCHANGE_TICKERS` — BSE (20) and DFM (6) non-US ticker lists |
| `app.js:54-99` | | `initMarkets()`, `loadMovers()`, `renderExchangeList()`, exchange tab handlers |
| `app.js:118-153` | | `openTicker()` — detail view, non-USD buy hiding (L141-144) |
| `app.js:166-226` | | Portfolio rendering, sell handler, reset |
| `app.js:229-312` | | Backtest tab: strategy select, JSON preview, `runCurrentBacktest()` |
| `app.js:315-416` | | Factor Composer: `addFactorCard()`, `updateExpression()`, `buildFactorStrategy()`, `saveFactorStrategy()` |
| `strategy.js` | 224 | **Strategy contract.** `AVAILABLE_FACTORS` (L7-18), `STRATEGY_SCHEMA` (L25-133), `BUILTIN_STRATEGIES` (L136-186), `validateStrategy()` (L200-223) |
| `backtest.js` | 362 | **Backtester.** Factor functions (L43-133), `zScoreNormalize()` (L135-148), `decide()` (L151-234), `runBacktest()` (L270-351) |
| `data.js` | 105 | Price/ticker fetching, `searchTickers()`, bar helpers, `getMovers()`, `fmtMoney(n, currency)` |
| `mentor.js` | 187 | Mentor chat UI, SSE stream parser, strategy card renderer |
| `portfolio.js` | 98 | Paper account: `buy()`, `sell()`, `summarize()` — localStorage persistence |
| `credits.js` | 74 | Estimated Anthropic credit tracker (Opus 4.8 pricing) |
| `chart.js` | 92 | Dependency-free SVG line chart, log/linear, multi-series |

### HTML / CSS / Config

| File | Lines | What's there |
|---|---|---|
| `public/index.html` | 160 | Single-page shell: Markets (search hero, movers, exchange tabs, detail) → Portfolio → Backtest (strategy select, factor composer) → Mentor |
| `public/css/app.css` | 208 | Mobile-first Tufte-clean styles. Factor composer styles at L163-191. |
| `public/sw.js` | 56 | Service worker: cache-first shell (`finapp-shell-v5`), network-only for `/api/*` |
| `.claude/launch.json` | 11 | Local preview: `python -m http.server 8787 --directory public` |

## API contracts

All endpoints return `{ok: false, reason}` on failure (graceful degradation).

```
GET  /api/prices/:symbol  → {ok, symbol, source, currency, bars: [{t, c}]}
                            Edge-cached 1 day. Sources: Yahoo → Stooq fallback.

GET  /api/tickers          → {ok, source, count, tickers: [{symbol, name?}]}
                            Edge-cached 1 day. ~10k US tickers or 30-item fallback.

GET  /api/movers           → {ok, gainers: [{symbol, price, changePct}], losers: [...]}
                            Edge-cached 1 hour. Top 5 each from 16 popular US stocks.

POST /api/mentor           → SSE stream (chat) or {ok, strategy, usage} (propose)
     Headers: x-mentor-pin
     Body: {mode: "chat"|"propose", messages: [{role, content}],
            context?: string, schema?: object}
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

## Key grep targets

| What | Grep pattern | Primary file |
|---|---|---|
| Strategy validation | `validateStrategy` | `strategy.js:200` |
| Factor compute fns | `FACTOR_FNS` | `backtest.js:43` |
| Z-score normalization | `zScoreNormalize` | `backtest.js:135` |
| Backtest decision | `function decide` | `backtest.js:151` |
| Backtest entry | `runBacktest` | `backtest.js:270` |
| Price fetch (server) | `fromYahoo\|fromStooq` | `src/index.js:28` |
| Mentor system prompt | `const SYSTEM` | `src/index.js:195` |
| Exchange tickers | `EXCHANGE_TICKERS` | `app.js:34` |
| Factor composer UI | `addFactorCard\|updateExpression` | `app.js:328` |
| Currency formatting | `fmtMoney` | `data.js:94` |
| Paper buy/sell | `export function buy\|sell` | `portfolio.js:30,47` |
| Credits pricing | `const PRICE` | `credits.js:14` |
| SW cache version | `const CACHE` | `sw.js:4` |

## Secrets (Cloudflare Worker encrypted)

- `ANTHROPIC_API_KEY` — prepaid Anthropic key
- `MENTOR_PIN` — passphrase gating `/api/mentor`
- Set via Dashboard → Worker → Settings → Variables and Secrets (as **Secret**, not Variable)
- **Must redeploy after adding/changing a secret**

## Constraints

- **No local Node/npm** — Python 3.11, git, `gh` only. See memory `dev-toolchain`.
- **Non-US tickers (.BO, .AE)** — browse/chart ONLY. No portfolio/backtest until FX layer exists.
- **No bulk data** — all prices fetched on-demand via Worker, edge-cached.
- **Deploy** — `git push` triggers Cloudflare cloud build (`npx wrangler deploy`).
- **Local preview** — `python -m http.server 8787 --directory public` (no `/api/*` routes).

## Repo / deploy

- GitHub: `aagarwal2025/FinApp`, branch `main`
- Cloudflare Worker: `finapp`
- SW cache key: `finapp-shell-v5` — bump on any static file change
