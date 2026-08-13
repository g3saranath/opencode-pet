// Shared path + constant helpers for the opencode-pet Electron app.
// (The opencode plugin re-implements this tiny logic standalone so it can stay
// dependency-free, but the values MUST match what's here.)
const os = require("os");
const path = require("path");

const DIR = path.join(os.homedir(), ".cache", "opencode-pet");
const STATE_FILE = path.join(DIR, "state.json");
const PID_FILE = path.join(DIR, "pet.pid");
const HEARTBEAT_FILE = path.join(DIR, "heartbeat");

// Valid pet states (kept in sync with plugin/pet.ts STATES).
const STATES = [
  "idle",
  "thinking",
  "working",
  "waiting",
  "happy",
  "error",
  "sleeping",
];

module.exports = { DIR, STATE_FILE, PID_FILE, HEARTBEAT_FILE, STATES };
