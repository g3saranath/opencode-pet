"use strict";

const stage = document.getElementById("stage");
const bubble = document.getElementById("bubble");
const bubbleEmoji = document.getElementById("bubble-emoji");
const bubbleText = document.getElementById("bubble-text");
const propEl = document.getElementById("prop");
const petEl = document.getElementById("pet");
const feedList = document.getElementById("feed-list");

const ALL_STATES = [
  "idle", "thinking", "working", "waiting", "happy", "error", "sleeping",
];

// tool -> [bubbleEmoji, label, floatingProp]
const TOOL_LOOK = {
  edit:      ["\u270F\uFE0F", "editing", "\u270D\uFE0F"],   // ✏️ ✍️
  write:     ["\u270F\uFE0F", "writing", "\u270D\uFE0F"],
  patch:     ["\u270F\uFE0F", "editing", "\u270D\uFE0F"],
  read:      ["\uD83D\uDCD6", "reading", "\uD83D\uDCD6"],   // 📖
  bash:      ["\u2699\uFE0F", "running", "\uD83E\uDDEA"],    // ⚙️ 🧪
  grep:      ["\uD83D\uDD0D", "searching", "\uD83D\uDD0D"],  // 🔍
  glob:      ["\uD83D\uDCC2", "looking", "\uD83D\uDD2E"],    // 📂 🔮
  list:      ["\uD83D\uDCC2", "looking", "\uD83D\uDD2E"],
  webfetch:  ["\uD83C\uDF10", "browsing", "\uD83E\uDD89"],   // 🌐 🦉
  websearch: ["\uD83C\uDF10", "searching", "\uD83E\uDD89"],
  task:      ["\uD83E\uDD16", "delegating", "\uD83E\uDE84"], // 🤖 🪄
  todowrite: ["\uD83D\uDCDD", "planning", "\uD83D\uDCDC"],   // 📝 📜
  question:  ["\u2753", "asking", "\u2753"],
};
const ALL_TOOL_CLASSES = Object.keys(TOOL_LOOK).map((t) => "tool-" + t);

const STATE_LOOK = {
  thinking: [null, ""],
  working:  ["\uD83E\uDE84", "casting"],
  waiting:  ["\u2753", "your call?"],
  happy:    ["\u2728", "done!"],
  error:    ["\uD83D\uDCA5", "uh oh"],
  sleeping: [null, ""],
  idle:     [null, ""],
};

let relaxTimer = null;
let prevState = "idle";
let muted = false;

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------
let feedSeq = 0;
let feedSig = "";
function renderFeed(entries) {
  if (!Array.isArray(entries)) return;
  const sig = entries.map((e) => (e ? e.seq + ":" + (e.text || "") : "")).join("|");
  if (sig === feedSig) return;
  feedSig = sig;

  const maxSeq = entries.reduce((m, e) => Math.max(m, (e && e.seq) || 0), 0);
  if (maxSeq < feedSeq) feedSeq = 0; // opencode restarted -> new session

  feedList.textContent = "";
  if (entries.length === 0) {
    const d = document.createElement("div");
    d.className = "feed-empty";
    d.textContent = "waiting\u2026";
    feedList.appendChild(d);
    return;
  }
  for (const e of entries) {
    if (!e) continue;
    const line = document.createElement("div");
    line.className = "feed-line " + (e.kind || "step");
    if ((e.seq || 0) > feedSeq) line.classList.add("new");
    const i = document.createElement("span");
    i.className = "fi";
    i.textContent = e.icon || "\u2022";
    const t = document.createElement("span");
    t.className = "ft";
    t.textContent = e.text || "";
    line.appendChild(i);
    line.appendChild(t);
    feedList.appendChild(line);
  }
  feedSeq = Math.max(feedSeq, maxSeq);
}

