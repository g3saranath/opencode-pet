"use strict";

// These tests exercise the REAL production implementation in
// shared/electron-bin.js — the same module plugin/pet.ts imports for both
// resolveAppDir() and launchPet(). Platform is injected so the Windows
// branches are covered when running on macOS/Linux CI.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveElectronBin, hasElectron } = require("../shared/electron-bin");

describe("electron binary resolution", () => {
  let tmpDir;

  // Builds an app dir containing whichever of the two binaries were asked for.
  function makeAppDir(name, { dist, shim }, platform) {
    const isWin = platform === "win32";
    const appDir = path.join(tmpDir, name);
    if (dist) {
      const p = path.join(
        appDir, "node_modules", "electron", "dist",
        isWin ? "electron.exe" : "electron",
      );
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "");
    }
    if (shim) {
      const p = path.join(
        appDir, "node_modules", ".bin",
        isWin ? "electron.cmd" : "electron",
      );
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "");
    }
    fs.mkdirSync(appDir, { recursive: true });
    return appDir;
  }

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-launcher-"));
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  for (const platform of ["win32", "darwin"]) {
    const isWin = platform === "win32";
    const distName = isWin ? "electron.exe" : "electron";

    describe(`on ${platform}`, () => {
      it("prefers the dist binary over the shim", () => {
        const appDir = makeAppDir(`${platform}-both`, { dist: true, shim: true }, platform);
        const resolved = resolveElectronBin(appDir, platform);
        assert.equal(resolved.bin, path.join(appDir, "node_modules", "electron", "dist", distName));
        // dist is a real executable, so it never needs a shell
        assert.equal(resolved.shell, false);
      });

      it("falls back to the shim when dist is missing", () => {
        const appDir = makeAppDir(`${platform}-shim`, { shim: true }, platform);
        const resolved = resolveElectronBin(appDir, platform);
        assert.equal(
          resolved.bin,
          path.join(appDir, "node_modules", ".bin", isWin ? "electron.cmd" : "electron"),
        );
        // .cmd is not directly executable by CreateProcess
        assert.equal(resolved.shell, isWin);
      });

      it("returns undefined when neither binary exists", () => {
        const appDir = makeAppDir(`${platform}-empty`, {}, platform);
        assert.equal(resolveElectronBin(appDir, platform), undefined);
      });
    });
  }

  it("does not resolve a Windows install that only has the unix shim", () => {
    // The original bug: .bin/electron is a #!/bin/sh script that ENOENTs when
    // spawned on Windows. A dir containing only that must not look installed.
    const appDir = path.join(tmpDir, "win-unix-shim-only");
    const p = path.join(appDir, "node_modules", ".bin", "electron");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "#!/bin/sh\n");
    assert.equal(resolveElectronBin(appDir, "win32"), undefined);
    assert.equal(hasElectron(appDir, "win32"), false);
  });

  it("hasElectron agrees with resolveElectronBin", () => {
    // resolveAppDir() picks a dir with hasElectron and launchPet() then spawns
    // via resolveElectronBin. If these disagreed, launch would silently fail.
    const cases = [
      makeAppDir("agree-dist", { dist: true }, process.platform),
      makeAppDir("agree-shim", { shim: true }, process.platform),
      makeAppDir("agree-none", {}, process.platform),
    ];
    for (const appDir of cases) {
      assert.equal(hasElectron(appDir), resolveElectronBin(appDir) !== undefined);
    }
  });
});
