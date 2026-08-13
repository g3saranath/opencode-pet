"use strict";

const { app, BrowserWindow, screen, globalShortcut, ipcMain, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const { DIR, STATE_FILE, PID_FILE, HEARTBEAT_FILE, STATES } = require("../shared/paths");

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const BASE_W = 240;
const BASE_H = 214;
const FEED_H = 178;
const FRAME_MS = 16;
// The pet sleeps only when opencode's heartbeat goes stale (i.e. it's not
// running/connected) — not merely because you've been quiet for a while.
const HEARTBEAT_TIMEOUT_MS = 45 * 1000;
const POS_FILE = path.join(DIR, "pos.json");
const CONFIG_FILE = path.join(DIR, "config.json");

const SIZES = [
  { label: "Small", scale: 0.8 },
  { label: "Medium", scale: 1.0 },
  { label: "Large", scale: 1.3 },
  { label: "Huge", scale: 1.6 },
];

let config = { scale: 1.0, muted: false, feed: true };

let win = null;
let lastStateUpdate = Date.now();
let lastState = "idle";
const startedAt = Date.now();

// Drag state
let dragging = false;
let grabX = 0;
let grabY = 0;
let lastWinX = 0;
let lastWinY = 0;
let smoothDX = 0;

// ---------------------------------------------------------------------------
// Single instance — a second launch just exits (so the plugin can safely
// attempt a launch without ever creating duplicate pets).
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// The app owns the pid file: it writes its *real* pid on startup and removes
// it on quit, so the plugin's "already running?" check is reliable.
function writePidFile() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));
  } catch {}
}
function clearPidFile() {
  try {
    if (fs.readFileSync(PID_FILE, "utf8").trim() === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Config persistence (scale + mute)
// ---------------------------------------------------------------------------
function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (Number.isFinite(c.scale)) config.scale = c.scale;
    if (typeof c.muted === "boolean") config.muted = c.muted;
    if (typeof c.feed === "boolean") config.feed = c.feed;
  } catch {}
}
function saveConfig() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config));
  } catch {}
}
function sendConfig() {
  if (win && !win.isDestroyed()) win.webContents.send("pet:config", config);
}
function winSize() {
  return {
    w: Math.round(BASE_W * config.scale),
    h: Math.round((BASE_H + (config.feed ? FEED_H : 0)) * config.scale),
  };
}

// ---------------------------------------------------------------------------
// Position persistence — the pet stays where you drop it, across restarts.
// ---------------------------------------------------------------------------
function loadPosition() {
  try {
    const p = JSON.parse(fs.readFileSync(POS_FILE, "utf8"));
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
  } catch {}
  return null;
}
function savePosition() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(POS_FILE, JSON.stringify({ x, y }));
  } catch {}
}
function defaultPosition() {
  const wa = screen.getPrimaryDisplay().workArea;
  const { w, h } = winSize();
  return { x: wa.x + wa.width - w - 24, y: wa.y + wa.height - h - 24 };
}

function createWindow() {
  const pos = loadPosition() || defaultPosition();
  lastWinX = pos.x;
  lastWinY = pos.y;
  const { w, h } = winSize();

  win = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false, // we move it ourselves during drag
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Float above everything, on every space, even over fullscreen apps.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Click-through by default; the renderer flips this off only while the
  // cursor is actually over the pet (so you can grab it), and back on
  // otherwise (so clicks pass through the empty area).
  win.setIgnoreMouseEvents(true, { forward: true });

  win.webContents.on("did-finish-load", () => {
    sendConfig();
    pushState(readState());
  });
}

// ---------------------------------------------------------------------------
// Scaling — resize the window around its centre and tell the renderer.
// ---------------------------------------------------------------------------
function setScale(scale) {
  if (!win || win.isDestroyed()) return;
  const b = win.getContentBounds();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  config.scale = scale;
  const { w, h } = winSize();
  win.setContentBounds({
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
    width: w,
    height: h,
  });
  saveConfig();
  savePosition();
  sendConfig();
}

function toggleMute() {
  config.muted = !config.muted;
  saveConfig();
  sendConfig();
}

function setFeed(on) {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition(); // keep top-left fixed; grow/shrink downward
  config.feed = on;
  const { w, h } = winSize();
  win.setContentBounds({ x, y, width: w, height: h });
  saveConfig();
  savePosition();
  sendConfig();
}

function resetPosition() {
  if (!win || win.isDestroyed()) return;
  const p = defaultPosition();
  win.setPosition(Math.round(p.x), Math.round(p.y));
  lastWinX = p.x;
  lastWinY = p.y;
  savePosition();
}

