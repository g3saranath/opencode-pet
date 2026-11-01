"use strict";

const stage = document.getElementById("stage");
const bubble = document.getElementById("bubble");
const bubbleEmoji = document.getElementById("bubble-emoji");
const bubbleText = document.getElementById("bubble-text");
const propEl = document.getElementById("prop");
const petEl = document.getElementById("pet");
const sprite = document.querySelector(".sprite");
const feedList = document.getElementById("feed-list");

const ALL_STATES = [
  "idle", "thinking", "working", "waiting", "happy", "error", "sleeping",
];

// Shared label tables and the "what to show" decision live in labels.js so the
// tests can exercise them without a DOM.
const { TOOL_LOOK, WORKING_VERBS, resolveBubble } = window.PetLabels;
const ALL_TOOL_CLASSES = Object.keys(TOOL_LOOK).map((t) => "tool-" + t);

let relaxTimer = null;
let prevState = "idle";
let muted = false;
let verbTimer = null;
let verbIdx = 0;
let currentState = "idle";
let petConfig = { animationSpeed: 1 };
let packPlayer = null;
let visible = true;
let unsubscribers = [];

function stopVerbs() {
  if (verbTimer) { clearInterval(verbTimer); verbTimer = null; }
}

function startVerbs(pool) {
  stopVerbs();
  if (!pool || !pool.length) return;
  verbIdx = Math.floor(Math.random() * pool.length);
  const tick = () => {
    bubbleText.textContent = " " + pool[verbIdx % pool.length];
    verbIdx++;
  };
  tick();
  verbTimer = setInterval(tick, 2000);
}

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
  currentState = state;

  for (const s of ALL_STATES) stage.classList.remove("state-" + s);
  stage.classList.add("state-" + state);

  // tool class (per-tool face + spell colour)
  for (const c of ALL_TOOL_CLASSES) stage.classList.remove(c);
  const tool = payload && payload.tool;

  const detail = payload && payload.detail ? String(payload.detail) : "";

  const { emoji, text, prop, toolClass, generic } = resolveBubble(state, tool, detail);
  if (toolClass) stage.classList.add(toolClass);

  stopVerbs();

  if (emoji) {
    bubbleEmoji.textContent = emoji;
    bubbleText.textContent = text ? " " + text : "";
    bubble.classList.add("show");
    if (generic) startVerbs(WORKING_VERBS);
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
    moveIdleTimer = setTimeout(() => {
      moveIdleTimer = null;
      stage.style.setProperty("--lean", "0deg");
    }, 160);
  }
}

// ---------------------------------------------------------------------------
// Config (scale + mute) from main
// ---------------------------------------------------------------------------
function applyConfig(cfg) {
  if (!cfg) return;
  if (Number.isFinite(cfg.scale)) stage.style.setProperty("--scale", cfg.scale);
  if (Number.isFinite(cfg.animationSpeed) && cfg.animationSpeed > 0) {
    petConfig.animationSpeed = cfg.animationSpeed;
    stage.style.setProperty("--anim-speed", 1 / cfg.animationSpeed);
  }
  if (typeof cfg.muted === "boolean") muted = cfg.muted;
  if (typeof cfg.feed === "boolean") stage.classList.toggle("feed-on", cfg.feed);
  if (typeof cfg.pet === "string") loadPet(cfg.pet);
}

// Registered sprite-sheet packs (see packs.js). Unknown ids, including the
// default "scrybe", keep the built-in art.
const PACKS = window.PetPacks && typeof window.PetPacks === "object" ? window.PetPacks : {};

function findPack(id) {
  if (typeof id !== "string" || !id || id === "scrybe") return null;
  return Object.prototype.hasOwnProperty.call(PACKS, id) ? PACKS[id] : null;
}

