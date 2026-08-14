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
  `✏️ token.ts`, `⚙️ npm test`, `🔍 TODO`, `📝 3/5 done`, `❓ allow bash?`.
- **Custom per-mode art.** Distinct artwork for thinking, working, and sleeping,
  with a mood colour-grade and its own flight motion.
- **Auto wake / sleep.** Wakes the moment opencode connects (heartbeat), stays
  awake while it runs, naps when it disconnects.
- **Stays put & draggable.** Sits where you leave him; drag to reposition
  (remembered across restarts).
- **Sound, sizing, and a right-click menu.** Completion chime (mutable), four
  sizes, toggle the log, reset position, quit.

## 🛠 How it works

```
opencode ──(plugin)──► ~/.cache/opencode-pet/state.json ──(watch)──► Electron overlay
```

- **`plugin/pet.ts`** - an opencode plugin (Node built-ins only). It hooks into
  session / tool / message events, keeps a rolling relay of the recent steps and
  the streaming reasoning/response, and writes it (throttled) to a small state
  file. It also pulses a heartbeat and launches the overlay.
- **`app/`** - a transparent, always-on-top Electron window. The character is a
  raster sprite animated with CSS; each mood swaps the sprite and layers motion,
  a colour-grade, and overlays. Click-through everywhere except the character.

The overlay and plugin talk only through files in `~/.cache/opencode-pet/`, so
there are no ports and nothing to configure.

## Install

Requires [Node.js](https://nodejs.org) and [opencode](https://opencode.ai).

```sh
git clone https://github.com/g3saranath/opencode-pet.git ~/opencode-pet
cd ~/opencode-pet
npm install                                     # downloads Electron

# register the plugin with opencode (global)
mkdir -p ~/.config/opencode/plugin
ln -sf ~/opencode-pet/plugin/pet.ts ~/.config/opencode/plugin/pet.ts
```

Then **restart opencode**. Scrybe appears automatically and starts relaying the
session. (Plugins load only at startup, so restart after any change.)

> Prefer not to auto-launch on session start? Set `OPENCODE_PET_NO_LAUNCH=1` and
> run the overlay yourself with `npm start`.

## Controls

| Action        | How                                                     |
| ------------- | ------------------------------------------------------- |
| Move          | Left-click and drag                                     |
| Menu          | **Right-click** - Size, Mute, Activity log, Reset, Quit |
| Resize        | Right-click ▸ Size ▸ Small / Medium / Large / Huge      |
| Mute sounds   | Right-click ▸ Mute sounds                               |
| Show/hide log | Right-click ▸ Show activity log                         |
| Quit          | Right-click ▸ Quit, or `Ctrl`+`Alt`+`P`                 |
| Run manually  | `npm start`                                             |

## Configuration

| Variable                   | Effect                                                             |
| -------------------------- | ----------------------------------------------------------------- |
| `OPENCODE_PET_DIR`         | Path to this checkout (auto-detected: `~/opencode-pet`)           |
| `OPENCODE_PET_NO_LAUNCH=1` | Don't auto-launch the overlay from the plugin                     |

Runtime files live in `~/.cache/opencode-pet/`: `state.json` (current relay),
`heartbeat` (connection pulse), `pet.pid` (overlay pid), `pos.json` (position),
`config.json` (size / mute / log preferences).

## Swapping the art

The character lives in `app/renderer/` as `sprite.png` (idle / fallback) plus
`sprite-thinking.png`, `sprite-working.png`, and `sprite-sleeping.png`. Each is
used for its state and falls back to `sprite.png` when absent. Drop in your own
square, transparent-background PNGs with the same names and restart the overlay.

## Platform

Built and tested on macOS (Apple Silicon). It uses standard Electron overlay
APIs, so Linux / Windows should work with minor tweaks - PRs welcome.

## Contributing

Issues and PRs are welcome. The code is deliberately small and dependency-light
(one Electron dependency for the app; the plugin uses only Node built-ins).

## License

[MIT](LICENSE) © g3saranath

## Notice

The bundled character art is fan art of a well-known wizard-on-a-broom character.
This project is **not affiliated with, endorsed by, or associated with** Warner
Bros., J.K. Rowling, or the Harry Potter franchise, and is shared for
non-commercial, personal use only. All related trademarks and copyrights belong
to their respective owners. Swap in your own artwork (see **Swapping the art**)
if you prefer.
