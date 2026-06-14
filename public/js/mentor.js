// mentor.js — chat UI for the Claude tutor. Streams chat answers (parses the
// Anthropic SSE forwarded by /api/mentor) and, in "propose" mode, renders a
// runnable strategy card from the structured-JSON reply.

import { STRATEGY_SCHEMA } from "./strategy.js";

const PIN_KEY = "finapp.mentorPin";
let pin = localStorage.getItem(PIN_KEY) || "";
let history = []; // [{role, content}]
let busy = false;
let cfg = {}; // { onStrategy(strategy), getContext() }

let logEl, textEl, sendBtn, proposeBtn, pinWrap, pinInput, pinSaveBtn;

export function initMentor(config) {
  cfg = config || {};
  logEl = document.getElementById("mentor-log");
  textEl = document.getElementById("mentor-text");
  sendBtn = document.getElementById("mentor-send");
  proposeBtn = document.getElementById("mentor-propose");
  pinWrap = document.getElementById("mentor-pin-setup");
  pinInput = document.getElementById("mentor-pin");
  pinSaveBtn = document.getElementById("mentor-pin-save");

  pinSaveBtn.addEventListener("click", () => {
    pin = pinInput.value.trim();
    localStorage.setItem(PIN_KEY, pin);
    pinWrap.classList.add("hidden");
    sys("Passphrase saved. Ask me anything about trading strategies.");
  });
  sendBtn.addEventListener("click", () => send("chat"));
  proposeBtn.addEventListener("click", () => send("propose"));

  if (!pin) {
    pinWrap.classList.remove("hidden");
    sys("Set your mentor passphrase above to start.");
  } else {
    sys("Hi — I'm your trading mentor. Ask me to explain a concept, or describe an idea and tap “Propose strategy” to get a runnable one.");
  }
}

function addMsg(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}
const sys = (t) => addMsg("sys", t);

function setBusy(b) {
  busy = b;
  sendBtn.disabled = b;
  proposeBtn.disabled = b;
}

async function send(mode) {
  if (busy) return;
  const text = textEl.value.trim();
  if (!text) return;
  if (!pin) {
    pinWrap.classList.remove("hidden");
    sys("Set your passphrase first.");
    return;
  }
  addMsg("user", text);
  history.push({ role: "user", content: text });
  textEl.value = "";
  setBusy(true);

  const payload = { mode, messages: history };
  const ctx = cfg.getContext?.();
  if (ctx) payload.context = ctx;
  if (mode === "propose") payload.schema = STRATEGY_SCHEMA;

  try {
    const resp = await fetch("/api/mentor", {
      method: "POST",
      headers: { "content-type": "application/json", "x-mentor-pin": pin },
      body: JSON.stringify(payload),
    });

    if (!resp.ok || resp.headers.get("content-type")?.includes("application/json")) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      if (mode === "chat" && err.ok === false) { sys("⚠ " + err.error); }
      else if (mode === "propose" && err.ok === true) { renderStrategy(err.strategy); }
      else sys("⚠ " + (err.error || "request failed"));
      if (resp.status === 401) pinWrap.classList.remove("hidden");
      setBusy(false);
      return;
    }

    // chat: stream the Anthropic SSE
    await streamChat(resp);
  } catch (e) {
    sys("⚠ Network error reaching the mentor.");
  } finally {
    setBusy(false);
  }
}

async function streamChat(resp) {
  const bot = addMsg("bot", "");
  const thinking = document.createElement("span");
  thinking.className = "spinner";
  bot.appendChild(thinking);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", acc = "";

  const flush = () => {
    bot.textContent = acc; // replaces spinner once text arrives
    logEl.scrollTop = logEl.scrollHeight;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep partial line
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        acc += ev.delta.text;
        flush();
      } else if (ev.type === "error") {
        acc += `\n⚠ ${ev.error?.message || "stream error"}`;
        flush();
      }
    }
  }
  if (!acc) bot.textContent = "(no response)";
  history.push({ role: "assistant", content: acc });
}

function renderStrategy(strategy) {
  history.push({ role: "assistant", content: "Proposed strategy: " + (strategy?.name || "(unnamed)") });
  const wrap = document.createElement("div");
  wrap.className = "msg bot";
  const title = document.createElement("b");
  title.textContent = strategy.name || "Proposed strategy";
  const desc = document.createElement("div");
  desc.className = "muted";
  desc.textContent = strategy.description || "";
  const pre = document.createElement("pre");
  pre.className = "code-block";
  pre.textContent = JSON.stringify(strategy, null, 2);
  const actions = document.createElement("div");
  actions.className = "chat-buttons";
  const runBtn = document.createElement("button");
  runBtn.className = "btn";
  runBtn.textContent = "Backtest this →";
  runBtn.addEventListener("click", () => cfg.onStrategy?.(strategy, true));
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-quiet";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => { cfg.onStrategy?.(strategy, false); sys("Saved to the Backtest tab."); });
  actions.append(runBtn, saveBtn);
  wrap.append(title, desc, pre, actions);
  logEl.appendChild(wrap);
  logEl.scrollTop = logEl.scrollHeight;
}
