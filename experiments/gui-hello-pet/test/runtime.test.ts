// Parity between the GUI's inlined helpers (src/runtime.ts) and the shared/
// modules the server plugin and the overlay use.
//
// The bundle cannot require ../../shared at runtime (see src/runtime.ts), so
// the rules are copied. These tests feed the same inputs to both copies and
// fail on any difference, so a change to shared/ that is not mirrored here (or
// the other way round) cannot ship silently.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import * as gui from "../src/runtime.ts"

const require = createRequire(import.meta.url)
const SHARED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../shared")

// Both copies read HOME and OPENCODE_PET_DIR; shared/ reads them at load time.
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pet-gui-parity-")))
const HOME = path.join(TMP, "home")
const ENV_APP = path.join(TMP, "env-app")
fs.mkdirSync(HOME, { recursive: true })
process.env.HOME = HOME
process.env.USERPROFILE = HOME
process.env.OPENCODE_PET_DIR = ENV_APP
delete process.env.OPENCODE_PET_NO_LAUNCH

const shared = {
  paths: require(path.join(SHARED, "paths.js")),
  safePath: require(path.join(SHARED, "safe-path.js")),
  safeEnv: require(path.join(SHARED, "safe-env.js")),
  config: require(path.join(SHARED, "pet-config.js")),
  alive: require(path.join(SHARED, "process-alive.js")),
  proc: require(path.join(SHARED, "pet-process.js")),
  bin: require(path.join(SHARED, "electron-bin.js")),
  launcher: require(path.join(SHARED, "pet-launcher.js")),
  control: require(path.join(SHARED, "pet-control.js")),
  shortcut: require(path.join(SHARED, "shortcut-owner.js")),
}

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})

