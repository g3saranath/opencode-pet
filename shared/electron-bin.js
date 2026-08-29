// Locating the Electron binary, shared by the plugin launcher and its tests.
//
// On Windows the extensionless `node_modules/.bin/electron` shim is a
// `#!/bin/sh` script: spawning it directly fails with ENOENT, and the `.cmd`
// shim next to it pops a visible console window unless explicitly hidden.
// The real binary under `electron/dist` has neither problem, so prefer it and
// only fall back to the shim when it is missing.
const fs = require("fs");
const path = require("path");

// The packaged binary. Present in a normal `npm install` of electron.
function distBinary(appDir, isWin) {
  return path.join(
    appDir,
    "node_modules",
    "electron",
    "dist",
    isWin ? "electron.exe" : "electron",
  );
}

// The npm-generated shim. Needs `shell: true` on Windows because `.cmd` is
// not directly executable by CreateProcess.
function shimBinary(appDir, isWin) {
  return path.join(appDir, "node_modules", ".bin", isWin ? "electron.cmd" : "electron");
}

// Returns `{ bin, shell }` for the best available Electron, or undefined when
// the app has no installed Electron at all.
function resolveElectronBin(appDir, platform = process.platform) {
  const isWin = platform === "win32";
  const dist = distBinary(appDir, isWin);
  if (fs.existsSync(dist)) return { bin: dist, shell: false };
  const shim = shimBinary(appDir, isWin);
  if (fs.existsSync(shim)) return { bin: shim, shell: isWin };
  return undefined;
}

// True when `appDir` looks like a usable install. Kept in lockstep with
// resolveElectronBin on purpose: if the two disagreed, resolveAppDir could
// pick a directory whose binary the launcher then fails to find.
function hasElectron(appDir, platform = process.platform) {
  return resolveElectronBin(appDir, platform) !== undefined;
}

module.exports = { resolveElectronBin, hasElectron };
