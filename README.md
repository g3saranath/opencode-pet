<div align="center">

# Opencode Scrybe Pet

**A desktop pet for [opencode](https://opencode.ai) that _scries_ your session and _scribes_ it live.**

A little wizard on a broom perches on top of your screen and shows what your
agent is doing, in real time - streaming reasoning and replies, every tool call
and its output, plans, permissions, and the final result. He reacts as work
happens and dozes off when opencode isn't running.

<img src="assets/hero.png" width="330" alt="Scrybe Pet relaying a live opencode session" />

</div>

## Modes

The character itself changes with the work - not just a badge on top.

<div align="center">
<table>
  <tr>
    <td align="center" width="25%"><img src="assets/mode-idle.png" width="190" alt="idle" /></td>
    <td align="center" width="25%"><img src="assets/mode-thinking.png" width="190" alt="thinking" /></td>
    <td align="center" width="25%"><img src="assets/mode-working.png" width="190" alt="working" /></td>
    <td align="center" width="25%"><img src="assets/mode-sleeping.png" width="190" alt="sleeping" /></td>
  </tr>
  <tr>
    <td align="center"><b>idle</b><br/><sub>calm hover</sub></td>
    <td align="center"><b>thinking</b><br/><sub>eyes up, pondering</sub></td>
    <td align="center"><b>working</b><br/><sub>heads-down + live action</sub></td>
    <td align="center"><b>sleeping</b><br/><sub>opencode disconnected</sub></td>
  </tr>
</table>
</div>

## Features

- **Live relay.** A transcript panel streams the session as it happens - your
  prompt, the model's **reasoning** and **response** (streaming, updating in
  place), each tool call with its target, and the tool **output**.
- **Live status bubble.** The current action + target at a glance:
  `✏️ token.ts`, `⚙️ testing`, `🔍 TODO`, `📝 3/5 done`, `❓ allow shell npm test?`.
  Shell commands get short labels (`npm test` → testing, `git commit` →
  committing, `gh pr edit` → editing PR) while the log keeps the real command,
  and with nothing specific to show he cycles through wizard verbs (casting,
  conjuring, scrying, …).
- **Custom per-mode art.** Distinct artwork for thinking, working, and sleeping,
  with a mood colour-grade and its own flight motion.
