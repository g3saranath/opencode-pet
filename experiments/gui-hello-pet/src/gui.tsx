import { Schema } from "effect"
import { Command, Ipc, Plugin, SettingsPage } from "@opencode/plugin/gui"
import * as fs from "node:fs"
import * as path from "node:path"
import en from "./i18n/en"
import {
  cacheDir,
  closePetProcess,
  createChangeGate,
  createShortcutController,
  launchPet,
  parsePetCommand,
  petAlreadyRunning,
  readConfig,
  readPosition,
  resolveAppDir,
  resolveCommand,
  shortcutAction,
  updateConfig,
  writePosition,
} from "./runtime"
import type { GlobalShortcutApi, SpawnFn } from "./runtime"

// The process, config, and shortcut rules live in ./runtime, a side-effect-free
// mirror of this repo's shared/ modules that test/runtime.test.ts keeps in
// parity. This file only wires them to the plugin SDK.

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

// Pets the overlay can actually draw. Sprite-sheet packs are registered in
// app/renderer/packs.js; none ship yet, so Scrybe is the only choice.
const KNOWN_PACKS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "scrybe", label: "Scrybe (built in)" },
]

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
function cacheFile(name: string) {
  return path.join(cacheDir(), name)
}
const stateFile = () => cacheFile("state.json")
const pidFile = () => cacheFile("pet.pid")
const heartbeatFile = () => cacheFile("heartbeat")
const hiddenFile = () => cacheFile("hidden")
const appDirFile = () => cacheFile("app.dir")
const packsDir = () => cacheFile("packs")
const configDir = () => ({ dir: cacheDir() })

// Electron and child_process are loaded only when a main-process function
// runs, never at module scope, for the same reason.
function electron(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("electron")
  } catch {
    return null
  }
}

function spawnFn(): SpawnFn | undefined {
  try {
    return require("node:child_process").spawn as SpawnFn
  } catch {
    return undefined
  }
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

function readTextFile(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").trim()
  } catch {
    return ""
  }
}

function startPet(): boolean {
  // The server plugin records the checkout it resolved; prefer it.
  const recorded = readTextFile(appDirFile())
  const result = launchPet({
    appDir: resolveAppDir(recorded ? [recorded] : []),
    pidFile: pidFile(),
    lockDir: cacheDir(),
    spawn: spawnFn(),
  })
  return result.launched
}

function stopPet(): boolean {
  return closePetProcess({ pidFile: pidFile(), heartbeatFile: heartbeatFile() })
}

function petRunning(): boolean {
  return petAlreadyRunning({ pidFile: pidFile() })
}

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

function refreshStatus(current: { available: boolean; state: PetState; ts: number; detail?: string }) {
  const cfg = readConfig(configDir())
  const pos = readPosition(configDir()) || { x: 0, y: 0 }
  return {
    available: current.available,
    running: petRunning(),
    enabled: cfg.enabled,
    visible: cfg.visible,
    autoLaunch: cfg.autoLaunch,
    state: current.state,
    ts: current.ts,
    detail: current.detail,
    scale: cfg.scale,
    animationSpeed: cfg.animationSpeed,
    muted: cfg.muted,
    feed: cfg.feed,
    autoHideFullscreen: cfg.autoHideFullscreen,
    // An older config may name a pack that no longer ships; the overlay draws
    // Scrybe for it, so report that.
    pet: KNOWN_PACKS.some((pack) => pack.id === cfg.pet) ? cfg.pet : "scrybe",
    positionX: pos.x,
    positionY: pos.y,
  }
}

