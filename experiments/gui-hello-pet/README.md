# Phase 0 experiment: Hello Pet GUI plugin

Phase 0 spike for the OpenCode Pet GUI plugin migration. This folder is separate from the real pet code and can be deleted at any time.

It proves three SDK surfaces inside OpenCode Desktop:

1. A compact `Hello Pet` badge at the bottom-right of the window, in the `window.bottom` slot.
2. A `Pet` settings page with a show/hide toggle and a live state line.
3. A `/pet` command that toggles the badge, plus `/pet on` and `/pet off`.

The badge reads the existing pet state file through a small main entry. It does not start the Electron overlay and does not touch the server plugin.

## Why the UI was invisible (root cause)

The plugin code and the bundle were already correct. The app never loaded the plugin.

OpenCode Desktop shows the GUI plugins that the OpenCode server reports. The server collects them from the `plugins` array in the config and from plugin files inside the config's plugin folders. This experiment was in neither place. The app's plugin list held the built-in plugins plus `opencode-pet` from `~/.config/opencode/plugin/`, but no `opencode-pet-hello-gui` entry, so the app had nothing to show.

The "Experimental" settings page with "New icons" and "New model picker" is built into OpenCode Desktop. It comes from the app, not from this plugin.

The fix is one config entry (see [Load locally](#load-locally) below):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/absolute/path/to/opencode-pet/experiments/gui-hello-pet"
  ]
}
```

Back up your global config (`~/.config/opencode/opencode.json`) before editing it.

## Why the page vanished a second time

After the config fix, the desktop window still rejected the bundle. Its log said:

```
[plugin] opencode-pet-hello-gui TypeError: os__namespace.homedir is not a function
```

The window host evaluates the same bundle with inert stubs for Node modules. The old code ran `path.join(os.homedir(), ...)` at the top level, before the plugin could register anything. That one call threw, so the whole GUI disappeared.

The fix moves all Node access inside the main entry, which has real Node access. The window never touches the file system. It reads the state through the Ipc channel instead. Two log lines now make the next failure easy to spot:

- `[hello-pet] main entry watching <state file>` when the main entry starts.
- `[hello-pet] window entry registered settings page, badge and /pet` when the window entry loads.

If either line is missing, the matching half failed and the app's plugin log shows the error.

## Build

```sh
cd experiments/gui-hello-pet
npm install
npm run build
```

The build writes `dist/gui-experimental.cjs`. The desktop app loads that file directly, so `node_modules` is not needed at runtime.

`npm run typecheck`, `npm run lint`, and `npm test` are also available. The tests check that
`src/runtime.ts` matches the repo's `shared/` modules (the bundle carries its own copy of those
rules because the app does not let it require files outside the bundle), and that the built
bundle loads in a window host where Node modules are stubbed. Rebuild before running them.

## Load locally

Add the absolute path to this folder to the `plugins` array in the OpenCode config. On OpenCode 2.x the global file is usually `~/.config/opencode/opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/absolute/path/to/opencode-pet/experiments/gui-hello-pet"
  ]
}
```

Use forward slashes. Keep any existing entries in the array.

Then start OpenCode Desktop again. Config changes reload the server's plugin list, but the app window reads every GUI bundle during its own startup, so a restart is the reliable way to see the UI.

## Test in the desktop app

1. Quit OpenCode Desktop from the app menu, then start it again.
2. Open Settings and look for a `Pet` page in the nav. Typing "pet" in settings search also finds it.
3. Open Settings > Extensions > Plugins. The list shows `opencode-pet-hello-gui` as a local plugin with no error.
4. Open the command palette. It offers `Pet: toggle`.
5. Type `/pet on` in the composer and press Enter. The badge appears at the bottom-right. `/pet off` hides it.
6. Type `/pet` and the command menu opens. Choose `Pet: toggle`, then press Enter. The badge switches state.
7. On the `Pet` settings page, untick the toggle. The badge disappears. Tick it again and the badge returns.
8. While the real pet is running, the badge and the settings page show its live state (for example `Working`).

If the plugin fails, Extensions > Plugins shows an error and a Reload action, and the app writes the failure to its server log. Look for the `[hello-pet]` lines described above.

## What was verified locally

Checked on 30 Oct 2026 against OpenCode Desktop and CLI 2.2.0.

Server and bundle:

- The config entry makes the server report `opencode-pet-hello-gui` with `source.type: "local"`, `features: { "gui": true }`, and `state.status: "active"`.
- `plugin.gui` returns the freshly built bundle. The served revision and size changed after each build, and the old top-level `os.homedir()` call is gone.
- The bundle loads with only the modules the app provides (`solid-js`, `solid-js/web`, `effect`, `@opencode/plugin/gui`) and `setup` registers exactly three items:
  - `Slot` with `at: "window.bottom"` and a render function.
  - `SettingsPage` with `id: "pet"`, the `speech-bubble` icon, one search entry, and a render function.
  - `Command` with `id: "pet"`, `slash: { name: "pet", arguments: true }`, and a `run` function.

Actual Desktop window:

- The settings nav shows a `Pet` tab between `Pairing` and `Server`.
- The `Pet` page shows the checked `Show the pet` box, the experiment note, and `Live pet state: Working`.
- The compact badge is visible at the bottom-right: `Hello Pet`, live state `Working`, detail `writing x`, and a close control.
- In the real composer, `/pet off` removed the badge, `/pet on` brought it back, and `/pet` toggled it through the command menu.
- The window log contains `[hello-pet] window entry registered settings page, badge and /pet`, and no plugin error after the fix.

The floating Electron pet was left untouched and kept running during these tests.

## Remove

Delete the config entry and this folder. Nothing outside the config and this folder was changed.

## Notes and limits

- A GUI-only plugin needs no server entry. Its id comes from the package name, and its `./gui-experimental` export is the bundle the app loads.
- The bundle must be CommonJS. The SDK Vite plugin writes it, keeps app-provided modules external, and rejects bundled copies of Solid, Effect, or the OpenCode SDK.
- The GUI SDK has no call that creates a separate always-on-top or transparent OS window. `ctx.windows` only lists existing app windows. A floating desktop pet still needs the Electron overlay in `app/`.
- The badge renders in normal flow inside the slot, so it cannot escape the app window.
- `opencode plugin list` may print an empty or partial list right after a server start. The plugin appears after the location finishes loading, which takes a moment.
