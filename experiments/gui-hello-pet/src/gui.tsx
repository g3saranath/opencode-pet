import { Schema } from "effect"
import { Command, Ipc, Plugin, SettingsPage } from "@opencode/plugin/gui"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import en from "./i18n/en"

// (shared helpers inlined below)

// (shared helpers inlined below)

// ---------------------------------------------------------------------------
// Self-contained copies of the shared helpers (inlined so the bundle has no
// runtime requires to shared/). Canonical versions live in shared/.
// ---------------------------------------------------------------------------

const UNSAFE_CMD_CHARS = /[&|<>^%!"\r\n\0]/;

function isSafeCmdPath(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && !UNSAFE_CMD_CHARS.test(value)
}

function safeHome(): string {
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

function isUsableAppDir(dir: unknown): boolean {
  if (typeof dir !== "string" || !dir) return false
  if (dir.includes("\0")) return false
  if (!path.isAbsolute(dir)) return false
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

const ALLOWED_EXACT = new Set([
  "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "SystemDrive", "windir", "WINDIR",
  "COMSPEC", "ComSpec", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE",
  "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
  "PROGRAMW6432", "USERNAME", "USER", "LOGNAME", "SHELL", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME", "XDG_DATA_HOME", "DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS",
  "LANG", "LC_ALL", "LC_CTYPE", "TZ", "NUMBER_OF_PROCESSORS", "OS", "PROCESSOR_ARCHITECTURE",
])
const ALLOWED_PREFIXES = ["OPENCODE_PET_"]
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

function isAllowedKey(key: string): boolean {
  if (!SAFE_KEY.test(key)) return false
  if (ALLOWED_EXACT.has(key)) return true
  return ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))
}

function safeEnv(extra: Record<string, unknown> = {}, source: Record<string, unknown> = process.env): Record<string, string> {
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

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  if (value < min) return min
  if (value > max) return max
  return value
}

const MIN_SCALE = 0.5
const MAX_SCALE = 2.0
const MIN_SPEED = 0.5
const MAX_SPEED = 2.0

function normalizeConfig(raw: unknown): Record<string, unknown> {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const config: Record<string, unknown> = {
    version: 2,
    enabled: true,
    autoLaunch: true,
    pet: "scrybe",
    scale: 1.0,
    animationSpeed: 1.0,
    muted: false,
    autoHideFullscreen: false,
    feed: false,
    visible: true,
  }
  if (typeof source.version === "number" && Number.isFinite(source.version)) {
    config.version = Math.max(1, Math.round(source.version))
  }
  if (typeof source.enabled === "boolean") config.enabled = source.enabled
  if (typeof source.autoLaunch === "boolean") config.autoLaunch = source.autoLaunch
  if (typeof source.pet === "string" && source.pet.trim()) config.pet = source.pet.trim()
  config.scale = clampNumber(source.scale, MIN_SCALE, MAX_SCALE, 1.0)
  config.animationSpeed = clampNumber(source.animationSpeed, MIN_SPEED, MAX_SPEED, 1.0)
  if (typeof source.muted === "boolean") config.muted = source.muted
  if (typeof source.autoHideFullscreen === "boolean") config.autoHideFullscreen = source.autoHideFullscreen
  if (typeof source.feed === "boolean") config.feed = source.feed
  if (typeof source.visible === "boolean") config.visible = source.visible
  return config
}

function readConfig(): Record<string, unknown> {
  const file = path.join(cacheDir(), "config.json")
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"))
    return normalizeConfig(raw)
  } catch {
    return normalizeConfig(null)
  }
}

function updateConfig(patch: Record<string, unknown>) {
  const current = readConfig()
  const merged = { ...current, ...(patch && typeof patch === "object" ? patch : {}) }
  const normalized = normalizeConfig(merged)
  const file = path.join(cacheDir(), "config.json")
  const tmp = file + ".tmp"
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(normalized))
    fs.renameSync(tmp, file)
  } catch {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* best effort */
    }
  }
}

function readPosition(): { x: number; y: number } {
  const file = path.join(cacheDir(), "pos.json")
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"))
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const x = (raw as Record<string, unknown>).x
      const y = (raw as Record<string, unknown>).y
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return { x: Math.round(x as number), y: Math.round(y as number) }
      }
    }
  } catch {
    /* no position yet */
  }
  return { x: 0, y: 0 }
}

