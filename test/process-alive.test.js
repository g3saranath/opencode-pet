"use strict";

// Exercises shared/process-alive.js, used by the plugin before it signals the
// pet and by the app when validating the heartbeat pid. A wrong answer here
// either kills an unrelated process or puts the pet to sleep while opencode
// is still running.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { isProcessAlive } = require("../shared/process-alive");

describe("process liveness", () => {
  it("reports the current process as alive", () => {
    assert.equal(isProcessAlive(process.pid), true);
  });

  it("reports an unused pid as dead", () => {
    // Search from the top of the pid space for one that is genuinely absent,
    // rather than hardcoding a number that might be in use.
    let free = 0;
    for (let pid = 0x3fffffff; pid > 0x3ffffff0; pid--) {
      try {
        process.kill(pid, 0);
      } catch (err) {
        if (err.code === "ESRCH") { free = pid; break; }
      }
    }
    assert.ok(free, "expected to find an unused pid");
    assert.equal(isProcessAlive(free), false);
  });

  it("treats EPERM as alive, not dead", () => {
    // pid 1 (init/launchd) exists but is owned by root, so an unprivileged
    // probe throws EPERM. Treating that as dead would make the pet quit while
    // opencode was still running.
    const original = process.kill;
    try {
      process.kill = () => {
        const err = new Error("operation not permitted");
        err.code = "EPERM";
        throw err;
      };
      assert.equal(isProcessAlive(1), true);
    } finally {
      process.kill = original;
    }
  });

  it("rejects invalid pids without throwing", () => {
    for (const bad of [0, -1, NaN, 1.5, undefined, null]) {
      assert.equal(isProcessAlive(bad), false);
    }
  });
});
