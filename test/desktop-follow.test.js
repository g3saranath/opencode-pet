"use strict";

// Unit tests for shared/desktop-follow.js: turning OPENCODE_PET_APP_PROCESS into
// a mode, parsing tasklist output, and telling "app closed" apart from "the
// probe itself failed". Nothing here spawns a real tasklist or touches a pet.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  OFF_VALUES,
  PROBE_TIMEOUT_MS,
  RESOLVE_TIMEOUT_MS,
  parseTasklist,
  parseTasklistRows,
  probeDesktopApp,
  resetProbeCache,
  resolveAppProcess,
} = require("../shared/desktop-follow.js");

describe("desktop follow mode", () => {
  it("defaults to OpenCode.exe on Windows", () => {
    assert.deepEqual(resolveAppProcess({}, "win32"), {
      mode: "follow",
      processName: "OpenCode.exe",
      source: "default",
    });
  });

  it("defaults to off on other platforms", () => {
    assert.deepEqual(resolveAppProcess({}, "darwin"), {
      mode: "off",
      processName: "",
      source: "default",
    });
  });

  it("follows an explicitly configured process name", () => {
    assert.deepEqual(
      resolveAppProcess({ OPENCODE_PET_APP_PROCESS: "MyApp.exe" }, "win32"),
      { mode: "follow", processName: "MyApp.exe", source: "env" },
    );
  });

  it("treats an explicit empty value as OFF even on Windows", () => {
    // This used to fall through to the Windows default, so follow could not be
    // switched off on the one platform where it is on by default.
    assert.deepEqual(
      resolveAppProcess({ OPENCODE_PET_APP_PROCESS: "" }, "win32"),
      { mode: "off", processName: "", source: "env" },
    );
    assert.deepEqual(
      resolveAppProcess({ OPENCODE_PET_APP_PROCESS: "   " }, "win32"),
      { mode: "off", processName: "", source: "env" },
    );
  });

  it("accepts common OFF words case-insensitively", () => {
    for (const value of ["off", "OFF", "0", "false", "no", "none", "disabled"]) {
      assert.equal(resolveAppProcess({ OPENCODE_PET_APP_PROCESS: value }, "win32").mode, "off");
      assert.equal(OFF_VALUES.has(value.toLowerCase()), true);
    }
  });
});

describe("tasklist parsing", () => {
  const present = '"OpenCode.exe","17624","Console","7","66,736 K"\r\n';

  it("matches the image name in the first CSV column", () => {
    assert.equal(parseTasklist(present, "OpenCode.exe"), true);
    assert.equal(parseTasklist(present, "opencode.exe"), true, "case-insensitive");
  });

  it("exposes the pid from the second CSV column", () => {
    assert.deepEqual(parseTasklistRows(present, "OpenCode.exe"), [
      { name: "OpenCode.exe", pid: 17624 },
    ]);
  });

  it("does not match the no-tasks message", () => {
    assert.equal(
      parseTasklist("INFO: No tasks are running which match the specified criteria.", "OpenCode.exe"),
      false,
    );
  });

  it("does not match a different name that merely contains the target", () => {
    assert.equal(parseTasklist('"OpenCode.exe.bak","1"', "OpenCode.exe"), false);
  });
});

