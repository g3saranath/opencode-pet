"use strict";

const { app, BrowserWindow, screen, globalShortcut, ipcMain, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const { DIR, PID_FILE, HEARTBEAT_FILE, STATES } = require("../shared/paths");
const { readState } = require("../shared/state-protocol");
const { isProcessAlive } = require("../shared/process-alive");
const { createConnectionMonitor } = require("../shared/connection-monitor");
const {
  DEFAULT_CONFIG,
  readConfig,
  updateConfig,
  readPosition,
  writePosition,
} = require("../shared/pet-config");
const { normalizeDragOffset, normalizeStatePayload } = require("../shared/ipc-validation");
const { SHORTCUT, claimShortcut, releaseShortcut } = require("../shared/shortcut-owner");

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
// Once asleep, wait this long before exiting entirely, so a brief opencode
// restart wakes the existing pet instead of leaving an orphaned window.
const SLEEP_QUIT_MS = 15 * 1000;
const HIDDEN_FILE = path.join(DIR, "hidden");

const SIZES = [
  { label: "Small", scale: 0.8 },
  { label: "Medium", scale: 1.0 },
  { label: "Large", scale: 1.3 },
  { label: "Huge", scale: 1.6 },
];

// The single source of truth for defaults and ranges. Anything read from disk
// or from the GUI is passed through this normalizer, so the Electron process
// and the settings page cannot disagree about what a valid config looks like.
let config = { ...DEFAULT_CONFIG };

let win = null;
let lastStateUpdate = Date.now();
let lastState = "idle";
const startedAt = Date.now();

// Counts consecutive missed heartbeats so a single stale read cannot sleep the
// pet. A valid heartbeat resets the counter; 15s after the first miss the
// monitor reports "quit" and the overlay exits.
const connection = createConnectionMonitor({
  heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
  sleepQuitMs: SLEEP_QUIT_MS,
});

// Drag state
let dragging = false;
let grabX = 0;
let grabY = 0;
let lastWinX = 0;
let lastWinY = 0;
let smoothDX = 0;

// ---------------------------------------------------------------------------
// Timers
//
// Every recurring timer is owned by this registry. That matters on window
// recreate and on quit: a leaked interval keeps reading files, moving the
// window, or spawning probes after the pet is supposed to be gone. The drag
// loop and the cursor hit-test are separate because they are armed only while
// they are useful (drag in progress / window visible).
// ---------------------------------------------------------------------------
const timers = new Map();
let dragTimer = null;
let cursorTimer = null;
let stateWatcher = null;
let stateDebounceTimer = null;
let ipcWired = false;
// Click-through as last applied, so the 50ms cursor watch only calls into
// Electron when the answer actually changes.
let ignoringMouse = true;
let quitShortcutHeld = false;

function startTimer(name, fn, ms) {
  stopTimer(name);
  timers.set(name, setInterval(fn, ms));
}

function stopTimer(name) {
  const id = timers.get(name);
  if (id !== undefined) {
    clearInterval(id);
    timers.delete(name);
  }
}

function stopAllTimers() {
  for (const id of timers.values()) clearInterval(id);
  timers.clear();
  disarmDragLoop();
  stopCursorWatch();
  stopStateWatch();
}

function armDragLoop() {
  if (dragTimer) return;
  dragTimer = setInterval(tick, FRAME_MS);
}

function disarmDragLoop() {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
}

function startCursorWatch() {
  if (cursorTimer) return;
  cursorTimer = setInterval(watchCursorTick, 50);
}

function stopCursorWatch() {
  if (cursorTimer) {
    clearInterval(cursorTimer);
    cursorTimer = null;
  }
}

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
// Config persistence
//
// config.json is shared with the settings page, which edits it while the pet
// runs. The file is the source of truth: the overlay adopts it on every poll
// (applyExternalConfig) and never writes its whole in-memory copy back. A
// change made here (right-click menu) writes only the fields it changed,
// merged into what is on disk right now, so a settings-page edit from a moment
// ago is never overwritten with this process's older copy.
// ---------------------------------------------------------------------------
function loadConfig() {
  config = readConfig({ dir: DIR });
}
function persistConfig(patch) {
  updateConfig(patch, { dir: DIR });
}
function sendConfig() {
  if (win && !win.isDestroyed()) win.webContents.send("pet:config", { ...config });
}
function sendVisibility(visible) {
  if (win && !win.isDestroyed()) win.webContents.send("pet:visibility", Boolean(visible));
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
  return readPosition({ dir: DIR });
}
function savePosition() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  writePosition({ x, y }, { dir: DIR });
}
function defaultPosition() {
  const wa = screen.getPrimaryDisplay().workArea;
  const { w, h } = winSize();
  return { x: wa.x + wa.width - w - 24, y: wa.y + wa.height - h - 24 };
}

