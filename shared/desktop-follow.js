// Desktop-app follow: deciding whether the pet should be awake because the
// OpenCode Desktop app is open.
//
// This module is deliberately free of Electron and of the plugin's live state
// so the behaviour can be unit tested. `probeDesktopApp` returns three answers
// instead of a boolean:
//
//   "present"  the app process is running
//   "absent"   the probe ran and found no match (the app really is closed)
//   "unknown"  the probe itself failed (spawn error, timeout, permissions)
//
// The caller must not treat "unknown" as "absent": a broken tasklist call used
// to look like a closed app. The plugin counts consecutive unknown answers and
// falls back to the heartbeat timeout only after that counter trips.
//
// On Windows the image name is not enough. Electron keeps crashpad and utility
// processes named OpenCode.exe, and an orphaned crashpad helper can outlive the
// real app for hours. A name-only probe then reports "present" forever and the
// pet never closes. The probe therefore resolves the main process (the one
// without a --type= helper argument) and keeps its pid cached, checking that
// pid on each cheap tasklist call.
"use strict";

const { execFile } = require("node:child_process");

const PROBE_TIMEOUT_MS = 2 * 1000;
// Resolving the main pid starts PowerShell, which is slower than tasklist. It
// only happens on a cache miss, so the extra budget does not affect normal
// probes.
const RESOLVE_TIMEOUT_MS = 6 * 1000;

// Values that mean "do not follow the desktop app". An explicit empty value is
// included so Windows users can turn the default OpenCode.exe follow off.
const OFF_VALUES = new Set(["", "off", "0", "false", "no", "none", "disabled"]);

// Main pids, keyed by lower-cased image name. Module-level so the plugin keeps
// the cache between probes; tests pass their own Map.
const mainPidCache = new Map();

// A new plugin instance must not trust a pid cached by the previous one: the
// app may have restarted while the service was reloading.
function resetProbeCache(cache = mainPidCache) {
  cache.clear();
}

// Resolve once per setup() so tests (and a restarted service) can change the
// environment without reloading the whole module.
function resolveAppProcess(env = process.env, platform = process.platform) {
  const explicit = Object.prototype.hasOwnProperty.call(env, "OPENCODE_PET_APP_PROCESS");
  const raw = explicit ? String(env.OPENCODE_PET_APP_PROCESS ?? "").trim() : "";

  if (explicit && OFF_VALUES.has(raw.toLowerCase())) {
    return { mode: "off", processName: "", source: "env" };
  }
  if (raw) {
    return { mode: "follow", processName: raw, source: "env" };
  }
  if (platform === "win32") {
    return { mode: "follow", processName: "OpenCode.exe", source: "default" };
  }
  return { mode: "off", processName: "", source: "default" };
}

// Parse the CSV form of tasklist output into { name, pid } rows. Matching the
// first quoted column avoids false positives from the "INFO: No tasks..." line
// and from names that merely contain the configured name (for example
// OpenCode.exe.bak).
function parseTasklistRows(stdout, processName) {
  const wanted = String(processName || "").toLowerCase();
  if (!wanted) return [];
  const rows = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const match = /^\s*"([^"]*)","(\d+)"/.exec(line);
    if (match && match[1].toLowerCase() === wanted) {
      rows.push({ name: match[1], pid: Number(match[2]) });
    }
  }
  return rows;
}

function parseTasklist(stdout, processName) {
  return parseTasklistRows(stdout, processName).length > 0;
}

// Process names are passed through the environment to PowerShell, but they are
// also interpolated into a WMI filter, so reject anything that could break out
// of the quoted string.
const SAFE_PROCESS_NAME = /^[A-Za-z0-9._ -]+$/;

const MAIN_PID_SCRIPT = [
  "$n=$env:OPENCODE_PET_PROC_NAME;",
  "$p=Get-CimInstance Win32_Process -Filter \"Name='$n'\" -ErrorAction Stop",
  "| Where-Object { $_.CommandLine -notmatch '--type=' }",
  "| Select-Object -First 1;",
  "if ($p) { [Console]::Out.Write($p.ProcessId) }",
].join(" ");

// Find the pid of the main app process. Helpers (crashpad, gpu, utility,
// renderer) are started with a --type= argument and are ignored.
function resolveMainPid(run, name, timeoutMs, callback) {
  if (!SAFE_PROCESS_NAME.test(name)) {
    callback(null);
    return;
  }
  run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", MAIN_PID_SCRIPT],
    {
      windowsHide: true,
      timeout: timeoutMs,
      env: { ...process.env, OPENCODE_PET_PROC_NAME: name },
    },
    (err, stdout) => {
      if (err) {
        callback(null, err);
        return;
      }
      const pid = Number.parseInt(String(stdout || "").trim(), 10);
      callback(Number.isFinite(pid) && pid > 0 ? pid : null);
    },
  );
}

// Ask the OS whether the configured app process is running. `options` exists
// for tests: inject execFile, platform, timeouts, or a cache without touching
// real processes.
function probeDesktopApp(config, options = {}) {
  const run = options.execFile || execFile;
  const platform = options.platform || process.platform;
  const timeout = options.timeoutMs === undefined ? PROBE_TIMEOUT_MS : options.timeoutMs;
  const resolveTimeout =
    options.resolveTimeoutMs === undefined ? RESOLVE_TIMEOUT_MS : options.resolveTimeoutMs;
  const cache = options.cache || mainPidCache;

  if (!config || config.mode === "off" || !config.processName) {
    // No app to follow: keep the old always-awake-while-opencode-runs path.
    return Promise.resolve("present");
  }

  const name = config.processName;
  const key = name.toLowerCase();

  if (platform !== "win32") {
    // pgrep exits 0 on a match and 1 on none. Anything else (missing pgrep,
    // timeout, permission error) is unknown rather than "closed".
    return new Promise((resolve) => {
      run("pgrep", ["-x", name], { timeout }, (err) => {
        if (!err) {
          resolve("present");
          return;
        }
        resolve(err.code === 1 ? "absent" : "unknown");
      });
    });
  }

  return new Promise((resolve) => {
    run(
      "tasklist",
      ["/FI", `IMAGENAME eq ${name}`, "/FO", "CSV", "/NH"],
      { windowsHide: true, timeout },
      (err, stdout) => {
        if (err) {
          resolve("unknown");
          return;
        }

        const rows = parseTasklistRows(stdout, name);
        if (rows.length === 0) {
          cache.delete(key);
          resolve("absent");
          return;
        }

        // Fast path: the main process we already found is still in the list.
        const cached = cache.get(key);
        if (cached && rows.some((row) => row.pid === cached)) {
          resolve("present");
          return;
        }

        // Only helper processes are left, or the main pid changed. Resolve the
        // real app process once and cache it.
        resolveMainPid(run, name, resolveTimeout, (pid, resolveErr) => {
          if (resolveErr) {
            resolve("unknown");
            return;
          }
          if (!pid) {
            cache.delete(key);
            resolve("absent");
            return;
          }
          cache.set(key, pid);
          resolve("present");
        });
      },
    );
  });
}

module.exports = {
  OFF_VALUES,
  PROBE_TIMEOUT_MS,
  RESOLVE_TIMEOUT_MS,
  parseTasklist,
  parseTasklistRows,
  probeDesktopApp,
  resetProbeCache,
  resolveAppProcess,
};
