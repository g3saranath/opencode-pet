// Main-process helpers for the GUI plugin, mirrored from this repo's shared/.
//
// OpenCode Desktop evaluates the GUI bundle twice: in the plugin main process
// (real Node) and in each window, where Node modules are inert stubs. The app
// also rejects runtime requires of files outside the bundle. So the bundle
// cannot simply require ../../shared, and it must not touch Node at load time.
//
// These are therefore copies of the shared/ rules, kept in one place:
//
//   - Nothing here runs at import time except constant definitions. Node is
//     only touched when a function is called, which happens in main only.
//   - Processes are started through an injected `spawn`, so this module never
//     imports node:child_process (gui.tsx loads it lazily in main).
//   - test/runtime.test.ts runs the same inputs through this file and through
//     shared/ and fails on any difference.
//
// Change a rule in shared/ first, then mirror it here. The parity test tells
// you when the two have drifted.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// ---------------------------------------------------------------------------
// shared/paths.js
// ---------------------------------------------------------------------------
export function safeHome(): string {
  try {
    if (typeof os.homedir === "function") {
      const value = os.homedir()
      if (typeof value === "string" && value) return value
    }
  } catch {
    /* inert stub */
  }
  return process.env.HOME || process.env.USERPROFILE || ""
}

export function cacheDir(): string {
  return path.join(safeHome(), ".cache", "opencode-pet")
}

// ---------------------------------------------------------------------------
// shared/safe-path.js
// ---------------------------------------------------------------------------
export function resolveReal(target: string): string {
  const absolute = path.resolve(String(target))
  try {
    return fs.realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

export function isPathInside(parent: unknown, child: unknown): boolean {
  if (typeof parent !== "string" || typeof child !== "string") return false
  if (!parent || !child) return false
  const base = resolveReal(parent)
  const target = resolveReal(child)
  const relative = path.relative(base, target)
  if (relative === "") return true
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}

export function isUsableAppDir(dir: unknown): dir is string {
  if (typeof dir !== "string" || !dir) return false
  if (dir.includes("\0")) return false
  if (!path.isAbsolute(dir)) return false
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// shared/safe-env.js
// ---------------------------------------------------------------------------
export const ALLOWED_EXACT: ReadonlySet<string> = new Set([
  "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "SystemDrive", "windir", "WINDIR",
  "COMSPEC", "ComSpec", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE",
  "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
  "PROGRAMW6432", "USERNAME", "USER", "LOGNAME", "SHELL", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME", "XDG_DATA_HOME", "XAUTHORITY", "XDG_SESSION_TYPE", "XDG_CURRENT_DESKTOP",
  "DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "LANG", "LC_ALL", "LC_CTYPE", "TZ",
  "NUMBER_OF_PROCESSORS", "OS", "PROCESSOR_ARCHITECTURE", "ELECTRON_MIRROR", "ELECTRON_CUSTOM_DIR",
  "ELECTRON_CUSTOM_FILENAME", "ELECTRON_GET_USE_PROXY", "GLOBAL_AGENT_HTTP_PROXY",
  "GLOBAL_AGENT_HTTPS_PROXY", "GLOBAL_AGENT_NO_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "no_proxy",
])
export const ALLOWED_PREFIXES: readonly string[] = ["OPENCODE_PET_"]
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isAllowedKey(key: string): boolean {
  if (!SAFE_KEY.test(key)) return false
  if (ALLOWED_EXACT.has(key)) return true
  return ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))
}

export function safeEnv(
  extra: Record<string, unknown> = {},
  source: Record<string, unknown> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {}
  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue
      if (!isAllowedKey(key)) continue
      env[key] = String(value)
    }
  }
  if (extra && typeof extra === "object") {
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined || value === null) continue
      if (!SAFE_KEY.test(key)) continue
      env[key] = String(value)
    }
  }
  return env
}

// ---------------------------------------------------------------------------
// shared/pet-config.js
// ---------------------------------------------------------------------------
export type PetConfig = {
  version: number
  enabled: boolean
  autoLaunch: boolean
  pet: string
  scale: number
  animationSpeed: number
  muted: boolean
  autoHideFullscreen: boolean
  feed: boolean
  visible: boolean
}