// Is any OpenCode window fullscreen? The plugin main process lives inside the
// desktop app (Electron), so it can see the app's own windows. A different
// host may not expose Electron, and then auto-hide simply stays off.
function openCodeIsFullscreen(): boolean {
  const BrowserWindow = electron()?.BrowserWindow
  if (!BrowserWindow) return false
  try {
    return BrowserWindow.getAllWindows().some((win: any) => {
      try {
        return Boolean(win && win.isFullScreen && win.isFullScreen())
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

const definition = Plugin.define({
  i18n: { en },
  main(ctx) {
    let runtime = readRuntimeState()
    let status = refreshStatus(runtime)
    let disposed = false
    let restartTimer: ReturnType<typeof setTimeout> | undefined

    // Only notify the window, and only rewrite the `hidden` flag, when the
    // value actually changed. Both run on timers for as long as Desktop is open.
    const statusChanged = createChangeGate()
    statusChanged(status)
    const hiddenChanged = createChangeGate()
    const writeHidden = (hidden: boolean) => {
      // The overlay deletes a stale flag when it starts, so rewrite a missing
      // "true" even if this process already wrote it once.
      if (hiddenChanged(hidden) || (hidden && !fs.existsSync(hiddenFile()))) {
        writeJson(hiddenFile(), hidden)
      }
    }

    const publish = () => {
      runtime = readRuntimeState()
      status = refreshStatus(runtime)
      if (statusChanged(status)) provider.changed()
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
        updateConfig(value ? { enabled: true, visible: true } : { enabled: false }, configDir())
        if (value) startPet()
        else stopPet()
        publish()
      },
      setVisible: (value: boolean) => {
        // Visibility only. Hiding must not kill the process, so `/pet off`
        // and this checkbox can be undone without a relaunch.
        updateConfig({ visible: Boolean(value) }, configDir())
        publish()
      },
      setAutoLaunch: (value: boolean) => {
        updateConfig({ autoLaunch: Boolean(value) }, configDir())
        publish()
      },
      restart: () => {
        stopPet()
        scheduleStart()
        publish()
      },
      setScale: (scale: number) => {
        // The shared normalizer clamps to the supported range on write.
        updateConfig({ scale }, configDir())
        publish()
      },
      setAnimationSpeed: (speed: number) => {
        updateConfig({ animationSpeed: speed }, configDir())
        publish()
      },
      setMuted: (muted: boolean) => {
        updateConfig({ muted: Boolean(muted) }, configDir())
        publish()
      },
      setFeed: (feed: boolean) => {
        updateConfig({ feed: Boolean(feed) }, configDir())
        publish()
      },
      setAutoHideFullscreen: (value: boolean) => {
        updateConfig({ autoHideFullscreen: Boolean(value) }, configDir())
        if (!value) writeHidden(false)
        publish()
      },
      setPet: (pet: string) => {
        const id = typeof pet === "string" ? pet.trim() : ""
        if (KNOWN_PACKS.some((pack) => pack.id === id)) updateConfig({ pet: id }, configDir())
        publish()
      },
      setPosition: (pos: { x: number; y: number }) => {
        writePosition(pos, configDir())
        publish()
      },
      resetPosition: () => {
        try {
          fs.unlinkSync(cacheFile("pos.json"))
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
          const shell = electron()?.shell
          if (shell && shell.openPath) void shell.openPath(packsDir())
        } catch {
          // The folder still exists even if the shell cannot open it.
        }
      },
    })

    // Ctrl+Alt+Shift+P here is a process switch: it starts a stopped pet and
    // stops a running one. The overlay binds the same key to quit while it
    // runs; shortcut.owner keeps the two from both holding it, and tick()
    // takes the key over once the overlay lets go.
    const shortcut = createShortcutController({
      globalShortcut: () => {
        const api = electron()?.globalShortcut
        return api && typeof api.register === "function" ? (api as GlobalShortcutApi) : null
      },
      dir: cacheDir,
      onPress: () => {
        if (disposed) return
        if (shortcutAction(petRunning()) === "stop") {
          stopPet()
        } else {
          updateConfig({ visible: true }, configDir())
          startPet()
        }
        publish()
      },
    })
    if (!shortcut.tick()) {
      console.info("[hello-pet] Ctrl+Alt+Shift+P is held elsewhere (usually the running pet); will retry")
    }

    const statusTimer = setInterval(() => {
      if (disposed) return
      shortcut.tick()
      publish()
    }, 2000)

    const fullscreenTimer = setInterval(() => {
      if (disposed) return
      // `status` is refreshed every 2s, so no extra config read here.
      writeHidden(status.autoHideFullscreen && openCodeIsFullscreen())
    }, 1000)

    return () => {
      disposed = true
      clearInterval(statusTimer)
      clearInterval(fullscreenTimer)
      if (restartTimer) clearTimeout(restartTimer)
      shortcut.dispose()
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
            keywords: "pack pet active choose scrybe",
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
              {KNOWN_PACKS.length > 1 ? (
                <select
                  value={status()?.pet ?? "scrybe"}
                  onChange={(event) => void runControl(() => control.setPet(event.currentTarget.value))}
                >
                  {KNOWN_PACKS.map((pack) => (
                    <option value={pack.id}>{pack.label}</option>
                  ))}
                </select>
              ) : (
                <span style={{ opacity: 0.8 }}>{KNOWN_PACKS[0].label}</span>
              )}
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
                checked={status()?.feed ?? true}
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
