// Pet control semantics, shared by the GUI plugin and its tests.
//
// The slash command and the keyboard shortcut both need the same decision:
// does this action change visibility, change the process, or both? Keeping the
// rules here means the GUI, the Electron app, and the tests cannot drift.
"use strict";

const PET_COMMANDS = ["on", "off", "toggle", "restart", "status"];

// Normalize free-form command input. Unknown words fall back to "toggle" so
// `/pet foo` still does something predictable instead of nothing.
function parsePetCommand(input) {
  const raw = String(input === undefined || input === null ? "" : input)
    .trim()
    .toLowerCase();
  if (!raw) return { action: "toggle", raw };
  if (raw === "on" || raw === "enable" || raw === "show") return { action: "on", raw };
  if (raw === "off" || raw === "disable" || raw === "hide") return { action: "off", raw };
  if (raw === "toggle") return { action: "toggle", raw };
  if (raw === "restart" || raw === "reload") return { action: "restart", raw };
  if (raw === "status" || raw === "state") return { action: "status", raw };
  return { action: "toggle", raw };
}

// The keyboard shortcut is a process switch, not a visibility switch: press it
// while the pet is stopped and it starts, press it while the pet runs and it
// stops. Returns "start" or "stop".
function shortcutAction(running) {
  return running ? "stop" : "start";
}

// Resolve what a command should do, given the live process/visibility state.
// The returned object is intentionally declarative so the caller can apply it
// in one place and tests can assert on it without a running Electron app.
function resolveCommand(action, state) {
  const running = Boolean(state && state.running);
  const visible = Boolean(state && state.visible);
  switch (action) {
    case "on":
      return { start: !running, show: true, stop: false };
    case "off":
      // Hiding never kills the process.
      return { start: false, show: false, stop: false };
    case "toggle":
      // Toggle visibility only. If the process is stopped there is nothing to
      // show, so start it first.
      return { start: !running, show: running ? !visible : true, stop: false };
    case "restart":
      return { start: true, show: true, stop: running };
    case "status":
      return { start: false, show: visible, stop: false };
    default:
      return { start: false, show: visible, stop: false };
  }
}

module.exports = { PET_COMMANDS, parsePetCommand, shortcutAction, resolveCommand };