function startPet(): boolean {
  const result = launchPet({ appDir: resolveAppDir([readTextFile(appDirFile())]) })
  return Boolean(result && result.launched)
}

function stopPet(): boolean {
  return closePetProcess({ pidFile: pidFile(), heartbeatFile: heartbeatFile() })
}

function petRunning(): boolean {
  return petAlreadyRunning({ pidFile: pidFile() })
}

function readPetPid(pidFileArg: string): number {
  try {
    const pid = parseInt(fs.readFileSync(pidFileArg, "utf8").trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : 0
  } catch {
    return 0
  }
}

function isAlive(pid: number): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as { code?: string }).code !== "ESRCH"
  }
}

function closePetProcess(options: { pidFile?: string; heartbeatFile?: string } = {}): boolean {
  const pidFileArg = options.pidFile || pidFile()
  const heartbeatFileArg = options.heartbeatFile || heartbeatFile()
  try {
    fs.unlinkSync(heartbeatFileArg)
  } catch {
    /* heartbeat already gone */
  }
  const pid = readPetPid(pidFileArg)
  if (!pid || !isAlive(pid)) return false
  try {
    process.kill(pid)
  } catch {
    /* already exited */
  }
  try {
    fs.unlinkSync(pidFileArg)
  } catch {
    /* best effort */
  }
  return true
}

function resolveElectronBin(dir: string, platform: string = process.platform): string | undefined {
  const isWin = platform === "win32"
  const dist = path.join(dir, "node_modules", "electron", "dist", isWin ? "electron.exe" : "electron")
  if (fs.existsSync(dist)) return dist
  const shim = path.join(dir, "node_modules", ".bin", isWin ? "electron.cmd" : "electron")
  if (fs.existsSync(shim)) return shim
  return undefined
}

function hasElectron(dir: string): boolean {
  return resolveElectronBin(dir) !== undefined
}

function resolveAppDir(extraCandidates: string[] = []): string {
  const candidates = [
    process.env.OPENCODE_PET_DIR,
    ...extraCandidates,
    path.join(safeHome(), "opencode-pet"),
    path.join(safeHome(), "opencode-scrybe"),
  ].filter(Boolean) as string[]
  for (const dir of candidates) {
    if (isUsableAppDir(dir) && hasElectron(dir)) return dir
  }
  return candidates[0] || path.join(safeHome(), "opencode-pet")
}

function petAlreadyRunning(options: { pidFile?: string } = {}): boolean {
  const pidFileArg = options.pidFile || pidFile()
  const pid = readPetPid(pidFileArg)
  return Boolean(pid && isAlive(pid))
}

const DEFAULT_LOCK_HOLD_MS = 1500

function acquireLaunchLock(dir: string, staleMs: number = 5000): string | null {
  if (!dir) return null
  const file = path.join(dir, "launch.lock")
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
      /* raced */
    }
    return null
  }
}

function launchPet(options: { appDir?: string; pidFile?: string; skipLock?: boolean; skipRunningCheck?: boolean; platform?: string } = {}): { launched: boolean; reason?: string; appDir?: string } {
  const appDir = options.appDir || resolveAppDir([])
  const noLaunch = process.env.OPENCODE_PET_NO_LAUNCH === "1"
  if (noLaunch) return { launched: false, reason: "no-launch" }
  const bin = resolveElectronBin(appDir, options.platform || process.platform)
  if (!bin) return { launched: false, reason: "no-electron" }
  if (options.skipRunningCheck !== true && petAlreadyRunning({ pidFile: options.pidFile })) {
    return { launched: false, reason: "already-running" }
  }
  if (options.skipLock !== true) {
    const lock = acquireLaunchLock(path.join(safeHome(), ".cache", "opencode-pet"), 5000)
    if (!lock) return { launched: false, reason: "launch-locked" }
    setTimeout(() => {
      try {
        fs.unlinkSync(lock)
      } catch {
        /* already released */
      }
    }, DEFAULT_LOCK_HOLD_MS).unref?.()
  }
  const childEnv = safeEnv({})
  const spawnOptions = {
    cwd: appDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    env: childEnv,
  }
  const isWin = (options.platform || process.platform) === "win32"
  try {
    const { spawn } = require("node:child_process")
    let child
    if (isWin && bin.endsWith(".cmd")) {
      if (!isSafeCmdPath(bin)) return { launched: false, reason: "unsafe-path" }
      const comspec = process.env.ComSpec || process.env.COMSPEC || "cmd.exe"
      child = spawn(comspec, ["/d", "/s", "/c", bin, "."], spawnOptions)
    } else {
      child = spawn(bin, ["."], spawnOptions)
    }
    child.on("error", () => {})
    child.unref()
  } catch {
    return { launched: false, reason: "spawn-failed" }
  }
  return { launched: true, appDir }
}

