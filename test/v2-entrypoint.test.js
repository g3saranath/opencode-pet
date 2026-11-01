"use strict";

// Focused tests for the OpenCode V2 entry point (setup(ctx)).
//
// These run without an OpenCode install: setup() only needs ctx.event.subscribe,
// so a fake context feeds it events. The cache path is derived from the home dir
// at import time, so the home is pointed at a temp dir first and the real
// ~/.cache/opencode-pet is never touched. OPENCODE_PET_APP_PROCESS names an app
// that does not exist, which keeps the desktop-app probe inert so the assertions
// are deterministic, and OPENCODE_PET_NO_LAUNCH stops Electron from spawning.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-v2-"));
process.env.USERPROFILE = TMP_HOME;
process.env.HOME = TMP_HOME;
process.env.OPENCODE_PET_NO_LAUNCH = "1";
process.env.OPENCODE_PET_APP_PROCESS = "pet-nonexistent-xyz.exe";

const DIR = path.join(TMP_HOME, ".cache", "opencode-pet");
const STATE_FILE = path.join(DIR, "state.json");
const PET_URL = pathToFileURL(path.join(__dirname, "..", "plugin", "pet.ts")).href;

const readState = () => JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in for ctx.event.subscribe(): yields the given events, then parks
// until the plugin aborts the stream on cleanup.
function fakeIterable(events, signal) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < events.length) return { value: events[i++], done: false };
          await new Promise((resolve) => {
            if (signal?.aborted) return resolve();
            signal?.addEventListener("abort", resolve, { once: true });
          });
          return { value: undefined, done: true };
        },
      };
    },
  };
}

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

test("default export is a V2 plugin definition with a V1 entry point", () => {
  assert.equal(mod.default.id, "opencode-pet");
  assert.equal(typeof mod.default.setup, "function");
  assert.equal(typeof mod.default.server, "function", "the V1 entry point stays available");
});

test("setup(ctx) returns its unload cleanup and relays V2 events", async () => {
  const events = [
    {
      type: "session.inbox.enqueued",
      data: { item: { type: "user", payload: { text: "hello there" } } },
    },
    { type: "session.idle", data: {} },
  ];
  const ctx = { event: { subscribe: ({ signal }) => fakeIterable(events, signal) } };

  const cleanup = await mod.default.setup(ctx);
  assert.equal(typeof cleanup, "function", "setup returns a cleanup function");

  try {
    // Wait for both queued events to drain and the final state to land.
    for (let i = 0; i < 60; i++) {
      if (fs.existsSync(STATE_FILE) && readState().state === "happy") break;
      await sleep(25);
    }

    const state = readState();
    assert.ok(
      state.feed.some((e) => e.text === "you: hello there"),
      "the user prompt was relayed",
    );
    assert.equal(state.state, "happy", "session.idle finishes happily");
    assert.equal(state.feed[state.feed.length - 1]?.text, "finished", "the done line is last");
  } finally {
    // Must not throw, and must leave the plugin stopped (no timers left running).
    await cleanup();
  }
});