function setState(payload) {
  const state = payload && ALL_STATES.includes(payload.state)
    ? payload.state : "idle";

  for (const s of ALL_STATES) stage.classList.remove("state-" + s);
  stage.classList.add("state-" + state);

  // tool class (per-tool face + spell colour)
  for (const c of ALL_TOOL_CLASSES) stage.classList.remove(c);
  const tool = payload && payload.tool;

  let emoji = null, text = "", prop = "";
  if (tool && TOOL_LOOK[tool]) {
    stage.classList.add("tool-" + tool);
    [emoji, text, prop] = TOOL_LOOK[tool];
  } else if (STATE_LOOK[state]) {
    [emoji, text] = STATE_LOOK[state];
  }
  if (payload && payload.detail) text = payload.detail;

  if (emoji) {
    bubbleEmoji.textContent = emoji;
    bubbleText.textContent = text ? " " + text : "";
    bubble.classList.add("show");
  } else {
    bubble.classList.remove("show");
  }

  if (prop) { propEl.textContent = prop; propEl.classList.add("show"); }
  else { propEl.classList.remove("show"); }

  if (payload && payload.feed) renderFeed(payload.feed);

  // sounds on entering happy / error
  if (state !== prevState) {
    if (state === "happy") playChime();
    else if (state === "error") playError();
  }
  prevState = state;

  // transient states relax back to idle
  if (relaxTimer) { clearTimeout(relaxTimer); relaxTimer = null; }
  if (state === "happy") relaxTimer = setTimeout(() => setState({ state: "idle" }), 4200);
  else if (state === "error") relaxTimer = setTimeout(() => setState({ state: "idle" }), 5000);
}

// ---------------------------------------------------------------------------
// Sound (synthesised — no assets needed)
// ---------------------------------------------------------------------------
let audioCtx = null;
function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
function blip(freq, start, dur, type, gainv) {
  const c = ctx(); if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type || "sine";
  o.frequency.value = freq;
  o.connect(g); g.connect(c.destination);
  const t = c.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gainv || 0.2, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.02);
}
function playChime() {
  if (muted) return;
  // magical ascending sparkle
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => blip(f, i * 0.09, 0.28, "triangle", 0.18));
  blip(1567.98, 0.4, 0.4, "sine", 0.12);
}
function playError() {
  if (muted) return;
  blip(196, 0, 0.22, "sawtooth", 0.16);
  blip(146.83, 0.12, 0.3, "sawtooth", 0.16);
}

// ---------------------------------------------------------------------------
// Movement (facing while dragging)
// ---------------------------------------------------------------------------
let moveIdleTimer = null;
function onMove({ dx, speed }) {
  // The sprite art faces left; flip it to face right when dragged rightward,
  // so he always looks the way he's moving.
  if (Math.abs(dx) > 0.6) stage.classList.toggle("flip", dx > 0);
  const lean = Math.max(-10, Math.min(10, dx * 1.2));
  stage.style.setProperty("--lean", lean.toFixed(1) + "deg");
  if (speed > 6) {
    if (moveIdleTimer) clearTimeout(moveIdleTimer);
    moveIdleTimer = setTimeout(() => stage.style.setProperty("--lean", "0deg"), 160);
  }
}

// ---------------------------------------------------------------------------
// Config (scale + mute) from main
// ---------------------------------------------------------------------------
function applyConfig(cfg) {
  if (!cfg) return;
  if (Number.isFinite(cfg.scale)) stage.style.setProperty("--scale", cfg.scale);
  if (typeof cfg.muted === "boolean") muted = cfg.muted;
  if (typeof cfg.feed === "boolean") stage.classList.toggle("feed-on", cfg.feed);
}

// ---------------------------------------------------------------------------
// Drag-to-move + click-through management
// ---------------------------------------------------------------------------
let ignoring = true;
let dragging = false;
function setIgnore(v) {
  if (v === ignoring) return;
  ignoring = v;
  if (window.pet) window.pet.setIgnore(v);
}
function overPet(x, y) {
  const r = petEl.getBoundingClientRect();
  const pad = 6;
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}
document.addEventListener("mousemove", (e) => {
  if (dragging) return;
  setIgnore(!overPet(e.clientX, e.clientY));
});
petEl.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; // left button drags
  dragging = true;
  document.body.classList.add("dragging");
  if (window.pet) window.pet.dragStart({ x: e.clientX, y: e.clientY });
  e.preventDefault();
});
document.addEventListener("mouseup", () => {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove("dragging");
  if (window.pet) window.pet.dragEnd();
});
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (window.pet) window.pet.contextMenu();
});

if (window.pet) {
  window.pet.onState(setState);
  window.pet.onMove(onMove);
  window.pet.onConfig(applyConfig);
}

setState({ state: "idle" });