function parsePetCommand(input: unknown): { action: string; raw: string } {
  const raw = String(input === undefined || input === null ? "" : input).trim().toLowerCase()
  if (!raw) return { action: "toggle", raw }
  if (raw === "on" || raw === "enable" || raw === "show") return { action: "on", raw }
  if (raw === "off" || raw === "disable" || raw === "hide") return { action: "off", raw }
  if (raw === "toggle") return { action: "toggle", raw }
  if (raw === "restart" || raw === "reload") return { action: "restart", raw }
  if (raw === "status" || raw === "state") return { action: "status", raw }
  return { action: "toggle", raw }
}

function shortcutAction(running: boolean): "start" | "stop" {
  return running ? "stop" : "start"
}

function resolveCommand(action: string, state: { running?: boolean; visible?: boolean }): { start: boolean; show: boolean; stop: boolean } {
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
      return { start: false, show: false, stop: false }
    default:
      return { start: false, show: visible, stop: false }
  }
}

// (inlined helpers above)

const PET_STATES = [
  "idle",
  "thinking",
  "working",
  "waiting",
  "happy",
  "error",
  "sleeping",
] as const

type PetState = (typeof PET_STATES)[number]

const KNOWN_PACKS = [
  { id: "scrybe", label: "Scrybe (built in)" },
  { id: "clack", label: "Clack" },
  { id: "shane-hollander", label: "Shane Hollander" },
] as const

const PetStatusSchema = Schema.Struct({
  available: Schema.Boolean,
  running: Schema.Boolean,
  enabled: Schema.Boolean,
  visible: Schema.Boolean,
  autoLaunch: Schema.Boolean,
  state: Schema.Literals(PET_STATES),
  ts: Schema.Number,
  detail: Schema.optional(Schema.String),
  scale: Schema.Number,
  animationSpeed: Schema.Number,
  muted: Schema.Boolean,
  feed: Schema.Boolean,
  autoHideFullscreen: Schema.Boolean,
  pet: Schema.String,
  positionX: Schema.Number,
  positionY: Schema.Number,
})

const PetControl = Ipc.define({
  id: "opencode-pet-hello-gui.control",
  state: PetStatusSchema,
  methods: {
    setEnabled: { input: Schema.Boolean },
    setVisible: { input: Schema.Boolean },
    setAutoLaunch: { input: Schema.Boolean },
    restart: {},
    setScale: { input: Schema.Number },
    setAnimationSpeed: { input: Schema.Number },
    setMuted: { input: Schema.Boolean },
    setFeed: { input: Schema.Boolean },
    setAutoHideFullscreen: { input: Schema.Boolean },
    setPet: { input: Schema.String },
    setPosition: { input: Schema.Struct({ x: Schema.Number, y: Schema.Number }) },
    resetPosition: {},
    openPacksFolder: {},
  },
})

// Paths are resolved lazily. The desktop app also evaluates this bundle in
// the window process, where node:os and node:path are inert stubs. Calling
// them at module scope would make the whole settings page disappear.
function cacheDir() {
  return path.join(os.homedir(), ".cache", "opencode-pet")
}
function stateFile() {
  return path.join(cacheDir(), "state.json")
}
function posFile() {
  return path.join(cacheDir(), "pos.json")
}
function pidFile() {
  return path.join(cacheDir(), "pet.pid")
}
function heartbeatFile() {
  return path.join(cacheDir(), "heartbeat")
}
function hiddenFile() {
  return path.join(cacheDir(), "hidden")
}
function appDirFile() {
  return path.join(cacheDir(), "app.dir")
}
function packsDir() {
  return path.join(cacheDir(), "packs")
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

function writeJson(file: string, value: unknown) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(value))
    fs.renameSync(tmp, file)
  } catch {
    // Best effort. The Electron pet keeps its last good settings.
  }
}

