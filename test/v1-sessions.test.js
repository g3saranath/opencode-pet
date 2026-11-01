"use strict";

// OpenCode 1.x runs one server() per terminal (and per project), and they all
// share a single overlay. Closing one session must not kill the pet for the
// others; the last one to leave closes it.
//
// Like the other entry-point tests, HOME points at a temp dir before pet.ts is
// imported, and stand-in processes play the overlay and the other terminal.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { isProcessAlive } = require("../shared/process-alive.js");
const {
  registerSession,
  unregisterSession,
  liveSessions,
} = require("../shared/session-registry.js");

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-v1-sessions-"));
process.env.USERPROFILE = TMP_HOME;
process.env.HOME = TMP_HOME;
process.env.OPENCODE_PET_NO_LAUNCH = "1";

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

async function standIn() {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await waitFor(() => isProcessAlive(child.pid));
  return child;
}

function stop(child) {
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

async function startOverlay() {
  const overlay = await standIn();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(overlay.pid));
  return overlay;
}

let mod;

before(async () => {
  mod = await import(PET_URL);
});

after(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});

test("the registry lists live sessions and prunes dead or malformed ones", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-registry-"));
  try {
    const mine = registerSession(dir, { pid: 1001 });
    const other = registerSession(dir, { pid: 1002 });
    fs.writeFileSync(path.join(dir, "sessions", "not-a-session"), "");
    const alive = (pid) => pid === 1001 || pid === 1002;

    assert.deepEqual(
      liveSessions(dir, { isAlive: alive, except: mine }).map((s) => s.pid),
      [1002],
    );
    assert.equal(fs.existsSync(path.join(dir, "sessions", "not-a-session")), false, "pruned");

    // 1002 crashed: its entry is pruned on the next read.
    assert.deepEqual(liveSessions(dir, { isAlive: (pid) => pid === 1001, except: mine }), []);
    assert.equal(fs.existsSync(path.join(dir, "sessions", other)), false);

    unregisterSession(dir, mine);
    assert.deepEqual(liveSessions(dir, { isAlive: () => true }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("closing one terminal keeps the pet for another live terminal", async () => {
  const overlay = await startOverlay();
  const otherTerminal = await standIn();
  try {
    // The other terminal's server() registered itself.
    fs.mkdirSync(path.join(DIR, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(DIR, "sessions", `${otherTerminal.pid}.1`), "");

    const hooks = await mod.default.server();
    await hooks.dispose();

    assert.equal(isProcessAlive(overlay.pid), true, "the pet stays up");
    assert.equal(fs.existsSync(PID_FILE), true);
    const [, beatPid] = fs.readFileSync(HEARTBEAT_FILE, "utf8").trim().split(/\s+/);
    assert.equal(Number(beatPid), otherTerminal.pid, "heartbeat handed to the live session");

    // The other terminal goes away without a clean dispose (crash); the next
    // session to close is now the last one and closes the pet.
    stop(otherTerminal);
    await waitFor(() => !isProcessAlive(otherTerminal.pid));
    const last = await mod.default.server();
    await last.dispose();
    assert.ok(await waitFor(() => !isProcessAlive(overlay.pid)), "last session closes the pet");
  } finally {
    stop(otherTerminal);
    stop(overlay);
  }
});

test("projects in one process share the pet until the last one disposes", async () => {
  const overlay = await startOverlay();
  try {
    const a = await mod.default.server();
    const b = await mod.default.server();

    await a.dispose();
    assert.equal(isProcessAlive(overlay.pid), true, "b still uses the pet");

    await b.dispose();
    assert.ok(await waitFor(() => !isProcessAlive(overlay.pid)), "closed after the last dispose");
    assert.deepEqual(liveSessions(DIR), [], "no sessions left behind");
  } finally {
    stop(overlay);
  }
});