function nearestWorkArea(x, y) {
  const displays = screen.getAllDisplays();
  for (const display of displays) {
    const wa = display.workArea;
    if (x >= wa.x && x < wa.x + wa.width && y >= wa.y && y < wa.y + wa.height) {
      return wa;
    }
  }
  let best = displays[0] ? displays[0].workArea : screen.getPrimaryDisplay().workArea;
  let bestDistance = Infinity;
  for (const display of displays) {
    const wa = display.workArea;
    const cx = wa.x + wa.width / 2;
    const cy = wa.y + wa.height / 2;
    const distance = Math.hypot(cx - x, cy - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = wa;
    }
  }
  return best;
}

function clampPosition(pos, size) {
  const { w, h } = size || currentWindowSize();
  const wa = nearestWorkArea(pos.x, pos.y);
  return {
    x: Math.round(Math.min(Math.max(pos.x, wa.x), wa.x + wa.width - w)),
    y: Math.round(Math.min(Math.max(pos.y, wa.y), wa.y + wa.height - h)),
  };
}

// Windows can hand back a window a few pixels larger than the size we asked
// for, so clamping has to use the real window, not the requested size. A
// mismatch here is what used to push the pet past the screen edge.
function currentWindowSize() {
  if (win && !win.isDestroyed()) {
    const b = win.getBounds();
    if (b.width > 0 && b.height > 0) return { w: b.width, h: b.height };
  }
  return winSize();
}

function createWindow() {
  const rawPos = loadPosition() || defaultPosition();
  const pos = clampPosition(rawPos);
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

  // Windows sometimes creates the window a few pixels taller than requested.
  // Re-applying the content size once makes the transparent overlay match the
  // stage exactly, so nothing is clipped and clamping stays accurate.
  win.setContentSize(w, h);

  // Float above everything, on every space, even over fullscreen apps.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Click-through by default; the cursor watch below flips this off only
  // while the cursor is over the pet (so you can grab it), and back on
  // otherwise (so clicks pass through the log and the empty area).
  win.setIgnoreMouseEvents(true, { forward: true });
  ignoringMouse = true;

  win.webContents.on("did-finish-load", () => {
    sendConfig();
    pushState(readState());
    sendVisibility(win && !win.isDestroyed() ? win.isVisible() : false);
  });

  // A recreated window must not inherit the previous window's loops. The
  // interval helpers are idempotent, but the handlers below also make sure the
  // old loops stop the moment the old window goes away.
  win.on("hide", () => {
    stopCursorWatch();
    sendVisibility(false);
  });
  win.on("show", () => {
    startCursorWatch();
    sendVisibility(true);
  });
  win.on("closed", () => {
    win = null;
    disarmDragLoop();
    stopCursorWatch();
  });

  startCursorWatch();
}

// ---------------------------------------------------------------------------
// Resizing. `config` already holds the new scale / feed; this fits the window
// to it, either around its centre (scale) or with the top-left fixed so the
// log grows and shrinks downward (feed).
// ---------------------------------------------------------------------------
function resizeWindow(anchor) {
  if (!win || win.isDestroyed()) return;
  const b = win.getContentBounds();
  const { w, h } = winSize();
  const target =
    anchor === "center"
      ? { x: Math.round(b.x + b.width / 2 - w / 2), y: Math.round(b.y + b.height / 2 - h / 2) }
      : { x: b.x, y: b.y };
  const pos = clampPosition(target, { w, h });
  win.setContentBounds({ x: pos.x, y: pos.y, width: w, height: h });
  savePosition();
}

