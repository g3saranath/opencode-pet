// Validation for OS process image names.
//
// The desktop-follow probe puts a process name into `tasklist` and `pgrep`
// arguments and into a PowerShell WMI filter. A name containing spaces,
// wildcards, quotes, or path separators can change what those tools match (or
// break out of the quoted filter). Every entry point must reject such a name
// before it reaches a child process.
"use strict";

// Image names are letters, digits, dot, underscore, and hyphen. Spaces and
// wildcards are deliberately excluded: no real executable needs them, and both
// tasklist filters and WMI queries treat them specially.
const SAFE_PROCESS_NAME = /^[A-Za-z0-9._-]+$/;

// Windows image names are bounded well below this; the limit also stops a
// pathological caller from building an enormous command line.
const MAX_PROCESS_NAME_LENGTH = 260;

function isSafeProcessName(name) {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > MAX_PROCESS_NAME_LENGTH) return false;
  if (name === "." || name === "..") return false;
  return SAFE_PROCESS_NAME.test(name);
}

module.exports = { SAFE_PROCESS_NAME, MAX_PROCESS_NAME_LENGTH, isSafeProcessName };
