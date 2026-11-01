// Launching the Electron companion, shared by the server plugin and the GUI.
//
// The launcher only starts a process. It never decides whether the pet should
// be running; that decision belongs to the caller, which checks enabled state
// and desktop presence first.
//
// Two hardening rules live here:
//
//   1. The child gets an allow-listed environment (shared/safe-env.js), never
//      the parent's full environment with its API keys.
//   2. The child is spawned without shell interpolation. The only Windows
//      `.cmd` shim case goes through `cmd.exe` with the already-validated
//      absolute path as a single argument, and the path itself is checked for
//      characters that would change cmd's parse.
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("node:child_process");
const { resolveElectronBin, hasElectron } = require("./electron-bin.js");
const { safeEnv } = require("./safe-env.js");
const { isUsableAppDir } = require("./safe-path.js");
const { isProcessAlive } = require("./process-alive.js");
const { readPetPid } = require("./pet-process.js");
const { DIR } = require("./paths.js");

const DEFAULT_APP_DIRS = [
  process.env.OPENCODE_PET_DIR,
  path.resolve(__dirname, ".."),
  path.join(process.env.HOME || process.env.USERPROFILE || "", "opencode-scrybe"),
  path.join(process.env.HOME || process.env.USERPROFILE || "", "opencode-pet"),
].filter(Boolean);

function resolveAppDir(extraCandidates) {
  const candidates = [
    ...(extraCandidates || []),
    ...DEFAULT_APP_DIRS,
  ];
  for (const dir of candidates) {
    if (isUsableAppDir(dir) && hasElectron(dir)) return dir;
  }
  return candidates[0] || path.join(process.env.HOME || process.env.USERPROFILE || "", "opencode-pet");
}

// Characters that would let a path change how cmd.exe parses a command line.
// A normal Windows path never contains these, so rejecting them costs nothing
// and closes the only place a shell is still involved.
const UNSAFE_CMD_CHARS = /[&|<>^%!"\r\n\0]/;

function isSafeCmdPath(value) {
  return typeof value === "string" && value.length > 0 && !UNSAFE_CMD_CHARS.test(value);
}

const LAUNCH_LOCK_NAME = "launch.lock";
const DEFAULT_LOCK_HOLD_MS = 1500;

// A best-effort cross-process lock so two plugin instances cannot both decide
// to spawn before the overlay has written its pid file. A lock older than
// `staleMs` is treated as abandoned (the previous launcher crashed).
function acquireLaunchLock(dir, staleMs = 5000) {
  if (!dir) return null;
  const file = path.join(dir, LAUNCH_LOCK_NAME);
  const claim = () => {
    const fd = fs.openSync(file, "wx");
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return file;
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    return claim();
  } catch {
    try {
      const age = Date.now() - fs.statSync(file).mtimeMs;
      if (age > staleMs) {
        fs.unlinkSync(file);
        return claim();
      }
    } catch {
      /* raced with another launcher */
    }
    return null;
  }
}

function releaseLaunchLock(file) {
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    /* already released */
  }
}

// Is an overlay already running? The pid file is written by the app itself, so
// liveness is the strongest signal available without a platform process scan.
function petAlreadyRunning(options = {}) {
  const pidFile = options.pidFile;
  const isAlive = options.isAlive || isProcessAlive;
  const pid = readPetPid(pidFile);
  return Boolean(pid && isAlive(pid));
}

function launchPet(options) {
  const opts = options || {};
  const appDir = opts.appDir || resolveAppDir(opts.candidates);
  const noLaunch = opts.noLaunch || process.env.OPENCODE_PET_NO_LAUNCH === "1";
  if (noLaunch) return { launched: false, reason: "no-launch" };

  const resolved = resolveElectronBin(appDir, opts.platform || process.platform);
  if (!resolved) return { launched: false, reason: "no-electron" };

  // Callers that already checked (or deliberately want to re-check) can skip
  // this. The default keeps duplicate spawns out of every entry point.
  if (opts.skipRunningCheck !== true && petAlreadyRunning(opts)) {
    return { launched: false, reason: "already-running" };
  }

  const lockDir = opts.lockDir || DIR;
  const lock = opts.skipLock === true ? null : acquireLaunchLock(lockDir, opts.lockStaleMs);
  if (opts.skipLock !== true && !lock) {
    return { launched: false, reason: "launch-locked" };
  }

  const childEnv = safeEnv(opts.env);
  const spawnOptions = {
    cwd: appDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    env: childEnv,
  };

  try {
    let child;
    if (resolved.shell) {
      // Windows `.cmd` shim: run it through cmd.exe explicitly instead of
      // letting Node build a shell command line from the path.
      if (!isSafeCmdPath(resolved.bin)) {
        releaseLaunchLock(lock);
        return { launched: false, reason: "unsafe-path" };
      }
      const comspec = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
      child = spawn(comspec, ["/d", "/s", "/c", resolved.bin, "."], spawnOptions);
    } else {
      child = spawn(resolved.bin, ["."], spawnOptions);
    }
    child.on("error", () => {});
    child.unref();
  } catch {
    releaseLaunchLock(lock);
    return { launched: false, reason: "spawn-failed" };
  }

  if (lock) {
    const holdMs = opts.lockHoldMs === undefined ? DEFAULT_LOCK_HOLD_MS : opts.lockHoldMs;
    if (holdMs <= 0) {
      releaseLaunchLock(lock);
    } else {
      const timer = setTimeout(() => releaseLaunchLock(lock), holdMs);
      if (typeof timer.unref === "function") timer.unref();
    }
  }

  return { launched: true, appDir };
}

module.exports = {
  resolveAppDir,
  launchPet,
  petAlreadyRunning,
  acquireLaunchLock,
  releaseLaunchLock,
  isSafeCmdPath,
  hasElectron,
  resolveElectronBin,
};
