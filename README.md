# FinApp

A phone-installable PWA for learning quant trading: search tickers, view price history, **backtest** rule-based strategies, run a **paper portfolio**, and chat with an AI **mentor** (Claude Opus 4.8) that explains concepts and emits runnable strategies.

Built as a sibling to [Fin](../Fin) — same disciplines (config-as-data, graceful degradation, honest labeling), evolved into an interactive app. **No bulk data storage**: all market data is pulled programmatically, on demand.

## Architecture ($0 except API credits)

```
Private repo aagarwal2025/FinApp ── auto-deploy ──▶ Cloudflare Pages (free, HTTPS)
  public/                  static PWA (installable on Android, offline shell)
  functions/api/
    prices/[symbol].js     Yahoo chart API → Stooq fallback, edge-cached ~24h
    tickers.js             rreichel3/US-Stock-Symbols universe, edge-cached
    mentor.js              Claude Opus 4.8 (chat stream + structured strategy JSON)
  client state             paper portfolio + saved strategies in localStorage
```

No build step, no framework — vanilla ES modules. Cloudflare builds/serves in the cloud, so **no local Node toolchain is required to deploy**.

## Deploy (one-time)

1. **Push this repo** to `github.com/aagarwal2025/FinApp` (private).
2. In the **Cloudflare dashboard** → Workers & Pages → **Create → Pages → Connect to Git** → pick `FinApp`.
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: **`public`**
3. After the first deploy, set two **secrets** (Settings → Variables and Secrets → add as *Secret*, then redeploy):
   - `ANTHROPIC_API_KEY` — your prepaid Anthropic key ([console.anthropic.com](https://console.anthropic.com), Billing → buy ~$5 credits)
   - `MENTOR_PIN` — any passphrase; you'll enter it once in the app to unlock the mentor
4. Open the deployed URL on your Android phone → browser menu → **Add to Home Screen**.

## Local dev (optional, needs Node + wrangler)

```bash
npm install -g wrangler
cp .dev.vars.example .dev.vars   # fill in ANTHROPIC_API_KEY + MENTOR_PIN
wrangler pages dev public        # serves the site and /functions locally
```

Without Node, just push and use Cloudflare's automatic **preview deployments** as the test loop.

## Strategy model

A strategy is the JSON contract in [`public/js/strategy.js`](public/js/strategy.js) — the backtester executes it and the mentor is constrained (via Claude structured outputs) to emit exactly it. Rule types in v1:

- `relative_momentum` — Antonacci dual momentum (the Fin signal: hold the higher-trailing-return asset; rotate to a safe asset if negative)
- `sma_cross` — hold while above an N-day moving average, else the safe asset
- `buy_and_hold` — static weights, rebalanced

## Costs

Everything is free except Anthropic API usage: prepaid, ~$5 minimum, roughly 3–4¢ per Opus 4.8 mentor turn. Data endpoints and hosting are keyless/free.

The Mentor tab shows an **estimated** remaining balance: it prices the exact token `usage` returned by each call at Opus 4.8 rates and subtracts from a baseline you enter. There is no Anthropic API for the real dollar balance — that lives at console.anthropic.com → Billing. Tap **Set balance** to re-sync the estimate to the Console's real number anytime.

## Disclaimer

Educational tool. Hypothetical backtests assume frictionless EOD-close fills and are not predictive. Not financial advice.
