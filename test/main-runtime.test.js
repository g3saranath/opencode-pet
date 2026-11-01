"use strict";

// Regression guard for the Electron main process.
//
// app/main.js is not exported, so this test loads it in a sandbox with mocked
// Electron modules, exposes the file-level functions, and calls the ones that
// run on a timer. A missing import or a stale helper name shows up here as the
// same ReferenceError the desktop app would crash on.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const mainFile = path.join(__dirname, "..", "app", "main.js");

function createHarness(options = {}) {
  const dir = options.dir || fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-main-"));
  const positions = [];
  const config = {
    enabled: true,
    autoLaunch: true,
    scale: 1.0,
    muted: false,
    feed: false,
    animationSpeed: 1.0,
    autoHideFullscreen: false,
    pet: "scrybe",
    ...(options.config || {}),
  };

  const fakeWin = {
    isDestroyed: () => false,
    isVisible: () => true,
    getPosition: () => [100, 100],
    setPosition: (x, y) => {
      positions.push([x, y]);
    },
    getContentBounds: () => ({ x: 100, y: 100, width: 240, height: 214 }),
    getBounds: () => ({ x: 100, y: 100, width: 240, height: 214 }),
    setContentBounds: (b) => {
      positions.push([b.x, b.y]);
    },
    webContents: { send: () => {} },
    setIgnoreMouseEvents: () => {},
    setAlwaysOnTop: () => {},
    show: () => {},
    hide: () => {},
  };

  const displays = [
    { workArea: { x: 0, y: 0, width: 1000, height: 800 } },
  ];
  // Mutable so tests can move the cursor between calls.
  const cursor = options.cursor || { x: 0, y: 0 };
  const globalShortcut = options.globalShortcut || {
    register: () => true,
    unregisterAll: () => {},
  };
  let quitCalls = 0;

  const sandbox = {
    console,
    process,
    __dirname: path.dirname(mainFile),
    __filename: mainFile,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === "electron") {
        return {
          app: {
            requestSingleInstanceLock: () => true,
            whenReady: () => new Promise(() => {}),
            on: () => {},
            quit: () => {
              quitCalls++;
            },
            dock: undefined,
          },
          BrowserWindow: class {},
          screen: {
            getPrimaryDisplay: () => displays[0],
            getAllDisplays: () => displays,
            getCursorScreenPoint: () => ({ ...cursor }),
          },
          globalShortcut,
          ipcMain: { on: () => {} },
          Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
        };
      }
      if (request === "../shared/paths") {
        return {
          DIR: dir,
          PID_FILE: path.join(dir, "pet.pid"),
          HEARTBEAT_FILE: path.join(dir, "heartbeat"),
          STATES: ["idle", "thinking", "working", "waiting", "happy", "error", "sleeping"],
        };
      }
      if (request === "../shared/state-protocol") {
        return { readState: () => ({ state: "idle" }) };
      }
      if (request === "../shared/process-alive") {
        return { isProcessAlive: () => true };
      }
      if (request === "../shared/connection-monitor") {
        return { createConnectionMonitor: () => ({ sample: () => "connected" }) };
      }
      if (request === "../shared/pet-config") {
        // The real normalizer, pointed at the sandbox directory. Using the
        // production module here is the point: the app must not keep a second,
        // drifting copy of the config rules.
        return require("../shared/pet-config");
      }
      return require(request);
    },
  };

  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const source = fs.readFileSync(mainFile, "utf8");
  const exposure = [
    "",
    "module.exports = {",
    "  applyExternalPosition,",
    "  applyExternalConfig,",
    "  applyExternalHidden,",
    "  applyVisibility,",
    "  clampPosition,",
    "  winSize,",
    "  isTrustedSender,",
    "  startTimer,",
    "  stopAllTimers,",
    "  armDragLoop,",
    "  disarmDragLoop,",
    "  startCursorWatch,",
    "  stopCursorWatch,",
    "  watchCursorTick,",
    "  petHitRect,",
    "  setScale,",
    "  setFeed,",
    "  toggleMute,",
    "  registerQuitShortcut,",
    "  releaseQuitShortcut,",
    "  __timerNames: () => Array.from(timers.keys()),",
    "  __dragActive: () => dragTimer !== null,",
    "  __cursorActive: () => cursorTimer !== null,",
    "  __getConfig: () => config,",
    "  __setConfig: (next) => { config = next; },",
    "  __setWin: (next) => { win = next; },",
    "  __setDragging: (next) => { dragging = next; },",
    "  __shortcutHeld: () => quitShortcutHeld,",
    "};",
  ].join("\n");

  vm.runInContext(source + exposure, sandbox, { filename: mainFile });

  return {
    sandbox,
    dir,
    positions,
    fakeWin,
    cursor,
    exports: sandbox.module.exports,
    config,
    quitCalls: () => quitCalls,
  };
}

