"use strict";

// These tests exercise the REAL production implementation in
// shared/state-protocol.js — the same module plugin/pet.ts and app/main.js
// use. If that module breaks or disappears, these tests fail.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createStateWriter, readState } = require("../shared/state-protocol");
const { STATES } = require("../shared/paths.js");
const STATES_JSON = require("../shared/states.json");

describe("state protocol", () => {
  let tmpDir;
  let stateFile;
  let tmpFile;

  // A writer bound to the temp dir — built by the SAME factory production uses.
  function makeWriter() {
    return createStateWriter({ dir: tmpDir });
  }

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-test-"));
    stateFile = path.join(tmpDir, "state.json");
    tmpFile = path.join(tmpDir, "state.json.tmp");
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // --- shared state definitions -------------------------------------------

  it("single source of truth: shared/states.json equals shared/paths.js STATES", () => {
    assert.deepEqual(STATES, STATES_JSON);
  });

  it("STATES contains exactly the 7 expected states in order", () => {
    assert.deepEqual(STATES, ["idle", "thinking", "working", "waiting", "happy", "error", "sleeping"]);
  });

  // --- round trip ----------------------------------------------------------

  it("write + read round-trips state through the real implementation", () => {
    const writeState = makeWriter();
    assert.equal(writeState("thinking"), true);
    const got = readState(stateFile);
    assert.equal(got.state, "thinking");
    assert.ok(typeof got.ts === "number");
  });

  it("envelope preserves extra fields (tool, detail) and the feed array", () => {
    const writeState = makeWriter();
    const feed = [
      { seq: 1, icon: "✏️", text: "edit token.ts", kind: "step" },
      { seq: 2, icon: "↳", text: "output line", kind: "out", id: "abc" },
    ];
    writeState("working", { tool: "edit", detail: "token.ts" }, feed);
    const got = readState(stateFile);
    assert.equal(got.state, "working");
    assert.equal(got.tool, "edit");
    assert.equal(got.detail, "token.ts");
    assert.deepEqual(got.feed, feed);
  });

  it("preserves feed streaming id and kind", () => {
    const writeState = makeWriter();
    const feed = [{ seq: 5, icon: "💭", text: "reasoning…", kind: "reason", id: "part-1" }];
    writeState("thinking", {}, feed);
    const got = readState(stateFile);
    assert.equal(got.feed[0].id, "part-1");
    assert.equal(got.feed[0].kind, "reason");
  });

  it("envelope always includes ts timestamp", () => {
    const writeState = makeWriter();
    const before = Date.now();
    writeState("idle");
    const got = readState(stateFile);
    assert.ok(got.ts >= before);
    assert.ok(got.ts <= Date.now());
  });

  // --- reader validation / fallback ---------------------------------------

  it("rejects unknown state and falls back to idle", () => {
    const writeState = makeWriter();
    writeState("unknown_state"); // runtime doesn't gate writes; the reader validates
    assert.deepEqual(readState(stateFile), { state: "idle" });
  });

  it("handles missing file as idle", () => {
    try { fs.unlinkSync(stateFile); } catch {}
    assert.deepEqual(readState(stateFile), { state: "idle" });
  });

  it("handles corrupt JSON as idle", () => {
    fs.writeFileSync(stateFile, "{ not json");
    assert.deepEqual(readState(stateFile), { state: "idle" });
  });

  // --- atomicity -----------------------------------------------------------

  it("atomic write leaves no partial JSON (tmp is renamed away)", () => {
    const writeState = makeWriter();
    writeState("happy", {}, [{ seq: 99, icon: "✨", text: "finished", kind: "done" }]);
    assert.equal(fs.existsSync(tmpFile), false);
    const raw = fs.readFileSync(stateFile, "utf8");
    let parsed = null;
    assert.doesNotThrow(() => { parsed = JSON.parse(raw); });
    assert.equal(parsed.state, "happy");
  });

  it("recovers from a stale tmp file left behind by a crashed writer", () => {
    fs.writeFileSync(tmpFile, "{ stale garbage");
    const writeState = makeWriter();
    assert.equal(writeState("working"), true);
    assert.equal(fs.existsSync(tmpFile), false);
    assert.equal(readState(stateFile).state, "working");
  });

  // --- deduplication -------------------------------------------------------

  it("dedupes identical consecutive payloads and writes changed ones", async () => {
    const writeState = makeWriter(); // one writer for both calls, like one plugin instance
    assert.equal(writeState("waiting", { detail: "needs approval" }), true);
    const first = JSON.parse(fs.readFileSync(stateFile, "utf8"));

    await new Promise((r) => setTimeout(r, 15)); // guarantee the clock moves past first.ts
    assert.equal(writeState("waiting", { detail: "needs approval" }), false); // deduped
    const second = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.equal(second.ts, first.ts); // file untouched by the deduped write

    assert.equal(writeState("waiting", { detail: "changed" }), true); // new body → written
    const third = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    assert.notEqual(third.ts, first.ts);
    assert.equal(third.detail, "changed");
  });

  // --- error handling ------------------------------------------------------

  it("swallows filesystem errors instead of throwing (unwritable target)", () => {
    // The dir path passes THROUGH a regular file, so mkdir/rename must fail.
    const blocker = path.join(tmpDir, "blocker");
    fs.writeFileSync(blocker, "not a directory");
    const badWriter = createStateWriter({ dir: path.join(blocker, "sub") });
    assert.doesNotThrow(() => {
      const ok = badWriter("error", { detail: "boom" });
      assert.equal(ok, false);
    });
  });
});
