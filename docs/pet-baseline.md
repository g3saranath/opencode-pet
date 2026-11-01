# Pet baseline

This document records the working floating pet before the settings-control migration.

## Window contract

The floating pet must keep these Electron window properties:

- transparent: true
- frame: false
- resizable: false
- movable: false
- minimizable: false
- maximizable: false
- fullscreenable: false
- skipTaskbar: true
- focusable: false
- alwaysOnTop: true
- acceptFirstMouse: true
- useContentSize: true
- backgroundThrottling: false
- autoplayPolicy: no-user-gesture-required

Runtime behavior:

- single-instance lock
- pid file written on startup and removed on quit
- global shortcut Ctrl+Alt+Shift+P quits the running pet (registered by the overlay); with the GUI plugin it also starts a stopped pet. `shortcut.owner` keeps the overlay and the GUI plugin from both registering it
- click-through by default, disabled only over the pet (the top 240x214 of the stage, scaled); the activity log stays click-through
- the overlay never writes config.json from its settings poll; menu changes write only the field they change
- drag moves the window and saves position
- scale changes resize around the center
- state watcher reads state.json
- heartbeat timeout is 45 seconds
- quit after sleeping is 15 seconds

## Existing tests

Run `npm test`. Expected result: all tests pass (244 at the time of writing).

## Manual smoke checklist

1. OpenCode minimized, pet still visible.
2. Another app focused, pet still visible.
3. OpenCode closed, pet closes.
4. Drag works.
5. Right-click menu works.
6. Scale changes work.
7. Position persists after restart.
8. Real session states move through idle, thinking, working, waiting, happy, and error.