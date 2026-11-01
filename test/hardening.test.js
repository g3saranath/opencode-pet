"use strict";

// Security and control-flow tests for the hardening pass.
//
// These exercise the real production modules, not copies. Every case is a
// behaviour: what the code returns for hostile input, or which process the
// launcher decides to spawn.

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const { safeEnv, isAllowedKey } = require("../shared/safe-env.js");
const {
  isSafeProcessName,
  SAFE_PROCESS_NAME,
  MAX_PROCESS_NAME_LENGTH,
} = require("../shared/process-name.js");
const { isPathInside } = require("../shared/safe-path.js");
const {
  MAX_DRAG_OFFSET,
  normalizeDragOffset,
  normalizeStatePayload,
} = require("../shared/ipc-validation.js");
const {
  parsePetCommand,
  shortcutAction,
  resolveCommand,
} = require("../shared/pet-control.js");
const {
  DEFAULT_CONFIG,
  normalizeConfig,
  writeConfig,
  readConfig,
} = require("../shared/pet-config.js");
const {
  acquireLaunchLock,
  releaseLaunchLock,
  petAlreadyRunning,
  isSafeCmdPath,
  cmdShimArgs,
  launchPet,
} = require("../shared/pet-launcher.js");

const STATES = ["idle", "thinking", "working", "waiting", "happy", "error", "sleeping"];

function tempDir(prefix = "opencode-pet-hardening-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("safe child environment", () => {
  it("keeps only allow-listed names", () => {
    const env = safeEnv(
      { OPENCODE_PET_DIR: "C:/pet" },
      {
        PATH: "/usr/bin",
        HOME: "/home/me",
        SECRET_TOKEN: "nope",
        AWS_SECRET_ACCESS_KEY: "nope",
        "BAD-KEY": "nope",
        OPENCODE_PET_APP_PROCESS: "OpenCode.exe",
      },
    );
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.HOME, "/home/me");
    assert.equal(env.OPENCODE_PET_APP_PROCESS, "OpenCode.exe");
    assert.equal(env.OPENCODE_PET_DIR, "C:/pet");
    assert.equal(env.SECRET_TOKEN, undefined);
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(env["BAD-KEY"], undefined);
  });

  it("rejects names that look like shell syntax", () => {
    assert.equal(isAllowedKey("PATH"), true);
    assert.equal(isAllowedKey("PATH; rm -rf /"), false);
    assert.equal(isAllowedKey("A B"), false);
    assert.equal(isAllowedKey("$HOME"), false);
  });

  it("keeps what Electron needs to open a Linux display and download itself", () => {
    for (const key of [
      "XAUTHORITY",
      "XDG_SESSION_TYPE",
      "XDG_CURRENT_DESKTOP",
      "ELECTRON_MIRROR",
      "HTTPS_PROXY",
      "https_proxy",
      "NO_PROXY",
    ]) {
      assert.equal(isAllowedKey(key), true, key);
    }
    // Still no general pass-through for Electron or Node behaviour switches.
    assert.equal(isAllowedKey("ELECTRON_RUN_AS_NODE"), false);
    assert.equal(isAllowedKey("NODE_OPTIONS"), false);
  });
});

describe("process name validation", () => {
  it("accepts normal image names", () => {
    for (const name of ["OpenCode.exe", "code", "my-app_2", "a.b.c"]) {
      assert.equal(isSafeProcessName(name), true, name);
    }
  });

  it("rejects names that could change a tasklist or WMI query", () => {
    for (const name of [
      "",
      " ",
      "OpenCode.exe && calc",
      "OpenCode.exe\" or 1=1",
      "..",
      ".",
      "C:\\Windows\\System32\\cmd.exe",
      "a b",
      "a*b",
      "a|b",
      "a\r\nb",
      "x".repeat(MAX_PROCESS_NAME_LENGTH + 1),
      null,
      42,
    ]) {
      assert.equal(isSafeProcessName(name), false, String(name));
    }
    assert.equal(SAFE_PROCESS_NAME.test("OpenCode.exe"), true);
  });
});

