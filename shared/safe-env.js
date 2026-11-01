// A minimal, allow-listed environment for child processes.
//
// The pet launcher and the desktop probe used to forward `{ ...process.env }`
// to every child they spawned. That leaks API keys, tokens, and unrelated
// application state into processes that only need PATH and a home directory.
//
// This module builds a fresh environment from an allow-list instead. Anything
// the caller genuinely needs is passed through `extra`; everything else is
// dropped. `OPENCODE_PET_*` is kept because those variables are this project's
// documented configuration surface.
"use strict";

// Variables the operating system and Node/Electron need to start a process.
// Names are matched case-sensitively, so both Windows spellings are listed.
const ALLOWED_EXACT = new Set([
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
]);

// Project-owned configuration. These are safe by definition: they are the
// documented knobs for this pet, not credentials.
const ALLOWED_PREFIXES = ["OPENCODE_PET_"];

// Environment variable names must look like names, never like shell syntax.
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isAllowedKey(key) {
  if (!SAFE_KEY.test(key)) return false;
  if (ALLOWED_EXACT.has(key)) return true;
  return ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// Build the child environment. `extra` wins over the inherited value for any
// key it supplies, but only for keys that pass the same safety checks.
function safeEnv(extra = {}, source = process.env) {
  const env = {};
  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      if (!isAllowedKey(key)) continue;
      env[key] = String(value);
    }
  }
  if (extra && typeof extra === "object") {
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined || value === null) continue;
      if (!SAFE_KEY.test(key)) continue;
      env[key] = String(value);
    }
  }
  return env;
}

module.exports = { safeEnv, isAllowedKey, ALLOWED_EXACT, ALLOWED_PREFIXES };