function popupMenu() {
  const template = [
    { label: "Scrybe \uD83D\uDD2E", enabled: false },
    { type: "separator" },
    {
      label: "Size",
      submenu: SIZES.map((s) => ({
        label: s.label,
        type: "radio",
        checked: Math.abs(config.scale - s.scale) < 0.001,
        click: () => setScale(s.scale),
      })),
    },
    {
      label: "Mute sounds",
      type: "checkbox",
      checked: config.muted,
      click: () => toggleMute(),
    },
    {
      label: "Show activity log",
      type: "checkbox",
      checked: config.feed,
      click: () => setFeed(!config.feed),
    },
    { type: "separator" },
    { label: "Reset position", click: () => resetPosition() },
    { label: "Quit pet", click: () => app.quit() },
  ];
  Menu.buildFromTemplate(template).popup({ window: win });
}

// ---------------------------------------------------------------------------
// Drag loop — only moves the window while you're dragging the pet.
// ---------------------------------------------------------------------------
function tick() {
  if (!win || win.isDestroyed()) return;

  if (dragging) {
    const cursor = screen.getCursorScreenPoint();
    const nx = cursor.x - grabX;
    const ny = cursor.y - grabY;
    const dx = nx - lastWinX;
    const dy = ny - lastWinY;
    smoothDX = smoothDX * 0.7 + dx * 0.3;
    lastWinX = nx;
    lastWinY = ny;
    win.setPosition(Math.round(nx), Math.round(ny));
    win.webContents.send("pet:move", {
      dx: smoothDX,
      speed: Math.abs(dx) + Math.abs(dy),
    });
  }
}

function checkConnection() {
  if (!win || win.isDestroyed()) return;
  const now = Date.now();

  let lastBeat = 0;
  try {
    lastBeat = parseInt(fs.readFileSync(HEARTBEAT_FILE, "utf8").trim(), 10) || 0;
  } catch {
    /* no heartbeat file */
  }

  // Grace window on startup so the pet doesn't flash "sleeping" before the
  // first heartbeat arrives.
  const connected =
    now - lastBeat < HEARTBEAT_TIMEOUT_MS ||
    now - startedAt < HEARTBEAT_TIMEOUT_MS;

  if (connected) {
    // opencode is running: if we were napping, wake up.
    if (lastState === "sleeping") pushState({ state: "idle" });
  } else {
    // opencode is gone: nap.
    if (lastState !== "sleeping") pushState({ state: "sleeping" });
  }
}

// ---------------------------------------------------------------------------
// State file (written by the opencode plugin)
// ---------------------------------------------------------------------------
function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && STATES.includes(parsed.state)) return parsed;
  } catch {
    /* no state yet */
  }
  return { state: "idle" };
}

function pushState(payload) {
  if (!payload || !STATES.includes(payload.state)) return;
  lastState = payload.state;
  lastStateUpdate = Date.now();
  if (win && !win.isDestroyed()) {
    win.webContents.send("pet:state", payload);
  }
}

function watchState() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch {}
  let timer = null;
  const onChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => pushState(readState()), 30);
  };
  try {
    fs.watch(DIR, (_event, filename) => {
      if (!filename || filename === "state.json") onChange();
    });
  } catch (err) {
    setInterval(onChange, 400);
  }
}

// ---------------------------------------------------------------------------
// Renderer -> main IPC (interactivity + dragging)
// ---------------------------------------------------------------------------
function wireIpc() {
  ipcMain.on("pet:set-ignore", (_e, ignore) => {
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(!!ignore, { forward: true });
    }
  });
  ipcMain.on("pet:drag-start", (_e, off) => {
    if (!win || win.isDestroyed()) return;
    const [wx, wy] = win.getPosition();
    grabX = off && Number.isFinite(off.x) ? off.x : 0;
    grabY = off && Number.isFinite(off.y) ? off.y : 0;
    lastWinX = wx;
    lastWinY = wy;
    smoothDX = 0;
    dragging = true;
  });
  ipcMain.on("pet:drag-end", () => {
    dragging = false;
    smoothDX = 0;
    savePosition();
    if (win && !win.isDestroyed()) {
      win.webContents.send("pet:move", { dx: 0, speed: 0 });
    }
  });
  ipcMain.on("pet:context-menu", () => popupMenu());
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (!gotLock) return;
  if (process.platform === "darwin" && app.dock) app.dock.hide();

  loadConfig();
  writePidFile();
  createWindow();
  watchState();
  wireIpc();
  setInterval(tick, FRAME_MS);
  setInterval(checkConnection, 3000);

  // Quit the pet from anywhere.
  globalShortcut.register("Control+Alt+P", () => app.quit());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  /* another launch attempted — we're already here, ignore. */
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  clearPidFile();
});
