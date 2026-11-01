"use strict";
Object.defineProperties(exports, { __esModule: { value: true }, [Symbol.toStringTag]: { value: "Module" } });
const web = require("solid-js/web");
const effect = require("effect");
const gui = require("@opencode/plugin/gui");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
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
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const os__namespace = /* @__PURE__ */ _interopNamespaceDefault(os);
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
  "settings.packs.note": "Only the built-in Scrybe pet is available for now. Custom pack import is not wired into the pet renderer yet.",
  "settings.packs.openFolder": "Open packs folder",
  "settings.scale": "Scale",
  "settings.animationSpeed": "Animation Speed",
  "settings.sound": "Sound Effects",
  "settings.feed": "Activity Feed",
  "settings.autoHide": "Auto Hide when OpenCode is fullscreen",
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
function cacheDir() {
  return path__namespace.join(safeHome(), ".cache", "opencode-pet");
}
function resolveReal(target) {
  const absolute = path__namespace.resolve(String(target));
  try {
    return fs__namespace.realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}
function isPathInside(parent, child) {
  if (typeof parent !== "string" || typeof child !== "string") return false;
  if (!parent || !child) return false;
  const base = resolveReal(parent);
  const target = resolveReal(child);
  const relative = path__namespace.relative(base, target);
  if (relative === "") return true;
  return !relative.startsWith("..") && !path__namespace.isAbsolute(relative);
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
const ALLOWED_EXACT = /* @__PURE__ */ new Set([
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "SystemDrive",
  "windir",
  "WINDIR",
  "COMSPEC",
  "ComSpec",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "USERNAME",
  "USER",
  "LOGNAME",
  "SHELL",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XAUTHORITY",
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "DBUS_SESSION_BUS_ADDRESS",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "ELECTRON_MIRROR",
  "ELECTRON_CUSTOM_DIR",
  "ELECTRON_CUSTOM_FILENAME",
  "ELECTRON_GET_USE_PROXY",
  "GLOBAL_AGENT_HTTP_PROXY",
  "GLOBAL_AGENT_HTTPS_PROXY",
  "GLOBAL_AGENT_NO_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy"
]);
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
const DEFAULT_CONFIG = {
  version: 2,
  enabled: true,
  autoLaunch: true,
  pet: "scrybe",
  scale: 1,
  animationSpeed: 1,
  muted: false,
  autoHideFullscreen: false,
  feed: true,
  visible: true
};
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
const MIN_SPEED = 0.5;
const MAX_SPEED = 2;
function clampNumber(value, min, max, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
function normalizeConfig(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const config = { ...DEFAULT_CONFIG };
  if (typeof source.version === "number" && Number.isFinite(source.version)) {
    config.version = Math.max(1, Math.round(source.version));
  }
  if (typeof source.enabled === "boolean") config.enabled = source.enabled;
  if (typeof source.autoLaunch === "boolean") config.autoLaunch = source.autoLaunch;
  if (typeof source.pet === "string" && source.pet.trim()) config.pet = source.pet.trim();
  config.scale = clampNumber(source.scale, MIN_SCALE, MAX_SCALE, DEFAULT_CONFIG.scale);
  config.animationSpeed = clampNumber(
    source.animationSpeed,
    MIN_SPEED,
    MAX_SPEED,
    DEFAULT_CONFIG.animationSpeed
  );
  if (typeof source.muted === "boolean") config.muted = source.muted;
  if (typeof source.autoHideFullscreen === "boolean") {
    config.autoHideFullscreen = source.autoHideFullscreen;
  }
  if (typeof source.feed === "boolean") config.feed = source.feed;
  if (typeof source.visible === "boolean") config.visible = source.visible;
  return config;
}
function normalizePosition(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { x, y } = raw;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}
function requireDir(options) {
  const dir = options && options.dir || null;
  if (!dir) throw new Error("pet-config: a directory is required");
  return dir;
}
function writeAtomic(dir, name, value) {
  const file = path__namespace.join(dir, name);
  const tmp = path__namespace.join(dir, name + ".tmp");
  try {
    fs__namespace.mkdirSync(dir, { recursive: true });
    fs__namespace.writeFileSync(tmp, JSON.stringify(value));
    fs__namespace.renameSync(tmp, file);
    return true;
  } catch {
    try {
      fs__namespace.unlinkSync(tmp);
    } catch {
    }
    return false;
  }
}
function readConfig(options) {
  const file = path__namespace.join(requireDir(options), "config.json");
  try {
    return normalizeConfig(JSON.parse(fs__namespace.readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function writeConfig(config, options) {
  const normalized = normalizeConfig(config);
  return writeAtomic(requireDir(options), "config.json", normalized) ? normalized : normalizeConfig({});
}
function updateConfig(patch, options) {
  const current = readConfig(options);
  const merged = { ...current, ...patch && typeof patch === "object" ? patch : {} };
  return writeConfig(merged, options);
}
function readPosition(options) {
  const file = path__namespace.join(requireDir(options), "pos.json");
  try {
    return normalizePosition(JSON.parse(fs__namespace.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}
function writePosition(position, options) {
  const dir = requireDir(options);
  const normalized = normalizePosition(position);
  if (!normalized) return null;
  return writeAtomic(dir, "pos.json", normalized) ? normalized : null;
}
function isProcessAlive(pid) {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}
function readPetPid(pidFile2 = path__namespace.join(cacheDir(), "pet.pid")) {
  try {
    const pid = parseInt(fs__namespace.readFileSync(pidFile2, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}
function closePetProcess(options = {}) {
  const pidFile2 = options.pidFile || path__namespace.join(cacheDir(), "pet.pid");
  const heartbeatFile2 = options.heartbeatFile || path__namespace.join(cacheDir(), "heartbeat");
  const isAlive = options.isAlive || isProcessAlive;
  const kill = options.kill || ((pid2) => process.kill(pid2));
  try {
    fs__namespace.unlinkSync(heartbeatFile2);
  } catch {
  }
  const pid = readPetPid(pidFile2);
  if (!pid || !isAlive(pid)) return false;
  try {
    kill(pid);
  } catch {
  }
  try {
    fs__namespace.unlinkSync(pidFile2);
  } catch {
  }
  return true;
}
function resolveElectronBin(appDir, platform = process.platform) {
  if (!isUsableAppDir(appDir)) return void 0;
  const isWin = platform === "win32";
  const dist = path__namespace.join(appDir, "node_modules", "electron", "dist", isWin ? "electron.exe" : "electron");
  if (fs__namespace.existsSync(dist) && isPathInside(appDir, dist)) return { bin: dist, shell: false };
  const shim = path__namespace.join(appDir, "node_modules", ".bin", isWin ? "electron.cmd" : "electron");
  if (fs__namespace.existsSync(shim) && isPathInside(appDir, shim)) return { bin: shim, shell: isWin };
  return void 0;
}
function hasElectron(appDir, platform = process.platform) {
  return resolveElectronBin(appDir, platform) !== void 0;
}
function defaultAppDirs() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return [
    process.env.OPENCODE_PET_DIR,
    path__namespace.join(home, "opencode-scrybe"),
    path__namespace.join(home, "opencode-pet")
  ].filter(Boolean);
}
function resolveAppDir(extraCandidates) {
  const candidates = [...extraCandidates || [], ...defaultAppDirs()];
  for (const dir of candidates) {
    if (isUsableAppDir(dir) && hasElectron(dir)) return dir;
  }
  return candidates[0] || path__namespace.join(process.env.HOME || process.env.USERPROFILE || "", "opencode-pet");
}
const UNSAFE_CMD_CHARS = /[&|<>^%!"\r\n\0]/;
function isSafeCmdPath(value) {
  return typeof value === "string" && value.length > 0 && !UNSAFE_CMD_CHARS.test(value);
}
function cmdShimArgs(bin) {
  return ["/d", "/s", "/c", `""${bin}" ."`];
}
const LAUNCH_LOCK_NAME = "launch.lock";
const DEFAULT_LOCK_HOLD_MS = 1500;
function acquireLaunchLock(dir, staleMs = 5e3) {
  if (!dir) return null;
  const file = path__namespace.join(dir, LAUNCH_LOCK_NAME);
  const claim = () => {
    const fd = fs__namespace.openSync(file, "wx");
    fs__namespace.writeSync(fd, String(process.pid));
    fs__namespace.closeSync(fd);
    return file;
  };
  try {
    fs__namespace.mkdirSync(dir, { recursive: true });
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
function releaseLaunchLock(file) {
  if (!file) return;
  try {
    fs__namespace.unlinkSync(file);
  } catch {
  }
}
function petAlreadyRunning(options = {}) {
  const isAlive = options.isAlive || isProcessAlive;
  const pid = readPetPid(options.pidFile);
  return Boolean(pid && isAlive(pid));
}
function launchPet(options = {}) {
  const opts = options;
  const appDir = opts.appDir || resolveAppDir(opts.candidates);
  const noLaunch = opts.noLaunch || process.env.OPENCODE_PET_NO_LAUNCH === "1";
  if (noLaunch) return { launched: false, reason: "no-launch" };
  const resolved = resolveElectronBin(appDir, opts.platform || process.platform);
  if (!resolved) return { launched: false, reason: "no-electron" };
  if (opts.skipRunningCheck !== true && petAlreadyRunning(opts)) {
    return { launched: false, reason: "already-running" };
  }
  const lockDir = opts.lockDir || cacheDir();
  const lock = opts.skipLock === true ? null : acquireLaunchLock(lockDir, opts.lockStaleMs);
  if (opts.skipLock !== true && !lock) {
    return { launched: false, reason: "launch-locked" };
  }
  const spawnOptions = {
    cwd: appDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    env: safeEnv(opts.env)
  };
  try {
    if (typeof opts.spawn !== "function") throw new Error("no spawn");
    const run = opts.spawn;
    let child;
    if (resolved.shell) {
      if (!isSafeCmdPath(resolved.bin)) {
        releaseLaunchLock(lock);
        return { launched: false, reason: "unsafe-path" };
      }
      const comspec = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
      child = run(comspec, cmdShimArgs(resolved.bin), {
        ...spawnOptions,
        windowsVerbatimArguments: true
      });
    } else {
      child = run(resolved.bin, ["."], spawnOptions);
    }
    child.on("error", () => {
    });
    child.unref();
  } catch {
    releaseLaunchLock(lock);
    return { launched: false, reason: "spawn-failed" };
  }
  if (lock) {
    const holdMs = opts.lockHoldMs === void 0 ? DEFAULT_LOCK_HOLD_MS : opts.lockHoldMs;
    if (holdMs <= 0) {
      releaseLaunchLock(lock);
    } else {
      const timer = setTimeout(() => releaseLaunchLock(lock), holdMs);
      if (typeof timer.unref === "function") timer.unref();
    }
  }
  return { launched: true, appDir };
}
function parsePetCommand(input) {
  const raw = String(input === void 0 || input === null ? "" : input).trim().toLowerCase();
  if (!raw) return { action: "toggle", raw };
  if (raw === "on" || raw === "enable" || raw === "show") return { action: "on", raw };
  if (raw === "off" || raw === "disable" || raw === "hide") return { action: "off", raw };
  if (raw === "toggle") return { action: "toggle", raw };
  if (raw === "restart" || raw === "reload") return { action: "restart", raw };
  if (raw === "status" || raw === "state") return { action: "status", raw };
  return { action: "toggle", raw };
}
function shortcutAction(running) {
  return running ? "stop" : "start";
}
function resolveCommand(action, state) {
  const running = Boolean(state && state.running);
  const visible = Boolean(state && state.visible);
  switch (action) {
    case "on":
      return { start: !running, show: true, stop: false };
    case "off":
      return { start: false, show: false, stop: false };
    case "toggle":
      return { start: !running, show: running ? !visible : true, stop: false };
    case "restart":
      return { start: true, show: true, stop: running };
    case "status":
      return { start: false, show: visible, stop: false };
    default:
      return { start: false, show: visible, stop: false };
  }
}
const SHORTCUT = "Control+Alt+Shift+P";
const OWNER_FILE_NAME = "shortcut.owner";
function readShortcutOwner(dir) {
  try {
    const pid = parseInt(fs__namespace.readFileSync(path__namespace.join(dir, OWNER_FILE_NAME), "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}
function claimShortcut(dir, options = {}) {
  const pid = options.pid || process.pid;
  const isAlive = options.isAlive || isProcessAlive;
  const current = readShortcutOwner(dir);
  if (current === pid) return true;
  if (current && isAlive(current)) return false;
  const file = path__namespace.join(dir, OWNER_FILE_NAME);
  try {
    fs__namespace.mkdirSync(dir, { recursive: true });
    fs__namespace.unlinkSync(file);
  } catch {
  }
  try {
    const fd = fs__namespace.openSync(file, "wx");
    fs__namespace.writeSync(fd, String(pid));
    fs__namespace.closeSync(fd);
    return true;
  } catch {
    return readShortcutOwner(dir) === pid;
  }
}
function releaseShortcut(dir, options = {}) {
  const pid = options.pid || process.pid;
  if (readShortcutOwner(dir) !== pid) return false;
  try {
    fs__namespace.unlinkSync(path__namespace.join(dir, OWNER_FILE_NAME));
    return true;
  } catch {
    return false;
  }
}
function createChangeGate() {
  let last;
  return (value) => {
    const key = JSON.stringify(value);
    if (key === last) return false;
    last = key;
    return true;
  };
}
function createShortcutController(options) {
  let held = false;
  const ownerOptions = options.pid ? { pid: options.pid } : {};
  return {
    held: () => held,
    tick() {
      if (held) return true;
      const api = options.globalShortcut();
      if (!api) return false;
      const dir = options.dir();
      if (!claimShortcut(dir, ownerOptions)) return false;
      try {
        held = api.register(SHORTCUT, options.onPress) === true;
      } catch {
        held = false;
      }
      if (!held) releaseShortcut(dir, ownerOptions);
      return held;
    },
    dispose() {
      if (held) {
        try {
          options.globalShortcut()?.unregister(SHORTCUT);
        } catch {
        }
        held = false;
      }
      try {
        releaseShortcut(options.dir(), ownerOptions);
      } catch {
      }
    }
  };
}
var _tmpl$ = /* @__PURE__ */ web.template(`<div style="display:flex;flex-direction:column;gap:18px;padding:4px 0"><section style=display:flex;flex-direction:column;gap:10px><h3 style=margin:0;font-size:13px;font-weight:600></h3><div style="display:grid;grid-template-columns:140px 1fr;gap:6px;font-size:13px"><span style=opacity:0.65></span><span></span><span style=opacity:0.65></span><span></span><span style=opacity:0.65></span><span>, </span></div><div style=display:flex;gap:8px;flex-wrap:wrap><button type=button></button><button type=button></button></div></section><section style=display:flex;flex-direction:column;gap:10px><h3 style=margin:0;font-size:13px;font-weight:600></h3><label style=display:flex;align-items:flex-start;gap:10px;cursor:pointer><input type=checkbox style=margin-top:2px><span style=display:flex;flex-direction:column;gap:2px><span style=font-weight:600></span><span style=opacity:0.7;font-size:12px></span></span></label><label style=display:flex;align-items:flex-start;gap:10px;cursor:pointer><input type=checkbox style=margin-top:2px><span style=display:flex;flex-direction:column;gap:2px><span style=font-weight:600></span><span style=opacity:0.7;font-size:12px></span></span></label><label style=display:flex;align-items:flex-start;gap:10px;cursor:pointer><input type=checkbox style=margin-top:2px><span style=display:flex;flex-direction:column;gap:2px><span style=font-weight:600></span><span style=opacity:0.7;font-size:12px></span></span></label></section><section style=display:flex;flex-direction:column;gap:10px><h3 style=margin:0;font-size:13px;font-weight:600></h3><label style=display:flex;flex-direction:column;gap:4px;font-size:13px><span></span></label><label style=display:flex;flex-direction:column;gap:4px;font-size:13px><span>: </span><input type=range min=0.5 max=2 step=0.05></label><label style=display:flex;flex-direction:column;gap:4px;font-size:13px><span>: </span><input type=range min=0.5 max=2 step=0.05></label></section><section style=display:flex;flex-direction:column;gap:10px><h3 style=margin:0;font-size:13px;font-weight:600></h3><label style=display:flex;align-items:center;gap:8px;font-size:13px><input type=checkbox></label><label style=display:flex;align-items:center;gap:8px;font-size:13px><input type=checkbox></label><label style=display:flex;align-items:center;gap:8px;font-size:13px><input type=checkbox></label></section><section style=display:flex;flex-direction:column;gap:10px><h3 style=margin:0;font-size:13px;font-weight:600></h3><p style=margin:0;opacity:0.7;font-size:12px></p><div style=display:flex;gap:8px;flex-wrap:wrap><button type=button></button></div></section><p style=margin:0;opacity:0.6;font-size:12px>`), _tmpl$2 = /* @__PURE__ */ web.template(`<select>`), _tmpl$3 = /* @__PURE__ */ web.template(`<option>`), _tmpl$4 = /* @__PURE__ */ web.template(`<span style=opacity:0.8>`);
const PET_STATES = ["idle", "thinking", "working", "waiting", "happy", "error", "sleeping"];
const KNOWN_PACKS = [{
  id: "scrybe",
  label: "Scrybe (built in)"
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
function cacheFile(name) {
  return path__namespace.join(cacheDir(), name);
}
const stateFile = () => cacheFile("state.json");
const pidFile = () => cacheFile("pet.pid");
const heartbeatFile = () => cacheFile("heartbeat");
const hiddenFile = () => cacheFile("hidden");
const appDirFile = () => cacheFile("app.dir");
const packsDir = () => cacheFile("packs");
const configDir = () => ({
  dir: cacheDir()
});
function electron() {
  try {
    return require("electron");
  } catch {
    return null;
  }
}
function spawnFn() {
  try {
    return require("node:child_process").spawn;
  } catch {
    return void 0;
  }
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
function readTextFile(file) {
  try {
    return fs__namespace.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}
function startPet() {
  const recorded = readTextFile(appDirFile());
  const result = launchPet({
    appDir: resolveAppDir(recorded ? [recorded] : []),
    pidFile: pidFile(),
    lockDir: cacheDir(),
    spawn: spawnFn()
  });
  return result.launched;
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
function refreshStatus(current) {
  const cfg = readConfig(configDir());
  const pos = readPosition(configDir()) || {
    x: 0,
    y: 0
  };
  return {
    available: current.available,
    running: petRunning(),
    enabled: cfg.enabled,
    visible: cfg.visible,
    autoLaunch: cfg.autoLaunch,
    state: current.state,
    ts: current.ts,
    detail: current.detail,
    scale: cfg.scale,
    animationSpeed: cfg.animationSpeed,
    muted: cfg.muted,
    feed: cfg.feed,
    autoHideFullscreen: cfg.autoHideFullscreen,
    // An older config may name a pack that no longer ships; the overlay draws
    // Scrybe for it, so report that.
    pet: KNOWN_PACKS.some((pack) => pack.id === cfg.pet) ? cfg.pet : "scrybe",
    positionX: pos.x,
    positionY: pos.y
  };
}
function openCodeIsFullscreen() {
  const BrowserWindow = electron()?.BrowserWindow;
  if (!BrowserWindow) return false;
  try {
    return BrowserWindow.getAllWindows().some((win) => {
      try {
        return Boolean(win && win.isFullScreen && win.isFullScreen());
      } catch {
        return false;
      }
    });
  } catch {
    return false;
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
    const statusChanged = createChangeGate();
    statusChanged(status);
    const hiddenChanged = createChangeGate();
    const writeHidden = (hidden) => {
      if (hiddenChanged(hidden) || hidden && !fs__namespace.existsSync(hiddenFile())) {
        writeJson(hiddenFile(), hidden);
      }
    };
    const publish = () => {
      runtime = readRuntimeState();
      status = refreshStatus(runtime);
      if (statusChanged(status)) provider.changed();
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
        }, configDir());
        if (value) startPet();
        else stopPet();
        publish();
      },
      setVisible: (value) => {
        updateConfig({
          visible: Boolean(value)
        }, configDir());
        publish();
      },
      setAutoLaunch: (value) => {
        updateConfig({
          autoLaunch: Boolean(value)
        }, configDir());
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
        }, configDir());
        publish();
      },
      setAnimationSpeed: (speed) => {
        updateConfig({
          animationSpeed: speed
        }, configDir());
        publish();
      },
      setMuted: (muted) => {
        updateConfig({
          muted: Boolean(muted)
        }, configDir());
        publish();
      },
      setFeed: (feed) => {
        updateConfig({
          feed: Boolean(feed)
        }, configDir());
        publish();
      },
      setAutoHideFullscreen: (value) => {
        updateConfig({
          autoHideFullscreen: Boolean(value)
        }, configDir());
        if (!value) writeHidden(false);
        publish();
      },
      setPet: (pet) => {
        const id = typeof pet === "string" ? pet.trim() : "";
        if (KNOWN_PACKS.some((pack) => pack.id === id)) updateConfig({
          pet: id
        }, configDir());
        publish();
      },
      setPosition: (pos) => {
        writePosition(pos, configDir());
        publish();
      },
      resetPosition: () => {
        try {
          fs__namespace.unlinkSync(cacheFile("pos.json"));
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
          const shell = electron()?.shell;
          if (shell && shell.openPath) void shell.openPath(packsDir());
        } catch {
        }
      }
    });
    const shortcut = createShortcutController({
      globalShortcut: () => {
        const api = electron()?.globalShortcut;
        return api && typeof api.register === "function" ? api : null;
      },
      dir: cacheDir,
      onPress: () => {
        if (disposed) return;
        if (shortcutAction(petRunning()) === "stop") {
          stopPet();
        } else {
          updateConfig({
            visible: true
          }, configDir());
          startPet();
        }
        publish();
      }
    });
    if (!shortcut.tick()) {
      console.info("[hello-pet] Ctrl+Alt+Shift+P is held elsewhere (usually the running pet); will retry");
    }
    const statusTimer = setInterval(() => {
      if (disposed) return;
      shortcut.tick();
      publish();
    }, 2e3);
    const fullscreenTimer = setInterval(() => {
      if (disposed) return;
      writeHidden(status.autoHideFullscreen && openCodeIsFullscreen());
    }, 1e3);
    return () => {
      disposed = true;
      clearInterval(statusTimer);
      clearInterval(fullscreenTimer);
      if (restartTimer) clearTimeout(restartTimer);
      shortcut.dispose();
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
          keywords: "pack pet active choose scrybe"
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
        var _el$ = _tmpl$(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$6.nextSibling, _el$8 = _el$7.nextSibling, _el$9 = _el$8.nextSibling, _el$0 = _el$9.nextSibling, _el$1 = _el$0.firstChild, _el$10 = _el$4.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling, _el$13 = _el$2.nextSibling, _el$14 = _el$13.firstChild, _el$15 = _el$14.nextSibling, _el$16 = _el$15.firstChild, _el$17 = _el$16.nextSibling, _el$18 = _el$17.firstChild, _el$19 = _el$18.nextSibling, _el$20 = _el$15.nextSibling, _el$21 = _el$20.firstChild, _el$22 = _el$21.nextSibling, _el$23 = _el$22.firstChild, _el$24 = _el$23.nextSibling, _el$25 = _el$20.nextSibling, _el$26 = _el$25.firstChild, _el$27 = _el$26.nextSibling, _el$28 = _el$27.firstChild, _el$29 = _el$28.nextSibling, _el$30 = _el$13.nextSibling, _el$31 = _el$30.firstChild, _el$32 = _el$31.nextSibling, _el$33 = _el$32.firstChild, _el$34 = _el$32.nextSibling, _el$35 = _el$34.firstChild, _el$36 = _el$35.firstChild, _el$37 = _el$35.nextSibling, _el$38 = _el$34.nextSibling, _el$39 = _el$38.firstChild, _el$40 = _el$39.firstChild, _el$41 = _el$39.nextSibling, _el$42 = _el$30.nextSibling, _el$43 = _el$42.firstChild, _el$44 = _el$43.nextSibling, _el$45 = _el$44.firstChild, _el$46 = _el$44.nextSibling, _el$47 = _el$46.firstChild, _el$48 = _el$46.nextSibling, _el$49 = _el$48.firstChild, _el$50 = _el$42.nextSibling, _el$51 = _el$50.firstChild, _el$52 = _el$51.nextSibling, _el$53 = _el$52.nextSibling, _el$54 = _el$53.firstChild, _el$55 = _el$50.nextSibling;
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
        web.insert(_el$32, (() => {
          var _c$3 = web.memo(() => KNOWN_PACKS.length > 1);
          return () => _c$3() ? (() => {
            var _el$56 = _tmpl$2();
            _el$56.addEventListener("change", (event) => void runControl(() => control.setPet(event.currentTarget.value)));
            web.insert(_el$56, () => KNOWN_PACKS.map((pack) => (() => {
              var _el$57 = _tmpl$3();
              web.insert(_el$57, () => pack.label);
              web.effect(() => _el$57.value = pack.id);
              return _el$57;
            })()));
            web.effect(() => _el$56.value = status()?.pet ?? "scrybe");
            return _el$56;
          })() : (() => {
            var _el$58 = _tmpl$4();
            web.insert(_el$58, () => KNOWN_PACKS[0].label);
            return _el$58;
          })();
        })(), null);
        web.insert(_el$35, () => ctx.t("settings.scale"), _el$36);
        web.insert(_el$35, () => status()?.scale ?? 1, null);
        _el$37.$$input = (event) => void runControl(() => control.setScale(Number(event.currentTarget.value)));
        web.insert(_el$39, () => ctx.t("settings.animationSpeed"), _el$40);
        web.insert(_el$39, () => status()?.animationSpeed ?? 1, null);
        _el$41.$$input = (event) => void runControl(() => control.setAnimationSpeed(Number(event.currentTarget.value)));
        web.insert(_el$43, () => ctx.t("settings.section.behaviour"));
        _el$45.addEventListener("change", (event) => void runControl(() => control.setMuted(!event.currentTarget.checked)));
        web.insert(_el$44, () => ctx.t("settings.sound"), null);
        _el$47.addEventListener("change", (event) => void runControl(() => control.setFeed(event.currentTarget.checked)));
        web.insert(_el$46, () => ctx.t("settings.feed"), null);
        _el$49.addEventListener("change", (event) => void runControl(() => control.setAutoHideFullscreen(event.currentTarget.checked)));
        web.insert(_el$48, () => ctx.t("settings.autoHide"), null);
        web.insert(_el$51, () => ctx.t("settings.section.packs"));
        web.insert(_el$52, () => ctx.t("settings.packs.note"));
        _el$54.$$click = () => void runControl(() => control.openPacksFolder());
        web.insert(_el$54, () => ctx.t("settings.packs.openFolder"));
        web.insert(_el$55, () => ctx.t("settings.note"));
        web.effect(() => _el$16.checked = status()?.enabled ?? true);
        web.effect(() => _el$21.checked = status()?.visible ?? true);
        web.effect(() => _el$26.checked = status()?.autoLaunch ?? true);
        web.effect(() => _el$37.value = status()?.scale ?? 1);
        web.effect(() => _el$41.value = status()?.animationSpeed ?? 1);
        web.effect(() => _el$45.checked = !(status()?.muted ?? false));
        web.effect(() => _el$47.checked = status()?.feed ?? true);
        web.effect(() => _el$49.checked = status()?.autoHideFullscreen ?? false);
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
