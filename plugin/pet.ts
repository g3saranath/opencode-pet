import type { Plugin } from "@opencode-ai/plugin";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Paths (MUST match shared/paths.js in the pet app)
// ---------------------------------------------------------------------------
const DIR = path.join(os.homedir(), ".cache", "opencode-pet");
const STATE_FILE = path.join(DIR, "state.json");
const TMP_FILE = path.join(DIR, "state.json.tmp");
const PID_FILE = path.join(DIR, "pet.pid");
const HEARTBEAT_FILE = path.join(DIR, "heartbeat");

// While opencode is connected the plugin pulses a heartbeat; the overlay stays
// awake as long as it sees a recent pulse, and only sleeps once opencode is gone.
const HEARTBEAT_MS = 15 * 1000;

// Where the Electron overlay lives. Honour the env override first, then fall
// back to the usual clone locations (works whether the repo folder is named
// "opencode-familiar" or "opencode-pet").
function resolveAppDir(): string {
  const candidates = [
    process.env.OPENCODE_PET_DIR,
    path.join(os.homedir(), "opencode-scrybe"),
    path.join(os.homedir(), "opencode-pet"),
  ].filter(Boolean) as string[];
  for (const d of candidates) {
    if (fs.existsSync(path.join(d, "node_modules", ".bin", "electron"))) return d;
  }
  return candidates[0] || path.join(os.homedir(), "opencode-familiar");
}
const APP_DIR = resolveAppDir();

// Single source of truth for valid pet states — shared/states.json
function loadStates(): string[] {
  const candidates: string[] = [];
  // 1. APP_DIR-relative (works when plugin is launched from installed location)
  candidates.push(path.join(APP_DIR, "shared", "states.json"));
  // 2. CWD-relative (works in repo checkout / tests)
  candidates.push(path.join(process.cwd(), "shared", "states.json"));
  // 3. Relative to this file (covers symlink / ESM / CJS loaders)
  try {
    // @ts-ignore — import.meta may not be available in all loaders
    const url = (typeof import.meta !== "undefined" && (import.meta as any).url) ? (import.meta as any).url as string : null;
    if (url) {
      const filePath = decodeURIComponent(new URL(url).pathname);
      // Windows: pathname is /D:/path — strip leading slash
      const normalized = process.platform === "win32" && filePath.startsWith("/") ? filePath.slice(1) : filePath;
      candidates.push(path.join(path.dirname(normalized), "..", "shared", "states.json"));
    }
  } catch {}
  try {
    const d = (typeof __dirname !== "undefined" ? __dirname : null) as string | null;
    if (d) candidates.push(path.join(d, "..", "shared", "states.json"));
  } catch {}
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0 && arr.every((s: unknown) => typeof s === "string")) return arr;
    } catch {}
  }
  // Fallback: keep session alive if states.json is missing (e.g. stray dev checkout)
  return ["idle", "thinking", "working", "waiting", "happy", "error", "sleeping"];
}
const STATES = loadStates() as unknown as readonly ["idle", "thinking", "working", "waiting", "happy", "error", "sleeping"];
type PetState = (typeof STATES)[number];

type FeedEntry = { seq: number; icon: string; text: string; kind: string; id?: string };

let lastPayload = "";
let activeTools = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

// Rolling activity log so you can follow the intermediate steps.
let feed: FeedEntry[] = [];
let seq = 0;
let lastTodoLabel = "";
const FEED_MAX = 12;

// Live-relay streaming state.
let streamId: string | null = null;   // id of the message part currently streaming
let userMsgId: string | null = null;  // to avoid echoing the user's own message

// Throttled writes so streaming deltas don't hammer the state file.
let pendingState: PetState = "idle";
let pendingExtra: Record<string, unknown> = {};
let flushTimer: ReturnType<typeof setTimeout> | undefined;
const THROTTLE_MS = 120;

// tool -> [icon, verb] for feed lines
const TOOL_META: Record<string, [string, string]> = {
  edit: ["\u270F\uFE0F", "edit"],
  write: ["\u270F\uFE0F", "write"],
  patch: ["\u270F\uFE0F", "edit"],
  read: ["\uD83D\uDCD6", "read"],
  bash: ["\u2699\uFE0F", "run"],
  grep: ["\uD83D\uDD0D", "grep"],
  glob: ["\uD83D\uDCC2", "glob"],
  list: ["\uD83D\uDCC2", "list"],
  webfetch: ["\uD83C\uDF10", "fetch"],
  websearch: ["\uD83C\uDF10", "search"],
  task: ["\uD83E\uDD16", "task"],
  todowrite: ["\uD83D\uDCDD", "plan"],
  question: ["\u2753", "ask"],
};

