"use strict";

// Unit tests for the overlay's stale-heartbeat fallback counter. The pet should
// nap on the first missed heartbeat, quit 15s later, and reset both counters as
// soon as a valid heartbeat arrives.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { createConnectionMonitor } = require("../shared/connection-monitor.js");

const TIMEOUT = 45_000;
const QUIT = 15_000;

function monitor() {
  return createConnectionMonitor({ heartbeatTimeoutMs: TIMEOUT, sleepQuitMs: QUIT });
}

describe("connection fallback counter", () => {
  it("stays connected on a fresh heartbeat", () => {
    const m = monitor();
    const now = 1_000_000;
    assert.equal(m.sample({ now, lastBeat: now - 1000, startedAt: now - 60_000 }), "connected");
    assert.equal(m.misses, 0);
  });

  it("naps on the first miss then quits 15s later", () => {
    const m = monitor();
    const start = 1_000_000;
    const oldBeat = start - TIMEOUT - 1000;

    assert.equal(
      m.sample({ now: start, lastBeat: oldBeat, startedAt: start - 60_000 }),
      "sleeping",
    );
    assert.equal(m.misses, 1);

    assert.equal(
      m.sample({ now: start + 3_000, lastBeat: oldBeat, startedAt: start - 60_000 }),
      "sleeping",
    );
    assert.equal(m.misses, 2);

    assert.equal(
      m.sample({ now: start + 14_000, lastBeat: oldBeat, startedAt: start - 60_000 }),
      "sleeping",
    );

    assert.equal(
      m.sample({ now: start + QUIT, lastBeat: oldBeat, startedAt: start - 60_000 }),
      "quit",
    );
  });

  it("treats a dead heartbeat pid as a miss even if the timestamp is fresh", () => {
    const m = monitor();
    const now = 1_000_000;
    assert.equal(
      m.sample({ now, lastBeat: now - 100, pidAlive: false, startedAt: now - 60_000 }),
      "sleeping",
    );
  });

  it("resets the counter when the heartbeat comes back", () => {
    const m = monitor();
    const start = 1_000_000;
    const oldBeat = start - TIMEOUT - 1000;

    m.sample({ now: start, lastBeat: oldBeat, startedAt: start - 60_000 });
    m.sample({ now: start + 3_000, lastBeat: oldBeat, startedAt: start - 60_000 });
    assert.equal(m.misses, 2);

    assert.equal(
      m.sample({ now: start + 6_000, lastBeat: start + 6_000, startedAt: start - 60_000 }),
      "connected",
    );
    assert.equal(m.misses, 0);
    assert.equal(m.sleepingSince, 0);

    // The next miss starts a fresh 15s window instead of quitting immediately.
    assert.equal(
      m.sample({ now: start + 9_000, lastBeat: oldBeat, startedAt: start - 60_000 }),
      "sleeping",
    );
  });

  it("uses the startup grace window so a new pet does not flash sleeping", () => {
    const m = monitor();
    const now = 1_000_000;
    assert.equal(m.sample({ now, lastBeat: 0, startedAt: now - 1000 }), "connected");
    assert.equal(m.misses, 0);
  });
});