function loadPet(id) {
  if (packPlayer) {
    packPlayer.active = false;
    if (packPlayer.raf) cancelAnimationFrame(packPlayer.raf);
    packPlayer = null;
  }
  stage.classList.remove("pack-mode");
  petEl.classList.remove("pack-mode");
  sprite.style.backgroundImage = "";
  sprite.style.backgroundSize = "";
  sprite.style.backgroundPosition = "";
  sprite.style.backgroundRepeat = "";

  const pack = findPack(id);
  if (!pack) return;

  const img = new Image();
  img.onload = () => {
    stage.classList.add("pack-mode");
    sprite.style.backgroundImage = 'url("' + pack.url + '")';
    sprite.style.backgroundSize = pack.cols * pack.frameW + "px " + pack.rows * pack.frameH + "px";
    sprite.style.backgroundRepeat = "no-repeat";

    let frame = 0;
    let last = performance.now();
    // The rAF loop runs every display frame, but the sheet only advances every
    // `interval` ms, so only touch the style when the visible frame changes.
    let lastPosition = "";
    const player = { raf: 0, active: false, tick: null };
    const tick = (now) => {
      if (!player.active) return;
      const row = pack.map[currentState] != null ? pack.map[currentState] : 0;
      const col = frame % pack.cols;
      const position = "-" + (col * pack.frameW) + "px -" + (row * pack.frameH) + "px";
      if (position !== lastPosition) {
        sprite.style.backgroundPosition = position;
        lastPosition = position;
      }
      const interval = 120 / (petConfig.animationSpeed > 0 ? petConfig.animationSpeed : 1);
      if (now - last >= interval) {
        frame += 1;
        last = now;
      }
      player.raf = requestAnimationFrame(tick);
    };
    player.tick = tick;
    packPlayer = player;
    // Only spin the sheet when the overlay is actually visible. A hidden
    // window that keeps a rAF loop alive burns a core for nothing.
    if (visible) {
      player.active = true;
      player.raf = requestAnimationFrame(tick);
    }
  };
  img.onerror = () => {
    // Fall back to the built-in wizard art.
  };
  img.src = pack.url;
}

// ---------------------------------------------------------------------------
// Visibility
//
// The main process hides the window when the user turns the pet off or when a
// fullscreen app suppresses it. Pause the CSS keyframes and the sprite-sheet
// rAF loop while that is true, then resume from the current frame.
// ---------------------------------------------------------------------------
function setVisibility(next) {
  visible = Boolean(next);
  document.body.classList.toggle("paused", !visible);
  if (!packPlayer) return;
  if (visible && !packPlayer.active) {
    packPlayer.active = true;
    packPlayer.raf = requestAnimationFrame(packPlayer.tick);
  } else if (!visible && packPlayer.active) {
    packPlayer.active = false;
    if (packPlayer.raf) cancelAnimationFrame(packPlayer.raf);
    packPlayer.raf = 0;
  }
}

// ---------------------------------------------------------------------------
// Drag-to-move and context menu.
//
// The main process owns click-through: it watches the cursor against the
// window bounds and flips setIgnoreMouseEvents on or off. That is more
// reliable than a renderer hit test through a CSS-scaled stage, which is
// what made the pet feel dead to the mouse.
// ---------------------------------------------------------------------------
let dragging = false;
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
  unsubscribers.push(window.pet.onState(setState));
  unsubscribers.push(window.pet.onMove(onMove));
  unsubscribers.push(window.pet.onConfig(applyConfig));
  unsubscribers.push(window.pet.onVisibility(setVisibility));
}

window.addEventListener("beforeunload", () => {
  for (const off of unsubscribers) {
    try {
      off();
    } catch {
      /* already gone */
    }
  }
  unsubscribers = [];
  stopVerbs();
  if (relaxTimer) { clearTimeout(relaxTimer); relaxTimer = null; }
  if (moveIdleTimer) { clearTimeout(moveIdleTimer); moveIdleTimer = null; }
  if (packPlayer) {
    packPlayer.active = false;
    if (packPlayer.raf) cancelAnimationFrame(packPlayer.raf);
    packPlayer = null;
  }
});

setState({ state: "idle" });
