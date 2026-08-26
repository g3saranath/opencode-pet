"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Mirror the launcher's resolution logic so the test verifies the same
// branching the real plugin uses (prefer dist/electron.exe, fallback to shim).
function resolveElectronBin(APP_DIR) {
  const isWin = process.platform === "win32";
  const dist = path.join(
    APP_DIR,
    "node_modules",
    "electron",
    "dist",
    isWin ? "electron.exe" : "electron",
  );
  if (fs.existsSync(dist)) return { bin: dist, shell: false };
  const shim = path.join(APP_DIR, "node_modules", ".bin", isWin ? "electron.cmd" : "electron");
  if (fs.existsSync(shim)) return { bin: shim, shell: isWin };
  return undefined;
}

describe("launcher path resolution", () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-launcher-"));
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("prefers dist/electron binary when it exists", () => {
    const appDir = path.join(tmpDir, "app-dist");
    const distBin = path.join(appDir, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
    fs.mkdirSync(path.dirname(distBin), { recursive: true });
    fs.writeFileSync(distBin, "");
    // also create shim to prove dist wins
    const shim = path.join(appDir, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
    fs.mkdirSync(path.dirname(shim), { recursive: true });
    fs.writeFileSync(shim, "");
    const resolved = resolveElectronBin(appDir);
    assert.equal(resolved.bin, distBin);
    assert.equal(resolved.shell, false);
  });

  it("falls back to shim when dist is missing", () => {
    const appDir = path.join(tmpDir, "app-shim");
    const shim = path.join(appDir, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
    fs.mkdirSync(path.dirname(shim), { recursive: true });
    fs.writeFileSync(shim, "");
    const resolved = resolveElectronBin(appDir);
    assert.equal(resolved.bin, shim);
    // shell flag matches platform (true on win for .cmd)
    assert.equal(resolved.shell, process.platform === "win32");
  });

  it("returns undefined when neither binary exists", () => {
    const appDir = path.join(tmpDir, "app-empty");
    fs.mkdirSync(appDir, { recursive: true });
    assert.equal(resolveElectronBin(appDir), undefined);
  });

  it("plugin source contains windowsHide and error-handler guards", () => {
    const petTs = fs.readFileSync(
      path.join(__dirname, "..", "plugin", "pet.ts"),
      "utf8",
    );
    assert.match(petTs, /windowsHide:\s*true/);
    assert.match(petTs, /child\.on\("error"/);
    assert.match(petTs, /resolveElectronBin/);
    assert.match(petTs, /process\.kill\(pid\)/);
  });

  it("app uses non-conflicting pet quit shortcut", () => {
    const mainJs = fs.readFileSync(
      path.join(__dirname, "..", "app", "main.js"),
      "utf8",
    );
    assert.match(mainJs, /Control\+Alt\+Shift\+P/);
  });
});
