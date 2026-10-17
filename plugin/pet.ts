// opencode-pet plugin, OpenCode V2 shape.
//
// Same file-bus design as before: this plugin watches the session and writes
// ~/.cache/opencode-pet/state.json plus a heartbeat, and the Electron overlay
// in app/ watches that directory. Nothing else changed.
//
// What did change is the plugin contract. V1 loaded one object of string-keyed
// hooks ("chat.message", "tool.execute.before", "event", ...). V2 loads a
// default definition carrying an `id` and a `setup(ctx)` that registers hooks
// and subscriptions through the context, and V1 implementation code does not
// run in V2. This file is the V2 shape.
//
// It stays dependency-free at runtime: only Node built-ins plus this repo's
// shared/ modules. The V2 runtime supplies everything else.
import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DIR, PID_FILE, HEARTBEAT_FILE } from "../shared/paths.js";
import { createStateWriter, type PetState } from "../shared/state-protocol.js";
import { resolveElectronBin, hasElectron } from "../shared/electron-bin.js";
import { isProcessAlive } from "../shared/process-alive.js";

// V2 loads this plugin into opencode's long-lived background service, which
// outlives the desktop app: the service keeps running after you close the
// window. So "is opencode connected?" cannot be answered by this process being
// alive; we ask the OS whether the app is open. While it is, the plugin pulses
// a heartbeat and the overlay stays awake as long as it sees a recent pulse.
const PROBE_MS = 2 * 1000;

// The desktop app's process image (the same name for its main and helper
// processes), so any match means the app is open.
const APP_IMAGE = "OpenCode.exe";

// V2 runs setup once per open location. Only the owner of this file drives the
// pet, so two open projects cannot write the state file at the same time and
// make the wizard twitch. A secondary watches the file and takes over if the
// owner's process exits.
const OWNER_FILE = path.join(DIR, "owner.pid");
const OWNER_CHECK_MS = 5 * 1000;

// Where the Electron overlay lives. Honour OPENCODE_PET_DIR first, then fall
// back to the checkout this plugin file actually lives in (resolves the
// ~/.config/opencode/plugin symlink back here), then the usual clone paths.
function ownCheckoutDir(): string {
  try {
    const self = fs.realpathSync(fileURLToPath(import.meta.url));
    return path.resolve(path.dirname(self), "..");
  } catch {
    return "";
  }
}

function resolveAppDir(): string {
  const candidates = [
    process.env.OPENCODE_PET_DIR,
    ownCheckoutDir(),
    path.join(os.homedir(), "opencode-scrybe"),
    path.join(os.homedir(), "opencode-pet"),
  ].filter(Boolean) as string[];
  for (const d of candidates) {
    if (hasElectron(d)) return d;
  }
  return candidates[0] || path.join(os.homedir(), "opencode-pet");
}
const APP_DIR = resolveAppDir();

type FeedEntry = { seq: number; icon: string; text: string; kind: string; id?: string };

// Rolling activity log so you can follow the intermediate steps.
let feed: FeedEntry[] = [];
let seq = 0;
let lastTodoLabel = "";
const FEED_MAX = 12;
const RELAY_MAX = 180;

// A tool call is in flight between "called" and "success"/"failed"; used to
// keep the pet on "working" while it is busy.
let activeTools = 0;

// Throttled writes so streaming deltas don't hammer the state file.
let pendingState: PetState = "idle";
let pendingExtra: Record<string, unknown> = {};
let flushTimer: ReturnType<typeof setTimeout> | undefined;
const THROTTLE_MS = 120;

// V2 tool events do not carry the tool name; the name arrives earlier on
// session.tool.input.started, keyed by the same call id. Remember it so the
// "called" line can be labelled.
const callNames = new Map<string, string>();

// Streaming buffers, keyed by stream id (assistant message + kind + ordinal).
const streamBuf = new Map<string, string>();

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
// Streaming relay: keep the last RELAY_MAX characters of each live part so the
// transcript updates in place instead of appending a line per delta.
// ---------------------------------------------------------------------------
function tail(s: unknown, n = RELAY_MAX): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? "\u2026" + t.slice(-n) : t;
}

function streamLine(id: string, icon: string, kind: string, text: string) {
  const existing = feed.find((x) => x.id === id);
  if (existing) {
    existing.text = text;
    return;
  }
  feed.push({ seq: ++seq, id, icon, text, kind });
  if (feed.length > FEED_MAX) feed = feed.slice(-FEED_MAX);
}

function relayStart(id: string) {
  if (streamBuf.size > 32) streamBuf.delete(streamBuf.keys().next().value as string);
  streamBuf.set(id, "");
}

function relayDelta(id: string, icon: string, kind: string, delta: unknown) {
  const acc = (streamBuf.get(id) || "") + String(delta ?? "");
  streamBuf.set(id, acc);
  if (!acc.trim()) return;
  streamLine(id, icon, kind, tail(acc));
  emitThrottled(activeTools > 0 ? "working" : "thinking");
}