test("applyExternalPosition runs on a timer without a ReferenceError", () => {
  const h = createHarness();
  try {
    // A position that needs clamping, so the function actually does work.
    fs.writeFileSync(path.join(h.dir, "pos.json"), JSON.stringify({ x: 900, y: 700 }));
    h.exports.__setWin(h.fakeWin);
    h.exports.__setDragging(false);

    assert.doesNotThrow(() => h.exports.applyExternalPosition());
    assert.deepEqual(h.positions.at(-1), [760, 586]);
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("applyExternalPosition tolerates no window", () => {
  const h = createHarness();
  try {
    h.exports.__setWin(null);
    assert.doesNotThrow(() => h.exports.applyExternalPosition());
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("clampPosition uses the real window size, not the requested one", () => {
  const h = createHarness();
  try {
    // Windows can hand back a window a few pixels bigger than asked. Clamping
    // to the requested size would then push the pet past the screen edge.
    h.exports.__setWin({
      isDestroyed: () => false,
      getBounds: () => ({ x: 0, y: 0, width: 232, height: 243 }),
    });
    const pos = h.exports.clampPosition({ x: 9999, y: 9999 });
    assert.equal(pos.x, 768);
    assert.equal(pos.y, 557);
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("clampPosition honours an explicit size argument", () => {
  const h = createHarness();
  try {
    h.exports.__setWin(null);
    const pos = h.exports.clampPosition({ x: 9999, y: 9999 }, { w: 300, h: 400 });
    assert.equal(pos.x, 700);
    assert.equal(pos.y, 400);
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("applyExternalConfig runs with a live window and defaults", () => {
  const h = createHarness();
  try {
    h.exports.__setWin(h.fakeWin);
    assert.doesNotThrow(() => h.exports.applyExternalConfig());
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("applyExternalHidden runs with a live window", () => {
  const h = createHarness();
  try {
    h.exports.__setWin(h.fakeWin);
    assert.doesNotThrow(() => h.exports.applyExternalHidden());
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("named timers replace instead of stacking", () => {
  const h = createHarness();
  try {
    h.exports.startTimer("probe", () => {}, 10);
    h.exports.startTimer("probe", () => {}, 10);
    h.exports.startTimer("beat", () => {}, 10);
    assert.deepEqual(Array.from(h.exports.__timerNames()).sort(), ["beat", "probe"]);
  } finally {
    h.exports.stopAllTimers();
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("stopAllTimers disarms the drag loop and cursor watch", () => {
  const h = createHarness();
  try {
    h.exports.__setWin(h.fakeWin);
    h.exports.__setDragging(true);
    h.exports.armDragLoop();
    h.exports.armDragLoop();
    assert.equal(h.exports.__dragActive(), true, "drag loop armed once");

    h.exports.startCursorWatch();
    h.exports.startCursorWatch();
    assert.equal(h.exports.__cursorActive(), true, "cursor watch armed once");

    h.exports.stopAllTimers();
    assert.equal(h.exports.__dragActive(), false);
    assert.equal(h.exports.__cursorActive(), false);
    assert.deepEqual(Array.from(h.exports.__timerNames()), []);
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("visibility is the AND of user intent and the fullscreen flag", () => {
  const h = createHarness();
  try {
    let visible = true;
    const win = {
      ...h.fakeWin,
      isVisible: () => visible,
      show: () => {
        visible = true;
      },
      hide: () => {
        visible = false;
      },
    };
    h.exports.__setWin(win);

    // User hid the pet.
    h.exports.__setConfig({ ...h.exports.__getConfig(), visible: false });
    h.exports.applyVisibility();
    assert.equal(visible, false, "intent false hides");

    // User wants it shown again, no fullscreen suppression.
    h.exports.__setConfig({ ...h.exports.__getConfig(), visible: true });
    h.exports.applyVisibility();
    assert.equal(visible, true, "intent true shows");

    // A fullscreen app suppresses it without changing the intent.
    fs.writeFileSync(path.join(h.dir, "hidden"), "1");
    h.exports.applyVisibility();
    assert.equal(visible, false, "fullscreen flag hides");
    assert.equal(h.exports.__getConfig().visible, true, "intent is preserved");

    // Fullscreen ends: the pet comes back because the intent is still true.
    fs.unlinkSync(path.join(h.dir, "hidden"));
    h.exports.applyVisibility();
    assert.equal(visible, true, "pet returns after fullscreen");
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("IPC sender validation rejects anything but the live window", () => {
  const h = createHarness();
  try {
    h.exports.__setWin(null);
    assert.equal(h.exports.isTrustedSender({ sender: h.fakeWin.webContents }), false);

    h.exports.__setWin(h.fakeWin);
    assert.equal(h.exports.isTrustedSender({ sender: h.fakeWin.webContents }), true);
    assert.equal(h.exports.isTrustedSender({ sender: {} }), false);
    assert.equal(h.exports.isTrustedSender(null), false);
    assert.equal(h.exports.isTrustedSender({}), false);
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Config ownership: the settings page and the overlay share config.json.
// ---------------------------------------------------------------------------
const petConfig = require("../shared/pet-config");
const { SHORTCUT, OWNER_FILE_NAME } = require("../shared/shortcut-owner");

function liveWin(h, bounds = { x: 100, y: 100, width: 240, height: 214 }) {
  let visible = true;
  const ignoreCalls = [];
  const win = {
    ...h.fakeWin,
    isVisible: () => visible,
    show: () => {
      visible = true;
    },
    hide: () => {
      visible = false;
    },
    getContentBounds: () => ({ ...bounds }),
    getBounds: () => ({ ...bounds }),
    setIgnoreMouseEvents: (value) => ignoreCalls.push(value),
  };
  h.exports.__setWin(win);
  return { win, ignoreCalls, isVisible: () => visible };
}

test("a settings-page edit is never reverted by a change the overlay applies in the same poll", () => {
  // Each patch pairs a field with a side effect (scale / feed) with one that has
  // none. The overlay used to save its whole in-memory config while applying
  // the first, writing the stale second one back to disk.
  const patches = [
    { scale: 1.3, visible: false },
    { scale: 1.3, autoLaunch: false },
    { feed: false, autoHideFullscreen: true },
    { muted: true, animationSpeed: 1.5, visible: false },
  ];
  for (const patch of patches) {
    const h = createHarness();
    try {
      petConfig.writeConfig({}, { dir: h.dir });
      h.exports.__setConfig(petConfig.readConfig({ dir: h.dir }));
      const w = liveWin(h);

      petConfig.updateConfig(patch, { dir: h.dir });
      h.exports.applyExternalConfig();
      h.exports.applyExternalConfig();

      const disk = petConfig.readConfig({ dir: h.dir });
      for (const [key, value] of Object.entries(patch)) {
        assert.equal(disk[key], value, `${JSON.stringify(patch)}: disk ${key}`);
        assert.equal(h.exports.__getConfig()[key], value, `${JSON.stringify(patch)}: memory ${key}`);
      }
      if (patch.visible === false) assert.equal(w.isVisible(), false, "the pet stays hidden");
    } finally {
      fs.rmSync(h.dir, { recursive: true, force: true });
    }
  }
});

test("the config poll never writes config.json", () => {
  const h = createHarness();
  try {
    petConfig.writeConfig({ scale: 1.3, feed: false, visible: false }, { dir: h.dir });
    const file = path.join(h.dir, "config.json");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(file, old, old);
    const before = fs.readFileSync(file, "utf8");

    h.exports.__setConfig({ ...petConfig.DEFAULT_CONFIG });
    liveWin(h);
    h.exports.applyExternalConfig();

    assert.equal(fs.readFileSync(file, "utf8"), before);
    // A rewrite would move the mtime to "now", a minute after the old stamp.
    assert.ok(Math.abs(fs.statSync(file).mtimeMs - old.getTime()) < 1000, "file untouched");
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("a right-click menu change writes only its own field", () => {
  const h = createHarness();
  try {
    // The settings page turned these off a moment ago; the overlay has not
    // polled yet, so its memory still says true.
    petConfig.writeConfig({ visible: false, autoLaunch: false }, { dir: h.dir });
    h.exports.__setConfig({ ...petConfig.DEFAULT_CONFIG });
    liveWin(h);

    h.exports.setScale(1.3);
    h.exports.toggleMute();
    h.exports.setFeed(false);

    const disk = petConfig.readConfig({ dir: h.dir });
    assert.equal(disk.scale, 1.3);
    assert.equal(disk.muted, true);
    assert.equal(disk.feed, false);
    assert.equal(disk.visible, false, "settings-page edit kept");
    assert.equal(disk.autoLaunch, false, "settings-page edit kept");
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Click-through: only the pet catches the mouse.
// ---------------------------------------------------------------------------
test("only the pet catches the mouse; the activity log stays click-through", () => {
  const h = createHarness();
  try {
    h.exports.__setConfig({ ...petConfig.DEFAULT_CONFIG, scale: 1, feed: true });
    // Window with the log open: 240 x (214 + 178).
    const w = liveWin(h, { x: 100, y: 100, width: 240, height: 392 });
    h.exports.__setDragging(false);

    h.cursor.x = 150;
    h.cursor.y = 150; // over the pet
    h.exports.watchCursorTick();
    h.exports.watchCursorTick(); // unchanged: no second call into Electron
    h.cursor.y = 400; // over the activity log
    h.exports.watchCursorTick();
    h.cursor.x = 50;
    h.cursor.y = 50; // outside the window
    h.exports.watchCursorTick();

    assert.deepEqual(w.ignoreCalls, [false, true]);
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("the pet hit area scales with the pet and never exceeds the window", () => {
  const h = createHarness();
  try {
    // Spread: the result is created inside the vm realm.
    assert.deepEqual({ ...h.exports.petHitRect({ x: 10, y: 20, width: 384, height: 627 }, 1.6) }, {
      x: 10,
      y: 20,
      width: 384,
      height: 342,
    });
    assert.deepEqual({ ...h.exports.petHitRect({ x: 0, y: 0, width: 200, height: 100 }, 1) }, {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Quit shortcut, coordinated with the GUI plugin through shortcut.owner.
// ---------------------------------------------------------------------------
function recordingShortcut(result = true) {
  const calls = { register: [], unregisterAll: 0, handler: null };
  return {
    calls,
    api: {
      register: (accelerator, handler) => {
        calls.register.push(accelerator);
        calls.handler = handler;
        return result;
      },
      unregisterAll: () => {
        calls.unregisterAll++;
      },
    },
  };
}

test("the overlay registers the quit shortcut when nobody else holds it", () => {
  const gs = recordingShortcut();
  const h = createHarness({ globalShortcut: gs.api });
  try {
    h.exports.registerQuitShortcut();
    assert.deepEqual(gs.calls.register, [SHORTCUT]);
    assert.equal(h.exports.__shortcutHeld(), true);
    const owner = path.join(h.dir, OWNER_FILE_NAME);
    assert.equal(fs.readFileSync(owner, "utf8"), String(process.pid));

    gs.calls.handler();
    assert.equal(h.quitCalls(), 1, "the key quits the pet");

    h.exports.releaseQuitShortcut();
    assert.equal(gs.calls.unregisterAll, 1);
    assert.equal(fs.existsSync(owner), false, "claim released on quit");
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("the overlay stays off the key while a live GUI owns it, then takes it over", () => {
  const gs = recordingShortcut();
  const h = createHarness({ globalShortcut: gs.api });
  try {
    const owner = path.join(h.dir, OWNER_FILE_NAME);
    // The parent of the test process stands in for a live OpenCode Desktop.
    fs.writeFileSync(owner, String(process.ppid));
    h.exports.registerQuitShortcut();
    assert.deepEqual(gs.calls.register, [], "no double registration");
    assert.equal(h.exports.__shortcutHeld(), false);

    fs.unlinkSync(owner); // the GUI let go (Desktop closed)
    h.exports.registerQuitShortcut();
    assert.deepEqual(gs.calls.register, [SHORTCUT]);
    assert.equal(h.exports.__shortcutHeld(), true);
  } finally {
    h.exports.releaseQuitShortcut();
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("a refused registration does not keep the claim", () => {
  const gs = recordingShortcut(false);
  const h = createHarness({ globalShortcut: gs.api });
  try {
    h.exports.registerQuitShortcut();
    assert.equal(h.exports.__shortcutHeld(), false);
    assert.equal(fs.existsSync(path.join(h.dir, OWNER_FILE_NAME)), false);
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});