// The Electron app and this page must agree on defaults, ranges, and file
// layout. The helpers above are the inlined copies.
function readRuntimeState(): { available: boolean; state: PetState; ts: number; detail?: string } {
  const fallback = { available: false, state: "idle" as PetState, ts: 0 }
  const raw = readJson(stateFile())
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback
  const record = raw as Record<string, unknown>
  const state = record.state
  if (typeof state !== "string" || !PET_STATES.includes(state as PetState)) return fallback
  const ts = typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : 0
  const detail = typeof record.detail === "string" ? record.detail : undefined
  return { available: true, state: state as PetState, ts, detail }
}

function readTextFile(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").trim()
  } catch {
    return ""
  }
}

function refreshStatus(current: { available: boolean; state: PetState; ts: number; detail?: string }) {
  const cfg = readConfig()
  const pos = readPosition()
  return {
    available: current.available,
    running: petRunning(),
    enabled: cfg.enabled !== false,
    visible: cfg.visible !== false,
    autoLaunch: cfg.autoLaunch !== false,
    state: current.state,
    ts: current.ts,
    detail: current.detail,
    scale: typeof cfg.scale === "number" ? cfg.scale : 1.0,
    animationSpeed: typeof cfg.animationSpeed === "number" ? cfg.animationSpeed : 1.0,
    muted: cfg.muted === true,
    feed: cfg.feed === true,
    autoHideFullscreen: cfg.autoHideFullscreen === true,
    pet: typeof cfg.pet === "string" && cfg.pet ? cfg.pet : "scrybe",
    positionX: pos.x,
    positionY: pos.y,
  }
}

// The OpenCode desktop app is Electron, so the plugin main process can reach
// its BrowserWindow list. This is best effort: a different host may not expose
// Electron, and then auto-hide simply stays off.
function electronBrowserWindow(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require("electron")
    return electron && electron.BrowserWindow ? electron.BrowserWindow : null
  } catch {
    return null
  }
}