describe("probeDesktopApp", () => {
  const follow = { mode: "follow", processName: "OpenCode.exe", source: "default" };

  // Simulate tasklist and PowerShell separately. The PowerShell answer is the
  // main process pid, or "" when only helpers remain.
  function stub({ tasklistOut, tasklistErr, mainPid, resolveErr, calls }) {
    return (file, args, options, cb) => {
      if (calls) calls.push({ file, args, options });
      if (file === "tasklist") {
        cb(tasklistErr || null, tasklistErr ? undefined : tasklistOut);
        return;
      }
      if (file === "powershell.exe") {
        cb(resolveErr || null, resolveErr ? undefined : String(mainPid ?? ""));
        return;
      }
      cb(new Error(`unexpected command: ${file}`));
    };
  }

  it("reports present for the main process", async () => {
    const calls = [];
    const result = await probeDesktopApp(follow, {
      platform: "win32",
      cache: new Map(),
      execFile: stub({
        tasklistOut: '"OpenCode.exe","8056","Console","7","1 K"',
        mainPid: 8056,
        calls,
      }),
    });
    assert.equal(result, "present");
    assert.equal(calls[0].file, "tasklist");
    assert.deepEqual(calls[0].args.slice(0, 2), ["/FI", "IMAGENAME eq OpenCode.exe"]);
    assert.equal(calls[0].options.windowsHide, true);
    assert.equal(calls[0].options.timeout, PROBE_TIMEOUT_MS);
    assert.equal(calls[1].file, "powershell.exe");
    assert.equal(calls[1].options.env.OPENCODE_PET_PROC_NAME, "OpenCode.exe");
    assert.equal(calls[1].options.timeout, RESOLVE_TIMEOUT_MS);
  });

  it("reports absent when only Electron helper processes remain", async () => {
    // The real bug: an orphaned crashpad handler keeps the image name alive
    // after the app window and main process are gone.
    const result = await probeDesktopApp(follow, {
      platform: "win32",
      cache: new Map(),
      execFile: stub({
        tasklistOut: '"OpenCode.exe","17624","Console","7","66,736 K"',
        mainPid: "",
      }),
    });
    assert.equal(result, "absent");
  });

  it("reports absent when tasklist finds no match", async () => {
    const result = await probeDesktopApp(follow, {
      platform: "win32",
      execFile: stub({
        tasklistOut: "INFO: No tasks are running which match the specified criteria.",
      }),
    });
    assert.equal(result, "absent");
  });

  it("keeps using the cached main pid without another PowerShell call", async () => {
    const calls = [];
    const cache = new Map();
    const execFile = stub({
      tasklistOut:
        '"OpenCode.exe","17624","Console","7","1 K"\r\n"OpenCode.exe","8056","Console","7","1 K"',
      mainPid: 8056,
      calls,
    });

    assert.equal(await probeDesktopApp(follow, { platform: "win32", cache, execFile }), "present");
    assert.equal(await probeDesktopApp(follow, { platform: "win32", cache, execFile }), "present");

    const powershellCalls = calls.filter((call) => call.file === "powershell.exe");
    assert.equal(powershellCalls.length, 1);
    assert.equal(cache.get("opencode.exe"), 8056);
  });

  it("drops the cached pid and re-resolves after the main process exits", async () => {
    const cache = new Map([["opencode.exe", 8056]]);
    let phase = "helpers";
    const execFile = (file, _args, _options, cb) => {
      if (file === "tasklist") {
        cb(null, '"OpenCode.exe","17624","Console","7","1 K"');
        return;
      }
      // The first re-resolve finds nothing, the next one finds the reopened app.
      const pid = phase === "helpers" ? "" : "9000";
      cb(null, pid);
    };

    assert.equal(await probeDesktopApp(follow, { platform: "win32", cache, execFile }), "absent");
    assert.equal(cache.has("opencode.exe"), false);

    phase = "reopened";
    assert.equal(await probeDesktopApp(follow, { platform: "win32", cache, execFile }), "present");
    assert.equal(cache.get("opencode.exe"), 9000);
  });

  it("resets the cache for a new plugin instance", async () => {
    const cache = new Map([["opencode.exe", 8056]]);
    const calls = [];
    const execFile = stub({
      tasklistOut: '"OpenCode.exe","8056","Console","7","1 K"',
      mainPid: 8056,
      calls,
    });

    resetProbeCache(cache);
    assert.equal(cache.size, 0);

    assert.equal(await probeDesktopApp(follow, { platform: "win32", cache, execFile }), "present");
    assert.equal(calls.filter((call) => call.file === "powershell.exe").length, 1);
  });

  it("reports unknown instead of absent when tasklist fails", async () => {
    // A broken probe must not look like a closed app.
    const timeout = Object.assign(new Error("timed out"), { killed: true });
    const result = await probeDesktopApp(follow, {
      platform: "win32",
      execFile: stub({ tasklistErr: timeout }),
    });
    assert.equal(result, "unknown");
  });

  it("reports unknown when the main-pid lookup fails", async () => {
    const result = await probeDesktopApp(follow, {
      platform: "win32",
      cache: new Map(),
      execFile: stub({
        tasklistOut: '"OpenCode.exe","17624","Console","7","1 K"',
        resolveErr: new Error("powershell blocked"),
      }),
    });
    assert.equal(result, "unknown");
  });

  it("uses pgrep on other platforms and treats exit 1 as absent", async () => {
    const absent = await probeDesktopApp(follow, {
      platform: "darwin",
      execFile: (file, args, _options, cb) => {
        assert.equal(file, "pgrep");
        assert.deepEqual(args, ["-x", "OpenCode.exe"]);
        cb({ code: 1 });
      },
    });
    assert.equal(absent, "absent");

    const unknown = await probeDesktopApp(follow, {
      platform: "linux",
      execFile: (_file, _args, _options, cb) => cb({ code: "ENOENT" }),
    });
    assert.equal(unknown, "unknown");
  });

  it("does not run a probe at all in OFF mode", async () => {
    let called = false;
    const result = await probeDesktopApp(
      { mode: "off", processName: "", source: "env" },
      {
        platform: "win32",
        execFile: () => {
          called = true;
        },
      },
    );
    assert.equal(result, "present", "OFF keeps the old always-awake behaviour");
    assert.equal(called, false);
  });
});
