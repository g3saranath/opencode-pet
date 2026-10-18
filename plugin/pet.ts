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
import type { Plugin } from "@opencode/plugin";
import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DIR, HEARTBEAT_FILE } from "../shared/paths.js";
import { createStateWriter, type PetState } from "../shared/state-protocol.js";
import { resolveElectronBin, hasElectron } from "../shared/electron-bin.js";
import { isProcessAlive } from "../shared/process-alive.js";
import { readPetPid, closePetProcess } from "../shared/pet-process.js";

// V2 loads this plugin into opencode's long-lived background service, which
// outlives the desktop app: the service keeps running after you close the
// window. So "is opencode connected?" cannot be answered by this process being
// alive; we ask the OS whether the app is open. While it is, the plugin pulses
// a heartbeat and the overlay stays awake as long as it sees a recent pulse.
//
// Probe quickly while the pet is up so closing the app is noticed in ~2s, and
// back off while it is asleep so an idle service is not spawning a process
// every couple of seconds forever.
const PROBE_MS = 2 * 1000;
const IDLE_PROBE_MS = 10 * 1000;

// The overlay naps after 45s without a pulse, so writing the heartbeat (and
// refreshing the owner claim) every 10s is plenty.
const BEAT_MS = 10 * 1000;

// The desktop app's process name per platform. Windows is the only one with a
// known default. Elsewhere there is no verified name, and guessing wrong would
// keep the pet from ever waking (TUI-only users have no desktop process at
// all), so detection is opt-in through OPENCODE_PET_APP_PROCESS and the pet
// otherwise stays awake while opencode runs.
const DEFAULT_APP_PROCESS: Record<string, string> = { win32: "OpenCode.exe" };
const APP_PROCESS = process.env.OPENCODE_PET_APP_PROCESS || DEFAULT_APP_PROCESS[process.platform] || "";

// OPENCODE_PET_DEBUG=1 records event types this plugin does not handle in
// ~/.cache/opencode-pet/debug.log, so a renamed event shows up instead of the
// pet silently going quiet.
const DEBUG = process.env.OPENCODE_PET_DEBUG === "1";
const DEBUG_FILE = path.join(DIR, "debug.log");

// V2 runs setup once per open location. Only the owner of this file drives the
// pet, so two open projects cannot write the state file at the same time and
// make the wizard twitch. A secondary watches the file and takes over if the
// owner's process exits.
const OWNER_FILE = path.join(DIR, "owner.pid");
const OWNER_CHECK_MS = 5 * 1000;

// Where the Electron overlay lives. Honour OPENCODE_PET_DIR first, then fall
// back to the checkout this plugin file actually lives in (following any
// symlink back here), then the usual clone paths.
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

// The bubble's tool and target while a tool is in flight, so streamed reasoning
// during the call does not wipe "editing app.js" back to a generic verb.
let currentTool: Record<string, unknown> = {};

// V2 tool events do not carry the tool name; the name arrives earlier on
// session.tool.input.started, keyed by the same call id. Remember it so the
// "called" line can be labelled. Capped because a call interrupted before
// "called" would otherwise leave its entry behind for the life of the service.
const callNames = new Map<string, string>();
const CALL_NAMES_MAX = 64;

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

// V2 tools arrive with slightly different names depending on the client. Map
// the known aliases back to the canonical names used above so the pet can label
// them, and keep anything unknown as-is (lowercased).
const TOOL_ALIASES: Record<string, string> = {
  apply_patch: "patch",
  shell: "bash",
  terminal: "bash",
  exec: "bash",
  read_file: "read",
  write_file: "write",
  edit_file: "edit",
  list_dir: "list",
  ls: "list",
  web_search: "websearch",
  web_fetch: "webfetch",
};

function normalizeTool(name: unknown): string {
  const raw = String(name ?? "").trim().toLowerCase();
  if (!raw) return "tool";
  return TOOL_ALIASES[raw] || raw;
}

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
  emitThrottled(busyState(), busyExtra());
}

