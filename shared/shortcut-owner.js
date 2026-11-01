// Ownership of the Ctrl+Alt+Shift+P global shortcut.
//
// Two processes want this key: the Electron overlay (quit) and the GUI plugin
// inside OpenCode Desktop (start / stop). Windows refuses a second
// registration, but macOS hot keys are not exclusive, so without coordination
// one key press could reach both handlers and they would race (the overlay
// quits while the GUI, seeing it gone, starts it again). A small owner file
// decides who registers: the first live claimant holds the key and the other
// stays off it, retrying later.
//
// The GUI plugin keeps an inlined copy of these rules
// (experiments/gui-hello-pet/src/runtime.ts); its parity test keeps them equal.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isProcessAlive } = require("./process-alive");

const SHORTCUT = "Control+Alt+Shift+P";
const OWNER_FILE_NAME = "shortcut.owner";

function ownerFile(dir) {
  return path.join(dir, OWNER_FILE_NAME);
}

function readShortcutOwner(dir) {
  try {
    const pid = parseInt(fs.readFileSync(ownerFile(dir), "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

// True when `pid` owns the shortcut after the call. A live owner other than
// `pid` blocks the claim; a dead, missing, or unreadable owner is replaced.
function claimShortcut(dir, options = {}) {
  const pid = options.pid || process.pid;
  const isAlive = options.isAlive || isProcessAlive;
  const current = readShortcutOwner(dir);
  if (current === pid) return true;
  if (current && isAlive(current)) return false;

  const file = ownerFile(dir);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.unlinkSync(file);
  } catch {
    /* missing already */
  }
  try {
    const fd = fs.openSync(file, "wx");
    fs.writeSync(fd, String(pid));
    fs.closeSync(fd);
    return true;
  } catch {
    // Another claimant won the race.
    return readShortcutOwner(dir) === pid;
  }
}

// Drops the claim, but only if `pid` still holds it.
function releaseShortcut(dir, options = {}) {
  const pid = options.pid || process.pid;
  if (readShortcutOwner(dir) !== pid) return false;
  try {
    fs.unlinkSync(ownerFile(dir));
    return true;
  } catch {
    return false;
  }
}

module.exports = { SHORTCUT, OWNER_FILE_NAME, readShortcutOwner, claimShortcut, releaseShortcut };
