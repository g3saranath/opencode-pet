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
            quit: () => {},
            dock: undefined,
          },
          BrowserWindow: class {},
          screen: {
            getPrimaryDisplay: () => displays[0],
            getAllDisplays: () => displays,
            getCursorScreenPoint: () => ({ x: 0, y: 0 }),
          },
          globalShortcut: { register: () => true, unregisterAll: () => {} },
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
    "  __timerNames: () => Array.from(timers.keys()),",
    "  __dragActive: () => dragTimer !== null,",
    "  __cursorActive: () => cursorTimer !== null,",
    "  __getConfig: () => config,",
    "  __setConfig: (next) => { config = next; },",
    "  __setWin: (next) => { win = next; },",
    "  __setDragging: (next) => { dragging = next; },",
    "};",
  ].join("\n");

  vm.runInContext(source + exposure, sandbox, { filename: mainFile });

  return { sandbox, dir, positions, fakeWin, exports: sandbox.module.exports, config };
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