function busyState(): PetState {
  return activeTools > 0 ? "working" : "thinking";
}

function busyExtra(): Record<string, unknown> {
  return activeTools > 0 ? currentTool : {};
}

function resetTools() {
  activeTools = 0;
  currentTool = {};
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
// the OS instead: tasklist on Windows (stock, no admin needed), pgrep -x
// elsewhere. With no process name configured, or no way to ask, we keep the old
// always-awake behaviour rather than guessing.
function desktopAppPresent(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!APP_PROCESS) {
      resolve(true);
      return;
    }
    if (process.platform === "win32") {
      execFile(
        "tasklist",
        ["/FI", `IMAGENAME eq ${APP_PROCESS}`, "/NH"],
        { windowsHide: true },
        (err, stdout) =>
          resolve(!err && String(stdout).toLowerCase().includes(APP_PROCESS.toLowerCase())),
      );
      return;
    }
    // pgrep exits 0 on a match and 1 on none; a missing pgrep stays awake.
    execFile("pgrep", ["-x", APP_PROCESS], (err: any) => {
      if (!err) resolve(true);
      else resolve(typeof err.code !== "number");
    });
  });
}

// ---------------------------------------------------------------------------
// Owner election (see OWNER_FILE above).
//
// V2 can run several setup() calls in the same server process (one per open
// location), so process.pid alone cannot tell two instances apart. Each setup
// gets a random token; the owner file records "<pid>:<token>". The owner
// rewrites it every BEAT_MS, so a file whose mtime has gone stale means the
// owning instance is gone even while the process is still alive. The stale
// window covers a couple of missed refreshes at the slower idle probe rate.
// ---------------------------------------------------------------------------
const OWNER_STALE_MS = 3 * BEAT_MS;

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
// Split a shell command on ; && || | while leaving quoted text alone, so
// `grep "a|b"` or `git commit -m "x && y"` stay one segment.
function splitSegments(cmd: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = "";
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (c === ";" || c === "|") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

// Turn a shell command into a short, human label so the pet does not paste a
// wall of `cd ...; && ...` into the bubble. Prefers the segment that names a
// known tool (npm, git, gh, ...), otherwise the first token.
function bashLabel(cmd: unknown): string {
  const full = String(cmd ?? "").trim();
  if (!full) return "running";
  const segments = splitSegments(full);
  // Skip variable assignments and navigation so `cd X; npm test` and
  // `$p = ...; Get-Content $p` label the real work, not the setup step.
  const SKIP = /^(\$?[\w:\\.-]+\s*=|cd\b|pushd\b|popd\b|set-location\b)/i;
  const pool = segments.filter((s) => !SKIP.test(s));
  const seg = pool[0] || segments[0] || full;
  let tokens = seg.replace(/^&\s*/, "").split(/\s+/);
  if (tokens[0] === "sudo" && tokens.length > 1) tokens = tokens.slice(1);
  const head = tokens[0].toLowerCase();
  const sub = (tokens[1] || "").toLowerCase();

  if (["npm", "npx", "yarn", "pnpm", "bun"].includes(head)) {
    if (sub === "test" || sub === "t") return "testing";
    if (sub === "install" || sub === "i" || sub === "add" || sub === "ci") return "installing";
    if (sub === "build") return "building";
    if (sub === "start" || sub === "dev" || sub === "serve") return "starting";
    if (sub === "lint") return "linting";
    if (head === "npx") {
      if (sub === "tsc") return "type-checking";
      if (["vitest", "jest", "pytest"].includes(sub)) return "testing";
      if (sub === "eslint") return "linting";
      if (sub === "prettier") return "formatting";
    }
    if (sub === "run") {
      const script = (tokens[2] || "").toLowerCase();
      if (script === "build" || script === "compile") return "building";
      if (script === "test") return "testing";
      if (script === "dev" || script === "start" || script === "serve") return "starting";
      if (script === "lint") return "linting";
      if (script === "typecheck" || script === "type-check") return "type-checking";
      return "running " + (script || "script");
    }
    return "running " + (sub || head);
  }
  if (head === "git") {
    if (sub === "commit") return "committing";
    if (sub === "push") return "pushing";
    if (sub === "pull" || sub === "fetch") return "pulling";
    if (sub === "status") return "checking status";
    if (sub === "diff") return "diffing";
    if (sub === "checkout" || sub === "switch") return "switching branch";
    if (sub === "merge" || sub === "rebase") return "merging";
    if (sub === "log") return "reading history";
    if (sub === "clone") return "cloning";
    return "git " + (sub || "command");
  }
  if (head === "gh") {
    if (sub === "pr") {
      const action = (tokens[2] || "").toLowerCase();
      if (action === "create") return "opening PR";
      if (action === "edit") return "editing PR";
      if (action === "merge") return "merging PR";
      if (action === "view") return "viewing PR";
      if (action === "list") return "listing PRs";
      return "PR " + (action || "task");
    }
    if (sub === "issue") return "managing issue";
    if (sub === "run") return "checking CI";
    if (sub === "repo") return "repo task";
    return "running gh";
  }
  if (["node", "deno", "bun"].includes(head)) return "running " + head;
  if (["python", "python3", "py"].includes(head)) return "running python";
  if (["pip"].includes(head)) return "installing packages";
  if (head === "uv") {
    if (sub === "run") return "running python";
    if (sub === "sync" || sub === "add" || sub === "pip") return "installing packages";
    return "running uv";
  }
  if (head === "cargo") {
    if (sub === "test") return "testing";
    if (sub === "build" || sub === "check") return "building";
    if (sub === "run") return "running";
    if (sub === "clippy" || sub === "fmt") return "checking code";
    return "cargo " + (sub || "task");
  }
  if (head === "go") {
    if (sub === "test") return "testing";
    if (sub === "build") return "building";
    if (sub === "run") return "running";
    if (sub === "mod") return "managing modules";
    return "go " + (sub || "task");
  }
  if (["docker", "docker-compose"].includes(head)) {
    if (sub === "build" || tokens[1] === "compose" && tokens[2] === "build") return "building image";
    if (sub === "compose") {
      const action = (tokens[2] || "").toLowerCase();
      if (action === "up") return "starting containers";
      if (action === "down") return "stopping containers";
      if (action === "logs") return "reading logs";
      return "compose " + (action || "task");
    }
    if (sub === "ps") return "listing containers";
    if (sub === "logs") return "reading logs";
    if (sub === "exec") return "entering container";
    return "docker " + (sub || "task");
  }
  if (head === "kubectl") {
    if (sub === "get") return "reading cluster";
    if (sub === "apply") return "applying config";
    if (sub === "logs") return "reading logs";
    if (sub === "describe") return "inspecting";
    if (sub === "delete") return "removing resource";
    return "kubectl " + (sub || "task");
  }
  if (head === "make") return "building";
  if (["cd", "pushd", "popd"].includes(head)) return "navigating";
  if (["ls", "dir"].includes(head)) return "listing files";
  if (["rm", "del", "rmdir"].includes(head)) return "removing";
  if (["cp", "copy"].includes(head)) return "copying";
  if (["mv", "move"].includes(head)) return "moving";
  if (head === "mkdir") return "creating folder";
  if (["curl", "wget", "invoke-webrequest", "iwr"].includes(head)) return "fetching";
  if (["cat", "type", "less", "more"].includes(head)) return "reading";
  if (["echo", "write-output"].includes(head)) return "writing";
  if (head === "tsc") return "type-checking";
  if (["vitest", "jest", "pytest"].includes(head)) return "testing";
  if (head === "eslint") return "linting";
  if (head === "prettier") return "formatting";
  // PowerShell cmdlets (Windows default shell). Matched case-insensitively
  // because the head is lowercased above.
  const PS: Record<string, string> = {
    "get-childitem": "listing files", gci: "listing files",
    "get-content": "reading", gc: "reading",
    "set-content": "writing", "out-file": "writing", "add-content": "writing",
    "select-string": "searching", sls: "searching",
    "foreach-object": "processing", "where-object": "filtering",
    "select-object": "selecting", "sort-object": "sorting",
    "group-object": "grouping", "measure-object": "measuring",
    "compare-object": "comparing",
    "join-path": "resolving path", "resolve-path": "resolving path",
    "test-path": "checking path",
    "new-item": "creating", "remove-item": "removing",
    "copy-item": "copying", "move-item": "moving",
    "get-item": "reading", "get-itemproperty": "reading",
    "write-host": "writing", "write-output": "writing", "write-error": "writing",
    "invoke-webrequest": "fetching", "invoke-restmethod": "fetching",
    "start-process": "starting", "stop-process": "stopping", kill: "stopping",
    "get-process": "checking processes", "get-service": "checking services",
    "get-command": "looking up command", "get-help": "reading help",
    "convertfrom-json": "parsing json", "convertto-json": "writing json",
  };
  if (PS[head]) return PS[head];
  // Scripts run by path read better by file name: ./scripts/deploy.sh -> deploy.sh
  return "running " + truncate(head.split(/[\\/]/).pop() || head, 14);
}

// Raw command shown in the activity feed (the bubble gets the friendly label).
function bashSnippet(cmd: unknown): string {
  return truncate(String(cmd ?? "").replace(/\s+/g, " ").trim(), 54);
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
      return bashLabel(args.command || args.cmd);
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

const seenUnhandled = new Set<string>();

function logUnhandled(type: string) {
  if (!DEBUG || seenUnhandled.has(type)) return;
  seenUnhandled.add(type);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(DEBUG_FILE, `${new Date().toISOString()} unhandled event: ${type}\n`);
  } catch {
    /* best effort */
  }
}

function handleEvent(ev: any) {
  if (!ev || !ev.type) return;
  const d = ev.data || {};

  switch (ev.type) {
    // A prompt was accepted: show it and start thinking. The prompt text lives
    // on the inbox item's payload (Session.Inbox.UserPayload).
    case "session.inbox.enqueued": {
      const item = d.item || {};
      const raw = !item.type || item.type === "user" ? (item.payload?.text ?? item.text ?? "") : "";
      const text = String(raw).replace(/\s+/g, " ").trim();
      if (text) logStep("\uD83E\uDDD1", "you: " + text, "you", 80);
      lastTodoLabel = "";
      emit(busyState(), busyExtra());
      break;
    }

    // Remember the tool name so the later "called" line can be labelled.
    case "session.tool.input.started":
      if (d.id) {
        if (callNames.size >= CALL_NAMES_MAX) callNames.delete(callNames.keys().next().value as string);
        callNames.set(d.id, normalizeTool(d.name));
      }
      break;

    case "session.tool.called": {
      activeTools++;
      const tool = normalizeTool(d.name || callNames.get(d.id));
      callNames.delete(d.id);
      if (tool === "todowrite") {
        planFromTodos(d.input?.todos);
        break;
      }
      const detail = summarize(tool, d.input);
      const meta = TOOL_META[tool] || ["\uD83E\uDE84", tool];
      // Feed keeps the real command; the bubble gets the short friendly label.
      const feedText =
        tool === "bash"
          ? bashSnippet(d.input?.command || d.input?.cmd)
          : detail
            ? `${meta[1]} ${detail}`
            : meta[1];
      logStep(meta[0], feedText, "step");
      currentTool = { tool, detail };
      emit("working", currentTool);
      break;
    }

    case "session.tool.success": {
      activeTools = Math.max(0, activeTools - 1);
      if (activeTools === 0) currentTool = {};
      callNames.delete(d.id);
      const line = snippet(extractText(d), 54);
      if (line) logStep("\u21B3", line, "out");
      emit(busyState(), busyExtra());
      break;
    }

    case "session.tool.failed": {
      activeTools = Math.max(0, activeTools - 1);
      if (activeTools === 0) currentTool = {};
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
      emit(busyState(), busyExtra());
      break;
    }

    case "session.execution.succeeded": {
      resetTools();
      if (feed[feed.length - 1]?.kind !== "done") logStep("\u2728", "finished", "done");
      emit("happy");
      break;
    }

    case "session.execution.failed": {
      resetTools();
      const msg = d.error?.message || d.error?.name || snippet(extractText(d), 54) || "execution failed";
      logStep("\uD83D\uDCA5", "error: " + msg, "error");
      emit("error", { detail: truncate(msg, 22) });
      break;
    }

    // The user stopped the turn; nothing more is coming, so rest rather than
    // sit on "thinking" until the next prompt.
    case "session.execution.interrupted": {
      resetTools();
      logStep("\u23F8", "stopped", "wait");
      emit("idle");
      break;
    }

    case "session.idle":
      resetTools();
      if (feed[feed.length - 1]?.kind !== "done") logStep("\u2728", "finished", "done");
      emit("happy");
      break;

    case "session.error": {
      resetTools();
      const err = d.error;
      const msg = err?.name || err?.message || err?.data?.message || "something broke";
      logStep("\uD83D\uDCA5", "error: " + msg, "error");
      emit("error", { detail: truncate(msg, 22) });
      break;
    }

    // Permission.Request carries an optional message, the action (shell, edit,
    // ...) and the resources it applies to.
    case "permission.asked": {
      const resource = Array.isArray(d.resources) ? d.resources[0] : "";
      const asked = d.action ? `allow ${d.action}${resource ? " " + resource : ""}?` : "";
      const title = String(d.message || asked || "needs approval");
      logStep("\u2753", title, "wait");
      emit("waiting", { detail: truncate(title, 24) });
      break;
    }

    case "permission.replied":
      emit(busyState(), busyExtra());
      break;

    default:
      logUnhandled(String(ev.type));
  }
}

// ---------------------------------------------------------------------------
// OpenCode V1 state.
//
// V1 (opencode 1.x >= 1.18.29) has no ctx and no event subscription: it loads
// one object of string-keyed hooks. Only one entry point runs for a given
// opencode version, and the two share the helper layer above but keep their own
// live state so they can never interfere even if that ever changes.
// ---------------------------------------------------------------------------
const V1_HEARTBEAT_MS = 15 * 1000;
let v1HeartbeatTimer: ReturnType<typeof setInterval> | undefined;
let v1UserMsgId: string | null = null;

// Streamed text. V1 sends the full part on message.part.updated (the part
// boundary) and the next chunk on message.part.delta for the same part id. We
// remember each part's kind from its boundary, append deltas, and render the
// line in place. Boundary updates replace the buffered text instead of
// appending, so a late full snapshot cannot double the text.
const v1Parts = new Map<string, { kind: "say" | "reason"; text: string }>();

function v1PartKind(type: unknown): "say" | "reason" | null {
  if (type === "reasoning") return "reason";
  if (type === "text") return "say";
  return null;
}

function v1RenderPart(partID: string) {
  const part = v1Parts.get(partID);
  if (!part) return;
  const raw = part.text.replace(/\s+/g, " ").trim();
  if (!raw) return;
  const icon = part.kind === "reason" ? "\uD83D\uDCAD" : "\uD83D\uDDE8\uFE0F";
  streamLine(partID, icon, part.kind, tail(raw));
  emitThrottled(busyState(), busyExtra());
}

// Part boundary: the whole part arrives, so replace any text we had buffered.
function v1PartUpdated(part: any) {
  if (!part || !part.id) return;
  const kind = v1PartKind(part.type);
  if (!kind) return; // tool / step / file parts are relayed elsewhere
  if (part.synthetic || part.ignored) return;
  if (v1UserMsgId && part.messageID === v1UserMsgId) return; // don't echo the prompt
  v1Parts.set(part.id, { kind, text: String(part.text ?? "") });
  v1RenderPart(part.id);
}

// Streamed chunk: append to the part we already know. Only the text field is
// relayed, and deltas for an unknown part are ignored rather than guessed.
function v1PartDelta(props: any) {
  if (props?.field !== "text") return;
  const partID = props?.partID;
  const part = partID ? v1Parts.get(partID) : undefined;
  if (!part) return;
  if (v1UserMsgId && props.messageID === v1UserMsgId) return;
  part.text += String(props.delta ?? "");
  v1RenderPart(partID);
}

// V1 asks for approval with a `permission` name plus `patterns` (see OpenCode
// 1.x PermissionV1.Request). Older builds used a `title` on permission.updated,
// kept here as a fallback so either event labels the bubble. The label mirrors
// the V2 style ("allow shell npm test?").
function permissionLabel(props: any): string {
  const permission = String(props?.permission ?? "").trim();
  const pattern = Array.isArray(props?.patterns) ? String(props.patterns[0] ?? "").trim() : "";
  const asked = permission ? `allow ${permission}${pattern ? " " + pattern : ""}?` : "";
  const title = String(props?.title ?? "").trim();
  return asked || title || "needs approval";
}

// ---------------------------------------------------------------------------
// Plugin: an id, the V2 setup(), and the V1 server(). opencode 2.x calls
// setup(); opencode 1.x (>= 1.18.29) calls server(). Only one runs.
// ---------------------------------------------------------------------------
export { bashLabel };

const petPlugin = {
  id: "opencode-pet",

  async setup(ctx: Plugin.Context) {
    const ownership = createOwnership();
    const controller = new AbortController();
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    let ownerTimer: ReturnType<typeof setInterval> | undefined;
    let started = false;
    let stopped = false;
    let lastBeat = 0;
    let lastOwnerRefresh = 0;
    // Whether the pet should be up right now. Flipped only on an actual
    // open/close of the app, so a manual quit sticks until the app reopens.
    let petUp = false;

    // Stop pulsing so the overlay naps (and quits ~15s later) if nobody takes
    // over. Used on unload, where a reload would otherwise kill the pet only to
    // relaunch it a moment later.
    const releasePet = () => {
      try {
        fs.unlinkSync(HEARTBEAT_FILE);
      } catch {}
      lastBeat = 0;
      emit("sleeping");
    };

    // Close the pet now that the app is gone. Deleting the heartbeat and
    // signalling the overlay makes it vanish immediately; the overlay's own
    // stale-heartbeat check (45s to nap, then 15s to quit) is only the fallback
    // for when this never runs. The shared helper only signals a pid it has
    // confirmed is still alive, so a stale pet.pid cannot kill an unrelated
    // process.
    const closePet = () => {
      releasePet();
      closePetProcess();
    };

    // Ask the OS whether the app is open, and keep the pet in step. Runs on a
    // timer because the service this plugin lives in never learns when the
    // desktop app closes. Each probe schedules the next, quickly while the pet
    // is up and slowly while it is asleep, so probes never overlap.
    const probe = async () => {
      if (stopped) return;
      try {
        const now = Date.now();
        // Keep the owner claim fresh; a stale claim lets another instance take over.
        if (now - lastOwnerRefresh >= BEAT_MS) {
          ownership.refresh();
          lastOwnerRefresh = now;
        }
        const present = await desktopAppPresent();
        if (stopped) return;
        if (present) {
          if (Date.now() - lastBeat >= BEAT_MS) {
            beat();
            lastBeat = Date.now();
          }
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
        if (!stopped) probeTimer = setTimeout(probe, petUp ? PROBE_MS : IDLE_PROBE_MS);
      }
    };

    const start = () => {
      if (started || stopped) return;
      started = true;

      void probe();

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
      if (probeTimer) clearTimeout(probeTimer);
      if (ownerTimer) clearInterval(ownerTimer);
      controller.abort();
      // Unload covers both a full shutdown and a plugin reload. Only stop
      // pulsing here: on a reload the next instance resumes within a probe and
      // the pet stays up; on shutdown the overlay naps and quits by itself.
      releasePet();
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

  // -------------------------------------------------------------------------
  // OpenCode V1 entry point.
  //
  // opencode 1.x loads the default export's server() and uses the string-keyed
  // hooks it returns. There is no ctx, no event subscription, and no desktop-app
  // follow: the plugin lives and dies with the session, so it just pulses a
  // heartbeat and relays the events it is handed. The state and helpers above
  // (logStep, emit, launchPet, summarize, streamLine, ...) are reused as-is;
  // only the event wiring and lifecycle differ from setup().
  // -------------------------------------------------------------------------
  async server() {
    // Wake the pet the moment opencode connects.
    beat();
    logStep("\u2728", "connected", "meta");
    emit("idle");
    launchPet();
    if (v1HeartbeatTimer) clearInterval(v1HeartbeatTimer);
    v1HeartbeatTimer = setInterval(beat, V1_HEARTBEAT_MS);

    return {
      // A user prompt / model turn kicked off.
      "chat.message": async (input: any, output: any) => {
        v1UserMsgId = input?.messageID || output?.message?.id || null;
        const parts: any[] = output?.parts || [];
        const text = parts
          .filter((p) => p && p.type === "text" && p.text)
          .map((p) => p.text)
          .join(" ")
          .trim();
        if (text) logStep("\uD83E\uDDD1", "you: " + text, "you", 80);
        lastTodoLabel = "";
        emit(busyState(), busyExtra());
      },

      "tool.execute.before": async (input: any, output: any) => {
        activeTools++;
        const tool = normalizeTool(input?.tool);
        const args = output?.args;
        if (tool === "todowrite") {
          planFromTodos(args?.todos);
          return;
        }
        const detail = summarize(tool, args);
        const meta = TOOL_META[tool] || ["\uD83E\uDE84", tool];
        // Feed keeps the real command; the bubble gets the short friendly label.
        const feedText =
          tool === "bash"
            ? bashSnippet(args?.command || args?.cmd)
            : detail
              ? `${meta[1]} ${detail}`
              : meta[1];
        logStep(meta[0], feedText, "step");
        currentTool = { tool, detail };
        emit("working", currentTool);
      },

      "tool.execute.after": async (_input: any, output: any) => {
        activeTools = Math.max(0, activeTools - 1);
        if (activeTools === 0) currentTool = {};
        const line = snippet(extractText(output?.output ?? output), 54);
        if (line) logStep("\u21B3", line, "out");
        emit(busyState(), busyExtra());
      },

      event: async ({ event }: any) => {
        const props = event?.properties || {};
        switch (event?.type) {
          case "message.part.updated":
            v1PartUpdated(props.part);
            break;
          case "message.part.delta":
            v1PartDelta(props);
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
          case "todo.updated":
            planFromTodos(props.todos);
            break;
          case "session.idle":
            resetTools();
            if (feed[feed.length - 1]?.kind !== "done") logStep("\u2728", "finished", "done");
            emit("happy");
            break;
          case "session.error": {
            resetTools();
            const err = props.error;
            const msg = err?.name || err?.data?.message || "something broke";
            logStep("\uD83D\uDCA5", "error: " + msg, "error");
            emit("error", { detail: truncate(msg, 22) });
            break;
          }
          case "permission.asked":
          case "permission.updated": {
            const label = permissionLabel(props);
            logStep("\u2753", label, "wait");
            emit("waiting", { detail: truncate(label, 24) });
            break;
          }
          case "permission.replied":
            emit(busyState(), busyExtra());
            break;
        }
      },

      // opencode is shutting down: stop the heartbeat and close the overlay
      // now, exactly like V2. Without the pid signal the overlay lingers ~15s
      // after opencode 1 exits.
      dispose: async () => {
        if (v1HeartbeatTimer) clearInterval(v1HeartbeatTimer);
        v1HeartbeatTimer = undefined;
        closePetProcess();
        emit("sleeping");
      },
    };
  },
} satisfies Plugin.Plugin & { server(): Promise<Record<string, unknown>> };

export default petPlugin;