let fixtureSeq = 0
function fixture(name = "f"): string {
  const dir = path.join(TMP, `${name}-${++fixtureSeq}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function touch(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, "")
}

function electronApp(dir: string, kind: "dist-posix" | "dist-win" | "shim-posix" | "shim-win") {
  const files = {
    "dist-posix": ["node_modules", "electron", "dist", "electron"],
    "dist-win": ["node_modules", "electron", "dist", "electron.exe"],
    "shim-posix": ["node_modules", ".bin", "electron"],
    "shim-win": ["node_modules", ".bin", "electron.cmd"],
  }
  touch(path.join(dir, ...files[kind]))
  return dir
}

test("constants match shared/", () => {
  assert.deepEqual({ ...gui.DEFAULT_CONFIG }, shared.config.DEFAULT_CONFIG)
  assert.equal(gui.MIN_SCALE, shared.config.MIN_SCALE)
  assert.equal(gui.MAX_SCALE, shared.config.MAX_SCALE)
  assert.equal(gui.MIN_SPEED, shared.config.MIN_SPEED)
  assert.equal(gui.MAX_SPEED, shared.config.MAX_SPEED)
  assert.deepEqual([...gui.ALLOWED_EXACT].sort(), [...shared.safeEnv.ALLOWED_EXACT].sort())
  assert.deepEqual([...gui.ALLOWED_PREFIXES], shared.safeEnv.ALLOWED_PREFIXES)
  assert.deepEqual([...gui.PET_COMMANDS], shared.control.PET_COMMANDS)
  assert.equal(gui.SHORTCUT, shared.shortcut.SHORTCUT)
  assert.equal(gui.OWNER_FILE_NAME, shared.shortcut.OWNER_FILE_NAME)
  assert.equal(gui.cacheDir(), shared.paths.DIR)
})

test("config and position normalisation match", () => {
  const inputs: unknown[] = [
    null,
    undefined,
    "idle",
    [],
    {},
    { scale: 99, animationSpeed: 0, enabled: "yes", pet: "   ", muted: "no" },
    { scale: 1.3, muted: true, feed: false, visible: false, autoLaunch: false },
    { version: 7.6, pet: "  clack ", autoHideFullscreen: true, scale: Number.NaN },
    { scale: -1, animationSpeed: 5, feed: "true" },
  ]
  for (const input of inputs) {
    assert.deepEqual(gui.normalizeConfig(input), shared.config.normalizeConfig(input), JSON.stringify(input))
  }
  for (const input of [null, { x: "a", y: 2 }, { x: 12.4, y: 99.9 }, { x: Infinity, y: 1 }, [1, 2]]) {
    assert.deepEqual(gui.normalizePosition(input), shared.config.normalizePosition(input), JSON.stringify(input))
  }
})

test("config and position files are read and written the same way", () => {
  const dir = fixture("config")
  gui.writeConfig({ scale: 1.6, feed: false }, { dir })
  assert.deepEqual(shared.config.readConfig({ dir }), gui.readConfig({ dir }))
  shared.config.updateConfig({ visible: false }, { dir })
  gui.updateConfig({ muted: true }, { dir })
  assert.deepEqual(gui.readConfig({ dir }), shared.config.readConfig({ dir }))
  assert.equal(gui.readConfig({ dir }).visible, false, "a merge keeps the other writer's field")

  gui.writePosition({ x: 12.4, y: 99.9 }, { dir })
  assert.deepEqual(shared.config.readPosition({ dir }), { x: 12, y: 100 })
  assert.deepEqual(gui.readPosition({ dir: fixture("nopos") }), shared.config.readPosition({ dir: fixture("nopos") }))
})

test("the child environment allow-list matches", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/home/me",
    XAUTHORITY: "/run/user/1000/gdm/Xauthority",
    HTTPS_PROXY: "http://proxy:8080",
    SECRET_TOKEN: "nope",
    AWS_SECRET_ACCESS_KEY: "nope",
    NODE_OPTIONS: "--inspect",
    ELECTRON_RUN_AS_NODE: "1",
    "BAD-KEY": "nope",
    OPENCODE_PET_APP_PROCESS: "OpenCode.exe",
    UNDEFINED_VALUE: undefined,
  }
  const extra = { OPENCODE_PET_DIR: "C:/pet", "BAD KEY": "x", NULLISH: null }
  assert.deepEqual(gui.safeEnv(extra, source), shared.safeEnv.safeEnv(extra, source))
  for (const key of ["PATH", "PATH; rm -rf /", "A B", "$HOME", "OPENCODE_PET_X", "NODE_OPTIONS"]) {
    assert.equal(gui.isAllowedKey(key), shared.safeEnv.isAllowedKey(key), key)
  }
})

test("/pet and shortcut semantics match", () => {
  for (const input of ["", "on", " ON ", "show", "enable", "off", "hide", "disable", "toggle",
    "restart", "reload", "status", "state", "nonsense", null, undefined, 42]) {
    assert.deepEqual(gui.parsePetCommand(input), shared.control.parsePetCommand(input), String(input))
  }
  for (const action of [...shared.control.PET_COMMANDS, "weird"]) {
    for (const running of [true, false]) {
      for (const visible of [true, false]) {
        const state = { running, visible }
        assert.deepEqual(
          gui.resolveCommand(action, state),
          shared.control.resolveCommand(action, state),
          `${action} ${JSON.stringify(state)}`,
        )
      }
    }
  }
  assert.equal(gui.shortcutAction(true), shared.control.shortcutAction(true))
  assert.equal(gui.shortcutAction(false), shared.control.shortcutAction(false))
})

test("path checks match", () => {
  const dir = fixture("paths")
  const child = path.join(dir, "node_modules", "electron")
  fs.mkdirSync(child, { recursive: true })
  const file = path.join(dir, "file.txt")
  fs.writeFileSync(file, "")
  const cases: Array<[unknown, unknown]> = [
    [dir, child],
    [dir, dir],
    [dir, path.join(dir, "..", "elsewhere")],
    [dir, path.join(dir, "..")],
    ["", child],
    [dir, null],
  ]
  for (const [parent, target] of cases) {
    assert.equal(gui.isPathInside(parent, target), shared.safePath.isPathInside(parent, target), `${parent} ${target}`)
  }
  for (const candidate of [dir, file, "relative/dir", `${dir}\0x`, path.join(dir, "missing"), "", 42]) {
    assert.equal(gui.isUsableAppDir(candidate), shared.safePath.isUsableAppDir(candidate), String(candidate))
  }
})

test("Electron lookup matches, including a symlink that escapes the app", () => {
  const outside = fixture("outside")
  touch(path.join(outside, "dist", "electron"))
  const escaping = fixture("escaping")
  fs.mkdirSync(path.join(escaping, "node_modules"), { recursive: true })
  fs.symlinkSync(outside, path.join(escaping, "node_modules", "electron"))

  const apps = [
    electronApp(fixture("dist-posix"), "dist-posix"),
    electronApp(fixture("dist-win"), "dist-win"),
    electronApp(fixture("shim-posix"), "shim-posix"),
    electronApp(fixture("shim-win"), "shim-win"),
    escaping,
    fixture("empty"),
    "relative/app",
  ]
  for (const app of apps) {
    for (const platform of ["linux", "darwin", "win32"]) {
      assert.deepEqual(
        gui.resolveElectronBin(app, platform),
        shared.bin.resolveElectronBin(app, platform),
        `${app} on ${platform}`,
      )
    }
  }
  assert.equal(gui.resolveElectronBin(escaping, "linux"), undefined, "escaping dist is refused")
})

test("app directory resolution matches", () => {
  electronApp(ENV_APP, "dist-posix")
  electronApp(ENV_APP, "dist-win")
  const recorded = electronApp(fixture("recorded"), "dist-posix")
  electronApp(recorded, "dist-win")
  const broken = fixture("broken")

  assert.equal(gui.resolveAppDir([recorded]), shared.launcher.resolveAppDir([recorded]))
  assert.equal(gui.resolveAppDir([recorded]), recorded, "an extra candidate wins")
  assert.equal(gui.resolveAppDir([broken]), shared.launcher.resolveAppDir([broken]))
  assert.equal(gui.resolveAppDir([broken]), ENV_APP, "then OPENCODE_PET_DIR")
})

test("pid and close helpers match", () => {
  for (const content of ["4321", "not-a-pid", "-5", null]) {
    const dir = fixture("pid")
    const pidFile = path.join(dir, "pet.pid")
    if (content !== null) fs.writeFileSync(pidFile, content)
    assert.equal(gui.readPetPid(pidFile), shared.proc.readPetPid(pidFile), String(content))
  }

  const run = (impl: typeof gui | typeof shared.proc, alive: boolean, throws: boolean) => {
    const dir = fixture("close")
    const pidFile = path.join(dir, "pet.pid")
    const heartbeatFile = path.join(dir, "heartbeat")
    fs.writeFileSync(pidFile, "999999")
    fs.writeFileSync(heartbeatFile, "beat")
    const signals: number[] = []
    const closed = impl.closePetProcess({
      pidFile,
      heartbeatFile,
      isAlive: () => alive,
      kill: (pid: number) => {
        signals.push(pid)
        if (throws) throw new Error("ESRCH")
      },
    })
    return { closed, signals, pid: fs.existsSync(pidFile), beat: fs.existsSync(heartbeatFile) }
  }
  for (const alive of [true, false]) {
    for (const throws of [true, false]) {
      assert.deepEqual(run(gui, alive, throws), run(shared.proc, alive, throws), `alive=${alive} throws=${throws}`)
    }
  }
  for (const pid of [0, -1, 1.5, "12", process.pid]) {
    assert.equal(gui.isProcessAlive(pid), shared.alive.isProcessAlive(pid), String(pid))
  }
})

test("launch decisions and spawned command lines match", () => {
  type Call = { cmd: string; args: string[]; options: Record<string, unknown> }
  const launch = (impl: typeof gui | typeof shared.launcher, options: Record<string, unknown>) => {
    const calls: Call[] = []
    const result = impl.launchPet({
      ...options,
      spawn: (cmd: string, args: string[], spawnOptions: Record<string, unknown>) => {
        calls.push({ cmd, args, options: spawnOptions })
        return { on() {}, unref() {} }
      },
    })
    return { result, calls }
  }

  const posix = electronApp(fixture("launch-posix"), "dist-posix")
  const spaced = electronApp(path.join(fixture("launch"), "John Smith", "pet"), "shim-win")
  const unsafe = electronApp(path.join(fixture("launch"), "bad&dir"), "shim-win")
  const live = fixture("live")
  fs.writeFileSync(path.join(live, "pet.pid"), "4242")
  const locked = fixture("locked")
  fs.writeFileSync(path.join(locked, "launch.lock"), "1")

  const scenarios: Array<[string, Record<string, unknown>]> = [
    ["dist binary", { appDir: posix, platform: "linux", skipLock: true, skipRunningCheck: true }],
    ["cmd shim with a space", { appDir: spaced, platform: "win32", skipLock: true, skipRunningCheck: true }],
    ["unsafe cmd path", { appDir: unsafe, platform: "win32", skipLock: true, skipRunningCheck: true }],
    ["already running", {
      appDir: posix, platform: "linux", skipLock: true,
      pidFile: path.join(live, "pet.pid"), isAlive: () => true,
    }],
    ["no electron", { appDir: fixture("none"), platform: "linux", skipLock: true }],
    ["launch locked", { appDir: posix, platform: "linux", skipRunningCheck: true, lockDir: locked }],
    ["lock taken and released", {
      appDir: posix, platform: "linux", skipRunningCheck: true, lockHoldMs: 0, lockDir: fixture("lock"),
    }],
    ["no launch", { appDir: posix, platform: "linux", noLaunch: true }],
  ]
  for (const [name, options] of scenarios) {
    assert.deepEqual(launch(gui, options), launch(shared.launcher, options), name)
  }

  const shim = path.join(spaced, "node_modules", ".bin", "electron.cmd")
  assert.deepEqual(gui.cmdShimArgs(shim), shared.launcher.cmdShimArgs(shim))
  for (const value of ["C:\\tools\\electron.cmd", "C:\\a&b.cmd", 'C:\\a"b.cmd', "", 7]) {
    assert.equal(gui.isSafeCmdPath(value), shared.launcher.isSafeCmdPath(value), String(value))
  }
})

test("shortcut ownership rules match", () => {
  const steps = (impl: typeof gui | typeof shared.shortcut) => {
    const dir = fixture("owner")
    const alive = (pid: number) => pid !== 111
    const out: unknown[] = []
    out.push(impl.claimShortcut(dir, { pid: 111, isAlive: () => true }))
    out.push(impl.claimShortcut(dir, { pid: 222, isAlive: () => true }))
    out.push(impl.claimShortcut(dir, { pid: 222, isAlive: alive }))
    out.push(impl.readShortcutOwner(dir))
    out.push(impl.releaseShortcut(dir, { pid: 111 }))
    out.push(impl.releaseShortcut(dir, { pid: 222 }))
    fs.writeFileSync(path.join(dir, impl.OWNER_FILE_NAME), "garbage")
    out.push(impl.claimShortcut(dir, { pid: 333, isAlive: () => true }))
    return out
  }
  assert.deepEqual(steps(gui), steps(shared.shortcut))
})

// ---------------------------------------------------------------------------
// GUI-only helpers
// ---------------------------------------------------------------------------
test("the change gate only passes values that changed", () => {
  const changed = gui.createChangeGate()
  assert.equal(changed(false), true, "first value")
  assert.equal(changed(false), false)
  assert.equal(changed(true), true)
  assert.equal(changed({ a: 1 }), true)
  assert.equal(changed({ a: 1 }), false, "compared by value")
})

function fakeShortcut(result = true) {
  const calls = { register: [] as string[], unregister: [] as string[], press: null as null | (() => void) }
  return {
    calls,
    api: {
      register(accelerator: string, callback: () => void) {
        calls.register.push(accelerator)
        calls.press = callback
        return result
      },
      unregister(accelerator: string) {
        calls.unregister.push(accelerator)
      },
    },
  }
}

test("the GUI takes the shortcut when it is free and gives it back on dispose", () => {
  const dir = fixture("gui-shortcut")
  const fake = fakeShortcut()
  let presses = 0
  const controller = gui.createShortcutController({
    globalShortcut: () => fake.api,
    dir: () => dir,
    onPress: () => presses++,
  })
  assert.equal(controller.tick(), true)
  assert.equal(controller.tick(), true, "idempotent")
  assert.deepEqual(fake.calls.register, [gui.SHORTCUT])
  assert.equal(gui.readShortcutOwner(dir), process.pid)
  fake.calls.press?.()
  assert.equal(presses, 1)

  controller.dispose()
  assert.deepEqual(fake.calls.unregister, [gui.SHORTCUT])
  assert.equal(gui.readShortcutOwner(dir), 0, "claim released")
})

test("the GUI stays off the key while the overlay holds it, then takes it over", () => {
  const dir = fixture("gui-wait")
  // The parent of the test process stands in for a running overlay.
  fs.writeFileSync(path.join(dir, gui.OWNER_FILE_NAME), String(process.ppid))
  const fake = fakeShortcut()
  const controller = gui.createShortcutController({
    globalShortcut: () => fake.api,
    dir: () => dir,
    onPress: () => {},
  })
  assert.equal(controller.tick(), false)
  assert.deepEqual(fake.calls.register, [], "no double registration")

  fs.unlinkSync(path.join(dir, gui.OWNER_FILE_NAME)) // the overlay quit
  assert.equal(controller.tick(), true)
  assert.deepEqual(fake.calls.register, [gui.SHORTCUT])
  controller.dispose()
})

test("a host without globalShortcut, or a refused key, leaves no claim behind", () => {
  const dir = fixture("gui-none")
  const none = gui.createShortcutController({ globalShortcut: () => null, dir: () => dir, onPress: () => {} })
  assert.equal(none.tick(), false)
  assert.equal(fs.existsSync(path.join(dir, gui.OWNER_FILE_NAME)), false)

  const refused = gui.createShortcutController({
    globalShortcut: () => fakeShortcut(false).api,
    dir: () => dir,
    onPress: () => {},
  })
  assert.equal(refused.tick(), false)
  assert.equal(fs.existsSync(path.join(dir, gui.OWNER_FILE_NAME)), false)
})