export const DEFAULT_CONFIG: Readonly<PetConfig> = {
  version: 2,
  enabled: true,
  autoLaunch: true,
  pet: "scrybe",
  scale: 1.0,
  animationSpeed: 1.0,
  muted: false,
  autoHideFullscreen: false,
  feed: true,
  visible: true,
}

export const MIN_SCALE = 0.5
export const MAX_SCALE = 2.0
export const MIN_SPEED = 0.5
export const MAX_SPEED = 2.0

type DirOptions = { dir?: string }

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  if (value < min) return min
  if (value > max) return max
  return value
}

export function normalizeConfig(raw: unknown): PetConfig {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const config: PetConfig = { ...DEFAULT_CONFIG }

  if (typeof source.version === "number" && Number.isFinite(source.version)) {
    config.version = Math.max(1, Math.round(source.version))
  }
  if (typeof source.enabled === "boolean") config.enabled = source.enabled
  if (typeof source.autoLaunch === "boolean") config.autoLaunch = source.autoLaunch
  if (typeof source.pet === "string" && source.pet.trim()) config.pet = source.pet.trim()
  config.scale = clampNumber(source.scale, MIN_SCALE, MAX_SCALE, DEFAULT_CONFIG.scale)
  config.animationSpeed = clampNumber(
    source.animationSpeed,
    MIN_SPEED,
    MAX_SPEED,
    DEFAULT_CONFIG.animationSpeed,
  )
  if (typeof source.muted === "boolean") config.muted = source.muted
  if (typeof source.autoHideFullscreen === "boolean") {
    config.autoHideFullscreen = source.autoHideFullscreen
  }
  if (typeof source.feed === "boolean") config.feed = source.feed
  if (typeof source.visible === "boolean") config.visible = source.visible
  return config
}

export function normalizePosition(raw: unknown): { x: number; y: number } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const { x, y } = raw as Record<string, unknown>
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.round(x as number), y: Math.round(y as number) }
}

function requireDir(options: DirOptions | undefined): string {
  const dir = (options && options.dir) || null
  if (!dir) throw new Error("pet-config: a directory is required")
  return dir
}

function writeAtomic(dir: string, name: string, value: unknown): boolean {
  const file = path.join(dir, name)
  const tmp = path.join(dir, name + ".tmp")
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(value))
    fs.renameSync(tmp, file)
    return true
  } catch {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* best effort */
    }
    return false
  }
}

export function readConfig(options: DirOptions): PetConfig {
  const file = path.join(requireDir(options), "config.json")
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(file, "utf8")))
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function writeConfig(config: unknown, options: DirOptions): PetConfig {
  const normalized = normalizeConfig(config)
  return writeAtomic(requireDir(options), "config.json", normalized) ? normalized : normalizeConfig({})
}

export function updateConfig(patch: Record<string, unknown>, options: DirOptions): PetConfig {
  const current = readConfig(options)
  const merged = { ...current, ...(patch && typeof patch === "object" ? patch : {}) }
  return writeConfig(merged, options)
}

export function readPosition(options: DirOptions): { x: number; y: number } | null {
  const file = path.join(requireDir(options), "pos.json")
  try {
    return normalizePosition(JSON.parse(fs.readFileSync(file, "utf8")))
  } catch {
    return null
  }
}

export function writePosition(position: unknown, options: DirOptions): { x: number; y: number } | null {
  const dir = requireDir(options)
  const normalized = normalizePosition(position)
  if (!normalized) return null
  return writeAtomic(dir, "pos.json", normalized) ? normalized : null
}

// ---------------------------------------------------------------------------
// shared/process-alive.js and shared/pet-process.js
// ---------------------------------------------------------------------------
export function isProcessAlive(pid: unknown): boolean {
  if (!pid || !Number.isInteger(pid) || (pid as number) <= 0) return false
  try {
    process.kill(pid as number, 0)
    return true
  } catch (err) {
    return (err as { code?: string }).code !== "ESRCH"
  }
}

