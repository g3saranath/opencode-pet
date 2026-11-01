"use strict";

// Unit tests for shared/pet-process.js, the close logic shared by the V1 and V2
// plugin entry points. The liveness probe and the signal sender are injected so
// these tests never touch a real process and never write to the real cache dir.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { readPetPid, closePetProcess } = require("../shared/pet-process.js");

function tempPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-proc-"));
  return {
    dir,
    pidFile: path.join(dir, "pet.pid"),
    heartbeatFile: path.join(dir, "heartbeat"),
  };
}

test("readPetPid reads a positive integer, else 0", () => {
  const { dir, pidFile } = tempPaths();
  try {
    assert.equal(readPetPid(pidFile), 0, "missing file");
    fs.writeFileSync(pidFile, "4321");
    assert.equal(readPetPid(pidFile), 4321);
    fs.writeFileSync(pidFile, "not-a-pid");
    assert.equal(readPetPid(pidFile), 0, "unparseable");
    fs.writeFileSync(pidFile, "-5");
    assert.equal(readPetPid(pidFile), 0, "non-positive");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("closePetProcess signals a live pid and clears heartbeat + pid file", () => {
  const { dir, pidFile, heartbeatFile } = tempPaths();
  try {
    fs.writeFileSync(pidFile, "999999");
    fs.writeFileSync(heartbeatFile, "beat");
    const signals = [];
    const closed = closePetProcess({
      pidFile,
      heartbeatFile,
      isAlive: () => true,
      kill: (pid) => signals.push(pid),
    });
    assert.equal(closed, true);
    assert.deepEqual(signals, [999999]);
    assert.equal(fs.existsSync(heartbeatFile), false);
    assert.equal(fs.existsSync(pidFile), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("closePetProcess never signals a dead pid but still stops the heartbeat", () => {
  const { dir, pidFile, heartbeatFile } = tempPaths();
  try {
    fs.writeFileSync(pidFile, "999999");
    fs.writeFileSync(heartbeatFile, "beat");
    let killed = false;
    const closed = closePetProcess({
      pidFile,
      heartbeatFile,
      isAlive: () => false,
      kill: () => {
        killed = true;
      },
    });
    assert.equal(closed, false);
    assert.equal(killed, false, "a stale pid is not signalled");
    assert.equal(fs.existsSync(heartbeatFile), false, "heartbeat always stops");
    assert.equal(fs.existsSync(pidFile), true, "pid file kept when nothing was signalled");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("closePetProcess tolerates a missing pid file", () => {
  const { dir, pidFile, heartbeatFile } = tempPaths();
  try {
    const closed = closePetProcess({
      pidFile,
      heartbeatFile,
      isAlive: () => true,
      kill: () => {},
    });
    assert.equal(closed, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("closePetProcess swallows a kill that races with process exit", () => {
  const { dir, pidFile, heartbeatFile } = tempPaths();
  try {
    fs.writeFileSync(pidFile, "999999");
    const closed = closePetProcess({
      pidFile,
      heartbeatFile,
      isAlive: () => true,
      kill: () => {
        throw new Error("ESRCH");
      },
    });
    assert.equal(closed, true, "a live pid was seen, so the close is reported handled");
    assert.equal(fs.existsSync(pidFile), false, "stale pid file still cleaned up");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