- **Auto wake / sleep.** Follows the desktop app, not the background service.
  The pet appears when you open the app, vanishes when you close it, and comes
  back when you reopen it. Automatic on Windows; on macOS and Linux it needs
  `OPENCODE_PET_APP_PROCESS` (see [Platform](#platform)), otherwise the pet
  stays awake while opencode runs. The stale-heartbeat timeout is only the
  fallback if the plugin cannot close it first.
- **Stays put & draggable.** Sits where you leave him; drag to reposition
  (remembered across restarts).
- **Sound, sizing, and a right-click menu.** Completion chime (mutable), four
  sizes, toggle the log, reset position, quit.

## How it works

```
opencode ──(plugin)──► ~/.cache/opencode-pet/state.json ──(watch)──► Electron overlay
```

- **`plugin/pet.ts`** - an opencode plugin (Node built-ins plus this repo's
  `shared/` modules). It hooks into
  session / tool / message events, keeps a rolling relay of the recent steps and
  the streaming reasoning/response, and writes it (throttled) to a small state
  file. While the desktop app is open it pulses a heartbeat and launches the
  overlay; when the app closes it deletes the heartbeat and closes the pet.
- **`app/`** - a transparent, always-on-top Electron window. The character is a
  raster sprite animated with CSS; each mood swaps the sprite and layers motion,
  a colour-grade, and overlays. Click-through everywhere except the character.

The overlay and plugin talk only through files in `~/.cache/opencode-pet/`, so
there are no ports and nothing to configure.

## Install

Requires [opencode](https://opencode.ai) and
[Node.js](https://nodejs.org) 22.18 or newer. The plugin ships both plugin
contracts from one file, and opencode picks the right entry point on its own:

- **opencode 2.x** loads the V2 entry point (`setup(ctx)`).
- **opencode 1.x (1.18.29 or newer)** loads the V1 entry point (`server()` with
  string-keyed hooks). Below 1.18.29 the object entrypoint is not supported.

```sh
git clone https://github.com/g3saranath/opencode-pet.git ~/opencode-pet
cd ~/opencode-pet
npm install                                     # downloads Electron
```

> `npm install` fetches the Electron app through this project's `postinstall`
> script. If you install with `--ignore-scripts`, Electron downloads itself the
> first time the overlay starts instead.

**opencode 2.x** - add the plugin's absolute path to `plugins` in your global
config, `~/.config/opencode/opencode.jsonc` (create the file if it doesn't
exist):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/Users/you/opencode-pet/plugin/pet.ts"],
}
```

On Windows, use a `file://` URL with forward slashes, for example
`"file:///D:/Projects/opencode-pet/plugin/pet.ts"`.

**opencode 1.x** - add the plugin's absolute path to `plugin` (singular) in the
V1 global config, `~/.config/opencode/opencode.json` (create the file if it
doesn't exist):

```jsonc
{
  "plugin": ["/Users/you/opencode-pet/plugin/pet.ts"],
}
```

On Windows, use the same kind of path with forward slashes, for example
`"D:/Projects/opencode-pet/plugin/pet.ts"`.

Then **restart opencode** so it loads the plugin. Quit and relaunch it, or run
`opencode service restart` to restart the background server. Scrybe appears
automatically and starts relaying the session.

> **Point at the clone, don't copy.** `plugin/pet.ts` imports this repo's
> `shared/` modules, so the config entry must point at the file inside your
> clone. Copying `pet.ts` on its own into the plugin directory will fail to
> load.

> Prefer not to auto-launch the overlay? Set `OPENCODE_PET_NO_LAUNCH=1` and
> run it yourself with `npm start`.

### Version support

Both entry points drive the same overlay and the same state file. The V2 entry
point adds desktop-app follow (wake when the desktop app opens, close when it
closes, reopen included). opencode 1.x has no long-lived background service, so
the V1 entry point keeps the older behaviour: the pet is awake while opencode is
running and naps when it disconnects. On 1.x the desktop-app follow and the
multi-window owner election do not apply.

## Controls

| Action        | How                                                     |
| ------------- | ------------------------------------------------------- |
| Move          | Left-click and drag                                     |
| Menu          | **Right-click** - Size, Mute, Activity log, Reset, Quit pet |
| Resize        | Right-click ▸ Size ▸ Small / Medium / Large / Huge      |
| Mute sounds   | Right-click ▸ Mute sounds                               |
| Show/hide log | Right-click ▸ Show activity log                         |
| Quit          | Right-click ▸ Quit pet, or `Ctrl`+`Alt`+`Shift`+`P`     |
| Run manually  | `npm start`                                             |

## Configuration

| Variable                   | Effect                                                             |
| -------------------------- | ----------------------------------------------------------------- |
| `OPENCODE_PET_DIR`         | Path to this checkout (defaults to the checkout the plugin lives in) |
| `OPENCODE_PET_NO_LAUNCH=1` | Don't auto-launch the overlay from the plugin                     |
| `OPENCODE_PET_APP_PROCESS` | Desktop app process name to follow for wake / sleep (default `OpenCode.exe` on Windows, off elsewhere) |
| `OPENCODE_PET_DEBUG=1`     | Log event types the plugin doesn't handle to `debug.log`          |

Runtime files live in `~/.cache/opencode-pet/`: `state.json` (current relay),
`heartbeat` (connection pulse), `owner.pid` (which plugin instance drives the
pet), `pet.pid` (overlay pid), `pos.json` (position), `config.json` (size / mute /
log preferences), and `debug.log` (only with `OPENCODE_PET_DEBUG=1`).

## For AI agents and other IDEs

Built for OpenCode, but the overlay is just a file watcher. Any agent or IDE
can drive the wizard by writing the same two files in `~/.cache/opencode-pet/`:

- `state.json`: `{ state, feed }` where `state` is one of
  `idle | thinking | working | waiting | happy | error | sleeping` and `feed`
  is an array of `{ seq, icon, text, kind }`. See `shared/state-protocol.js`
  as the reference (atomic write via `state.json.tmp` rename, deduped, with `ts`).
- `heartbeat`: `"<timestamp> <pid>"` updated every few seconds while the agent
  is alive. Delete it and write `state: sleeping` on shutdown so the pet
  naps and then quits.

Minimal example (adjust the path to point at your clone):

```js
const { createStateWriter } = require("/path/to/opencode-pet/shared/state-protocol");
const writeState = createStateWriter();
writeState("working", { detail: "edit token.ts" },
  [{ seq: 1, icon: "\u270F\uFE0F", text: "edit token.ts", kind: "step" }]);
```

The `heartbeat` pid is used to tell whose pulse it is: the overlay checks that
the process is still alive, so a crashed agent can't keep the pet awake by
leaving a fresh timestamp behind. Write your own `process.pid` there.

No ports or extra config. Just write the files and the wizard reacts. PRs for
other adapters are welcome.

## Swapping the art

The character lives in `app/renderer/` as `sprite.png` (idle / fallback) plus
`sprite-thinking.png`, `sprite-working.png`, and `sprite-sleeping.png`. Each is
used for its state and falls back to `sprite.png` when absent. Drop in your own
square, transparent-background PNGs with the same names and restart the overlay.

## Platform

Built on macOS (Apple Silicon) and also tested on Windows. It uses standard
Electron overlay APIs, so Linux should work with minor tweaks - PRs welcome.
The overlay runs on Electron 44, which needs macOS 13 or newer, or 64-bit
Windows or Linux.

Auto wake / sleep checks whether the desktop app's process is running. On
Windows it looks for `OpenCode.exe` out of the box. On macOS and Linux, set
`OPENCODE_PET_APP_PROCESS` to the app's exact process name (matched with
`pgrep -x`) to turn it on. Without it, the pet stays awake while opencode runs
and won't vanish when you close the app. That's also the right setting if you
only use the terminal client, since there is no desktop process to follow.

If the plugin can't close the pet itself, the overlay naps about 45 seconds
after the last heartbeat and quits 15 seconds after that.

## Contributing

Issues and PRs are welcome. The code is deliberately small and dependency-light
(one Electron dependency for the app; the plugin uses only Node built-ins plus
this repo's `shared/` modules - no npm packages at runtime). Run `npm test`
before sending a PR.

## License

[MIT](LICENSE) © g3saranath

## Notice

The bundled character art is fan art of a well-known wizard-on-a-broom character.
This project is **not affiliated with, endorsed by, or associated with** Warner
Bros., J.K. Rowling, or the Harry Potter franchise, and is shared for
non-commercial, personal use only. All related trademarks and copyrights belong
to their respective owners. Swap in your own artwork (see **Swapping the art**)
if you prefer.
