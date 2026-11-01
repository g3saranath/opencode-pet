"use strict";

// Unit tests for shared/shortcut-owner.js: which process may register the
// Ctrl+Alt+Shift+P global shortcut (the overlay or the GUI plugin).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  OWNER_FILE_NAME,
  readShortcutOwner,
  claimShortcut,
  releaseShortcut,
} = require("../shared/shortcut-owner.js");

function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-shortcut-"));
  try {
    fn(dir, path.join(dir, OWNER_FILE_NAME));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the first claimant owns the key; a second live one is refused", () => {
  withDir((dir) => {
    const alive = () => true;
    assert.equal(claimShortcut(dir, { pid: 111, isAlive: alive }), true);
    assert.equal(readShortcutOwner(dir), 111);
    assert.equal(claimShortcut(dir, { pid: 222, isAlive: alive }), false);
    assert.equal(claimShortcut(dir, { pid: 111, isAlive: alive }), true, "re-claim is idempotent");
  });
});

test("a dead owner is replaced", () => {
  withDir((dir) => {
    claimShortcut(dir, { pid: 111, isAlive: () => true });
    assert.equal(claimShortcut(dir, { pid: 222, isAlive: (pid) => pid !== 111 }), true);
    assert.equal(readShortcutOwner(dir), 222);
  });
});

test("an unreadable owner file does not lock the key forever", () => {
  withDir((dir, file) => {
    fs.writeFileSync(file, "garbage");
    assert.equal(claimShortcut(dir, { pid: 333, isAlive: () => true }), true);
    assert.equal(readShortcutOwner(dir), 333);
  });
});

test("only the owner can release the claim", () => {
  withDir((dir, file) => {
    claimShortcut(dir, { pid: 111, isAlive: () => true });
    assert.equal(releaseShortcut(dir, { pid: 222 }), false);
    assert.equal(fs.existsSync(file), true);
    assert.equal(releaseShortcut(dir, { pid: 111 }), true);
    assert.equal(fs.existsSync(file), false);
  });
});
