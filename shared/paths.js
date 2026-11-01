// Shared path + constant helpers for the opencode-pet Electron app.
//
// `os.homedir()` is evaluated at module scope here, which is fine in the
// Node/Electron main process. The GUI bundle is also loaded in the window
// process, where `node:os` is an inert stub and `homedir` may be missing, so
// fall back to the environment (or an empty string) instead of crashing the
// whole bundle. The constants below are only used for real I/O in the main
// process; the window process never reads them.
const os = require("os");
const path = require("path");

function safeHome() {
  try {
    if (typeof os.homedir === "function") {
      const value = os.homedir();
      if (typeof value === "string" && value) return value;
    }
  } catch {
    /* inert stub */
  }
  return process.env.HOME || process.env.USERPROFILE || "";
}

const DIR = path.join(safeHome(), ".cache", "opencode-pet");
const STATE_FILE = path.join(DIR, "state.json");
const PID_FILE = path.join(DIR, "pet.pid");
const HEARTBEAT_FILE = path.join(DIR, "heartbeat");

// Single source of truth for valid pet states — see shared/states.json. The
// fallback only matters if the JSON cannot be loaded (for example a bundler
// that drops it); it must match states.json.
const FALLBACK_STATES = ["idle", "thinking", "working", "waiting", "happy", "error", "sleeping"];
let STATES;
try {
  STATES = require("./states.json");
} catch {
  STATES = FALLBACK_STATES;
}
if (!Array.isArray(STATES)) STATES = FALLBACK_STATES;

module.exports = { DIR, STATE_FILE, PID_FILE, HEARTBEAT_FILE, STATES };