function logStep(icon: string, text: string, kind: string, max = 60) {
  feed.push({ seq: ++seq, icon, text: truncate(text, max), kind });
  if (feed.length > FEED_MAX) feed = feed.slice(-FEED_MAX);
}

function snippet(s: unknown, n: number): string {
  const line = String(s ?? "")
    .split("\n")
    .map((x) => x.trim())
    .find((x) => x.length);
  return truncate(line || "", n);
}

// ---------------------------------------------------------------------------
// Heartbeat — proof that opencode is alive & connected.
// ---------------------------------------------------------------------------
function beat() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(HEARTBEAT_FILE, String(Date.now()));
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------
// Turn tool args into a short, human "what's happening right now" label.
// ---------------------------------------------------------------------------
function basename(p: unknown): string {
  if (typeof p !== "string" || !p) return "";
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
function truncate(s: unknown, n: number): string {
  const str = String(s ?? "").replace(/\s+/g, " ").trim();
  return str.length > n ? str.slice(0, n - 1) + "\u2026" : str;
}
function summarize(tool: string, args: any): string {
  args = args || {};
  switch (tool) {
    case "edit":
    case "write":
    case "patch":
    case "read":
      return basename(args.filePath || args.path || args.file);
    case "bash":
      return truncate(args.command || args.cmd, 24);
    case "grep":
      return truncate(args.pattern, 22);
    case "glob":
      return truncate(args.pattern, 22);
    case "list":
      return basename(args.path || ".");
    case "webfetch":
      try {
        return new URL(args.url).hostname;
      } catch {
        return truncate(args.url, 22);
      }
    case "websearch":
      return truncate(args.query || args.pattern, 22);
    case "task":
      return truncate(args.description || args.subagent_type, 24);
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// State writing (atomic)
// ---------------------------------------------------------------------------
function writeState(state: PetState, extra: Record<string, unknown> = {}) {
  const body = { state, ...extra, feed };
  const dedupeKey = JSON.stringify(body);
  if (dedupeKey === lastPayload) return;
  lastPayload = dedupeKey;
  const payload = JSON.stringify({ ...body, ts: Date.now() });
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(TMP_FILE, payload);
    fs.renameSync(TMP_FILE, STATE_FILE);
  } catch {
    /* best effort — never break the session over a pet */
  }
}

// Immediate write (discrete events).
function emit(state: PetState, extra: Record<string, unknown> = {}) {
  pendingState = state;
  pendingExtra = extra;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  writeState(state, extra);
}

// Coalesced write (streaming deltas) — at most one every THROTTLE_MS.
function emitThrottled(state: PetState, extra: Record<string, unknown> = {}) {
  pendingState = state;
  pendingExtra = extra;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    writeState(pendingState, pendingExtra);
  }, THROTTLE_MS);
}

// Relay a streaming reasoning/text part into the feed (live transcript).
function relay(part: any) {
  if (!part) return;
  if (part.type !== "text" && part.type !== "reasoning") return;
  if (part.synthetic || part.ignored) return;
  if (userMsgId && part.messageID === userMsgId) return; // don't echo the prompt

  const raw = String(part.text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return;
  const shown = raw.length > 180 ? "\u2026" + raw.slice(-180) : raw;
  const kind = part.type === "reasoning" ? "reason" : "say";
  const icon = part.type === "reasoning" ? "\uD83D\uDCAD" : "\uD83D\uDDE8\uFE0F";

  if (part.id !== streamId) {
    streamId = part.id;
    feed.push({ seq: ++seq, id: part.id, icon, text: shown, kind });
    if (feed.length > FEED_MAX) feed = feed.slice(-FEED_MAX);
  } else {
    const e = [...feed].reverse().find((x) => x.id === part.id);
    if (e) e.text = shown;
  }
  emitThrottled(activeTools > 0 ? "working" : "thinking");
}

// ---------------------------------------------------------------------------
// Launch the Electron overlay (once)
// ---------------------------------------------------------------------------
function petAlreadyRunning(): boolean {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    if (!pid) return false;
    process.kill(pid, 0); // throws if the process is gone
    return true;
  } catch {
    return false;
  }
}