export function readPetPid(pidFile: string = path.join(cacheDir(), "pet.pid")): number {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : 0
  } catch {
    return 0
  }
}

export function closePetProcess(
  options: {
    pidFile?: string
    heartbeatFile?: string
    isAlive?: (pid: number) => boolean
    kill?: (pid: number) => void
  } = {},
): boolean {
  const pidFile = options.pidFile || path.join(cacheDir(), "pet.pid")
  const heartbeatFile = options.heartbeatFile || path.join(cacheDir(), "heartbeat")
  const isAlive = options.isAlive || isProcessAlive
  const kill = options.kill || ((pid: number) => process.kill(pid))

  try {
    fs.unlinkSync(heartbeatFile)
  } catch {
    /* heartbeat already gone */
  }

  const pid = readPetPid(pidFile)
  if (!pid || !isAlive(pid)) return false

  try {
    kill(pid)
  } catch {
    /* already exited between the probe and the signal */
  }
  try {
    fs.unlinkSync(pidFile)
  } catch {
    /* best effort */
  }
  return true
}

// ---------------------------------------------------------------------------
// shared/electron-bin.js
// ---------------------------------------------------------------------------
export type ElectronBin = { bin: string; shell: boolean }

export function resolveElectronBin(
  appDir: unknown,
  platform: string = process.platform,
): ElectronBin | undefined {
  if (!isUsableAppDir(appDir)) return undefined
  const isWin = platform === "win32"
  const dist = path.join(appDir, "node_modules", "electron", "dist", isWin ? "electron.exe" : "electron")
  if (fs.existsSync(dist) && isPathInside(appDir, dist)) return { bin: dist, shell: false }
  const shim = path.join(appDir, "node_modules", ".bin", isWin ? "electron.cmd" : "electron")
  if (fs.existsSync(shim) && isPathInside(appDir, shim)) return { bin: shim, shell: isWin }
  return undefined
}

export function hasElectron(appDir: unknown, platform: string = process.platform): boolean {
  return resolveElectronBin(appDir, platform) !== undefined
}

// ---------------------------------------------------------------------------
// shared/pet-launcher.js
// ---------------------------------------------------------------------------

// shared/ also tries the checkout it lives in. The bundle has no such location;
// the server plugin records its resolved checkout in `app.dir`, which gui.tsx
// passes as an extra candidate instead.
function defaultAppDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || ""
  return [
    process.env.OPENCODE_PET_DIR,
    path.join(home, "opencode-scrybe"),
    path.join(home, "opencode-pet"),
  ].filter(Boolean) as string[]
}

export function resolveAppDir(extraCandidates?: unknown[]): string {
  const candidates = [...(extraCandidates || []), ...defaultAppDirs()]
  for (const dir of candidates) {
    if (isUsableAppDir(dir) && hasElectron(dir)) return dir
  }
  return (candidates[0] as string) || path.join(process.env.HOME || process.env.USERPROFILE || "", "opencode-pet")
}

