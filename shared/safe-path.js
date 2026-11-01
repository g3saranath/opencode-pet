// Filesystem containment checks.
//
// Several shared modules accept a directory from an environment variable or a
// caller. Without a containment check, a crafted value can point a read or a
// spawn at an unrelated location. `isPathInside` answers the only question that
// matters at those boundaries: does the resolved child still live under the
// resolved parent?
"use strict";

const fs = require("fs");
const path = require("path");

// Resolve symlinks when the path exists, otherwise fall back to a lexical
// absolute path. The fallback keeps the check useful for paths that are about
// to be created.
function resolveReal(target) {
  const absolute = path.resolve(String(target));
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function isPathInside(parent, child) {
  if (typeof parent !== "string" || typeof child !== "string") return false;
  if (!parent || !child) return false;
  const base = resolveReal(parent);
  const target = resolveReal(child);
  const relative = path.relative(base, target);
  if (relative === "") return true;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

// A directory we are willing to launch from: absolute, free of NUL bytes, and
// actually a directory on disk.
function isUsableAppDir(dir) {
  if (typeof dir !== "string" || !dir) return false;
  if (dir.includes("\0")) return false;
  if (!path.isAbsolute(dir)) return false;
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

module.exports = { isPathInside, isUsableAppDir, resolveReal };
