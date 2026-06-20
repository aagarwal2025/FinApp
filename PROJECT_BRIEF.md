# FinApp — Knowledge Handoff & Project Brief

> **Purpose of this document.** A self-contained knowledge handoff:
> 1. **Part 1** — durable knowledge from the **Fin** weekly-report project (the sibling).
> 2. **Part 2** — the *original* forward-looking brief for **FinApp** (pre-build; the actual build
>    diverged — see Parts 3–4 for what shipped).
> 3. **Part 3** — the v1→V5 build handoff + operational lessons (Markets / Portfolio / Backtest / Mentor).
> 4. **Part 4** — **Claude's Desk** retro: the daily autonomous AI paper-trader on Cloudflare D1.
>
> Written as a self-contained handoff for an **Opus 4.8 High** reviewer agent. It
> assumes no access to the original chat. Audience: the user (an aspiring quant,
> strong Python) and the reviewing agent.

---

# Part 1 — Knowledge Extracted from the Fin Project

## 1.1 What Fin is

`Fin` (`C:\Users\akula\Desktop\Akul\Fin`, GitHub `aagarwal2025/Fin`, private) is an
automated **weekly portfolio-signal report**. Every Sunday a GitHub Action:

1. Pulls **live** holdings/balances/activity from the user's Vanguard accounts via
   the **SnapTrade** API.
2. Pulls **live** prices + trailing returns (1M/3M/12M) from **Yahoo Finance**
   (`yfinance`).