describe("path containment", () => {
  let dir;

  beforeEach(() => {
    dir = tempDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a child and rejects a sibling or parent", () => {
    const child = path.join(dir, "node_modules", "electron");
    fs.mkdirSync(child, { recursive: true });
    assert.equal(isPathInside(dir, child), true);
    assert.equal(isPathInside(dir, dir), true);
    assert.equal(isPathInside(dir, path.join(dir, "..", "elsewhere")), false);
    assert.equal(isPathInside(dir, path.join(dir, "..")), false);
    assert.equal(isPathInside("", child), false);
    assert.equal(isPathInside(dir, null), false);
  });
});

describe("IPC payload validation", () => {
  it("accepts a normal drag offset", () => {
    assert.deepEqual(normalizeDragOffset({ x: 12, y: -8 }), { x: 12, y: -8 });
  });

  it("rejects malformed or out-of-range drag offsets", () => {
    for (const bad of [
      null,
      undefined,
      [],
      "12,8",
      { x: "12", y: 8 },
      { x: NaN, y: 8 },
      { x: Infinity, y: 8 },
      { x: MAX_DRAG_OFFSET + 1, y: 0 },
      { x: 0, y: -MAX_DRAG_OFFSET - 1 },
    ]) {
      assert.equal(normalizeDragOffset(bad), null, JSON.stringify(bad));
    }
  });

  it("normalizes a state payload and drops unknown fields", () => {
    const payload = normalizeStatePayload(
      {
        state: "working",
        tool: "bash",
        detail: "npm test",
        evil: "ignored",
        feed: [{ seq: 1, icon: "x", text: "line", kind: "step", extra: "ignored" }],
      },
      STATES,
    );
    assert.deepEqual(payload, {
      state: "working",
      tool: "bash",
      detail: "npm test",
      feed: [{ seq: 1, icon: "x", text: "line", kind: "step" }],
    });
    assert.equal(payload.evil, undefined);
    assert.equal(payload.feed[0].extra, undefined);
  });

  it("rejects an unknown state or a non-object payload", () => {
    assert.equal(normalizeStatePayload({ state: "rm -rf" }, STATES), null);
    assert.equal(normalizeStatePayload(null, STATES), null);
    assert.equal(normalizeStatePayload([], STATES), null);
    assert.equal(normalizeStatePayload({ state: "idle" }, null), null);
  });

  it("caps detail, tool, and feed sizes", () => {
    const payload = normalizeStatePayload(
      {
        state: "idle",
        tool: "t".repeat(500),
        detail: "d".repeat(500),
        feed: Array.from({ length: 60 }, (_, i) => ({
          seq: i,
          icon: "i".repeat(50),
          text: "t".repeat(500),
          kind: "k".repeat(50),
        })),
      },
      STATES,
    );
    assert.equal(payload.tool.length, 64);
    assert.equal(payload.detail.length, 200);
    assert.equal(payload.feed.length, 24);
    assert.equal(payload.feed[0].icon.length, 8);
    assert.equal(payload.feed[0].text.length, 200);
    assert.equal(payload.feed[0].kind.length, 16);
  });
});

describe("/pet command semantics", () => {
  it("parses every documented form", () => {
    assert.equal(parsePetCommand("").action, "toggle");
    assert.equal(parsePetCommand(" ON ").action, "on");
    assert.equal(parsePetCommand("show").action, "on");
    assert.equal(parsePetCommand("off").action, "off");
    assert.equal(parsePetCommand("hide").action, "off");
    assert.equal(parsePetCommand("toggle").action, "toggle");
    assert.equal(parsePetCommand("restart").action, "restart");
    assert.equal(parsePetCommand("status").action, "status");
    assert.equal(parsePetCommand("nonsense").action, "toggle");
  });

  it("on starts only when stopped and always shows", () => {
    assert.deepEqual(resolveCommand("on", { running: true, visible: false }), {
      start: false,
      show: true,
      stop: false,
    });
    assert.deepEqual(resolveCommand("on", { running: false, visible: false }), {
      start: true,
      show: true,
      stop: false,
    });
  });

  it("off hides without killing the process", () => {
    assert.deepEqual(resolveCommand("off", { running: true, visible: true }), {
      start: false,
      show: false,
      stop: false,
    });
  });

  it("toggle flips visibility and never kills", () => {
    assert.deepEqual(resolveCommand("toggle", { running: true, visible: true }), {
      start: false,
      show: false,
      stop: false,
    });
    assert.deepEqual(resolveCommand("toggle", { running: true, visible: false }), {
      start: false,
      show: true,
      stop: false,
    });
    assert.deepEqual(resolveCommand("toggle", { running: false, visible: false }), {
      start: true,
      show: true,
      stop: false,
    });
  });

  it("restart stops then starts, and status changes nothing", () => {
    assert.deepEqual(resolveCommand("restart", { running: true, visible: false }), {
      start: true,
      show: true,
      stop: true,
    });
    assert.deepEqual(resolveCommand("status", { running: true, visible: false }), {
      start: false,
      show: false,
      stop: false,
    });
  });

  it("the shortcut is a process switch", () => {
    assert.equal(shortcutAction(true), "stop");
    assert.equal(shortcutAction(false), "start");
  });
});