function relayEnd(id: string, icon: string, kind: string, finalText: unknown) {
  const full = String(finalText ?? streamBuf.get(id) ?? "");
  streamBuf.delete(id);
  if (!full.trim()) return;
  streamLine(id, icon, kind, tail(full));
}

// ---------------------------------------------------------------------------
// Heartbeat: proof that opencode is alive and connected. Includes this
// server's pid so the overlay can tell which instance is pulsing and ignore a
// heartbeat from an instance that has since exited.
// ---------------------------------------------------------------------------
function beat() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(HEARTBEAT_FILE, `${Date.now()} ${process.pid}`);
  } catch {
    /* best effort */
  }
}

// Is the desktop app open right now? The background service this plugin runs in
// survives the app closing, so process.pid says nothing about the app. We ask
// the OS instead. tasklist is a stock Windows tool, no admin needed. On other
// platforms there is no image name to check, so we keep the old always-awake
// behaviour rather than guessing.
function desktopAppPresent(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve(true);
      return;
    }
    execFile(
      "tasklist",
      ["/FI", `IMAGENAME eq ${APP_IMAGE}`, "/NH"],
      { windowsHide: true },
      (err, stdout) => resolve(!err && /OpenCode\.exe/i.test(String(stdout))),
    );
  });
}

// ---------------------------------------------------------------------------
// Owner election (see OWNER_FILE above).
//
// V2 can run several setup() calls in the same server process (one per open
// location), so process.pid alone cannot tell two instances apart. Each setup
// gets a random token; the owner file records "<pid>:<token>". The owner
// rewrites it on every heartbeat, so a file whose mtime has gone stale means
// the owning instance is gone even while the process is still alive.
// ---------------------------------------------------------------------------
const OWNER_STALE_MS = 10 * PROBE_MS;

function createOwnership() {
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);

  function read(): { pid: number; token: string } {
    try {
      const [rawPid = "", rawToken = ""] = fs.readFileSync(OWNER_FILE, "utf8").trim().split(":");
      const pid = parseInt(rawPid, 10);
      return { pid: Number.isInteger(pid) && pid > 0 ? pid : 0, token: rawToken };
    } catch {
      return { pid: 0, token: "" };
    }
  }

  function write(): boolean {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(OWNER_FILE, `${process.pid}:${token}`);
      return true;
    } catch {
      return false;
    }
  }

  function mine(): boolean {
    return read().token === token;
  }

  function otherIsAlive(): boolean {
    const o = read();
    if (!o.token || o.token === token) return false;
    if (o.pid === 0 || !isProcessAlive(o.pid)) return false;
    try {
      return Date.now() - fs.statSync(OWNER_FILE).mtimeMs < OWNER_STALE_MS;
    } catch {
      return false;
    }
  }

  function tryClaim(): boolean {
    if (otherIsAlive()) return false;
    if (mine()) return true;
    // Read back to narrow the create race between two instances starting together.
    return write() && mine();
  }

  function refresh() {
    if (mine()) write();
  }

  function release() {
    try {
      if (mine()) fs.unlinkSync(OWNER_FILE);
    } catch {
      /* already gone */
    }
  }

  return { tryClaim, otherIsAlive, refresh, release };
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