const definition = Plugin.define({
  i18n: { en },
  main(ctx) {
    let runtime = readRuntimeState()
    let status = refreshStatus(runtime)
    let disposed = false
    let restartTimer: ReturnType<typeof setTimeout> | undefined
    let shortcutRegistered = false

    const publish = () => {
      runtime = readRuntimeState()
      status = refreshStatus(runtime)
      provider.changed()
    }

    // A stop followed immediately by a start can see the old pid still alive,
    // so give the overlay a moment to exit before relaunching. One timer slot
    // means a second restart cannot stack launches.
    const scheduleStart = () => {
      if (restartTimer) clearTimeout(restartTimer)
      restartTimer = setTimeout(() => {
        restartTimer = undefined
        if (!disposed) {
          startPet()
          publish()
        }
      }, 250)
    }

    const provider = ctx.provide(PetControl, {
      state: () => status,
      setEnabled: (value: boolean) => {
        updateConfig(value ? { enabled: true, visible: true } : { enabled: false })
        if (value) startPet()
        else stopPet()
        publish()
      },
      setVisible: (value: boolean) => {
        // Visibility only. Hiding must not kill the process, so `/pet off`
        // and this checkbox can be undone without a relaunch.
        updateConfig({ visible: Boolean(value) })
        publish()
      },
      setAutoLaunch: (value: boolean) => {
        updateConfig({ autoLaunch: Boolean(value) })
        publish()
      },
      restart: () => {
        stopPet()
        scheduleStart()
        publish()
      },
      setScale: (scale: number) => {
        // shared/pet-config clamps to the supported range on write.
        updateConfig({ scale })
        publish()
      },
      setAnimationSpeed: (speed: number) => {
        updateConfig({ animationSpeed: speed })
        publish()
      },
      setMuted: (muted: boolean) => {
        updateConfig({ muted: Boolean(muted) })
        publish()
      },
      setFeed: (feed: boolean) => {
        updateConfig({ feed: Boolean(feed) })
        publish()
      },
      setAutoHideFullscreen: (value: boolean) => {
        updateConfig({ autoHideFullscreen: Boolean(value) })
        writeJson(hiddenFile(), false)
        publish()
      },
      setPet: (pet: string) => {
        if (pet && pet.trim()) updateConfig({ pet: pet.trim() })
        publish()
      },
      setPosition: (pos: { x: number; y: number }) => {
        writeJson(posFile(), { x: Math.round(pos.x), y: Math.round(pos.y) })
        publish()
      },
      resetPosition: () => {
        try {
          fs.unlinkSync(posFile())
        } catch {
          // Already gone.
        }
        stopPet()
        scheduleStart()
        publish()
      },
      openPacksFolder: () => {
        try {
          fs.mkdirSync(packsDir(), { recursive: true })
          const electron = require("electron")
          if (electron && electron.shell && electron.shell.openPath) {
            void electron.shell.openPath(packsDir())
          }
        } catch {
          // The folder still exists even if the shell cannot open it.
        }
      },
    })

    // Ctrl+Alt+Shift+P is a process switch, not a visibility switch: press it
    // while the pet is stopped and it starts, press it while it runs and it
    // stops. The shortcut lives here because the Electron overlay cannot start
    // itself once it has exited.
    try {
      const electron = require("electron")
      if (electron && electron.globalShortcut) {
        shortcutRegistered = electron.globalShortcut.register("Control+Alt+Shift+P", () => {
          if (disposed) return
          const action = shortcutAction(petRunning())
          if (action === "stop") {
            stopPet()
          } else {
            updateConfig({ visible: true })
            startPet()
          }
          publish()
        })
        if (!shortcutRegistered) {
          console.error("[hello-pet] Ctrl+Alt+Shift+P is already taken by another app")
        }
      }
    } catch {
      // A host without globalShortcut still has the settings page and /pet.
    }

    const statusTimer = setInterval(() => {
      if (!disposed) publish()
    }, 2000)

    const fullscreenTimer = setInterval(() => {
      if (disposed) return
      const cfg = readConfig()
      const BrowserWindow = electronBrowserWindow()
      let fullscreen = false
      if (cfg.autoHideFullscreen === true && BrowserWindow) {
        try {
          fullscreen = BrowserWindow.getAllWindows().some((win: any) => {
            try {
              return Boolean(win && win.isFullScreen && win.isFullScreen())
            } catch {
              return false
            }
          })
        } catch {
          fullscreen = false
        }
      }
      writeJson(hiddenFile(), fullscreen ? true : false)
    }, 1000)

    return () => {
      disposed = true
      clearInterval(statusTimer)
      clearInterval(fullscreenTimer)
      if (restartTimer) clearTimeout(restartTimer)
      if (shortcutRegistered) {
        try {
          require("electron").globalShortcut.unregister("Control+Alt+Shift+P")
        } catch {
          // Already gone, or the host has no globalShortcut.
        }
      }
      writeJson(hiddenFile(), false)
      provider.dispose()
    }
  },
  setup(ctx) {
    const control = ctx.main(PetControl)
    const status = () => control.state()

    const runControl = async (action: () => Promise<unknown>) => {
      try {
        await action()
      } catch {
        // The main process may still be starting. The next poll catches up.
      }
    }

    const toast = (title: string) => {
      try {
        ctx.toast.show({ title })
      } catch {
        // Not every host exposes toasts.
      }
    }

    ctx.add(SettingsPage, (): SettingsPage => ({
      id: "pet",
      icon: "flask",
      get title() {
        return ctx.t("settings.title")
      },
      get entries() {
        return [
          {
            id: "pet-enabled",
            title: ctx.t("settings.enabled.title"),
            description: ctx.t("settings.enabled.description"),
            keywords: "pet companion desktop animal mascot enable disable",
          },
          {
            id: "pet-visible",
            title: ctx.t("settings.visible.title"),
            description: ctx.t("settings.visible.description"),
            keywords: "show hide visibility pet companion",
          },
          {
            id: "pet-auto-launch",
            title: ctx.t("settings.autoLaunch.title"),
            description: ctx.t("settings.autoLaunch.description"),
            keywords: "startup auto launch opencode start",
          },
          {
            id: "pet-active",
            title: ctx.t("settings.active.title"),
            description: ctx.t("settings.active.description"),
            keywords: "pack pet active choose clack shane scrybe",
          },
          {
            id: "pet-appearance",
            title: ctx.t("settings.appearance.title"),
            description: ctx.t("settings.appearance.description"),
            keywords: "scale size animation speed",
          },
          {
            id: "pet-behaviour",
            title: ctx.t("settings.behaviour.title"),
            description: ctx.t("settings.behaviour.description"),
            keywords: "sound feed fullscreen position",
          },
          {
            id: "pet-packs",
            title: ctx.t("settings.packs.title"),
            description: ctx.t("settings.packs.description"),
            keywords: "packs import manage pet",
          },
        ]
      },
      render: () => (
        <div style={{ display: "flex", "flex-direction": "column", gap: "18px", padding: "4px 0" }}>
          <section style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
            <h3 style={{ margin: 0, "font-size": "13px", "font-weight": 600 }}>
              {ctx.t("settings.section.status")}
            </h3>
            <div style={{ display: "grid", "grid-template-columns": "140px 1fr", gap: "6px", "font-size": "13px" }}>
              <span style={{ opacity: 0.65 }}>{ctx.t("settings.status.running")}</span>
              <span>{status()?.running ? ctx.t("settings.status.yes") : ctx.t("settings.status.no")}</span>
              <span style={{ opacity: 0.65 }}>{ctx.t("settings.status.state")}</span>
              <span>{status()?.available ? status()?.state : ctx.t("settings.status.offline")}</span>
              <span style={{ opacity: 0.65 }}>{ctx.t("settings.status.position")}</span>
              <span>
                {status()?.positionX ?? 0}, {status()?.positionY ?? 0}
              </span>
            </div>
            <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
              <button type="button" onClick={() => void runControl(() => control.restart())}>
                {ctx.t("settings.restart")}
              </button>
              <button type="button" onClick={() => void runControl(() => control.resetPosition())}>
                {ctx.t("settings.resetPosition")}
              </button>
            </div>
          </section>

          <section style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
            <h3 style={{ margin: 0, "font-size": "13px", "font-weight": 600 }}>
              {ctx.t("settings.section.general")}
            </h3>
            <label style={{ display: "flex", "align-items": "flex-start", gap: "10px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={status()?.enabled ?? true}
                onChange={(event) =>
                  void runControl(() => control.setEnabled(event.currentTarget.checked))
                }
                style={{ "margin-top": "2px" }}
              />
              <span style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
                <span style={{ "font-weight": 600 }}>{ctx.t("settings.enabled.title")}</span>
                <span style={{ opacity: 0.7, "font-size": "12px" }}>
                  {ctx.t("settings.enabled.description")}
                </span>
              </span>
            </label>
            <label style={{ display: "flex", "align-items": "flex-start", gap: "10px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={status()?.visible ?? true}
                onChange={(event) =>
                  void runControl(() => control.setVisible(event.currentTarget.checked))
                }
                style={{ "margin-top": "2px" }}
              />
              <span style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
                <span style={{ "font-weight": 600 }}>{ctx.t("settings.visible.title")}</span>
                <span style={{ opacity: 0.7, "font-size": "12px" }}>
                  {ctx.t("settings.visible.description")}
                </span>
              </span>
            </label>
            <label style={{ display: "flex", "align-items": "flex-start", gap: "10px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={status()?.autoLaunch ?? true}
                onChange={(event) =>
                  void runControl(() => control.setAutoLaunch(event.currentTarget.checked))
                }
                style={{ "margin-top": "2px" }}
              />
              <span style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
                <span style={{ "font-weight": 600 }}>{ctx.t("settings.autoLaunch.title")}</span>
                <span style={{ opacity: 0.7, "font-size": "12px" }}>
                  {ctx.t("settings.autoLaunch.description")}
                </span>
              </span>
            </label>
          </section>

          <section style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
            <h3 style={{ margin: 0, "font-size": "13px", "font-weight": 600 }}>
              {ctx.t("settings.section.pet")}
            </h3>
            <label style={{ display: "flex", "flex-direction": "column", gap: "4px", "font-size": "13px" }}>
              <span>{ctx.t("settings.active.title")}</span>
              <select
                value={status()?.pet ?? "scrybe"}
                onChange={(event) => void runControl(() => control.setPet(event.currentTarget.value))}
              >
                {KNOWN_PACKS.map((pack) => (
                  <option value={pack.id}>{pack.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", "flex-direction": "column", gap: "4px", "font-size": "13px" }}>
              <span>
                {ctx.t("settings.scale")}: {status()?.scale ?? 1}
              </span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={status()?.scale ?? 1}
                onInput={(event) =>
                  void runControl(() => control.setScale(Number(event.currentTarget.value)))
                }
              />
            </label>
            <label style={{ display: "flex", "flex-direction": "column", gap: "4px", "font-size": "13px" }}>
              <span>
                {ctx.t("settings.animationSpeed")}: {status()?.animationSpeed ?? 1}
              </span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={status()?.animationSpeed ?? 1}
                onInput={(event) =>
                  void runControl(() =>
                    control.setAnimationSpeed(Number(event.currentTarget.value)),
                  )
                }
              />
            </label>
          </section>

          <section style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
            <h3 style={{ margin: 0, "font-size": "13px", "font-weight": 600 }}>
              {ctx.t("settings.section.behaviour")}
            </h3>
            <label style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "13px" }}>
              <input
                type="checkbox"
                checked={!(status()?.muted ?? false)}
                onChange={(event) =>
                  void runControl(() => control.setMuted(!event.currentTarget.checked))
                }
              />
              {ctx.t("settings.sound")}
            </label>
            <label style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "13px" }}>
              <input
                type="checkbox"
                checked={status()?.feed ?? false}
                onChange={(event) =>
                  void runControl(() => control.setFeed(event.currentTarget.checked))
                }
              />
              {ctx.t("settings.feed")}
            </label>
            <label style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "13px" }}>
              <input
                type="checkbox"
                checked={status()?.autoHideFullscreen ?? false}
                onChange={(event) =>
                  void runControl(() =>
                    control.setAutoHideFullscreen(event.currentTarget.checked),
                  )
                }
              />
              {ctx.t("settings.autoHide")}
            </label>
          </section>

          <section style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
            <h3 style={{ margin: 0, "font-size": "13px", "font-weight": 600 }}>
              {ctx.t("settings.section.packs")}
            </h3>
            <p style={{ margin: 0, opacity: 0.7, "font-size": "12px" }}>
              {ctx.t("settings.packs.note")}
            </p>
            <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
              <button type="button" onClick={() => void runControl(() => control.openPacksFolder())}>
                {ctx.t("settings.packs.openFolder")}
              </button>
            </div>
          </section>

          <p style={{ margin: 0, opacity: 0.6, "font-size": "12px" }}>{ctx.t("settings.note")}</p>
        </div>
      ),
    }))

    ctx.add(Command, (): Command => ({
      id: "pet",
      get title() {
        return ctx.t("command.title")
      },
      get description() {
        return ctx.t("command.description")
      },
      keywords: "pet companion mascot toggle enable disable",
      section: "prompt",
      slash: { name: "pet", arguments: true },
      run: async (input) => {
        const { action } = parsePetCommand(input)
const current = status()

        if (action === "status") {
          const running = current?.running
            ? ctx.t("command.status.running")
            : ctx.t("command.status.stopped")
          const visibility = current?.visible
            ? ctx.t("command.status.visible")
            : ctx.t("command.status.hidden")
          const stateLabel = current?.available ? current.state : ctx.t("command.status.offline")
          toast(`${running} · ${visibility} · ${stateLabel}`)
          return
        }

        if (action === "restart") {
          await runControl(() => control.restart())
          toast(ctx.t("command.restarting"))
          return
        }

        // /pet on   -> show; start only if no process is running
        // /pet off  -> hide; never kill the process
        // /pet      -> flip visibility; start only if the process is stopped
        const plan = resolveCommand(action, {
          running: current?.running ?? false,
          visible: current?.visible ?? true,
        })
        if (plan.start) await runControl(() => control.setEnabled(true))
        await runControl(() => control.setVisible(plan.show))
      },
    }))

    console.info("[hello-pet] settings page and /pet command registered")
  },
})

export default definition
