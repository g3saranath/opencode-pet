// Real implementation of the opencode-pet file-bus state protocol.
// The opencode plugin writes state here; the Electron app reads it.
// Both sides MUST go through this module so behavior can't drift apart.
const fs = require("fs");
const path = require("path");
const { DIR, STATE_FILE, STATES } = require("./paths");

// Creates the writer half of the protocol (used by plugin/pet.ts).
//
// Each writer keeps its own dedup cache — one writer per plugin instance,
// mirroring how the plugin used to hold `lastPayload` at module scope.
// `options` exists so tests (or embedders) can redirect writes to another
// directory without touching production defaults.
function createStateWriter(options = {}) {
  const dir = options.dir || DIR;
  const stateFile = options.stateFile || path.join(dir, "state.json");
  const tmpFile = options.tmpFile || path.join(dir, "state.json.tmp");
  let lastPayload = "";

  return function writeState(state, extra = {}, feed = []) {
    // Envelope body excludes ts on purpose: identical consecutive payloads
    // dedupe away even though their timestamps differ.
    const body = { state, ...extra, feed };
    const dedupeKey = JSON.stringify(body);
    if (dedupeKey === lastPayload) return false;
    lastPayload = dedupeKey;
    const payload = JSON.stringify({ ...body, ts: Date.now() });
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmpFile, payload);
      fs.renameSync(tmpFile, stateFile); // atomic swap — readers never see partial JSON
    } catch {
      /* best effort — never break the session over a pet */
      return false;
    }
    return true;
  };
}

// Reader half of the protocol (used by app/main.js).
// Validates against the STATES allowlist and falls back to idle on any
// problem: missing file, corrupt JSON, or an unknown state string.
function readState(stateFile) {
  const file = stateFile || STATE_FILE;
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && STATES.includes(parsed.state)) return parsed;
  } catch {
    /* no state yet */
  }
  return { state: "idle" };
}

module.exports = { createStateWriter, readState };