describe("shared config", () => {
  let dir;

  beforeEach(() => {
    dir = tempDir("opencode-pet-config-hardening-");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("includes visibility in the defaults", () => {
    assert.equal(DEFAULT_CONFIG.visible, true);
    assert.equal(normalizeConfig(null).visible, true);
    assert.equal(normalizeConfig({ visible: false }).visible, false);
    assert.equal(normalizeConfig({ visible: "no" }).visible, true);
  });

  it("round-trips through the shared writer and reader", () => {
    writeConfig({ visible: false, scale: 1.4, enabled: false }, { dir });
    const cfg = readConfig({ dir });
    assert.equal(cfg.visible, false);
    assert.equal(cfg.scale, 1.4);
    assert.equal(cfg.enabled, false);
  });

  it("clamps out-of-range numbers the same way for every caller", () => {
    writeConfig({ scale: 99, animationSpeed: -3 }, { dir });
    const cfg = readConfig({ dir });
    assert.equal(cfg.scale, 2.0);
    assert.equal(cfg.animationSpeed, 0.5);
  });
});

describe("duplicate launch prevention", () => {
  let dir;

  beforeEach(() => {
    dir = tempDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports a live pid and ignores a dead one", () => {
    const pidFile = path.join(dir, "pet.pid");
    fs.writeFileSync(pidFile, "4242");
    assert.equal(petAlreadyRunning({ pidFile, isAlive: () => true }), true);
    assert.equal(petAlreadyRunning({ pidFile, isAlive: () => false }), false);
    fs.unlinkSync(pidFile);
    assert.equal(petAlreadyRunning({ pidFile, isAlive: () => true }), false);
  });

  it("takes the lock once and releases it", () => {
    const first = acquireLaunchLock(dir);
    assert.ok(first, "first claim succeeds");
    assert.equal(acquireLaunchLock(dir), null, "second claim is refused");
    releaseLaunchLock(first);
    const third = acquireLaunchLock(dir);
    assert.ok(third, "claim succeeds after release");
    releaseLaunchLock(third);
  });

  it("reclaims an abandoned lock", () => {
    const file = path.join(dir, "launch.lock");
    fs.writeFileSync(file, "9999");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(file, old, old);
    const lock = acquireLaunchLock(dir, 5000);
    assert.equal(lock, file, "stale lock is replaced");
    releaseLaunchLock(lock);
  });

  it("refuses to launch when the pet is already alive", () => {
    const appDir = path.join(dir, "app");
    const bin = path.join(appDir, "node_modules", "electron", "dist", "electron");
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, "");
    const pidFile = path.join(dir, "pet.pid");
    fs.writeFileSync(pidFile, "4242");

    const result = launchPet({
      appDir,
      pidFile,
      isAlive: () => true,
      skipLock: true,
      platform: "linux",
    });
    assert.deepEqual(result, { launched: false, reason: "already-running" });
  });

  it("rejects a Windows shim path that would change cmd parsing", () => {
    const appDir = path.join(dir, "bad&dir");
    const shim = path.join(appDir, "node_modules", ".bin", "electron.cmd");
    fs.mkdirSync(path.dirname(shim), { recursive: true });
    fs.writeFileSync(shim, "");

    const result = launchPet({
      appDir,
      skipLock: true,
      skipRunningCheck: true,
      platform: "win32",
    });
    assert.deepEqual(result, { launched: false, reason: "unsafe-path" });
  });

  it("validates cmd paths before they reach a shell", () => {
    assert.equal(isSafeCmdPath("C:\\tools\\electron.cmd"), true);
    assert.equal(isSafeCmdPath("C:\\tools\\a&b.cmd"), false);
    assert.equal(isSafeCmdPath("C:\\tools\\a|b.cmd"), false);
    assert.equal(isSafeCmdPath('C:\\tools\\a"b.cmd'), false);
    assert.equal(isSafeCmdPath(""), false);
  });

  it("quotes a shim path with spaces the way cmd /s expects", () => {
    // /s strips the first and last quote after /c, so the whole command needs
    // an outer pair, and Node must pass it through verbatim.
    assert.deepEqual(cmdShimArgs("C:\\Users\\John Smith\\pet\\node_modules\\.bin\\electron.cmd"), [
      "/d",
      "/s",
      "/c",
      '""C:\\Users\\John Smith\\pet\\node_modules\\.bin\\electron.cmd" ."',
    ]);

    const appDir = path.join(dir, "John Smith", "pet");
    const shim = path.join(appDir, "node_modules", ".bin", "electron.cmd");
    fs.mkdirSync(path.dirname(shim), { recursive: true });
    fs.writeFileSync(shim, "");
    const calls = [];
    const result = launchPet({
      appDir,
      skipLock: true,
      skipRunningCheck: true,
      platform: "win32",
      spawn: (cmd, args, options) => {
        calls.push({ cmd, args, options });
        return { on() {}, unref() {} };
      },
    });
    assert.equal(result.launched, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, cmdShimArgs(shim));
    assert.equal(calls[0].options.windowsVerbatimArguments, true);
    assert.equal(calls[0].options.shell, false);
  });

  it("spawns the dist binary directly, without a shell", () => {
    const appDir = path.join(dir, "app");
    const bin = path.join(appDir, "node_modules", "electron", "dist", "electron");
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, "");
    const calls = [];
    const result = launchPet({
      appDir,
      skipLock: true,
      skipRunningCheck: true,
      platform: "linux",
      spawn: (cmd, args, options) => {
        calls.push({ cmd, args, options });
        return { on() {}, unref() {} };
      },
    });
    assert.equal(result.launched, true);
    assert.equal(calls[0].cmd, bin);
    assert.deepEqual(calls[0].args, ["."]);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.windowsVerbatimArguments, undefined);
  });
});