const UNSAFE_CMD_CHARS = /[&|<>^%!"\r\n\0]/

export function isSafeCmdPath(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && !UNSAFE_CMD_CHARS.test(value)
}

export function cmdShimArgs(bin: string): string[] {
  return ["/d", "/s", "/c", `""${bin}" ."`]
}

export const LAUNCH_LOCK_NAME = "launch.lock"
const DEFAULT_LOCK_HOLD_MS = 1500

export function acquireLaunchLock(dir: string, staleMs: number = 5000): string | null {
  if (!dir) return null
  const file = path.join(dir, LAUNCH_LOCK_NAME)
  const claim = () => {
    const fd = fs.openSync(file, "wx")
    fs.writeSync(fd, String(process.pid))
    fs.closeSync(fd)
    return file
  }
  try {
    fs.mkdirSync(dir, { recursive: true })
    return claim()
  } catch {
    try {
      const age = Date.now() - fs.statSync(file).mtimeMs
      if (age > staleMs) {
        fs.unlinkSync(file)
        return claim()
      }
    } catch {
      /* raced with another launcher */
    }
    return null
  }
}

export function releaseLaunchLock(file: string | null): void {
  if (!file) return
  try {
    fs.unlinkSync(file)
  } catch {
    /* already released */
  }
}

export function petAlreadyRunning(
  options: { pidFile?: string; isAlive?: (pid: number) => boolean } = {},
): boolean {
  const isAlive = options.isAlive || isProcessAlive
  const pid = readPetPid(options.pidFile)
  return Boolean(pid && isAlive(pid))
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => { on(event: string, listener: () => void): unknown; unref(): void }

export type LaunchOptions = {
  appDir?: string
  candidates?: unknown[]
  noLaunch?: boolean
  platform?: string
  skipRunningCheck?: boolean
  pidFile?: string
  isAlive?: (pid: number) => boolean
  skipLock?: boolean
  lockDir?: string
  lockStaleMs?: number
  lockHoldMs?: number
  env?: Record<string, unknown>
  spawn?: SpawnFn
}

export type LaunchResult = { launched: boolean; reason?: string; appDir?: string }

export function launchPet(options: LaunchOptions = {}): LaunchResult {
  const opts = options
  const appDir = opts.appDir || resolveAppDir(opts.candidates)
  const noLaunch = opts.noLaunch || process.env.OPENCODE_PET_NO_LAUNCH === "1"
  if (noLaunch) return { launched: false, reason: "no-launch" }

  const resolved = resolveElectronBin(appDir, opts.platform || process.platform)
  if (!resolved) return { launched: false, reason: "no-electron" }

  if (opts.skipRunningCheck !== true && petAlreadyRunning(opts)) {
    return { launched: false, reason: "already-running" }
  }

  const lockDir = opts.lockDir || cacheDir()
  const lock = opts.skipLock === true ? null : acquireLaunchLock(lockDir, opts.lockStaleMs)
  if (opts.skipLock !== true && !lock) {
    return { launched: false, reason: "launch-locked" }
  }

  const spawnOptions = {
    cwd: appDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    env: safeEnv(opts.env),
  }

  try {
    if (typeof opts.spawn !== "function") throw new Error("no spawn")
    const run = opts.spawn
    let child
    if (resolved.shell) {
      if (!isSafeCmdPath(resolved.bin)) {
        releaseLaunchLock(lock)
        return { launched: false, reason: "unsafe-path" }
      }
      const comspec = process.env.ComSpec || process.env.COMSPEC || "cmd.exe"
      child = run(comspec, cmdShimArgs(resolved.bin), {
        ...spawnOptions,
        windowsVerbatimArguments: true,
      })
    } else {
      child = run(resolved.bin, ["."], spawnOptions)
    }
    child.on("error", () => {})
    child.unref()
  } catch {
    releaseLaunchLock(lock)
    return { launched: false, reason: "spawn-failed" }
  }

  if (lock) {
    const holdMs = opts.lockHoldMs === undefined ? DEFAULT_LOCK_HOLD_MS : opts.lockHoldMs
    if (holdMs <= 0) {
      releaseLaunchLock(lock)
    } else {
      const timer = setTimeout(() => releaseLaunchLock(lock), holdMs)
      if (typeof timer.unref === "function") timer.unref()
    }
  }

  return { launched: true, appDir }
}

// ---------------------------------------------------------------------------
// shared/pet-control.js
// ---------------------------------------------------------------------------
export const PET_COMMANDS: readonly string[] = ["on", "off", "toggle", "restart", "status"]

export function parsePetCommand(input: unknown): { action: string; raw: string } {
  const raw = String(input === undefined || input === null ? "" : input)
    .trim()
    .toLowerCase()
  if (!raw) return { action: "toggle", raw }
  if (raw === "on" || raw === "enable" || raw === "show") return { action: "on", raw }
  if (raw === "off" || raw === "disable" || raw === "hide") return { action: "off", raw }
  if (raw === "toggle") return { action: "toggle", raw }
  if (raw === "restart" || raw === "reload") return { action: "restart", raw }
  if (raw === "status" || raw === "state") return { action: "status", raw }
  return { action: "toggle", raw }
}

export function shortcutAction(running: boolean): "start" | "stop" {
  return running ? "stop" : "start"
}

export function resolveCommand(
  action: string,
  state: { running?: boolean; visible?: boolean } | null | undefined,
): { start: boolean; show: boolean; stop: boolean } {
  const running = Boolean(state && state.running)
  const visible = Boolean(state && state.visible)
  switch (action) {
    case "on":
      return { start: !running, show: true, stop: false }
    case "off":
      return { start: false, show: false, stop: false }
    case "toggle":
      return { start: !running, show: running ? !visible : true, stop: false }
    case "restart":
      return { start: true, show: true, stop: running }
    case "status":
      return { start: false, show: visible, stop: false }
    default:
      return { start: false, show: visible, stop: false }
  }
}

// ---------------------------------------------------------------------------
// shared/shortcut-owner.js
// ---------------------------------------------------------------------------
export const SHORTCUT = "Control+Alt+Shift+P"
export const OWNER_FILE_NAME = "shortcut.owner"

type OwnerOptions = { pid?: number; isAlive?: (pid: number) => boolean }

export function readShortcutOwner(dir: string): number {
  try {
    const pid = parseInt(fs.readFileSync(path.join(dir, OWNER_FILE_NAME), "utf8").trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : 0
  } catch {
    return 0
  }
}

export function claimShortcut(dir: string, options: OwnerOptions = {}): boolean {
  const pid = options.pid || process.pid
  const isAlive = options.isAlive || isProcessAlive
  const current = readShortcutOwner(dir)
  if (current === pid) return true
  if (current && isAlive(current)) return false

  const file = path.join(dir, OWNER_FILE_NAME)
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.unlinkSync(file)
  } catch {
    /* missing already */
  }
  try {
    const fd = fs.openSync(file, "wx")
    fs.writeSync(fd, String(pid))
    fs.closeSync(fd)
    return true
  } catch {
    return readShortcutOwner(dir) === pid
  }
}

export function releaseShortcut(dir: string, options: OwnerOptions = {}): boolean {
  const pid = options.pid || process.pid
  if (readShortcutOwner(dir) !== pid) return false
  try {
    fs.unlinkSync(path.join(dir, OWNER_FILE_NAME))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// GUI-only helpers (no shared/ counterpart)
// ---------------------------------------------------------------------------

// Returns a gate that answers true only when `value` differs from the value it
// saw last time. Used so the timers in gui.tsx write the `hidden` flag and
// notify the window only when something actually changed.
export function createChangeGate(): (value: unknown) => boolean {
  let last: string | undefined
  return (value: unknown) => {
    const key = JSON.stringify(value)
    if (key === last) return false
    last = key
    return true
  }
}

export type GlobalShortcutApi = {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

// Holds Ctrl+Alt+Shift+P for the GUI when nobody else does. The overlay binds
// the same key to quit; the owner file (shortcut.owner) keeps the two from
// both registering it. tick() is cheap and safe to call on a timer: while the
// overlay holds the key it does nothing, and once the overlay quits and
// releases it, the next tick takes it over.
export function createShortcutController(options: {
  globalShortcut: () => GlobalShortcutApi | null
  dir: () => string
  onPress: () => void
  pid?: number
}) {
  let held = false
  const ownerOptions = options.pid ? { pid: options.pid } : {}

  return {
    held: () => held,
    tick(): boolean {
      if (held) return true
      const api = options.globalShortcut()
      if (!api) return false
      const dir = options.dir()
      if (!claimShortcut(dir, ownerOptions)) return false
      try {
        held = api.register(SHORTCUT, options.onPress) === true
      } catch {
        held = false
      }
      if (!held) releaseShortcut(dir, ownerOptions)
      return held
    },
    dispose(): void {
      if (held) {
        try {
          options.globalShortcut()?.unregister(SHORTCUT)
        } catch {
          /* host already tore it down */
        }
        held = false
      }
      try {
        releaseShortcut(options.dir(), ownerOptions)
      } catch {
        /* best effort */
      }
    },
  }
}
