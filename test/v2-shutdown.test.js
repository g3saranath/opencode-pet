"use strict";

// Regression tests for the OpenCode V2 desktop-follow shutdown path.
//
// Each test uses its own temp HOME and a real stand-in process as the overlay,
// so the plugin takes the production close path (pid file + liveness check +
// signal) without ever touching the live pet in ~/.cache/opencode-pet.
//
// The desktop probe is injected. That lets us drive present / absent / unknown
// deterministically instead of spawning tasklist or copying executables.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { isProcessAlive } = require("../shared/process-alive.js");

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-v2-shutdown-"));
process.env.USERPROFILE = TMP_HOME;
process.env.HOME = TMP_HOME;
process.env.OPENCODE_PET_NO_LAUNCH = "1";
delete process.env.OPENCODE_PET_APP_PROCESS;

const DIR = path.join(TMP_HOME, ".cache", "opencode-pet");
const PID_FILE = path.join(DIR, "pet.pid");
const HEARTBEAT_FILE = path.join(DIR, "heartbeat");
const PET_URL = pathToFileURL(path.join(__dirname, "..", "plugin", "pet.ts")).href;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(20);
  }
  return false;
}

function resetDir() {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
}

function startPet() {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
}

async function startLivePet() {
  const child = startPet();
  await waitFor(() => isProcessAlive(child.pid));
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(child.pid));
  return child;
}

function stopPet(child) {
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

const idleContext = {};

const fast = { probeMs: 20, idleProbeMs: 20, beatMs: 20 };

let mod;

before(async () => {
  mod = await import(PET_URL);
});

after(() => {
  try {
    fs.rmSync(TMP_HOME, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

test("closes the pet when the desktop app closes", async () => {
  resetDir();
  const pet = await startLivePet();
  const answers = ["present", "present", "absent"];
  const cleanup = await mod.default.setup(idleContext, {
    ...fast,
    probeApp: async () => answers.shift() || "absent",
  });

  try {
    assert.ok(await waitFor(() => fs.existsSync(HEARTBEAT_FILE)), "heartbeat while app is open");
    assert.equal(isProcessAlive(pet.pid), true, "pet stays up while app is open");

    assert.ok(await waitFor(() => !isProcessAlive(pet.pid)), "pet closed after app exit");
    assert.equal(fs.existsSync(PID_FILE), false, "stale pid file removed");
    assert.equal(fs.existsSync(HEARTBEAT_FILE), false, "heartbeat removed");
  } finally {
    await cleanup();
    stopPet(pet);
    resetDir();
  }
});

test("closes a pet left behind when the app is already closed", async () => {
  resetDir();
  const pet = await startLivePet();
  // petUp starts false in a fresh plugin instance, so the old code did nothing
  // here and left the overlay running.
  const cleanup = await mod.default.setup(idleContext, {
    ...fast,
    probeApp: async () => "absent",
  });

  try {
    assert.ok(await waitFor(() => !isProcessAlive(pet.pid)), "orphaned pet was closed");
  } finally {
    await cleanup();
    stopPet(pet);
    resetDir();
  }
});

test("cleanup keeps the pet on a reload while the app is still open", async () => {
  resetDir();
  const pet = await startLivePet();
  const cleanup = await mod.default.setup(idleContext, {
    ...fast,
    probeApp: async () => "present",
  });

  try {
    assert.ok(await waitFor(() => fs.existsSync(HEARTBEAT_FILE)), "pet woke up");
    await cleanup();
    assert.equal(isProcessAlive(pet.pid), true, "reload does not kill the pet");
    assert.equal(fs.existsSync(HEARTBEAT_FILE), false, "heartbeat released on unload");
  } finally {
    stopPet(pet);
    resetDir();
  }
});

test("cleanup closes the pet when the app closed during unload", async () => {
  resetDir();
  const pet = await startLivePet();
  let appOpen = true;
  const cleanup = await mod.default.setup(idleContext, {
    ...fast,
    probeApp: async () => (appOpen ? "present" : "absent"),
  });

  try {
    assert.ok(await waitFor(() => fs.existsSync(HEARTBEAT_FILE)), "pet woke up");
    appOpen = false;
    await cleanup();
    assert.ok(await waitFor(() => !isProcessAlive(pet.pid)), "unload closed the pet");
  } finally {
    stopPet(pet);
    resetDir();
  }
});

test("OFF mode closes the pet on unload without a desktop signal", async () => {
  resetDir();
  process.env.OPENCODE_PET_APP_PROCESS = "";
  const pet = await startLivePet();
  let cleanup;

  try {
    // No probe override: OFF means the real probe reports "present" without
    // touching the OS, exactly like the always-awake fallback.
    cleanup = await mod.default.setup(idleContext, fast);
    assert.ok(await waitFor(() => fs.existsSync(HEARTBEAT_FILE)), "OFF still pulses");

    await cleanup();
    cleanup = undefined;
    assert.ok(await waitFor(() => !isProcessAlive(pet.pid)), "OFF closes on unload");
  } finally {
    if (cleanup) await cleanup();
    delete process.env.OPENCODE_PET_APP_PROCESS;
    stopPet(pet);
    resetDir();
  }
});

test("three failed probes stop the heartbeat but do not kill the pet", async () => {
  resetDir();
  const pet = await startLivePet();
  let first = true;
  const cleanup = await mod.default.setup(idleContext, {
    ...fast,
    probeApp: async () => {
      if (first) {
        first = false;
        return "present";
      }
      return "unknown";
    },
  });

  try {
    assert.ok(await waitFor(() => fs.existsSync(HEARTBEAT_FILE)), "heartbeat started");

    // The fallback counter trips after three consecutive probe failures.
    assert.ok(await waitFor(() => !fs.existsSync(HEARTBEAT_FILE)), "heartbeat stopped");
    assert.equal(isProcessAlive(pet.pid), true, "a failed probe never signals the pet");
  } finally {
    await cleanup();
    stopPet(pet);
    resetDir();
  }
});