// Flatten the several shapes a V2 tool result can take into plain text.
function extractText(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v.text === "string") return v.text;
  if (typeof v.output === "string") return v.output;
  if (typeof v.content === "string") return v.content;
  if (Array.isArray(v.content)) {
    return v.content
      .map((c: any) => (typeof c === "string" ? c : c?.text || ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function planFromTodos(todos: unknown) {
  const list = Array.isArray(todos) ? todos : [];
  const total = list.length;
  if (!total) return;
  const done = list.filter((t: any) => t?.status === "completed").length;
  const active = list.find((t: any) => t?.status === "in_progress")?.content;
  const label = String(active || `${done}/${total} done`);
  if (label === lastTodoLabel) return;
  lastTodoLabel = label;
  logStep("\uD83D\uDCDD", label, "plan");
  emit("working", { tool: "todowrite", detail: truncate(label, 22) });
}

// ---------------------------------------------------------------------------
// State writing (atomic); the real implementation lives in shared/state-protocol
// ---------------------------------------------------------------------------
const writeState = createStateWriter();

// Immediate write (discrete events).
function emit(state: PetState, extra: Record<string, unknown> = {}) {
  pendingState = state;
  pendingExtra = extra;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  writeState(state, extra, feed);
}

// Coalesced write (streaming deltas), at most one every THROTTLE_MS.
function emitThrottled(state: PetState, extra: Record<string, unknown> = {}) {
  pendingState = state;
  pendingExtra = extra;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    writeState(pendingState, pendingExtra, feed);
  }, THROTTLE_MS);
}

// ---------------------------------------------------------------------------
// Launch the Electron overlay (once)
// ---------------------------------------------------------------------------
function readPetPid(): number {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

function petAlreadyRunning(): boolean {
  return isProcessAlive(readPetPid());
}

// Resolve a spawnable Electron binary; see shared/electron-bin.js for why the
// packaged dist binary is preferred over the npm shim on Windows.
function appElectronBin() {
  return resolveElectronBin(APP_DIR);
}

function launchPet() {
  if (process.env.OPENCODE_PET_NO_LAUNCH === "1") return;
  if (petAlreadyRunning()) return;

  const resolved = appElectronBin();
  if (!resolved) {
    // App not installed yet; skip silently. State file still gets written.
    return;
  }

  try {
    const child = spawn(resolved.bin, ["."], {
      cwd: APP_DIR,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: resolved.shell,
      env: { ...process.env },
    });
    // Spawn failures surface as an async 'error' event. Without this handler an
    // ENOENT (for example a stale APP_DIR) would crash the server and the
    // desktop would show "TypeError: Failed to fetch".
    child.on("error", () => {});
    child.unref();
    // The Electron app writes its own real pid to PID_FILE on startup; we don't
    // record the short-lived shim pid here.
  } catch {
    /* ignore launch failures */
  }
}

// ---------------------------------------------------------------------------
// Event handling. V2 events arrive as { id, created, type, location, data }.
// ---------------------------------------------------------------------------
function streamId(kind: string, d: any): string {
  return `${d?.assistantMessageID || "msg"}:${kind}:${d?.ordinal ?? 0}`;
}

function handleEvent(ev: any) {
  if (!ev || !ev.type) return;
  const d = ev.data || {};

  switch (ev.type) {
    // A prompt was accepted: show it and start thinking.
    case "session.inbox.enqueued": {
      const item = d.item || {};
      const text = String(item.text ?? item.prompt ?? "").replace(/\s+/g, " ").trim();
      if (text) logStep("\uD83E\uDDD1", "you: " + text, "you", 80);
      lastTodoLabel = "";
      emit(activeTools > 0 ? "working" : "thinking");
      break;
    }

    // Remember the tool name so the later "called" line can be labelled.
    case "session.tool.input.started":
      if (d.id) callNames.set(d.id, String(d.name || "tool"));
      break;

    case "session.tool.called": {
      activeTools++;
      const tool = callNames.get(d.id) || "tool";
      callNames.delete(d.id);
      if (tool === "todowrite") {
        planFromTodos(d.input?.todos);
        break;
      }
      const detail = summarize(tool, d.input);
      const meta = TOOL_META[tool] || ["\uD83E\uDE84", tool];
      logStep(meta[0], detail ? `${meta[1]} ${detail}` : meta[1], "step");
      emit("working", { tool, detail });
      break;
    }

    case "session.tool.success": {
      activeTools = Math.max(0, activeTools - 1);
      callNames.delete(d.id);
      const line = snippet(extractText(d), 54);
      if (line) logStep("\u21B3", line, "out");
      emit(activeTools > 0 ? "working" : "thinking");
      break;
    }

    case "session.tool.failed": {
      activeTools = Math.max(0, activeTools - 1);
      callNames.delete(d.id);
      const msg = d.error?.message || d.error?.name || snippet(extractText(d), 54) || "tool failed";
      logStep("\uD83D\uDCA5", "error: " + msg, "error");
      emit("error", { detail: truncate(msg, 22) });
      break;
    }

    // Live reasoning / reply, streaming in place.
    case "session.reasoning.started":
      relayStart(streamId("reason", d));
      break;
    case "session.reasoning.delta":
      relayDelta(streamId("reason", d), "\uD83D\uDCAD", "reason", d.delta);
      break;
    case "session.reasoning.ended":
      relayEnd(streamId("reason", d), "\uD83D\uDCAD", "reason", d.text);
      break;

    case "session.text.started":
      relayStart(streamId("say", d));
      break;
    case "session.text.delta":
      relayDelta(streamId("say", d), "\uD83D\uDDE8\uFE0F", "say", d.delta);
      break;
    case "session.text.ended":
      relayEnd(streamId("say", d), "\uD83D\uDDE8\uFE0F", "say", d.text);
      break;

    case "session.status": {
      const status = d.status;
      const kind = typeof status === "string" ? status : status?.type;
      if (kind === "busy" && activeTools === 0) emit("thinking");
      else if (kind === "retry") {
        logStep("\uD83D\uDD01", "retrying\u2026", "wait");
        emit("thinking");
      }
      break;
    }

    case "session.execution.started": {
      emit(activeTools > 0 ? "working" : "thinking");
      break;
    }

    case "session.execution.succeeded": {
      activeTools = 0;
      if (feed[feed.length - 1]?.kind !== "done") logStep("\u2728", "finished", "done");
      emit("happy");
      break;
    }

    case "session.execution.failed": {
      activeTools = 0;
      const msg = d.error?.message || d.error?.name || snippet(extractText(d), 54) || "execution failed";
      logStep("\uD83D\uDCA5", "error: " + msg, "error");
      emit("error", { detail: truncate(msg, 22) });
      break;
    }

    case "session.execution.interrupted": {
      activeTools = 0;
      logStep("\u23F8", "stopped", "wait");
      emit("thinking");
      break;
    }

    case "session.idle":
      activeTools = 0;
      if (feed[feed.length - 1]?.kind !== "done") logStep("\u2728", "finished", "done");
      emit("happy");
      break;

    case "session.error": {
      activeTools = 0;
      const err = d.error;
      const msg = err?.name || err?.message || err?.data?.message || "something broke";
      logStep("\uD83D\uDCA5", "error: " + msg, "error");
      emit("error", { detail: truncate(msg, 22) });
      break;
    }

    case "permission.asked": {
      const title = d.title || d.action || d.permission || d.resource || "needs approval";
      logStep("\u2753", String(title), "wait");
      emit("waiting", { detail: truncate(title, 24) });
      break;
    }

    case "permission.replied":
      emit("thinking");
      break;
  }
}

// ---------------------------------------------------------------------------
// Plugin (V2 default definition: an id plus a setup function)
// ---------------------------------------------------------------------------
export default {
  id: "opencode-pet",

  async setup(ctx: any) {
    const ownership = createOwnership();
    const controller = new AbortController();
    let probeTimer: ReturnType<typeof setInterval> | undefined;
    let ownerTimer: ReturnType<typeof setInterval> | undefined;
    let started = false;
    let stopped = false;
    let probing = false;
    // Whether the pet should be up right now. Flipped only on an actual
    // open/close of the app, so a manual quit sticks until the app reopens.
    let petUp = false;

    // Close the pet now that the app is gone. Deleting the heartbeat and
    // signalling the overlay makes it vanish immediately; the overlay's own
    // stale-heartbeat check is only the 15s fallback for when this never runs.
    // Only signal a pid we have confirmed is still alive, so a stale pet.pid
    // (pet crashed, pid recycled by the OS) cannot make us kill an unrelated
    // process.
    const closePet = () => {
      try {
        fs.unlinkSync(HEARTBEAT_FILE);
      } catch {}
      emit("sleeping");
      const pid = readPetPid();
      if (pid && isProcessAlive(pid)) {
        try {
          process.kill(pid);
        } catch {
          /* already exited between the probe and the signal */
        }
        try {
          fs.unlinkSync(PID_FILE);
        } catch {}
      }
    };

    // Ask the OS whether the app is open, and keep the pet in step. Runs on a
    // timer because the service this plugin lives in never learns when the
    // desktop app closes.
    const probe = async () => {
      if (probing || stopped) return;
      probing = true;
      try {
        // Keep the owner claim fresh; a stale claim lets another instance take over.
        ownership.refresh();
        const present = await desktopAppPresent();
        if (present) {
          beat();
          if (!petUp) {
            // The app opened (or reopened): wake the pet.
            petUp = true;
            logStep("\u2728", "connected", "meta");
            emit("idle");
            launchPet();
          }
        } else if (petUp) {
          // The app closed: leave now.
          petUp = false;
          closePet();
        }
      } finally {
        probing = false;
      }
    };

    const start = () => {
      if (started || stopped) return;
      started = true;

      void probe();
      probeTimer = setInterval(() => {
        void probe();
      }, PROBE_MS);

      const subscribe = ctx?.event?.subscribe;
      if (typeof subscribe !== "function") return;

      void (async () => {
        try {
          for await (const event of subscribe.call(ctx.event, { signal: controller.signal })) {
            handleEvent(event);
          }
        } catch {
          /* stream aborted on shutdown, or the connection dropped */
        }
      })();
    };

    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (probeTimer) clearInterval(probeTimer);
      if (ownerTimer) clearInterval(ownerTimer);
      controller.abort();
      closePet();
      ownership.release();
    };

    if (ownership.tryClaim()) {
      start();
    } else {
      // Secondary instance: wait for the owner to exit, then take over so the
      // pet keeps working when the main window closes.
      ownerTimer = setInterval(() => {
        if (stopped || started) return;
        if (ownership.otherIsAlive()) return;
        if (ownership.tryClaim()) start();
      }, OWNER_CHECK_MS);
    }

    // Cleanup: V2 runs this when the plugin unloads (server shutdown, reload).
    return () => {
      if (ownerTimer) clearInterval(ownerTimer);
      if (started) stop();
      else ownership.release();
    };
  },
};
