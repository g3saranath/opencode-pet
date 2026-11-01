// Pure helpers for the Phase 0 GUI pet. Kept free of Solid, Effect and the
// OpenCode SDK so they can be unit-tested directly with Node's test runner.
//
// The same helpers are used by the window (src/gui.tsx) and by the main
// process, which is why they live here instead of inside the component.

export const PET_STATES = [
  "idle",
  "thinking",
  "working",
  "waiting",
  "happy",
  "error",
  "sleeping",
] as const

export type PetState = (typeof PET_STATES)[number]

export interface RuntimeState {
  available: boolean
  state: PetState
  ts: number
  detail?: string
}

const PET_STATE_SET = new Set<string>(PET_STATES)

export function normalizeCommandArg(input: unknown): string {
  return String(input ?? "").trim().toLowerCase()
}

// Single rule for the three command forms. `""` toggles, `on`/`enable` shows,
// `off`/`disable` hides. Anything else (including unknown words) toggles, so
// `/pet foo` never silently does nothing.
export function applyCommand(current: boolean, arg: unknown): boolean {
  const normalized = normalizeCommandArg(arg)
  if (normalized === "on" || normalized === "enable" || normalized === "show") return true
  if (normalized === "off" || normalized === "disable" || normalized === "hide") return false
  return !current
}

// Reads the real pet's state file payload (already parsed by the caller) and
// returns a safe, normalised value. Unknown or missing state becomes "offline"
// so the badge never crashes on a half-written file.
export function readRuntimeState(raw: unknown): RuntimeState {
  const fallback: RuntimeState = { available: false, state: "idle", ts: 0 }
  if (!raw || typeof raw !== "object") return fallback
  const record = raw as Record<string, unknown>
  const state = record.state
  if (typeof state !== "string" || !PET_STATE_SET.has(state)) return fallback
  const ts = typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : 0
  const detail = typeof record.detail === "string" ? record.detail : undefined
  return { available: true, state: state as PetState, ts, detail }
}

export const RUNTIME_LABEL: Record<PetState, string> = {
  idle: "Idle",
  thinking: "Thinking",
  working: "Working",
  waiting: "Waiting",
  happy: "Happy",
  error: "Error",
  sleeping: "Sleeping",
}

export function runtimeLabel(state: PetState | undefined, available: boolean): string {
  if (!available || !state) return "Pet offline"
  return RUNTIME_LABEL[state]
}
