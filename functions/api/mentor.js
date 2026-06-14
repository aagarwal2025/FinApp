// POST /api/mentor — the in-app trading mentor (Claude Opus 4.8).
// Two modes from one endpoint:
//   mode:"chat"    → streamed answer (Anthropic SSE forwarded to the browser)
//   mode:"propose" → one strategy as JSON, constrained to the caller's schema
//                    via structured outputs (output_config.format)
//
// The ANTHROPIC_API_KEY lives only as a Cloudflare secret. A second secret,
// MENTOR_PIN, gates this endpoint so a leaked URL can't burn API credits.
// Never throws to the client: on any failure it returns {ok:false, error}.

const API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const VERSION = "2023-06-01";

const SYSTEM = `You are a patient quantitative-finance tutor inside FinApp, a paper-trading learning app on the user's phone. The user is an aspiring quant: strong in Python, but new to designing trading strategies.

Teach concretely and numbers-first: momentum, mean reversion, trend-following, risk management, position sizing, drawdown, diversification, regime shifts. Explain the *why*, not just the *what*. Be honest about uncertainty — say when something can't be known without a backtest, and never overstate what a rule can do. This is education, NOT financial advice: present reasoning and tradeoffs, then let the user decide. Keep answers focused and easy to read on a small screen (short paragraphs, occasional bullet lists).

FinApp can backtest and paper-trade strategies of this exact shape:
- universe: tickers the rule chooses among (prefer liquid US ETFs)
- safe_asset: a defensive ticker to rotate into, or "CASH"
- rebalance: "monthly" or "weekly"
- rule, one of:
  - relative_momentum { lookback_days, if_all_negative: "safe_asset" | "best_anyway" } — hold the universe asset with the highest trailing return; rotate to safe_asset if the winner is negative (Antonacci dual momentum)
  - sma_cross { asset, sma_days } — hold asset while above its N-day moving average, else safe_asset
  - buy_and_hold { weights?: [{symbol, weight}] } — static allocation, rebalanced

When the user asks how to express an idea, describe it in those terms so they can build it here.`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Trim history to the last N turns to bound cost, keep roles valid.
function prepMessages(messages) {
  const clean = (messages || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20);
  // history must start with a user turn
  while (clean.length && clean[0].role !== "user") clean.shift();
  return clean;
}

export async function onRequestPost({ request, env }) {
  if (!env.MENTOR_PIN) return json({ ok: false, error: "Mentor not configured: set MENTOR_PIN in Cloudflare." }, 500);
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "Mentor not configured: set ANTHROPIC_API_KEY in Cloudflare." }, 500);
  if (request.headers.get("x-mentor-pin") !== env.MENTOR_PIN) {
    return json({ ok: false, error: "Wrong passphrase." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad request body" }, 400);
  }

  const mode = body.mode === "propose" ? "propose" : "chat";
  const messages = prepMessages(body.messages);
  if (!messages.length) return json({ ok: false, error: "no message" }, 400);

  // Optional app context (current backtest stats / portfolio snapshot) as a
  // trailing system note — kept out of the cached persona prefix.
  let system = SYSTEM;
  if (body.context && typeof body.context === "string") {
    system += `\n\n--- Current app context (for grounding your answer) ---\n${body.context.slice(0, 4000)}`;
  }

  const payload = {
    model: MODEL,
    // Generous ceiling so adaptive thinking can't exhaust the budget before the
    // (small) strategy JSON is emitted, which would break parsing.
    max_tokens: 8192,
    system,
    messages,
    thinking: { type: "adaptive" },
  };

  if (mode === "propose") {
    const schema = body.schema && typeof body.schema === "object" ? body.schema : null;
    if (!schema) return json({ ok: false, error: "propose mode requires a schema" }, 400);
    payload.output_config = { effort: "high", format: { type: "json_schema", schema } };
  } else {
    payload.output_config = { effort: "medium" };
    payload.stream = true;
  }

  let upstream;
  try {
    upstream = await fetch(API, {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ ok: false, error: "could not reach Anthropic API" }, 502);
  }

  if (!upstream.ok) {
    let detail = "";
    try {
      const err = await upstream.json();
      detail = err?.error?.message || JSON.stringify(err);
    } catch {
      detail = await upstream.text();
    }
    const hint = upstream.status === 400 && /credit|balance/i.test(detail)
      ? " (check your Anthropic credit balance)"
      : "";
    return json({ ok: false, error: `Claude API error ${upstream.status}: ${detail}${hint}` }, 502);
  }

  if (mode === "chat") {
    // Forward Anthropic's SSE straight to the browser; mentor.js parses it.
    return new Response(upstream.body, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }

  // propose: parse the JSON strategy from the first text block.
  try {
    const data = await upstream.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) return json({ ok: false, error: "model returned no strategy" }, 502);
    const strategy = JSON.parse(textBlock.text);
    return json({ ok: true, strategy, usage: data.usage });
  } catch (e) {
    return json({ ok: false, error: "could not parse strategy JSON from model" }, 502);
  }
}