// Right-click menu actions. Each one persists only the field it changes.
function setScale(scale) {
  if (!win || win.isDestroyed()) return;
  config.scale = scale;
  resizeWindow("center");
  persistConfig({ scale });
  sendConfig();
}

function toggleMute() {
  config.muted = !config.muted;
  persistConfig({ muted: config.muted });
  sendConfig();
}

function setFeed(on) {
  if (!win || win.isDestroyed()) return;
  config.feed = on;
  resizeWindow("top-left");
  persistConfig({ feed: on });
  sendConfig();
}

function resetPosition() {
  if (!win || win.isDestroyed()) return;
  const p = defaultPosition();
  moveTo(Math.round(p.x), Math.round(p.y));
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
// Visibility
//
// `config.visible` is the user's intent, persisted by the GUI. The `hidden`
// file is a transient fullscreen suppression written by the plugin. Effective
// visibility is the AND of the two. Showing or hiding the window here must
// never rewrite the intent, or a fullscreen hide would look like the user
// turned the pet off forever.
// ---------------------------------------------------------------------------
function readHiddenFlag() {
  try {
    const raw = fs.readFileSync(HIDDEN_FILE, "utf8").trim();
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

function showPet() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  const rawPos = loadPosition() || defaultPosition();
  const pos = clampPosition(rawPos);
  moveTo(pos.x, pos.y);
  win.show();
  win.setAlwaysOnTop(true, "screen-saver");
}

function hidePet() {
  if (!win || win.isDestroyed()) return;
  savePosition();
  win.hide();
}

function applyVisibility() {
  if (!win || win.isDestroyed()) return;
  const shouldShow = config.visible !== false && !readHiddenFlag();
  if (shouldShow && !win.isVisible()) showPet();
  else if (!shouldShow && win.isVisible()) hidePet();
}

function tick() {
  if (!win || win.isDestroyed()) {
    disarmDragLoop();
    return;
  }
  if (!dragging) {
    disarmDragLoop();
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const clamped = clampPosition({ x: cursor.x - grabX, y: cursor.y - grabY });
  const nx = clamped.x;
  const ny = clamped.y;
  if (nx === lastWinX && ny === lastWinY) return;
  const dx = nx - lastWinX;
  const dy = ny - lastWinY;
  smoothDX = smoothDX * 0.7 + dx * 0.3;
  lastWinX = nx;
  lastWinY = ny;
  moveTo(nx, ny);
  win.webContents.send("pet:move", {
    dx: smoothDX,
    speed: Math.abs(dx) + Math.abs(dy),
  });
}

// Moves without letting the window drift.
//
// On Windows every plain setPosition() on this frameless transparent window
// can nudge the height by a pixel, and a drag calls it dozens of times a
// second, so the overlay slowly grew past its artwork. Setting content bounds
// explicitly pins the size as well as the position.
function moveTo(x, y) {
  if (!win || win.isDestroyed()) return;
  const { w, h } = winSize();
  const b = win.getContentBounds();
  if (b.x === x && b.y === y && b.width === w && b.height === h) return;
  win.setContentBounds({ x, y, width: w, height: h });
}

// The part of the window that catches the mouse: the pet itself, i.e. the top
// BASE_W x BASE_H of the stage, scaled from the top-left (see #stage and .pet
// in style.css). The activity log below it stays click-through, so clicks
// there reach the app underneath. The hit test runs here in screen space
// rather than in the renderer, whose test through the CSS-scaled stage missed
// the pet on some display scales.
function petHitRect(bounds, scale) {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.min(bounds.width, Math.round(BASE_W * s)),
    height: Math.min(bounds.height, Math.round(BASE_H * s)),
  };
}

function setIgnoreMouse(ignore) {
  if (!win || win.isDestroyed()) return;
  if (ignore === ignoringMouse) return;
  ignoringMouse = ignore;
  win.setIgnoreMouseEvents(ignore, { forward: true });
}

function watchCursorTick() {
  if (!win || win.isDestroyed() || !win.isVisible() || dragging) return;
  const pt = screen.getCursorScreenPoint();
  const r = petHitRect(win.getContentBounds(), config.scale);
  const inside = pt.x >= r.x && pt.x < r.x + r.width && pt.y >= r.y && pt.y < r.y + r.height;
  setIgnoreMouse(!inside);
}

function checkConnection() {
  if (!win || win.isDestroyed()) return;
  const now = Date.now();

  let lastBeat = 0;
  let heartbeatPid = 0;
  try {
    const raw = fs.readFileSync(HEARTBEAT_FILE, "utf8").trim();
    const parts = raw.split(/\s+/);
    lastBeat = parseInt(parts[0], 10) || 0;
    heartbeatPid = parseInt(parts[1], 10) || 0;
  } catch {
    /* no heartbeat file */
  }

  // If the heartbeat carries a pid, require that process to still be alive.
  // This pins the pet to the opencode instance that actually launched it, so
  // a second server writing fresh timestamps with its own pid cannot keep the
  // pet awake after its owner exits. Heartbeats without a pid (older plugin)
  // fall back to the timestamp alone.
  const pidAlive = heartbeatPid ? isProcessAlive(heartbeatPid) : true;

  const status = connection.sample({ now, lastBeat, pidAlive, startedAt });

  if (status === "connected") {
    // opencode is running: if we were napping, wake up.
    if (lastState === "sleeping") pushState({ state: "idle" });
    return;
  }

  if (status === "quit") {
    app.quit();
    return;
  }

  // opencode is gone: nap, then fully exit so a later opencode start can
  // relaunch a fresh pet without an orphaned sleeping window hanging around.
  if (lastState !== "sleeping") {
    pushState({ state: "sleeping" });
  }
}

// ---------------------------------------------------------------------------
// State file (written by the opencode plugin, read via shared/state-protocol)
// ---------------------------------------------------------------------------

// Settings page -> overlay. Adopt the file wholesale, then apply side effects
// for whatever changed. Nothing is written back from here: a write-back races
// the settings page and can revert a field it changed in the same poll window
// (for example "hide" right after a scale change).
function applyExternalConfig() {
  const next = readConfig({ dir: DIR });
  if (!process.env.OPENCODE_PET_FORCE && next.enabled === false) {
    app.quit();
    return;
  }

  const prev = config;
  config = next;

  const scaleChanged = next.scale !== prev.scale;
  const feedChanged = next.feed !== prev.feed;
  if (scaleChanged) resizeWindow("center");
  else if (feedChanged) resizeWindow("top-left");

  if (
    scaleChanged ||
    feedChanged ||
    next.muted !== prev.muted ||
    next.animationSpeed !== prev.animationSpeed ||
    next.pet !== prev.pet
  ) {
    sendConfig();
  }

  if (next.visible !== prev.visible) applyVisibility();
}

function applyExternalHidden() {
  applyVisibility();
}

function applyExternalPosition() {
  if (!win || win.isDestroyed()) return;
  if (dragging) return;
  const pos = readPosition({ dir: DIR });
  if (!pos) return;
  const clamped = clampPosition(pos);
  pos.x = clamped.x;
  pos.y = clamped.y;
  const [x, y] = win.getPosition();
  if (Math.round(pos.x) === x && Math.round(pos.y) === y) return;
  moveTo(Math.round(pos.x), Math.round(pos.y));
  lastWinX = pos.x;
  lastWinY = pos.y;
}

function pushState(payload) {
  // Defense in depth: readState already rejects unknown states, but the same
  // payload also crosses into the renderer, so normalize it once more.
  const safe = normalizeStatePayload(payload, STATES);
  if (!safe) return;
  lastState = safe.state;
  lastStateUpdate = Date.now();
  if (win && !win.isDestroyed()) {
    win.webContents.send("pet:state", safe);
  }
}

function watchState() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch {}
  const onChange = () => {
    if (stateDebounceTimer) clearTimeout(stateDebounceTimer);
    stateDebounceTimer = setTimeout(() => {
      stateDebounceTimer = null;
      pushState(readState());
    }, 30);
  };
  try {
    stateWatcher = fs.watch(DIR, (_event, filename) => {
      if (!filename || filename === "state.json") onChange();
    });
  } catch (err) {
    startTimer("state-poll", onChange, 400);
  }
}

function stopStateWatch() {
  if (stateWatcher) {
    try {
      stateWatcher.close();
    } catch {}
    stateWatcher = null;
  }
  if (stateDebounceTimer) {
    clearTimeout(stateDebounceTimer);
    stateDebounceTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Renderer -> main IPC (interactivity + dragging)
//
// Every channel is sender-checked and schema-checked. The renderer is the only
// trusted caller, and even it may send a malformed payload after a hot reload
// or a bug; invalid input is dropped rather than coerced.
// ---------------------------------------------------------------------------
function isTrustedSender(event) {
  if (!win || win.isDestroyed()) return false;
  if (!event || !event.sender) return false;
  return event.sender === win.webContents;
}

function wireIpc() {
  if (ipcWired) return;
  ipcWired = true;

  ipcMain.on("pet:drag-start", (event, offset) => {
    if (!isTrustedSender(event)) return;
    if (!win || win.isDestroyed()) return;
    const safeOffset = normalizeDragOffset(offset);
    if (!safeOffset) return;
    const [wx, wy] = win.getPosition();
    grabX = safeOffset.x;
    grabY = safeOffset.y;
    lastWinX = wx;
    lastWinY = wy;
    smoothDX = 0;
    dragging = true;
    armDragLoop();
  });

  ipcMain.on("pet:drag-end", (event) => {
    if (!isTrustedSender(event)) return;
    dragging = false;
    disarmDragLoop();
    smoothDX = 0;
    savePosition();
    if (win && !win.isDestroyed()) {
      win.webContents.send("pet:move", { dx: 0, speed: 0 });
    }
  });

  ipcMain.on("pet:context-menu", (event) => {
    if (!isTrustedSender(event)) return;
    popupMenu();
  });
}

// ---------------------------------------------------------------------------
// Quit shortcut
//
// Ctrl+Alt+Shift+P quits the pet from anywhere (not Ctrl+Alt+P, which
// OpenCode uses). The optional GUI plugin binds the same key as a start / stop
// switch, because a stopped overlay cannot start itself. shared/shortcut-owner
// makes sure only one of the two processes holds the key at a time; whichever
// is not holding it retries, so the key keeps working when the other goes away.
// ---------------------------------------------------------------------------
function registerQuitShortcut() {
  if (quitShortcutHeld) return;
  if (!claimShortcut(DIR)) return;
  try {
    quitShortcutHeld = globalShortcut.register(SHORTCUT, () => app.quit());
  } catch {
    quitShortcutHeld = false;
  }
  if (!quitShortcutHeld) releaseShortcut(DIR);
}

function releaseQuitShortcut() {
  if (quitShortcutHeld) {
    try {
      globalShortcut.unregisterAll();
    } catch {}
    quitShortcutHeld = false;
  }
  releaseShortcut(DIR);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (!gotLock) return;
  if (process.platform === "darwin" && app.dock) app.dock.hide();

  const initial = readConfig({ dir: DIR });
  if (!process.env.OPENCODE_PET_FORCE && initial.enabled === false) {
    app.quit();
    return;
  }

  loadConfig();
  // A stale fullscreen flag from a previous session must not hide the pet.
  try {
    fs.unlinkSync(HIDDEN_FILE);
  } catch {}
  writePidFile();
  createWindow();
  watchState();
  wireIpc();
  startTimer("connection", checkConnection, 3000);
  startTimer("config", applyExternalConfig, 2000);
  startTimer("position", applyExternalPosition, 2000);
  startTimer("hidden", applyExternalHidden, 1000);
  registerQuitShortcut();
  startTimer("shortcut", registerQuitShortcut, 5000);

  // The visibility intent may have been persisted as false by the settings
  // page. Apply it now, after the window exists.
  applyVisibility();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  /* another launch attempted — we're already here, ignore. */
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  stopAllTimers();
  releaseQuitShortcut();
  clearPidFile();
});
