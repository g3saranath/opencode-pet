// Shared path + constant helpers for the opencode-pet Electron app.
const os = require("os");
const path = require("path");

const DIR = path.join(os.homedir(), ".cache", "opencode-pet");
const STATE_FILE = path.join(DIR, "state.json");
const PID_FILE = path.join(DIR, "pet.pid");
const HEARTBEAT_FILE = path.join(DIR, "heartbeat");

// Single source of truth for valid pet states — see shared/states.json
const STATES = require("./states.json");

module.exports = { DIR, STATE_FILE, PID_FILE, HEARTBEAT_FILE, STATES };