3. Computes an **Antonacci dual-momentum** signal (VTI vs VXUS on 12-mo total
   return; rotate the sleeve to VGIT if the winner's momentum is negative).
4. Measures **allocation drift** vs. a target 65%-safe / 35%-growth structure.
5. Renders a **mobile/email-friendly HTML report** and emails it via Gmail SMTP.

Single file does the work: `generate_report.py`. Orchestration:
`.github/workflows/weekly-report.yml` (cron `0 22 * * 0`). One-time brokerage
auth helper: `snaptrade_setup.py`.

## 1.2 The investment strategy (domain context)

- **Philosophy: capital preservation first.** Thesis: a 2008-style ~37% equity
  drawdown is plausible given S&P 500 mega-cap concentration. Target: preserve
  ~92–95% of capital in a crash, accepting lower upside.
- **Target allocation** (`BUCKETS` in `generate_report.py`, applied to live total):
  | Bucket | Target % | Product | Role |
  |---|---|---|---|
  | Cash Plus (FDIC) | 43.7% | Vanguard Cash Plus (~3.35% APY) | Non-negotiable floor |
  | Short Treasury | 9.7% | VGSH | Near-cash stability |
  | Intermediate Treasury | 9.7% | VGIT | "Crash weapon" (rallies on flight-to-safety) |
  | Dual-Momentum sleeve | 24.3% | VXUS↔VTI↔VGIT | Trend-following equity |
  | Ex-US ESG tilt | 12.6% | VSGX | Buy-and-hold conviction |
- **Dual momentum rules** (execute 1st of month): compare 12-mo total return of
  VTI vs VXUS; hold the winner if its return > 0; if both negative, rotate the
  sleeve to VGIT. `CURRENT_DM_SLEEVE` in CONFIG must be updated after a rotation.
- Source: Gary Antonacci, *Dual Momentum Investing*. Minimal turnover (~2–3
  trades/yr). The momentum filter is the crash-insurance mechanism.

## 1.3 Architecture & the patterns worth reusing

**The core pattern (highly reusable for FinApp):**
> A scheduled GitHub Action pulls live data, renders a *static artifact*, and
> delivers it — with **zero server cost** and a hard **"the deliverable always
> ships"** guarantee.

- **Data models** are plain `@dataclass`es: `Holding`, `Txn`, `Quote`, `Signal`,
  `BucketRow`, `ConnectionHealth`, `BenchmarkResult`.
- **Graceful degradation is a first-class design principle.** Every external
  dependency can fail without aborting the run:
  - `fetch_quotes()` retries w/ backoff, returns not-ok `Quote`s rather than raising.
  - `fetch_snaptrade_data()` **never raises**; returns `([], [], ConnectionHealth)`
    with a state of `OK | DISABLED | UNAVAILABLE | NOT_CONFIGURED` and a
    ready-to-render explanation sentence.
  - The report renders "data unavailable this run" placeholders instead of fake
    `$0` / `-100pp` values. **The email always sends.**
- **Config-as-data:** all strategy knobs live in a CONFIG block at the top, not
  scattered through logic.

## 1.4 The SnapTrade migration (what changed and why)

Originally holdings came from a manually-refreshed, **AES-256-GCM-encrypted CSV**
(`secure_csv.py` + a `CSV_KEY` secret). That was fully **retired** in favor of a
live brokerage API:

- **Why not Truthifi:** its tools only exist inside an authenticated MCP session —
  no scriptable API key, so it can't run unattended in CI.
- **SnapTrade** provides partner creds (`clientId`/`consumerKey`) + per-user creds
  (`userId`/`userSecret`); Python SDK `snaptrade-python-sdk` (imports as
  `snaptrade_client`). Verified-live response shapes: positions via
  `get_all_account_positions(...).body["results"]` (numeric fields are **strings**),
  cash via `get_user_account_balance`, activity via `get_account_activities`.
- **The OTP reality:** Vanguard is an `UNOFFICIAL_API`, flagged `is_degraded`.
  Connecting requires a human brokerage login + **SMS one-time code** — which
  fundamentally can't be automated. So it's done **once, out-of-band** via
  `snaptrade_setup.py` (`register`/`connect`/`reconnect`/`status`); CI just queries
  the already-connected accounts. A `DISABLED` connection degrades gracefully and
  the report tells the user to run `reconnect`.

## 1.5 Report 2.0 (the most recent Fin work — committed at HEAD `a49fe7f`)

Added analytical depth, designed against **Tufte's *Visual Display of Quantitative
Information*** (the user keeps compressed notes at
`C:\Users\akula\Desktop\Akul\General\tufte_vdqi_notes.md`). New sections:

1. **"Current Mix vs. Benchmarks" card** — portfolio's current-mix 3M/12M return
   vs. `60/40 VTI/VGIT` and `S&P 500 (VTI)`, with a `vs 60/40` delta column.
2. **Return attribution bars** — each bucket's 12-mo contribution
   (`weight × bucket_return`), Gmail-safe `<table><td>` bars.
3. **Momentum-spread sentence** in the signal card (how close the signal is to
   flipping).
4. **Crash stress simulation** in the allocation footer (2008-style / 2022-style
   shocks applied to live weights vs. 100% S&P).

**Honest-labeling decisions (important, carry the discipline forward):**
- It's **"Current-Mix Return," not "Your Strategy's return"** — it's
  `Σ(current_weight × trailing_return)`, a *hypothetical* (what today's allocation
  would have returned if held the whole period), **not** a realized return (the
  user deployed cash over time). The card says so inline.
- Benchmark labeled **"60/40 VTI / VGIT"** (VGIT is intermediate govt bonds, not
  the canonical BND aggregate) — no overstating.
- Attribution sums to the current-mix 12M return **by construction** (same
  `_bucket_returns` source) — a quick visual eyeball in the rendered HTML is the
  only check needed.
- Stress sim header says **"This allocation"** and footnotes that it assumes a
  *static* allocation (the momentum rule would actually rotate during a sustained
  downturn).

## 1.6 Hard-won technical gotchas (environment-specific — DON'T relearn these)

- **Windows console is cp1252.** `print()` of `✓`/`✗`/smart-quotes raises
  `UnicodeEncodeError`. **Keep all console output ASCII** (`--` not `—`, `[ok]`
  not checkmarks). Em-dashes/middots in HTML strings are fine (written as UTF-8).
- **Gmail strips modern CSS.** The HTML must be **table-based with inline styles**.
  Bars must be `<table><td style="background:…;width:X%">`, **not** `<div>` —
  Gmail strips `<div>` width styling. Reuse the `_bar()` helper pattern.
- **Mobile column budget:** keep comparison tables to ~4 columns for 375px phones.
- **GitHub Actions / `gh` CLI ops** (also in user memory `fin-github-ops.md`):
  - `gh` is at `C:\Program Files\GitHub CLI\gh.exe`, **not on PATH** in tool shells.
  - **Pushing from automated shells fails** via the wincred credential helper.
    Workaround — push with a token header:
    ```
    TOKEN=$("/c/Program Files/GitHub CLI/gh.exe" auth token)
    B64=$(printf "x-access-token:%s" "$TOKEN" | base64 -w0)
    git -c credential.helper= -c http.extraheader="Authorization: Basic $B64" push origin main
    ```
  - **Set Actions secrets without leaking them:** pipe the value to
    `gh secret set NAME --repo … ` via **stdin** (never as an argv/shell arg).
  - Current Fin secrets: `MAIL_USERNAME`, `MAIL_PASSWORD` (Gmail app password),
    `MAIL_TO`, `SNAPTRADE_CLIENT_ID/CONSUMER_KEY/USER_ID/USER_SECRET`. (`CSV_KEY`
    was removed when the CSV pipeline was retired.)
- **Secrets convention:** gitignored `*.local` files, simple `KEY=value` lines,
  resolved **file-first then env-var** (so the same code works locally and in CI).
  `snaptrade.local` holds the four SnapTrade creds locally.
- **Email-always-sends** is enforced in `main()`: no early `return 1` on missing
  holdings; render placeholders instead.

## 1.7 User profile & working preferences (for the reviewer agent)

- **Quant learning path:** Python (pandas/numpy/yfinance/backtrader/scikit-learn),
  interested in learning Julia (aiming to try Cornell Quant Finance cert), interested in Microsoft Qlib,
  PapersWithBacktest, peer-reviewed factor strategies (momentum, carry,
  risk-managed momentum). FinApp is explicitly a **learning vehicle**.
- **Tone:** direct, analytical, numbers-first. Wants assumptions surfaced,
  strategies stress-tested, and honesty over confabulation ("say you don't have
  the data"). Not financial advice — present data, user decides.
- **Cost-sensitive & burned by bait-and-switch** (banking): values free/consistent
  tooling; **paid IDEs (Android Studio/JetBrains) and paid data APIs are a last
  resort.**
- **Environment:** Windows 11, PowerShell (+ Bash tool available), VS Code.

## 1.8 Fin status at handoff

- HEAD `a49fe7f "Report 2.0"`, **working tree clean** — all report 2.0 work is
  committed. Last live run produced a valid report ($10,562 total, 2 accounts
  synced, signal HOLD INTERNATIONAL).
- No known open bugs. Optional polish only (e.g., eyeball attribution bars in a
  real Gmail render on a phone).

---

# Part 2 — FinApp Project Brief

## 2.1 Goal

A **phone-accessible app to paper-trade strategies** — define rule-based
strategies (in the spirit of Fin's dual momentum), test them on historical data,
and run them forward as simulated (paper) portfolios that mark-to-market on
fresh data. A sandbox to learn quant + app-building, evolving the Fin patterns.

## 2.2 Hard constraints (from the user)

- **Web-first.** Prefer a web-compatible solution installable on an Android phone.
  A native Android app is a **last resort** because Android Studio / JetBrains is
  expensive. (Note: building Android apps with Android Studio is actually *free*,
  but we respect the stated preference — and a PWA avoids the IDE entirely.)
- **No paid data.** Live/real-time data APIs are expensive and **not wanted**.
  EOD / delayed / historical data is fine.
- **Maximize ticker coverage.** Won't match Fidelity/TradingView, but should
  process **as many tickers as possible** from free sources.
- **Free hosting & tooling** throughout.

## 2.3 Free stock-data sources — research findings (June 2026)

**No live data needed** unlocks the best free options, including static bulk dumps.

| Source | Coverage | History | Free limit | Key? | Best for |
|---|---|---|---|---|---|
| **Stooq** (bulk CSV) | 12,000+ global securities/indices/FX | **30+ yrs** | **None** (bulk ZIP, ~1.4 GB US daily; CAPTCHA on download) | No | **Max-ticker offline universe + backtests** ⭐ |
| **yfinance** (Yahoo) | ~all US + intl tickers/ETFs | Decades | Unofficial, generous; rate-limit if hammered | No | On-demand EOD (already proven in Fin) ⭐ |
| **Alpaca** | US equities/ETFs/options/crypto | Yes | Real-time (IEX feed) **+ free paper-trading API** | Yes (free signup) | **Execution backend for paper trades** ⭐ |
| **Tiingo** | Most US stocks | **30+ yrs** EOD | 500 symbols/mo, 50/hr, 1000/day | Yes | Clean EOD for research |
| **EODHD** | 150,000+ tickers | 1 yr on free | 20 calls/day | Yes | Breadth on a budget |
| **Twelve Data** | Global | Yes | 800 calls/day (4h-delayed) | Yes | Simple REST, decent free cap |
| **Finnhub** | US + global | Yes | 60 req/min | Yes | Quotes/news/fundamentals |
| **Alpha Vantage** | Global | 20+ yrs | ~5/min, ~25/day | Yes | Easy start, caps fast |
| **Marketstack** | 500,000+ tickers | Yes | 100 req/mo | Yes | Breadth, tiny request cap |

**Ticker universe lists (free):** NASDAQ Trader FTP `symboldirectory`; GitHub
`rreichel3/US-Stock-Symbols` (NASDAQ/NYSE/AMEX, auto-updated, raw CSV/JSON);
`Ate329/top-us-stock-tickers` (`tickers/all.csv` via raw URL); datahub.io
`nyse-other-listings`.

**Recommendation:** **Stooq bulk CSV** for the broad historical universe (the
"as many tickers as possible" requirement) + **yfinance** for on-demand refresh +
**Alpaca's free paper-trading API** as an optional realistic execution engine.

## 2.4 Recommended architecture (web-first, $0)

**Evolve the Fin pattern** — scheduled job builds a static data bundle; a PWA
serves it; simulation runs client-side.

```
 GitHub Actions (nightly cron)                 GitHub Pages / Cloudflare Pages
 ┌───────────────────────────┐                 ┌──────────────────────────────┐
 │ pull EOD via Stooq/yfinance│  commit JSON/   │  PWA (HTML/CSS/JS)            │
 │ for chosen ticker universe │ ─ SQLite ─────▶ │  • manifest + service worker │
 │ build compact data bundle  │  bundle to repo │  • installable on Android    │
 └───────────────────────────┘                 │  • reads static data bundle  │
                                                │  • paper-trade engine in JS  │
                                                │  • portfolio state in        │
                                                │    localStorage / IndexedDB  │
                                                └──────────────────────────────┘
```

- **Frontend:** **PWA** — installable on Android via "Add to Home Screen", runs
  fullscreen, works offline, **no Play Store, no Android Studio**. Requires HTTPS
  (free on all hosts below) + a web app manifest + a service worker. Can later be
  wrapped into a real `.apk` via **Bubblewrap/TWA** (free CLI) if ever desired —
  still no paid IDE.
- **Hosting:** GitHub Pages, Cloudflare Pages, Netlify, or Vercel — all free, HTTPS
  by default. GitHub Pages keeps everything in one repo (mirrors Fin).
- **Data pipeline:** GitHub Actions cron (same muscle as Fin's weekly job) →
  compact static bundle. Keep the universe scoped (e.g. S&P 500 or a few hundred
  liquid names) so the bundle stays small; expand toward the full Stooq universe
  with on-demand lazy loading later.
- **Paper-trading engine — two paths:**
  - **(A) Build it (recommended for learning):** simulate fills on EOD closes in
    JS; portfolio/positions/cash in `localStorage`/IndexedDB; strategies as
    rule functions. Full control, maximal learning, no external dependency.
  - **(B) Alpaca paper API:** offload order simulation to Alpaca's free
    paper-trading endpoint (realistic fills, positions, P&L, up to 3 paper
    accounts). Less to build; adds an API dependency + key. Could combine: Alpaca
    for forward paper-trading, Stooq for the broad historical backtest.
- **Optional multi-device sync (later):** Supabase / Firebase / Cloudflare D1/KV
  free tiers. **Not needed for v1** (localStorage suffices).
- **Strategy layer:** port Fin's dual-momentum logic as the first built-in
  strategy; generalize to user-defined rule sets; reuse the `@dataclass` +
  config-as-data + graceful-degradation discipline.

## 2.5 Suggested MVP (v1)

1. Scope a universe (e.g. S&P 500) → nightly GH Action pulls EOD closes →
   commits `data/prices.json` (or SQLite) to the repo.
2. PWA shell: installable, offline-capable, reads the bundle.
3. Browse tickers; view a price-history chart.
4. Paper-trade: buy/sell simulated shares; portfolio + cash tracked in
   localStorage; mark-to-market on latest EOD close.
5. One built-in strategy backtester (dual momentum) reusing Fin's logic; show
   equity curve vs. a benchmark (Tufte-clean, like Report 2.0).

Then iterate: bigger universe, more strategies, Alpaca integration, sync.

## 2.6 Open questions (all resolved during the build)

These pre-build questions were all answered as the app was built: v1 shipped **both a backtester
and forward paper trading**; the **sim engine was built in JS** (not Alpaca); the universe is
**on-demand, no bundle** (the nightly GH Action was dropped — see Part 3); strategy logic is **JS
in-browser**; the repo is the private `aagarwal2025/FinApp`. Later, **Claude's Desk** added a third
mode — a fully autonomous AI trader (Part 4).

## 2.7 Sources

- EODHD — https://eodhd.com/ , pricing https://eodhd.com/pricing
- Best Financial Data APIs 2026 — https://www.nb-data.com/p/best-financial-data-apis-in-2026
- Marketstack — https://marketstack.com/
- Stooq bulk data — https://stooq.com/db/h/ , https://stooq.com/db/
- QuantStart intro to Stooq — https://www.quantstart.com/articles/an-introduction-to-stooq-pricing-data/
- Free stock API comparison (qveris) — https://qveris.ai/guides/stock-api-free-comparison/
- Best free stock APIs 2026 (dev.to) — https://dev.to/nexgendata/best-free-stock-market-apis-and-data-tools-in-2026-a-developers-honest-comparison-1926
- Tiingo / Twelve Data / Finnhub / Alpha Vantage limits — see comparison links above
- Alpaca paper trading — https://alpaca.markets/ , https://docs.alpaca.markets/us/docs/paper-trading
- PWA installable (MDN) — https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
- PWA → APK via TWA — https://github.com/Tonihj77-T/pwa2apk
- US ticker universes — https://github.com/rreichel3/US-Stock-Symbols , https://github.com/Ate329/top-us-stock-tickers , https://datahub.io/core/nyse-other-listings

---

# Part 3 — FinApp Build Handoff (v1 → "V5") & v5 Roadmap

> Written as a self-contained handoff for a tenured staff-engineer reviewer. Captures what was actually built, the operational lessons from the build/deploy work, and a critiqued v5 roadmap. v6 (SnapTrade) is **shelved** but recorded.

## 3.1 Status — what shipped at V5 (HEAD `00a1475`; v5a/v5b and Claude's Desk shipped later — see Part 4)

Live as a Cloudflare **Worker** named `finapp` (Workers **Static Assets** model — *not* Pages), repo `aagarwal2025/FinApp`. Architecture diverged from Part 2's plan in two deliberate ways: **no bulk data** (all market data pulled on demand via an edge-cached Worker proxy — Yahoo chart API primary, Stooq fallback; the nightly GitHub Action was dropped), and an **in-app Claude mentor** (Opus 4.8) that explains concepts and emits runnable strategies. No build step, no framework, no npm dependencies — vanilla ES modules + one Worker entry `src/index.js` routing `/api/{prices,tickers,mentor}`; everything else is static from `public/`.

Working surfaces: **Markets** (search, price chart, trailing returns), **Portfolio** (paper buy/sell at EOD close, localStorage, mark-to-market), **Backtester** (dual-momentum ported from Fin `compute_signal` + `sma_cross` + `buy_and_hold`; equity curve vs benchmark; CAGR/maxDD/vol), **Mentor** (streamed chat + structured strategy proposals + **web search** with dynamic filtering), and an **estimated** Anthropic credit readout.

## 3.2 Hard-won operational lessons (the durable knowledge)

- **Cloudflare "Import a repository" creates a Worker, not a Pages project.** It deploys with `npx wrangler deploy`; Pages-style config (`pages_build_output_dir`, a `/functions` dir of `onRequestGet` handlers) silently doesn't apply → "Missing entry-point." The correct model is Workers Static Assets: `main = "src/index.js"`, `[assets] directory = "./public"`, `run_worker_first = ["/api/*"]` so the Worker handles only API routes. Pages is in maintenance mode. (Migrated mid-build.)
- **A green build can deploy nothing.** The live URL served Cloudflare's default "Hello world" Worker while builds passed — the deploy step wasn't shipping our code. Diagnosis: `curl` the live `/` *and* an `/api/*` route — a catch-all 200 (even on `/favicon.ico`) means the placeholder; `/api/tickers` not returning our JSON means our router isn't live. Runtime **observability** logs show the serving `scriptVersion` but are **not** the build log — the build/deploy log under the Worker's Deployments entry is the artifact that says what shipped.
- **Secrets: three mechanisms, one correct.** Per-Worker **Secrets** (Settings → Variables and Secrets, type *Secret*) surface as `env.X` — what the Worker reads. Account **Secrets Store** needs an explicit binding. Plaintext **Variables** also surface as `env.X` but are **wiped on every `wrangler deploy`** unless `keep_vars=true`; encrypted Secrets are never deleted by a deploy. A live version only contains secrets that existed at *build time* — **redeploy after adding secrets.**
- **No local Node toolchain shaped the design — and caused one bug.** The dev box has Python/git/gh but no Node/npm, so there's no `wrangler dev`, no local lint/tests; the only feedback loop is cloud deploys. Hence the Mentor calls Anthropic via **raw `fetch`**, not `@anthropic-ai/sdk`, to stay build-free. The cost: a `cash = 0` initialization bug made every backtest mark to $0 on day one (caught by review, not tooling). **Recommendation:** before the factor math of v5b, install Node + wrangler to drive/verify deploys deterministically and add a small JS test harness for the pure money functions.
- **Claude API specifics.** `claude-opus-4-8`, `thinking:{type:"adaptive"}`, structured output via `output_config.format` (the mentor↔backtester strategy-JSON contract), web search via `web_search_20260209` + `code_execution_20260120` (dynamic filtering; code execution is free when paired with web search). No API returns a dollar balance → credits are **estimated** from per-call `usage` (tokens at Opus rates + `$0.01`/web-search request) against a user-entered baseline, always labeled "est." Web search adds ~+1–5¢ only on turns that actually search.
- **Fin disciplines that paid off.** Graceful degradation (every `/api` endpoint returns `{ok:false, reason}` rather than throwing; the UI renders placeholders, never fake `$0`); honest labeling (paper fills "simulated at EOD close"; backtests "hypothetical"); config-as-data (the strategy schema is the single source of truth).

## 3.3 v5 roadmap with staff-engineer critique

> **STATUS (2026-06-20):** **v5a and v5b have shipped** (Markets landing + non-US browse; the
> factor-score builder with 10 price factors + z-score normalization). **v6 (SnapTrade) remains
> shelved.** **v7 hardening** (Node + wrangler + a JS test harness for the money math) is still
> open. The detail below is kept as the design rationale for what was built.

v5 is split; v6 is shelved. Recommended sequence: **v5a → hardening → v5b.**

**v5a — Markets landing + non-US browsing (small; first).** Search hero + a "movers" strip + browse BSE (`.BO`) / Dubai DFM (`.AE`) — Yahoo's chart endpoint already serves both and the prices Worker passes suffixed symbols through unchanged. Risks: (1) **"movers" needs a source the on-demand model lacks** — add `/api/movers` proxying Yahoo's predefined screener (`day_gainers|day_losers|most_actives`), edge-cached, but that endpoint **may require a Yahoo crumb/cookie** (verify; fallback = compute over a curated watchlist); (2) **currency** — `.BO`=INR, `.AE`=AED; the Worker captures `meta.currency` but the client `fmtMoney` hardcodes `$`; (3) **cross-currency portfolio/backtest is a correctness trap** (can't sum INR+USD without FX) — scope v5a to **browse/chart only**, keep non-US out of the portfolio/backtester until an FX layer exists; (4) universe lists are US-only (`rreichel3`); (5) no Stooq fallback off-US.

**v5b — "Factor block" strategy builder (the big new scope).** Intent: compose a strategy as a weighted combination of factors — "factors in a polynomial = y." That is a **factor model**; build it as one, **not** as Scratch/Blockly general-purpose visual code (a heavyweight editor + npm dependency that fights the no-build PWA and emits arbitrary, hard-to-backtest programs). Instead, a **constrained factor composer**: the user adds factor "cards," each with a **weight**, **direction (+/−)**, and **lookback** → a new `rule.type: "factor_score"` (`{factors:[{factor,weight,direction,params}], combine:"rank_top1"|"score_weighted"}`) that slots into the existing strategy-JSON schema (`strategy.js`), the backtester's `decide()` (`backtest.js`), and the mentor's structured output. **Output is data, not code.** Offer ~10–12 **price-computable** factors only (no fundamentals — our EOD data can't compute "value"): momentum, risk-adjusted momentum (mom÷vol), volatility, trend vs SMA-N, fast/slow SMA cross, mean-reversion z-score, relative strength vs benchmark, trailing max-drawdown, downside deviation, 52-week-high proximity (+ optional skew/autocorrelation). **The #1 correctness risk is normalization:** factors on different scales (%/yr vs % vs 0–100) must be put on a common scale (cross-sectional **z-score or rank** across the `universe`) before weight×direction and summing to `y`, or one term swamps the rest — this is exactly the pure math that needs unit tests. Scoring is **cross-sectional** (rank assets each rebalance; allocate top-1 or score-weighted; fall to `safe_asset` when all negative, mirroring the dual-momentum valve). UI is a vanilla **card composer** (weight slider, +/− toggle, lookback, reorder via up/down) with a **live expression preview** (`y = 0.6·z(mom12m) − 0.3·z(vol3m) + …`) — block-like, not pixel-Scratch.

**v6 — SnapTrade (SHELVED, recorded).** Resume points: the interactive Connection Portal flow fits FinApp (a human is present for brokerage login — Fin's OTP-in-CI problem vanishes); **`userSecret` per-user persistence is the central design decision** (Cloudflare KV/D1 + a capability token vs localStorage + an explicit threat model); `consumerKey` stays a Worker Secret; SnapTrade auth needs **HMAC request signing** via Web Crypto in the Worker. SDKs exist (`snaptrade-typescript-sdk` npm v9.x, repo `passiv/snaptrade-sdks`; Python SDK as in Fin) but **edge/Workers compatibility is unverified** and they assume a Node-ish runtime — for the no-build Worker, **raw `fetch` + Web Crypto signing** is the path. Free-tier connection limits unverified — check pricing first. Keep **read-only** (no order placement — a different risk tier than a learning app should carry).

**v7 / hardening (promoted ahead of v5b).** Install Node + wrangler (shell-driven, deterministic deploy/verify) and add a minimal JS test harness for the pure money math — especially **factor normalization** and the backtest loop. The `cash=0` bug is the precedent: this is where silent correctness errors live.

## 3.4 Sources (Part 3)

- SnapTrade SDKs & Connection Portal — https://www.npmjs.com/package/snaptrade-typescript-sdk , https://github.com/passiv/snaptrade-sdks , https://docs.snaptrade.com/docs/implement-connection-portal
- Yahoo exchange suffixes (DFM `.AE`, BSE `.BO`) — https://finance.yahoo.com/quote/DFM.AE/ , https://help.yahoo.com/kb/SLN2310.html
- Cloudflare Workers Static Assets / migrate from Pages — https://developers.cloudflare.com/workers/static-assets/ , https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/
- Cloudflare Workers secrets vs vars (`keep_vars`) — https://developers.cloudflare.com/workers/configuration/secrets/ , https://developers.cloudflare.com/workers/wrangler/configuration/

---

# Part 4 — Claude's Desk Retro (the daily autonomous AI paper-trader)

> Added 2026-06-20. The biggest new surface since V5: a tab where **Claude itself** runs a
> discretionary paper-trading account daily, with full autonomy and cross-run memory. Written as a
> retro — what we set out to build, the walls we hit, the pivot, and the durable lessons.

## 4.1 What it is

A 5th tab ("Desk") showing a $10,000 simulated account that a scheduled **Claude Code routine**
(`trig_01QceuTTwJTCfsx7n7z6DJJ2`, cron `0 22 * * 1-5` UTC, model `claude-sonnet-4-6`) runs each
weekday after the US close. The routine has **full discretion**: it picks the strategy, decides
trades, marks to the latest EOD close, and saves a JSON ledger. It maintains a self-authored
**playbook** — its evolving trading philosophy — so each cold-start run inherits the last one's
thinking. The user steers lightly via an editable **Mandate** (in `routines/daily-paper-trader.md`);
the playbook is the routine's own voice. Honest labeling throughout: simulated, EOD fills,
non-reproducible by design, not advice.

Flow: **routine → WebSearch (prices) → Cloudflare MCP → D1 → Worker `/api/paper-run` → PWA.**

## 4.2 The intended design vs. what we built

The plan (chosen with the user up front) was the **Fin pattern**: the routine commits a
`paper-run.json` to the repo and Cloudflare redeploys — "scheduled writer → static artifact → it
always ships," minus the email. That is *not* what shipped, because of two walls the cloud routine
hit, neither visible until the first real run:

1. **It cannot push to the repo.** The user added a branch **ruleset** to `main`
   (`update`/`deletion`/`non_fast_forward`, all branches). The routine pushes via a **GitHub-App /
   user-to-server token**, and GitHub evaluates ruleset bypass by the **app identity, not the user's
   role** — so even after granting the app write permission *and* with the user being a repo admin,
   the push stayed blocked (`Permission ... denied` / `Resource not accessible by integration`).
   Admin-role bypass does not extend to app tokens. (A user **PAT** would bypass — the road not
   taken.)
2. **Its cloud sandbox blocks direct network egress.** Yahoo, Stooq, *and even the app's own Worker
   URL* all returned `403 / host_not_allowed` — only **WebSearch** and **MCP connectors** work.

So both halves of the Fin pattern (fetch prices, write the artifact) were closed off. The pivot:
**store the ledger in Cloudflare D1**, written via the **Cloudflare MCP connector**
(`d1_database_query`) — the one durable store the routine can actually reach — and source prices via
**cross-verified WebSearch**. The Worker reads D1 for `/api/paper-run` (seed-file fallback before
the first write); the front end (`daily.js`) didn't change.

**Why D1 specifically:** of the connected Cloudflare MCP tools, only D1 exposes a data write
(`d1_database_query` runs arbitrary SQL); the KV/R2 tools only manage namespaces/buckets, not
values. So D1 was the *only* writable option through the channel that works.

## 4.3 Hard-won operational lessons (durable)

- **Ruleset bypass is keyed to the actor's identity type.** Repo-admin bypass covers *your* PAT/
  OAuth pushes (`gh auth token` + `http.extraheader` — every `main` deploy here uses that and logs
  "Bypassed rule violations"), but **not** a GitHub App's token. If an automated agent must write a
  ruleset-locked repo, put *its* app/deploy-key on the bypass list or hand it a user PAT — write
  permission alone is not enough.
- **A scheduled cloud agent's only reliable I/O is WebSearch + its MCP connectors.** Design its
  persistence and data access around those, not git or arbitrary HTTP. MCP connectors also kept
  getting silently dropped from the routine config — **re-attach + re-verify on every update.**
- **`allowed_tools` vs MCP:** omitting `allowed_tools` in the routine's `session_context` falls back
  to the broad default preset, which (with the connector attached) lets the agent call the MCP
  tools. Explicitly listing built-ins *without* the MCP tools silently blocks them.
- **A phantom submodule gitlink breaks Cloudflare's clone.** A `.claude/worktrees/...` dir got
  `git add`-ed as a mode-160000 gitlink; Cloudflare's `git submodule update` then failed the build
  ("error updating submodules"). Fix: `git rm --cached` it and `.gitignore` `.claude/worktrees/`.
- **A build can fail on a *non-production* branch** while prod is fine — check *which ref* the
  failing Cloudflare build is building before assuming prod broke.
- **Fin disciplines held:** graceful degradation (Worker falls back to the seed; `/api/*` returns
  `{ok:false}`), honest labeling (the routine flags WebSearch-sourced prices as methodology and
  skipped GLD/BIL one run when two sources disagreed — never fabricated), and the deterministic
  bookkeeping mirrors `portfolio.js` exactly (each run self-checks `value ≈ cash + Σ shares×mark`,
  `cash ≥ 0`).

## 4.4 State at handoff

Live and verified (first real runs 2026-06-20). The routine reads/writes D1, maintains its playbook,
and the Desk tab renders summary + playbook + equity curve + holdings + a Daily ledger table. D1:
`finapp-desk`, table `ledger(id, doc, updated_at)`, JSON blob at `id=1`. Open follow-ups: the equity
curve needs ≥2 runs to draw; the in-session `PushNotification` tool isn't provisioned (the routine's
platform-level push is enabled instead); **v7 hardening** (a JS test harness for the money math) is
still the highest-value next step. Full operational detail + IDs in user memory `claude-desk-d1`.
