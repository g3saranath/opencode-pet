"use strict";
Object.defineProperties(exports, { __esModule: { value: true }, [Symbol.toStringTag]: { value: "Module" } });
const web = require("solid-js/web");
const effect = require("effect");
const gui = require("@opencode/plugin/gui");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const os__namespace = /* @__PURE__ */ _interopNamespaceDefault(os);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const en = {
  "settings.title": "Pet (Experimental)",
  "settings.note": "This page controls the real floating desktop companion. The companion runs as its own window and stays visible when OpenCode is minimized.",
  "settings.section.status": "Status",
  "settings.section.general": "General",
  "settings.section.pet": "Pet",
  "settings.section.behaviour": "Behaviour",
  "settings.section.packs": "Pet packs",
  "settings.status.running": "Companion",
  "settings.status.state": "Pet state",
  "settings.status.position": "Position",
  "settings.status.yes": "Running",
  "settings.status.no": "Stopped",
  "settings.status.offline": "Offline",
  "settings.enabled.title": "Enable Pets",
  "settings.enabled.description": "Stops the floating companion and all background work when unchecked.",
  "settings.visible.title": "Show pet",
  "settings.visible.description": "Hide the companion without stopping it. /pet off does the same; /pet on brings it back.",
  "settings.autoLaunch.title": "Launch pet automatically when OpenCode starts",
  "settings.autoLaunch.description": "When off, OpenCode does not start the pet. Manual launch from this page, /pet, or the keyboard shortcut still works while Pets are enabled.",
  "settings.active.title": "Active Pet",
  "settings.active.description": "Choose which pet pack the companion draws.",
  "settings.appearance.title": "Appearance",
  "settings.appearance.description": "Scale and animation speed.",
  "settings.behaviour.title": "Behaviour",
  "settings.behaviour.description": "Sound effects, activity feed, fullscreen hiding, and position.",
  "settings.packs.title": "Manage and Import Pets",
  "settings.packs.description": "Open the packs folder and review the available pets.",
  "settings.packs.note": "Custom pack import is not wired into the pet renderer yet. The built-in Scrybe, Clack, and Shane Hollander packs are safe to switch between.",
  "settings.packs.openFolder": "Open packs folder",
  "settings.scale": "Scale",
  "settings.animationSpeed": "Animation Speed",
  "settings.sound": "Sound Effects",
  "settings.feed": "Activity Feed",
  "settings.autoHide": "Auto Hide in Fullscreen",
  "settings.restart": "Restart Pet",
  "settings.resetPosition": "Reset Position",
  "command.title": "Pet: toggle",
  "command.description": "Control the floating desktop companion. Use /pet on, /pet off, /pet restart, or /pet status.",
  "command.restarting": "Restarting the pet",
  "command.status.running": "Pet is running",
  "command.status.stopped": "Pet is stopped",
  "command.status.visible": "visible",
  "command.status.hidden": "hidden",
  "command.status.offline": "no state yet"
};
var _tmpl$ = /* @__PURE__ */ web.template(`<div style="display:flex;flex-direction:column;gap:18px;padding:4px 0"><section style=display:flex;flex-direction:column;gap:10px><h3 style=margin:0;font-size:13px;font-weight:600></h3><div style="display:grid;grid-template-columns:140px 1fr;gap:6px;font-size:13px"><span style=opacity:0.65></span><span></span><span style=opacity:0.65></span><span></span><span style=opacity:0.65></span><span>, </span></div><div style=display:flex;gap:8px;flex-wrap:wrap><button type=button></button><button type=button></button></div></section><section style=display:flex;flex-direction:column;gap:10px><h3 style=margin:0;font-size:13px;font-weight:600></h3><label style=display:flex;align-items:flex-start;gap:10px;cursor:pointer><input type=checkbox style=margin-top:2px><span style=display:flex;flex-direction:column;gap:2px><span style=font-weight:600></span><span style=opacity:0.7;font-size:12px></span></span></label><label style=display:flex;align-items:flex-start;gap:10px;cursor:pointer><input type=checkbox style=margin-top:2px><span style=display:flex;flex-direction:column;gap:2px><span style=font-weight:600></span><span style=opacity:0.7;font-size:12px></span></span></label><label style=display:flex;align-items:flex-start;gap:10px;cursor:pointer><input type=checkbox style=margin-top:2px><span style=display:flex;flex-direction:column;gap:2px><span style=font-weight:600></span><span style=opacity:0.7;font-size:12px></span></span></label></section><section style=display:flex;flex-direction:column;gap:10px><h3 style=margin:0;font-size:13px;font-weight:600></h3><label style=display:flex;flex-direction:column;gap:4px;font-size:13px><span></span><select></select></label><label style=display:flex;flex-direction:column;gap:4px;font-size:13px><span>: </span><input type=range min=0.5 max=2 step=0.05></label><label style=display:flex;flex-direction:column;gap:4px;font-size:13px><span>: </span><input type=range min=0.5 max=2 step=0.05></label></section><section style=display:flex;flex-direction:column;gap:10px><h3 style=margin:0;font-size:13px;font-weight:600></h3><label style=display:flex;align-items:center;gap:8px;font-size:13px><input type=checkbox></label><label style=display:flex;align-items:center;gap:8px;font-size:13px><input type=checkbox></label><label style=display:flex;align-items:center;gap:8px;font-size:13px><input type=checkbox></label></section><section style=display:flex;flex-direction:column;gap:10px><h3 style=margin:0;font-size:13px;font-weight:600></h3><p style=margin:0;opacity:0.7;font-size:12px></p><div style=display:flex;gap:8px;flex-wrap:wrap><button type=button></button></div></section><p style=margin:0;opacity:0.6;font-size:12px>`), _tmpl$2 = /* @__PURE__ */ web.template(`<option>`);
const UNSAFE_CMD_CHARS = /[&|<>^%!"\r\n\0]/;
function isSafeCmdPath(value) {
  return typeof value === "string" && value.length > 0 && !UNSAFE_CMD_CHARS.test(value);
}
function safeHome() {
  try {
    if (typeof os__namespace.homedir === "function") {
      const value = os__namespace.homedir();
      if (typeof value === "string" && value) return value;
    }
  } catch {
  }
  return process.env.HOME || process.env.USERPROFILE || "";
}
function isUsableAppDir(dir) {
  if (typeof dir !== "string" || !dir) return false;
  if (dir.includes("\0")) return false;
  if (!path__namespace.isAbsolute(dir)) return false;
  try {
    return fs__namespace.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
const ALLOWED_EXACT = /* @__PURE__ */ new Set(["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "SystemDrive", "windir", "WINDIR", "COMSPEC", "ComSpec", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "USERNAME", "USER", "LOGNAME", "SHELL", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "NUMBER_OF_PROCESSORS", "OS", "PROCESSOR_ARCHITECTURE"]);
const ALLOWED_PREFIXES = ["OPENCODE_PET_"];
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
function isAllowedKey(key) {
  if (!SAFE_KEY.test(key)) return false;
  if (ALLOWED_EXACT.has(key)) return true;
  return ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix));
}
function safeEnv(extra = {}, source = process.env) {
  const env = {};
  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source)) {
      if (value === void 0) continue;
      if (!isAllowedKey(key)) continue;
      env[key] = String(value);
    }
  }
  if (extra && typeof extra === "object") {
    for (const [key, value] of Object.entries(extra)) {
      if (value === void 0 || value === null) continue;
      if (!SAFE_KEY.test(key)) continue;
      env[key] = String(value);
    }
  }
  return env;
}
function clampNumber(value, min, max, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
const MIN_SPEED = 0.5;
const MAX_SPEED = 2;
function normalizeConfig(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const config = {
    version: 2,
    enabled: true,
    autoLaunch: true,
    pet: "scrybe",
    scale: 1,
    animationSpeed: 1,
    muted: false,
    autoHideFullscreen: false,
    feed: false,
    visible: true
  };
  if (typeof source.version === "number" && Number.isFinite(source.version)) {
    config.version = Math.max(1, Math.round(source.version));
  }
  if (typeof source.enabled === "boolean") config.enabled = source.enabled;
  if (typeof source.autoLaunch === "boolean") config.autoLaunch = source.autoLaunch;
  if (typeof source.pet === "string" && source.pet.trim()) config.pet = source.pet.trim();
  config.scale = clampNumber(source.scale, MIN_SCALE, MAX_SCALE, 1);
  config.animationSpeed = clampNumber(source.animationSpeed, MIN_SPEED, MAX_SPEED, 1);
  if (typeof source.muted === "boolean") config.muted = source.muted;
  if (typeof source.autoHideFullscreen === "boolean") config.autoHideFullscreen = source.autoHideFullscreen;
  if (typeof source.feed === "boolean") config.feed = source.feed;
  if (typeof source.visible === "boolean") config.visible = source.visible;
  return config;
}
function readConfig() {
  const file = path__namespace.join(cacheDir(), "config.json");
  try {
    const raw = JSON.parse(fs__namespace.readFileSync(file, "utf8"));
    return normalizeConfig(raw);
  } catch {
    return normalizeConfig(null);
  }
}
function updateConfig(patch) {
  const current = readConfig();
  const merged = {
    ...current,
    ...patch && typeof patch === "object" ? patch : {}
  };
  const normalized = normalizeConfig(merged);
  const file = path__namespace.join(cacheDir(), "config.json");
  const tmp = file + ".tmp";
  try {
    fs__namespace.mkdirSync(path__namespace.dirname(file), {
      recursive: true
    });
    fs__namespace.writeFileSync(tmp, JSON.stringify(normalized));
    fs__namespace.renameSync(tmp, file);
  } catch {
    try {
      fs__namespace.unlinkSync(tmp);
    } catch {
    }
  }
}
function readPosition() {
  const file = path__namespace.join(cacheDir(), "pos.json");
  try {
    const raw = JSON.parse(fs__namespace.readFileSync(file, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const x = raw.x;
      const y = raw.y;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return {
          x: Math.round(x),
          y: Math.round(y)
        };
      }
    }
  } catch {
  }
  return {
    x: 0,
    y: 0
  };
}
function startPet() {
  const result = launchPet({
    appDir: resolveAppDir([readTextFile(appDirFile())])
  });
  return Boolean(result && result.launched);
}
function stopPet() {
  return closePetProcess({
    pidFile: pidFile(),
    heartbeatFile: heartbeatFile()
  });
}
function petRunning() {
  return petAlreadyRunning({
    pidFile: pidFile()
  });
}
function readPetPid(pidFileArg) {
  try {
    const pid = parseInt(fs__namespace.readFileSync(pidFileArg, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}
function closePetProcess(options = {}) {
  const pidFileArg = options.pidFile || pidFile();
  const heartbeatFileArg = options.heartbeatFile || heartbeatFile();
  try {
    fs__namespace.unlinkSync(heartbeatFileArg);
  } catch {
  }
  const pid = readPetPid(pidFileArg);
  if (!pid || !isAlive(pid)) return false;
  try {
    process.kill(pid);
  } catch {
  }
  try {
    fs__namespace.unlinkSync(pidFileArg);
  } catch {
  }
  return true;
}
function resolveElectronBin(dir, platform = process.platform) {
  const isWin = platform === "win32";
  const dist = path__namespace.join(dir, "node_modules", "electron", "dist", isWin ? "electron.exe" : "electron");
  if (fs__namespace.existsSync(dist)) return dist;
  const shim = path__namespace.join(dir, "node_modules", ".bin", isWin ? "electron.cmd" : "electron");
  if (fs__namespace.existsSync(shim)) return shim;
  return void 0;
}
function hasElectron(dir) {
  return resolveElectronBin(dir) !== void 0;
}
function resolveAppDir(extraCandidates = []) {
  const candidates = [process.env.OPENCODE_PET_DIR, ...extraCandidates, path__namespace.join(safeHome(), "opencode-pet"), path__namespace.join(safeHome(), "opencode-scrybe")].filter(Boolean);
  for (const dir of candidates) {
    if (isUsableAppDir(dir) && hasElectron(dir)) return dir;
  }
  return candidates[0] || path__namespace.join(safeHome(), "opencode-pet");
}
function petAlreadyRunning(options = {}) {
  const pidFileArg = options.pidFile || pidFile();
  const pid = readPetPid(pidFileArg);
  return Boolean(pid && isAlive(pid));
}
const DEFAULT_LOCK_HOLD_MS = 1500;
function acquireLaunchLock(dir, staleMs = 5e3) {
  if (!dir) return null;
  const file = path__namespace.join(dir, "launch.lock");
  const claim = () => {
    const fd = fs__namespace.openSync(file, "wx");
    fs__namespace.writeSync(fd, String(process.pid));
    fs__namespace.closeSync(fd);
    return file;
  };
  try {
    fs__namespace.mkdirSync(dir, {
      recursive: true
    });
    return claim();
  } catch {
    try {
      const age = Date.now() - fs__namespace.statSync(file).mtimeMs;
      if (age > staleMs) {
        fs__namespace.unlinkSync(file);
        return claim();
      }
    } catch {
    }
    return null;
  }
}
function launchPet(options = {}) {
  const appDir = options.appDir || resolveAppDir([]);
  const noLaunch = process.env.OPENCODE_PET_NO_LAUNCH === "1";
  if (noLaunch) return {
    launched: false,
    reason: "no-launch"
  };
  const bin = resolveElectronBin(appDir, options.platform || process.platform);
  if (!bin) return {
    launched: false,
    reason: "no-electron"
  };
  if (options.skipRunningCheck !== true && petAlreadyRunning({
    pidFile: options.pidFile
  })) {
    return {
      launched: false,
      reason: "already-running"
    };
  }
  if (options.skipLock !== true) {
    const lock = acquireLaunchLock(path__namespace.join(safeHome(), ".cache", "opencode-pet"), 5e3);
    if (!lock) return {
      launched: false,
      reason: "launch-locked"
    };
    setTimeout(() => {
      try {
        fs__namespace.unlinkSync(lock);
      } catch {
      }
    }, DEFAULT_LOCK_HOLD_MS).unref?.();
  }
  const childEnv = safeEnv({});
  const spawnOptions = {
    cwd: appDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    env: childEnv
  };
  const isWin = (options.platform || process.platform) === "win32";
  try {
    const {
      spawn
    } = require("node:child_process");
    let child;
    if (isWin && bin.endsWith(".cmd")) {
      if (!isSafeCmdPath(bin)) return {
        launched: false,
        reason: "unsafe-path"
      };
      const comspec = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
      child = spawn(comspec, ["/d", "/s", "/c", bin, "."], spawnOptions);
    } else {
      child = spawn(bin, ["."], spawnOptions);
    }
    child.on("error", () => {
    });
    child.unref();
  } catch {
    return {
      launched: false,
      reason: "spawn-failed"
    };
  }
  return {
    launched: true,
    appDir
  };
}
function parsePetCommand(input) {
  const raw = String(input === void 0 || input === null ? "" : input).trim().toLowerCase();
  if (!raw) return {
    action: "toggle",
    raw
  };
  if (raw === "on" || raw === "enable" || raw === "show") return {
    action: "on",
    raw
  };
  if (raw === "off" || raw === "disable" || raw === "hide") return {
    action: "off",
    raw
  };
  if (raw === "toggle") return {
    action: "toggle",
    raw
  };
  if (raw === "restart" || raw === "reload") return {
    action: "restart",
    raw
  };
  if (raw === "status" || raw === "state") return {
    action: "status",
    raw
  };
  return {
    action: "toggle",
    raw
  };
}
function shortcutAction(running) {
  return running ? "stop" : "start";
}
function resolveCommand(action, state) {
  const running = Boolean(state && state.running);
  const visible = Boolean(state && state.visible);
  switch (action) {
    case "on":
      return {
        start: !running,
        show: true,
        stop: false
      };
    case "off":
      return {
        start: false,
        show: false,
        stop: false
      };
    case "toggle":
      return {
        start: !running,
        show: running ? !visible : true,
        stop: false
      };
    case "restart":
      return {
        start: true,
        show: true,
        stop: running
      };
    case "status":
      return {
        start: false,
        show: false,
        stop: false
      };
    default:
      return {
        start: false,
        show: visible,
        stop: false
      };
  }
}
const PET_STATES = ["idle", "thinking", "working", "waiting", "happy", "error", "sleeping"];
const KNOWN_PACKS = [{
  id: "scrybe",
  label: "Scrybe (built in)"
}, {
  id: "clack",
  label: "Clack"
}, {
  id: "shane-hollander",
  label: "Shane Hollander"
}];
const PetStatusSchema = effect.Schema.Struct({
  available: effect.Schema.Boolean,
  running: effect.Schema.Boolean,
  enabled: effect.Schema.Boolean,
  visible: effect.Schema.Boolean,
  autoLaunch: effect.Schema.Boolean,
  state: effect.Schema.Literals(PET_STATES),
  ts: effect.Schema.Number,
  detail: effect.Schema.optional(effect.Schema.String),
  scale: effect.Schema.Number,
  animationSpeed: effect.Schema.Number,
  muted: effect.Schema.Boolean,
  feed: effect.Schema.Boolean,
  autoHideFullscreen: effect.Schema.Boolean,
  pet: effect.Schema.String,
  positionX: effect.Schema.Number,
  positionY: effect.Schema.Number
});
const PetControl = gui.Ipc.define({
  id: "opencode-pet-hello-gui.control",
  state: PetStatusSchema,
  methods: {
    setEnabled: {
      input: effect.Schema.Boolean
    },
    setVisible: {
      input: effect.Schema.Boolean
    },
    setAutoLaunch: {
      input: effect.Schema.Boolean
    },
    restart: {},
    setScale: {
      input: effect.Schema.Number
    },
    setAnimationSpeed: {
      input: effect.Schema.Number
    },
    setMuted: {
      input: effect.Schema.Boolean
    },
    setFeed: {
      input: effect.Schema.Boolean
    },
    setAutoHideFullscreen: {
      input: effect.Schema.Boolean
    },
    setPet: {
      input: effect.Schema.String
    },
    setPosition: {
      input: effect.Schema.Struct({
        x: effect.Schema.Number,
        y: effect.Schema.Number
      })
    },
    resetPosition: {},
    openPacksFolder: {}
  }
});
function cacheDir() {
  return path__namespace.join(os__namespace.homedir(), ".cache", "opencode-pet");
}
function stateFile() {
  return path__namespace.join(cacheDir(), "state.json");
}
function posFile() {
  return path__namespace.join(cacheDir(), "pos.json");
}
function pidFile() {
  return path__namespace.join(cacheDir(), "pet.pid");
}
function heartbeatFile() {
  return path__namespace.join(cacheDir(), "heartbeat");
}
function hiddenFile() {
  return path__namespace.join(cacheDir(), "hidden");
}
function appDirFile() {
  return path__namespace.join(cacheDir(), "app.dir");
}
function packsDir() {
  return path__namespace.join(cacheDir(), "packs");
}
function readJson(file) {
  try {
    return JSON.parse(fs__namespace.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function writeJson(file, value) {
  try {
    fs__namespace.mkdirSync(path__namespace.dirname(file), {
      recursive: true
    });
    const tmp = file + ".tmp";
    fs__namespace.writeFileSync(tmp, JSON.stringify(value));
    fs__namespace.renameSync(tmp, file);
  } catch {
  }
}
function readRuntimeState() {
  const fallback = {
    available: false,
    state: "idle",
    ts: 0
  };
  const raw = readJson(stateFile());
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const record = raw;
  const state = record.state;
  if (typeof state !== "string" || !PET_STATES.includes(state)) return fallback;
  const ts = typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : 0;
  const detail = typeof record.detail === "string" ? record.detail : void 0;
  return {
    available: true,
    state,
    ts,
    detail
  };
}
function readTextFile(file) {
  try {
    return fs__namespace.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}
function refreshStatus(current) {
  const cfg = readConfig();
  const pos = readPosition();
  return {
    available: current.available,
    running: petRunning(),
    enabled: cfg.enabled !== false,
    visible: cfg.visible !== false,
    autoLaunch: cfg.autoLaunch !== false,
    state: current.state,
    ts: current.ts,
    detail: current.detail,
    scale: typeof cfg.scale === "number" ? cfg.scale : 1,
    animationSpeed: typeof cfg.animationSpeed === "number" ? cfg.animationSpeed : 1,
    muted: cfg.muted === true,
    feed: cfg.feed === true,
    autoHideFullscreen: cfg.autoHideFullscreen === true,
    pet: typeof cfg.pet === "string" && cfg.pet ? cfg.pet : "scrybe",
    positionX: pos.x,
    positionY: pos.y
  };
}
function electronBrowserWindow() {
  try {
    const electron = require("electron");
    return electron && electron.BrowserWindow ? electron.BrowserWindow : null;
  } catch {
    return null;
  }
}
const definition = gui.Plugin.define({
  i18n: {
    en
  },
  main(ctx) {
    let runtime = readRuntimeState();
    let status = refreshStatus(runtime);
    let disposed = false;
    let restartTimer;
    let shortcutRegistered = false;
    const publish = () => {
      runtime = readRuntimeState();
      status = refreshStatus(runtime);
      provider.changed();
    };
    const scheduleStart = () => {
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        restartTimer = void 0;
        if (!disposed) {
          startPet();
          publish();
        }
      }, 250);
    };
    const provider = ctx.provide(PetControl, {
      state: () => status,
      setEnabled: (value) => {
        updateConfig(value ? {
          enabled: true,
          visible: true
        } : {
          enabled: false
        });
        if (value) startPet();
        else stopPet();
        publish();
      },
      setVisible: (value) => {
        updateConfig({
          visible: Boolean(value)
        });
        publish();
      },
      setAutoLaunch: (value) => {
        updateConfig({
          autoLaunch: Boolean(value)
        });
        publish();
      },
      restart: () => {
        stopPet();
        scheduleStart();
        publish();
      },
      setScale: (scale) => {
        updateConfig({
          scale
        });
        publish();
      },
      setAnimationSpeed: (speed) => {
        updateConfig({
          animationSpeed: speed
        });
        publish();
      },
      setMuted: (muted) => {
        updateConfig({
          muted: Boolean(muted)
        });
        publish();
      },
      setFeed: (feed) => {
        updateConfig({
          feed: Boolean(feed)
        });
        publish();
      },
      setAutoHideFullscreen: (value) => {
        updateConfig({
          autoHideFullscreen: Boolean(value)
        });
        writeJson(hiddenFile(), false);
        publish();
      },
      setPet: (pet) => {
        if (pet && pet.trim()) updateConfig({
          pet: pet.trim()
        });
        publish();
      },
      setPosition: (pos) => {
        writeJson(posFile(), {
          x: Math.round(pos.x),
          y: Math.round(pos.y)
        });
        publish();
      },
      resetPosition: () => {
        try {
          fs__namespace.unlinkSync(posFile());
        } catch {
        }
        stopPet();
        scheduleStart();
        publish();
      },
      openPacksFolder: () => {
        try {
          fs__namespace.mkdirSync(packsDir(), {
            recursive: true
          });
          const electron = require("electron");
          if (electron && electron.shell && electron.shell.openPath) {
            void electron.shell.openPath(packsDir());
          }
        } catch {
        }
      }
    });
    try {
      const electron = require("electron");
      if (electron && electron.globalShortcut) {
        shortcutRegistered = electron.globalShortcut.register("Control+Alt+Shift+P", () => {
          if (disposed) return;
          const action = shortcutAction(petRunning());
          if (action === "stop") {
            stopPet();
          } else {
            updateConfig({
              visible: true
            });
            startPet();
          }
          publish();
        });
        if (!shortcutRegistered) {
          console.error("[hello-pet] Ctrl+Alt+Shift+P is already taken by another app");
        }
      }
    } catch {
    }
    const statusTimer = setInterval(() => {
      if (!disposed) publish();
    }, 2e3);
    const fullscreenTimer = setInterval(() => {
      if (disposed) return;
      const cfg = readConfig();
      const BrowserWindow = electronBrowserWindow();
      let fullscreen = false;
      if (cfg.autoHideFullscreen === true && BrowserWindow) {
        try {
          fullscreen = BrowserWindow.getAllWindows().some((win) => {
            try {
              return Boolean(win && win.isFullScreen && win.isFullScreen());
            } catch {
              return false;
            }
          });
        } catch {
          fullscreen = false;
        }
      }
      writeJson(hiddenFile(), fullscreen ? true : false);
    }, 1e3);
    return () => {
      disposed = true;
      clearInterval(statusTimer);
      clearInterval(fullscreenTimer);
      if (restartTimer) clearTimeout(restartTimer);
      if (shortcutRegistered) {
        try {
          require("electron").globalShortcut.unregister("Control+Alt+Shift+P");
        } catch {
        }
      }
      writeJson(hiddenFile(), false);
      provider.dispose();
    };
  },
  setup(ctx) {
    const control = ctx.main(PetControl);
    const status = () => control.state();
    const runControl = async (action) => {
      try {
        await action();
      } catch {
      }
    };
    const toast = (title) => {
      try {
        ctx.toast.show({
          title
        });
      } catch {
      }
    };
    ctx.add(gui.SettingsPage, () => ({
      id: "pet",
      icon: "flask",
      get title() {
        return ctx.t("settings.title");
      },
      get entries() {
        return [{
          id: "pet-enabled",
          title: ctx.t("settings.enabled.title"),
          description: ctx.t("settings.enabled.description"),
          keywords: "pet companion desktop animal mascot enable disable"
        }, {
          id: "pet-visible",
          title: ctx.t("settings.visible.title"),
          description: ctx.t("settings.visible.description"),
          keywords: "show hide visibility pet companion"
        }, {
          id: "pet-auto-launch",
          title: ctx.t("settings.autoLaunch.title"),
          description: ctx.t("settings.autoLaunch.description"),
          keywords: "startup auto launch opencode start"
        }, {
          id: "pet-active",
          title: ctx.t("settings.active.title"),
          description: ctx.t("settings.active.description"),
          keywords: "pack pet active choose clack shane scrybe"
        }, {
          id: "pet-appearance",
          title: ctx.t("settings.appearance.title"),
          description: ctx.t("settings.appearance.description"),
          keywords: "scale size animation speed"
        }, {
          id: "pet-behaviour",
          title: ctx.t("settings.behaviour.title"),
          description: ctx.t("settings.behaviour.description"),
          keywords: "sound feed fullscreen position"
        }, {
          id: "pet-packs",
          title: ctx.t("settings.packs.title"),
          description: ctx.t("settings.packs.description"),
          keywords: "packs import manage pet"
        }];
      },
      render: () => (() => {
        var _el$ = _tmpl$(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$6.nextSibling, _el$8 = _el$7.nextSibling, _el$9 = _el$8.nextSibling, _el$0 = _el$9.nextSibling, _el$1 = _el$0.firstChild, _el$10 = _el$4.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling, _el$13 = _el$2.nextSibling, _el$14 = _el$13.firstChild, _el$15 = _el$14.nextSibling, _el$16 = _el$15.firstChild, _el$17 = _el$16.nextSibling, _el$18 = _el$17.firstChild, _el$19 = _el$18.nextSibling, _el$20 = _el$15.nextSibling, _el$21 = _el$20.firstChild, _el$22 = _el$21.nextSibling, _el$23 = _el$22.firstChild, _el$24 = _el$23.nextSibling, _el$25 = _el$20.nextSibling, _el$26 = _el$25.firstChild, _el$27 = _el$26.nextSibling, _el$28 = _el$27.firstChild, _el$29 = _el$28.nextSibling, _el$30 = _el$13.nextSibling, _el$31 = _el$30.firstChild, _el$32 = _el$31.nextSibling, _el$33 = _el$32.firstChild, _el$34 = _el$33.nextSibling, _el$35 = _el$32.nextSibling, _el$36 = _el$35.firstChild, _el$37 = _el$36.firstChild, _el$38 = _el$36.nextSibling, _el$39 = _el$35.nextSibling, _el$40 = _el$39.firstChild, _el$41 = _el$40.firstChild, _el$42 = _el$40.nextSibling, _el$43 = _el$30.nextSibling, _el$44 = _el$43.firstChild, _el$45 = _el$44.nextSibling, _el$46 = _el$45.firstChild, _el$47 = _el$45.nextSibling, _el$48 = _el$47.firstChild, _el$49 = _el$47.nextSibling, _el$50 = _el$49.firstChild, _el$51 = _el$43.nextSibling, _el$52 = _el$51.firstChild, _el$53 = _el$52.nextSibling, _el$54 = _el$53.nextSibling, _el$55 = _el$54.firstChild, _el$56 = _el$51.nextSibling;
        web.insert(_el$3, () => ctx.t("settings.section.status"));
        web.insert(_el$5, () => ctx.t("settings.status.running"));
        web.insert(_el$6, (() => {
          var _c$ = web.memo(() => !!status()?.running);
          return () => _c$() ? ctx.t("settings.status.yes") : ctx.t("settings.status.no");
        })());
        web.insert(_el$7, () => ctx.t("settings.status.state"));
        web.insert(_el$8, (() => {
          var _c$2 = web.memo(() => !!status()?.available);
          return () => _c$2() ? status()?.state : ctx.t("settings.status.offline");
        })());
        web.insert(_el$9, () => ctx.t("settings.status.position"));
        web.insert(_el$0, () => status()?.positionX ?? 0, _el$1);
        web.insert(_el$0, () => status()?.positionY ?? 0, null);
        _el$11.$$click = () => void runControl(() => control.restart());
        web.insert(_el$11, () => ctx.t("settings.restart"));
        _el$12.$$click = () => void runControl(() => control.resetPosition());
        web.insert(_el$12, () => ctx.t("settings.resetPosition"));
        web.insert(_el$14, () => ctx.t("settings.section.general"));
        _el$16.addEventListener("change", (event) => void runControl(() => control.setEnabled(event.currentTarget.checked)));
        web.insert(_el$18, () => ctx.t("settings.enabled.title"));
        web.insert(_el$19, () => ctx.t("settings.enabled.description"));
        _el$21.addEventListener("change", (event) => void runControl(() => control.setVisible(event.currentTarget.checked)));
        web.insert(_el$23, () => ctx.t("settings.visible.title"));
        web.insert(_el$24, () => ctx.t("settings.visible.description"));
        _el$26.addEventListener("change", (event) => void runControl(() => control.setAutoLaunch(event.currentTarget.checked)));
        web.insert(_el$28, () => ctx.t("settings.autoLaunch.title"));
        web.insert(_el$29, () => ctx.t("settings.autoLaunch.description"));
        web.insert(_el$31, () => ctx.t("settings.section.pet"));
        web.insert(_el$33, () => ctx.t("settings.active.title"));
        _el$34.addEventListener("change", (event) => void runControl(() => control.setPet(event.currentTarget.value)));
        web.insert(_el$34, () => KNOWN_PACKS.map((pack) => (() => {
          var _el$57 = _tmpl$2();
          web.insert(_el$57, () => pack.label);
          web.effect(() => _el$57.value = pack.id);
          return _el$57;
        })()));
        web.insert(_el$36, () => ctx.t("settings.scale"), _el$37);
        web.insert(_el$36, () => status()?.scale ?? 1, null);
        _el$38.$$input = (event) => void runControl(() => control.setScale(Number(event.currentTarget.value)));
        web.insert(_el$40, () => ctx.t("settings.animationSpeed"), _el$41);
        web.insert(_el$40, () => status()?.animationSpeed ?? 1, null);
        _el$42.$$input = (event) => void runControl(() => control.setAnimationSpeed(Number(event.currentTarget.value)));
        web.insert(_el$44, () => ctx.t("settings.section.behaviour"));
        _el$46.addEventListener("change", (event) => void runControl(() => control.setMuted(!event.currentTarget.checked)));
        web.insert(_el$45, () => ctx.t("settings.sound"), null);
        _el$48.addEventListener("change", (event) => void runControl(() => control.setFeed(event.currentTarget.checked)));
        web.insert(_el$47, () => ctx.t("settings.feed"), null);
        _el$50.addEventListener("change", (event) => void runControl(() => control.setAutoHideFullscreen(event.currentTarget.checked)));
        web.insert(_el$49, () => ctx.t("settings.autoHide"), null);
        web.insert(_el$52, () => ctx.t("settings.section.packs"));
        web.insert(_el$53, () => ctx.t("settings.packs.note"));
        _el$55.$$click = () => void runControl(() => control.openPacksFolder());
        web.insert(_el$55, () => ctx.t("settings.packs.openFolder"));
        web.insert(_el$56, () => ctx.t("settings.note"));
        web.effect(() => _el$16.checked = status()?.enabled ?? true);
        web.effect(() => _el$21.checked = status()?.visible ?? true);
        web.effect(() => _el$26.checked = status()?.autoLaunch ?? true);
        web.effect(() => _el$34.value = status()?.pet ?? "scrybe");
        web.effect(() => _el$38.value = status()?.scale ?? 1);
        web.effect(() => _el$42.value = status()?.animationSpeed ?? 1);
        web.effect(() => _el$46.checked = !(status()?.muted ?? false));
        web.effect(() => _el$48.checked = status()?.feed ?? false);
        web.effect(() => _el$50.checked = status()?.autoHideFullscreen ?? false);
        return _el$;
      })()
    }));
    ctx.add(gui.Command, () => ({
      id: "pet",
      get title() {
        return ctx.t("command.title");
      },
      get description() {
        return ctx.t("command.description");
      },
      keywords: "pet companion mascot toggle enable disable",
      section: "prompt",
      slash: {
        name: "pet",
        arguments: true
      },
      run: async (input) => {
        const {
          action
        } = parsePetCommand(input);
        const current = status();
        if (action === "status") {
          const running = current?.running ? ctx.t("command.status.running") : ctx.t("command.status.stopped");
          const visibility = current?.visible ? ctx.t("command.status.visible") : ctx.t("command.status.hidden");
          const stateLabel = current?.available ? current.state : ctx.t("command.status.offline");
          toast(`${running} · ${visibility} · ${stateLabel}`);
          return;
        }
        if (action === "restart") {
          await runControl(() => control.restart());
          toast(ctx.t("command.restarting"));
          return;
        }
        const plan = resolveCommand(action, {
          running: current?.running ?? false,
          visible: current?.visible ?? true
        });
        if (plan.start) await runControl(() => control.setEnabled(true));
        await runControl(() => control.setVisible(plan.show));
      }
    }));
    console.info("[hello-pet] settings page and /pet command registered");
  }
});
web.delegateEvents(["click", "input"]);
exports.default = definition;
//# sourceMappingURL=gui-experimental.cjs.map
