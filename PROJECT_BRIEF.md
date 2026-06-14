# FinApp — Knowledge Handoff & Project Brief

> **Purpose of this document.** It does two things:
> 1. **Part 1** extracts the durable, high-level knowledge from the chat that built
>    the **Fin** weekly-report project — so that knowledge survives even after that
>    chat is deleted.
> 2. **Part 2** is the forward-looking brief for **FinApp**, a tangential new project:
>    a phone-accessible way to **paper-trade strategies**, built web-first, on free
>    data and free tooling.
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

## 2.6 Open questions for the user / reviewer

1. **"Paper-trade strategies" — which emphasis for v1?**
   (a) *Backtester* (run a strategy over history, see results), (b) *forward paper
   trading* (daily EOD-marked simulated portfolio), or (c) *manual* paper
   portfolio tracking. (Recommendation: a+b, since that matches the quant goal.)
2. **Build the sim engine vs. use Alpaca's paper API?** (Recommendation: build it
   for v1 learning; keep Alpaca as a fast-follow option.)
3. **Universe size for v1?** Small (S&P 500, tiny bundle) vs. large (full Stooq,
   needs lazy loading). (Recommendation: start S&P 500.)
4. **Language for strategy logic:** JS in-browser (simplest for a pure-static PWA)
   vs. Python in the GH Action precomputing results (reuses existing skills).
   (Recommendation: Python precompute for heavy backtests, JS for interactive
   paper trades.)
5. **Repo:** new private GitHub repo `FinApp` under `aagarwal2025`?

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