describe("preload subscriptions", () => {
  it("returns an unsubscribe that removes the exact listener", () => {
    const listeners = new Map();
    let exposed;
    const sandbox = {
      module: { exports: {} },
      exports: {},
      require: (request) => {
        if (request === "electron") {
          return {
            contextBridge: {
              exposeInMainWorld: (_name, api) => {
                exposed = api;
              },
            },
            ipcRenderer: {
              on: (channel, fn) => {
                const list = listeners.get(channel) || [];
                list.push(fn);
                listeners.set(channel, list);
              },
              removeListener: (channel, fn) => {
                const list = listeners.get(channel) || [];
                listeners.set(
                  channel,
                  list.filter((entry) => entry !== fn),
                );
              },
              send: () => {},
            },
          };
        }
        return require(request);
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "..", "app", "preload.js"), "utf8"),
      sandbox,
      { filename: "preload.js" },
    );

    assert.ok(exposed, "bridge exposed");
    // The main process owns click-through; the renderer has no way to set it.
    assert.equal(exposed.setIgnore, undefined);
    const seen = [];
    const off = exposed.onVisibility((value) => seen.push(value));
    assert.equal(listeners.get("pet:visibility").length, 1);
    listeners.get("pet:visibility")[0]({}, false);
    assert.deepEqual(seen, [false]);
    off();
    assert.equal(listeners.get("pet:visibility").length, 0);
  });
});
