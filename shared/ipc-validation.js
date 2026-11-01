// Schema validation for messages that cross the renderer -> main IPC boundary.
//
// Electron IPC is an untrusted boundary: any script running in the renderer can
// send any payload on any channel. These helpers return a normalized value or
// `null`, so a handler can reject malformed input with a single check instead
// of coercing whatever arrives.
"use strict";

// Drag offsets are pixel deltas from the cursor to the window origin. A real
// drag never approaches this bound; anything larger is either a bug or an
// attempt to push the window somewhere it should not go.
const MAX_DRAG_OFFSET = 10000;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Returns { x, y } with finite, in-range numbers, or null when the payload is
// not a usable offset object.
function normalizeDragOffset(raw, limit = MAX_DRAG_OFFSET) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { x, y } = raw;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (Math.abs(x) > limit || Math.abs(y) > limit) return null;
  return { x, y };
}

// A state payload from the plugin or from the file bus. Only the fields the
// renderer understands survive, and only with the right types.
function normalizeStatePayload(raw, allowedStates) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const state = raw.state;
  if (typeof state !== "string" || !Array.isArray(allowedStates)) return null;
  if (!allowedStates.includes(state)) return null;
  const payload = { state };
  if (typeof raw.tool === "string" && raw.tool) payload.tool = raw.tool.slice(0, 64);
  if (typeof raw.detail === "string") payload.detail = raw.detail.slice(0, 200);
  if (Array.isArray(raw.feed)) {
    payload.feed = raw.feed
      .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
      .slice(-24)
      .map((entry) => ({
        seq: isFiniteNumber(entry.seq) ? entry.seq : 0,
        icon: typeof entry.icon === "string" ? entry.icon.slice(0, 8) : "",
        text: typeof entry.text === "string" ? entry.text.slice(0, 200) : "",
        kind: typeof entry.kind === "string" ? entry.kind.slice(0, 16) : "step",
      }));
  }
  return payload;
}

module.exports = {
  MAX_DRAG_OFFSET,
  normalizeDragOffset,
  normalizeStatePayload,
};
