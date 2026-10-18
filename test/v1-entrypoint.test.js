"use strict";

// Focused tests for the OpenCode V1 entry point (server()).
//
// The plugin's cache path is derived from the home dir when shared/paths is
// imported, so we point the home at a fresh temp directory *before* importing
// pet.ts. That keeps every write inside the temp dir and never touches the real
// ~/.cache/opencode-pet. OPENCODE_PET_NO_LAUNCH keeps server() from spawning
// Electron during the test.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-v1-"));
process.env.USERPROFILE = TMP_HOME;
process.env.HOME = TMP_HOME;
process.env.OPENCODE_PET_NO_LAUNCH = "1";

const DIR = path.join(TMP_HOME, ".cache", "opencode-pet");
const STATE_FILE = path.join(DIR, "state.json");
const HEARTBEAT_FILE = path.join(DIR, "heartbeat");
const PET_URL = pathToFileURL(path.join(__dirname, "..", "plugin", "pet.ts")).href;

const readState = () => JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mod;
let hooks;

before(async () => {
  mod = await import(PET_URL);
  hooks = await mod.default.server();
});

after(() => {
  try {
    fs.rmSync(TMP_HOME, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

test("default export exposes both entry points", () => {
  assert.equal(mod.default.id, "opencode-pet");
  assert.equal(typeof mod.default.setup, "function");
  assert.equal(typeof mod.default.server, "function");
});

test("server() returns the V1 string-keyed hooks", () => {
  for (const name of [
    "chat.message",
    "tool.execute.before",
    "tool.execute.after",
    "event",
    "dispose",
  ]) {
    assert.equal(typeof hooks[name], "function", name);
  }
});

test("server() wakes the pet: idle state plus a heartbeat", () => {
  const state = readState();
  assert.equal(state.state, "idle");
  assert.ok(state.feed.some((e) => e.text === "connected"), "connected line");
  assert.ok(fs.existsSync(HEARTBEAT_FILE), "heartbeat written");
});

test("chat.message shows the prompt and moves to thinking", async () => {
  await hooks["chat.message"](
    { messageID: "m1" },
    { message: { id: "m1" }, parts: [{ type: "text", text: "fix the bug" }] },
  );
  const state = readState();
  assert.equal(state.state, "thinking");
  assert.ok(state.feed.some((e) => e.text === "you: fix the bug"));
});

test("tool.execute.before labels the tool and switches to working", async () => {
  await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "npm test" } });
  const state = readState();
  assert.equal(state.state, "working");
  assert.equal(state.tool, "bash");
  assert.ok(state.feed.some((e) => e.text.includes("npm test")));
});

test("tool.execute.after records the output", async () => {
  await hooks["tool.execute.after"]({ tool: "bash" }, { output: "all tests passed" });
  const state = readState();
  assert.ok(state.feed.some((e) => e.text.includes("all tests passed")));
});

test("event: message.part.updated relays streamed text in place", async () => {
  await hooks.event({
    event: {
      type: "message.part.updated",
      properties: { part: { id: "p1", type: "reasoning", text: "thinking hard" } },
    },
  });
  await sleep(220); // relay writes are throttled
  const state = readState();
  const line = state.feed.find((e) => e.id === "p1");
  assert.ok(line, "streamed line present");
  assert.ok(line.text.includes("thinking hard"));
});

test("event: session.idle finishes happily", async () => {
  await hooks.event({ event: { type: "session.idle", properties: {} } });
  assert.equal(readState().state, "happy");
});

// ---------------------------------------------------------------------------
// event: session.status
//
// Historical V1 behavior (commit fdccab4), unchanged by the port:
//   - status "busy" while no tool is running -> emit("thinking")
//   - status "busy" while a tool runs       -> ignored (guarded by activeTools)
//   - status "retry"                        -> log a "retrying..." line + thinking
// ---------------------------------------------------------------------------

test("event: session.status busy with idle tools moves to thinking", async () => {
  await hooks.event({
    event: { type: "session.status", properties: { status: { type: "busy" } } },
  });
  assert.equal(readState().state, "thinking");
});

test("event: session.status busy does not override an in-flight tool", async () => {
  await hooks["tool.execute.before"]({ tool: "read" }, { args: { filePath: "src/app.js" } });
  assert.equal(readState().state, "working");

  await hooks.event({
    event: { type: "session.status", properties: { status: { type: "busy" } } },
  });
  assert.equal(readState().state, "working", "busy status is ignored while a tool runs");

  await hooks["tool.execute.after"]({ tool: "read" }, { output: "file contents" });
});

test("event: session.status retry logs a wait line and stays thinking", async () => {
  await hooks.event({
    event: { type: "session.status", properties: { status: { type: "retry" } } },
  });
  const state = readState();
  assert.equal(state.state, "thinking");
  assert.ok(
    state.feed.some((e) => e.text === "retrying\u2026" && e.kind === "wait"),
    "retry line present",
  );
});

// ---------------------------------------------------------------------------
// event: todo.updated
//
// Historical V1 behavior (commit fdccab4), now shared with V2 via
// planFromTodos(): pick the in-progress item's text (or "done/total done"),
// skip empty lists, skip an unchanged label, then log a "plan" line and emit
// working with { tool: "todowrite", detail }.
// ---------------------------------------------------------------------------

test("event: todo.updated with no items changes nothing", async () => {
  const before = readState();
  await hooks.event({ event: { type: "todo.updated", properties: { todos: [] } } });
  assert.deepEqual(readState(), before);
});

test("event: todo.updated highlights the in-progress item", async () => {
  await hooks.event({
    event: {
      type: "todo.updated",
      properties: {
        todos: [
          { status: "completed", content: "step one" },
          { status: "in_progress", content: "wire the tests" },
          { status: "pending", content: "ship it" },
        ],
      },
    },
  });
  const state = readState();
  assert.equal(state.state, "working");
  assert.equal(state.tool, "todowrite");
  assert.equal(state.detail, "wire the tests");
  assert.ok(
    state.feed.some((e) => e.text === "wire the tests" && e.kind === "plan"),
    "plan line present",
  );
});

test("event: todo.updated does not repeat an unchanged label", async () => {
  const before = readState();
  await hooks.event({
    event: {
      type: "todo.updated",
      properties: {
        todos: [
          { status: "completed", content: "step one" },
          { status: "in_progress", content: "wire the tests" },
          { status: "pending", content: "ship it" },
        ],
      },
    },
  });
  assert.deepEqual(readState(), before);
});

test("event: todo.updated falls back to a done/total count", async () => {
  await hooks.event({
    event: {
      type: "todo.updated",
      properties: {
        todos: [
          { status: "completed", content: "a" },
          { status: "completed", content: "b" },
          { status: "pending", content: "c" },
        ],
      },
    },
  });
  const state = readState();
  assert.equal(state.state, "working");
  assert.equal(state.detail, "2/3 done");
  assert.ok(
    state.feed.some((e) => e.text === "2/3 done" && e.kind === "plan"),
    "rollup plan line present",
  );
});

// ---------------------------------------------------------------------------
// event: permission.updated
//
// Historical V1 behavior (commit fdccab4), unchanged by the port: log the
// approval title (falling back to "needs approval") and emit waiting with the
// title truncated to 24 characters for the bubble.
// ---------------------------------------------------------------------------

test("event: permission.updated asks for approval", async () => {
  await hooks.event({
    event: { type: "permission.updated", properties: { title: "Allow running npm test" } },
  });
  const state = readState();
  assert.equal(state.state, "waiting");
  assert.equal(state.detail, "Allow running npm test");
  assert.ok(
    state.feed.some((e) => e.text === "Allow running npm test" && e.kind === "wait"),
    "approval line present",
  );
});

test("event: permission.updated falls back to a generic prompt", async () => {
  await hooks.event({ event: { type: "permission.updated", properties: {} } });
  const state = readState();
  assert.equal(state.state, "waiting");
  assert.equal(state.detail, "");
  assert.ok(
    state.feed.some((e) => e.text === "needs approval" && e.kind === "wait"),
    "fallback line present",
  );
});

test("dispose stops the heartbeat and reports sleeping", async () => {
  await hooks.dispose();
  assert.equal(fs.existsSync(HEARTBEAT_FILE), false);
  assert.equal(readState().state, "sleeping");
});
