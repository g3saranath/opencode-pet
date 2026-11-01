"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DEFAULT_CONFIG,
  normalizeConfig,
  normalizePosition,
  readConfig,
  writeConfig,
  updateConfig,
  readPosition,
  writePosition,
} = require("../shared/pet-config.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-config-"));
}

test("normalizeConfig returns defaults for bad input", () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig("idle"), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig([]), DEFAULT_CONFIG);
});

test("normalizeConfig keeps old config working", () => {
  const result = normalizeConfig({ scale: 1.3, muted: true, feed: true });
  assert.equal(result.scale, 1.3);
  assert.equal(result.muted, true);
  assert.equal(result.feed, true);
  assert.equal(result.enabled, true);
  assert.equal(result.pet, "scrybe");
  assert.equal(result.animationSpeed, 1.0);
  assert.equal(result.autoHideFullscreen, false);
});

test("normalizeConfig clamps numbers and ignores bad types", () => {
  const result = normalizeConfig({
    scale: 99,
    animationSpeed: 0,
    enabled: "yes",
    pet: "   ",
    muted: "no",
  });
  assert.equal(result.scale, 2.0);
  assert.equal(result.animationSpeed, 0.5);
  assert.equal(result.enabled, true);
  assert.equal(result.pet, "scrybe");
  assert.equal(result.muted, false);
});

test("writeConfig and readConfig round trip", () => {
  const dir = tempDir();
  try {
    const written = writeConfig(
      { scale: 1.6, pet: "clack", animationSpeed: 1.5, feed: true },
      { dir },
    );
    assert.equal(written.scale, 1.6);
    assert.equal(written.pet, "clack");
    const read = readConfig({ dir });
    assert.deepEqual(read, written);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("updateConfig merges without erasing fields", () => {
  const dir = tempDir();
  try {
    writeConfig({ scale: 0.8, pet: "shane", muted: true }, { dir });
    const updated = updateConfig({ scale: 1.0 }, { dir });
    assert.equal(updated.scale, 1.0);
    assert.equal(updated.pet, "shane");
    assert.equal(updated.muted, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeConfig is atomic and leaves no temp file", () => {
  const dir = tempDir();
  try {
    writeConfig({ scale: 1.1 }, { dir });
    const files = fs.readdirSync(dir);
    assert.equal(files.includes("config.json.tmp"), false);
    assert.equal(files.includes("config.json"), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("position helpers round trip and reject bad input", () => {
  const dir = tempDir();
  try {
    assert.equal(normalizePosition(null), null);
    assert.equal(normalizePosition({ x: "a", y: 2 }), null);
    const written = writePosition({ x: 12.4, y: 99.9 }, { dir });
    assert.deepEqual(written, { x: 12, y: 100 });
    assert.deepEqual(readPosition({ dir }), { x: 12, y: 100 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readConfig returns defaults when the file is missing", () => {
  const dir = tempDir();
  try {
    assert.deepEqual(readConfig({ dir }), DEFAULT_CONFIG);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});