function launchPet() {
  if (process.env.OPENCODE_PET_NO_LAUNCH === "1") return;
  if (petAlreadyRunning()) return;

  const electronBin = path.join(APP_DIR, "node_modules", ".bin", "electron");
  if (!fs.existsSync(electronBin)) {
    // App not installed yet — skip silently; state file still gets written.
    return;
  }

  try {
    const child = spawn(electronBin, ["."], {
      cwd: APP_DIR,
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
    // Note: the Electron app writes its own real pid to PID_FILE on startup;
    // we don't record the short-lived npm shim pid here.
  } catch {
    /* ignore launch failures */
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
export const PetPlugin: Plugin = async () => {
  // Wake the pet the moment opencode connects.
  beat();
  logStep("\u2728", "connected", "meta");
  emit("idle");
  launchPet();
  heartbeatTimer = setInterval(beat, HEARTBEAT_MS);

  return {
    // A user prompt / model turn kicked off.
    "chat.message": async (input, output) => {
      userMsgId =
        (input as any)?.messageID || (output as any)?.message?.id || null;
      streamId = null;
      const parts: any[] = (output as any)?.parts || [];
      const text = parts
        .filter((p) => p && p.type === "text" && p.text)
        .map((p) => p.text)
        .join(" ")
        .trim();
      if (text) logStep("\uD83E\uDDD1", "you: " + text, "you", 80);
      lastTodoLabel = "";
      emit(activeTools > 0 ? "working" : "thinking");
    },

    "tool.execute.before": async (input, output) => {
      activeTools++;
      streamId = null; // separate any streamed text from the tool line
      const detail = summarize(input.tool, output?.args);
      const meta = TOOL_META[input.tool] || ["\uD83E\uDE84", input.tool];
      logStep(meta[0], detail ? `${meta[1]} ${detail}` : meta[1], "step");
      emit("working", { tool: input.tool, detail });
    },

    "tool.execute.after": async (_input, output) => {
      activeTools = Math.max(0, activeTools - 1);
      streamId = null;
      const line = snippet((output as any)?.output, 54);
      if (line) logStep("\u21B3", line, "out");
      emit(activeTools > 0 ? "working" : "thinking");
    },

    event: async ({ event }) => {
      const props = (event as any).properties || {};
      switch (event.type) {
        case "message.part.updated":
          relay(props.part);
          break;
        case "session.status": {
          const status = props.status?.type;
          if (status === "busy" && activeTools === 0) emit("thinking");
          else if (status === "retry") {
            logStep("\uD83D\uDD01", "retrying\u2026", "wait");
            emit("thinking");
          }
          break;
        }
        case "todo.updated": {
          const todos: Array<{ status: string; content?: string }> =
            props.todos || [];
          const total = todos.length;
          if (!total) break;
          const done = todos.filter((t) => t.status === "completed").length;
          const active = todos.find((t) => t.status === "in_progress")?.content;
          const label = active || `${done}/${total} done`;
          if (label === lastTodoLabel) break;
          lastTodoLabel = label;
          logStep("\uD83D\uDCDD", label, "plan");
          emit("working", { tool: "todowrite", detail: truncate(label, 22) });
          break;
        }
        case "session.idle":
          activeTools = 0;
          streamId = null;
          if (feed[feed.length - 1]?.kind !== "done") {
            logStep("\u2728", "finished", "done");
          }
          emit("happy");
          break;
        case "session.error": {
          activeTools = 0;
          streamId = null;
          const err = props.error;
          const msg = err?.name || err?.data?.message || "something broke";
          logStep("\uD83D\uDCA5", "error: " + msg, "error");
          emit("error", { detail: truncate(msg, 22) });
          break;
        }
        case "permission.updated":
          logStep("\u2753", props.title || "needs approval", "wait");
          emit("waiting", { detail: truncate(props.title, 24) });
          break;
        case "permission.replied":
          emit("thinking");
          break;
      }
    },

    // opencode is shutting down — stop the heartbeat and let the pet nap.
    dispose: async () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      try {
        fs.unlinkSync(HEARTBEAT_FILE);
      } catch {}
      emit("sleeping");
    },
  };
};

export default PetPlugin;
