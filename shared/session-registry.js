// Live OpenCode 1.x sessions sharing one overlay.
//
// opencode 1.x has no long-lived background service: every terminal runs its
// own server() and they all drive the same single-instance overlay. A session
// that exits must only close the pet when it is the last one left; otherwise
// closing one terminal kills the pet for every other open session, and nothing
// relaunches it for them.
//
// Each server() call registers `<pid>.<n>` under DIR/sessions. Entries whose
// process is gone (crash, forced kill) are pruned whenever the list is read.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isProcessAlive } = require("./process-alive");

const SESSIONS_DIR_NAME = "sessions";
const SESSION_ID = /^(\d+)\.(\d+)$/;

let seq = 0;

function sessionsDir(dir) {
  return path.join(dir, SESSIONS_DIR_NAME);
}

// Registers a session and returns its id. Several server() calls in one
// process (one per project) each get their own entry.
function registerSession(dir, options = {}) {
  const pid = options.pid || process.pid;
  seq += 1;
  const id = `${pid}.${seq}`;
  try {
    fs.mkdirSync(sessionsDir(dir), { recursive: true });
    fs.writeFileSync(path.join(sessionsDir(dir), id), String(Date.now()));
  } catch {
    /* best effort: without the entry this session simply is not counted */
  }
  return id;
}

function unregisterSession(dir, id) {
  if (!id || !SESSION_ID.test(id)) return;
  try {
    fs.unlinkSync(path.join(sessionsDir(dir), id));
  } catch {
    /* already gone */
  }
}

// Sessions whose process is still alive, excluding `options.except`. Dead or
// malformed entries are removed on the way.
function liveSessions(dir, options = {}) {
  const isAlive = options.isAlive || isProcessAlive;
  let names;
  try {
    names = fs.readdirSync(sessionsDir(dir));
  } catch {
    return [];
  }
  const live = [];
  for (const name of names) {
    if (name === options.except) continue;
    const match = SESSION_ID.exec(name);
    const pid = match ? Number(match[1]) : 0;
    if (pid && isAlive(pid)) {
      live.push({ id: name, pid });
      continue;
    }
    try {
      fs.unlinkSync(path.join(sessionsDir(dir), name));
    } catch {
      /* raced with another pruner */
    }
  }
  return live;
}

module.exports = { SESSIONS_DIR_NAME, registerSession, unregisterSession, liveSessions };
