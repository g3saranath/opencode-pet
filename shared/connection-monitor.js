// Fallback connection monitor for the Electron overlay.
//
// The plugin stops writing the heartbeat when opencode is gone, but the pet
// cannot always be signalled directly (crash, forced kill, a plugin that never
// unloads). This monitor turns each checkConnection() tick into a counter of
// consecutive missed heartbeats. A valid heartbeat resets the counter, so one
// stale read cannot put the pet to sleep. When the disconnection has lasted
// `sleepQuitMs`, the caller quits the overlay.
//
// `sampleMs` is not needed here: elapsed time is used for the 15s quit so a
// slow tick still quits promptly, while the counter explains what was missed.
"use strict";

function createConnectionMonitor(options = {}) {
  const heartbeatTimeoutMs =
    options.heartbeatTimeoutMs === undefined ? 45 * 1000 : options.heartbeatTimeoutMs;
  const sleepQuitMs = options.sleepQuitMs === undefined ? 15 * 1000 : options.sleepQuitMs;

  let misses = 0;
  let sleepingSince = 0;

  function sample(input = {}) {
    const now = Number.isFinite(input.now) ? input.now : Date.now();
    const lastBeat = Number.isFinite(input.lastBeat) ? input.lastBeat : 0;
    const pidAlive = input.pidAlive !== false;
    const startedAt = Number.isFinite(input.startedAt) ? input.startedAt : now;

    // Startup grace: do not flash "sleeping" before the first heartbeat.
    const inGrace = now - startedAt < heartbeatTimeoutMs;
    const fresh = lastBeat > 0 && now - lastBeat < heartbeatTimeoutMs;
    const connected = (pidAlive && fresh) || inGrace;

    if (connected) {
      misses = 0;
      sleepingSince = 0;
      return "connected";
    }

    misses++;
    if (!sleepingSince) sleepingSince = now;
    if (now - sleepingSince >= sleepQuitMs) return "quit";
    return "sleeping";
  }

  return {
    sample,
    get misses() {
      return misses;
    },
    get sleepingSince() {
      return sleepingSince;
    },
  };
}

module.exports = { createConnectionMonitor };
