"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Helpers mirroring the real file-bus protocol
// See plugin/pet.ts:writeState and app/main.js:readState
// ---------------------------------------------------------------------------
let tmpDir;
let STATE_FILE;
let TMP_FILE;

// Mirrors plugin/pet.ts writeState (atomic tmp → rename, dedup not needed for test)
function writeState(state, extra = {}, feed = []) {
  const body = { state, ...extra, feed };
  const payload = JSON.stringify({ ...body, ts: Date.now() });
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(TMP_FILE, payload);
  fs.renameSync(TMP_FILE, STATE_FILE);
}

// Mirrors app/main.js readState (STATES allowlist + fallback)
function readState(STATES) {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && STATES.includes(parsed.state)) return parsed;
  } catch {}
  return { state: "idle" };
}

describe("state protocol", () => {
  let STATES;
  let sharedPathsStates;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-test-"));
    STATE_FILE = path.join(tmpDir, "state.json");
    TMP_FILE = path.join(tmpDir, "state.json.tmp");

    STATES = require("../shared/states.json");
    sharedPathsStates = require("../shared/paths.js").STATES;
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("single source of truth: shared/states.json equals shared/paths.js STATES", () => {
    assert.deepEqual(sharedPathsStates, STATES);
  });

  it("STATES contains exactly the 7 expected states in order", () => {
    assert.deepEqual(STATES, ["idle", "thinking", "working", "waiting", "happy", "error", "sleeping"]);
  });

  it("write + read round-trips state", () => {
    writeState("thinking");
    const got = readState(STATES);
    assert.equal(got.state, "thinking");
    assert.ok(typeof got.ts === "number");
  });

  it("preserves tool, detail, and feed fields", () => {
    const feed = [
      { seq: 1, icon: "✏️", text: "edit token.ts", kind: "step" },
      { seq: 2, icon: "↳", text: "output line", kind: "out", id: "abc" },
    ];
    writeState("working", { tool: "edit", detail: "token.ts" }, feed);
    const got = readState(STATES);
    assert.equal(got.state, "working");
    assert.equal(got.tool, "edit");
    assert.equal(got.detail, "token.ts");
    assert.deepEqual(got.feed, feed);
  });

  it("preserves feed streaming id and kind", () => {
    const feed = [{ seq: 5, icon: "💭", text: "reasoning…", kind: "reason", id: "part-1" }];
    writeState("thinking", {}, feed);
    const got = readState(STATES);
    assert.equal(got.feed[0].id, "part-1");
    assert.equal(got.feed[0].kind, "reason");
  });

  it("rejects unknown state and falls back to idle", () => {
    writeState("unknown_state");
    const got = readState(STATES);
    assert.equal(got.state, "idle");
  });

  it("handles missing file as idle", () => {
    try { fs.unlinkSync(STATE_FILE); } catch {}
    const got = readState(STATES);
    assert.equal(got.state, "idle");
  });

  it("handles corrupt JSON as idle", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(STATE_FILE, "{ not json");
    const got = readState(STATES);
    assert.equal(got.state, "idle");
  });

  it("atomic write leaves no partial JSON (tmp is renamed)", () => {
    writeState("happy", {}, [{ seq: 99, icon: "✨", text: "finished", kind: "done" }]);
    // tmp file should not remain after rename
    assert.equal(fs.existsSync(TMP_FILE), false);
    assert.equal(fs.existsSync(STATE_FILE), true);
    const got = readState(STATES);
    assert.equal(got.state, "happy");
    // file must be valid JSON
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    assert.doesNotThrow(() => JSON.parse(raw));
  });

  it("envelope always includes ts timestamp", () => {
    const before = Date.now();
    writeState("idle");
    const got = readState(STATES);
    assert.ok(got.ts >= before);
    assert.ok(got.ts <= Date.now());
  });
});
