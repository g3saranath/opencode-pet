"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TOOL_LOOK, STATE_LOOK, WORKING_VERBS, resolveBubble } = require("../app/renderer/labels.js");

test("wizard verbs: exactly the ten expected words", () => {
  assert.deepEqual(WORKING_VERBS, [
    "casting", "conjuring", "scrying", "brewing", "weaving",
    "channeling", "summoning", "divining", "enchanting", "scribing",
  ]);
});

test("wizard verbs: unique and non-empty", () => {
  assert.equal(new Set(WORKING_VERBS).size, WORKING_VERBS.length);
  for (const v of WORKING_VERBS) assert.ok(v.length > 0);
});

test("known tool shows its label", () => {
  const r = resolveBubble("working", "read", "");
  assert.equal(r.text, "reading");
  assert.equal(r.toolClass, "tool-read");
  assert.equal(r.generic, false);
  assert.ok(r.emoji);
});

test("known tool target overrides the label but keeps the tool class", () => {
  const r = resolveBubble("working", "edit", "app.js");
  assert.equal(r.text, "app.js");
  assert.equal(r.toolClass, "tool-edit");
  assert.equal(r.generic, false);
});

test("bash shows the friendly command label", () => {
  const r = resolveBubble("working", "bash", "testing");
  assert.equal(r.text, "testing");
  assert.equal(r.toolClass, "tool-bash");
});

test("unknown tool shows the tool name plus target", () => {
  const r = resolveBubble("working", "frobnicate", "widget");
  assert.equal(r.text, "frobnicate widget");
  assert.equal(r.toolClass, null);
  assert.equal(r.generic, false);
});

test("bare working is generic so the verbs rotate", () => {
  const r = resolveBubble("working", undefined, "");
  assert.equal(r.generic, true);
  assert.ok(r.emoji);
});

test("working with a target is not generic", () => {
  const r = resolveBubble("working", undefined, "some task");
  assert.equal(r.generic, false);
  assert.equal(r.text, "some task");
});

test("thinking, happy, error and waiting use their state labels", () => {
  assert.equal(resolveBubble("happy", undefined, "").text, STATE_LOOK.happy[1]);
  assert.equal(resolveBubble("error", undefined, "").text, STATE_LOOK.error[1]);
  assert.equal(resolveBubble("waiting", undefined, "").text, STATE_LOOK.waiting[1]);
  const thinking = resolveBubble("thinking", undefined, "");
  assert.equal(thinking.emoji, null);
  assert.equal(thinking.generic, false);
});

test("idle and sleeping hide the bubble", () => {
  assert.equal(resolveBubble("idle", undefined, "").emoji, null);
  assert.equal(resolveBubble("sleeping", undefined, "").emoji, null);
});

test("every tool label has emoji, text and prop", () => {
  for (const [tool, look] of Object.entries(TOOL_LOOK)) {
    assert.ok(look[0], tool + " emoji");
    assert.ok(look[1], tool + " text");
    assert.equal(typeof look[2], "string", tool + " prop");
  }
});
