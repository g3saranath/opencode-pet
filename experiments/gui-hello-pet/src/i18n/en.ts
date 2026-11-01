const en = {
  "settings.title": "Pet (Experimental)",
  "settings.note":
    "This page controls the real floating desktop companion. The companion runs as its own window and stays visible when OpenCode is minimized.",
  "settings.section.status": "Status",
  "settings.section.general": "General",
  "settings.section.pet": "Pet",
  "settings.section.behaviour": "Behaviour",
  "settings.section.packs": "Pet packs",
  "settings.status.running": "Companion",
  "settings.status.state": "Pet state",
  "settings.status.position": "Position",
  "settings.status.yes": "Running",
  "settings.status.no": "Stopped",
  "settings.status.offline": "Offline",
  "settings.enabled.title": "Enable Pets",
  "settings.enabled.description":
    "Stops the floating companion and all background work when unchecked.",
  "settings.visible.title": "Show pet",
  "settings.visible.description":
    "Hide the companion without stopping it. /pet off does the same; /pet on brings it back.",
  "settings.autoLaunch.title": "Launch pet automatically when OpenCode starts",
  "settings.autoLaunch.description":
    "When off, OpenCode does not start the pet. Manual launch from this page, /pet, or the keyboard shortcut still works while Pets are enabled.",
  "settings.active.title": "Active Pet",
  "settings.active.description": "Choose which pet pack the companion draws.",
  "settings.appearance.title": "Appearance",
  "settings.appearance.description": "Scale and animation speed.",
  "settings.behaviour.title": "Behaviour",
  "settings.behaviour.description":
    "Sound effects, activity feed, fullscreen hiding, and position.",
  "settings.packs.title": "Manage and Import Pets",
  "settings.packs.description": "Open the packs folder and review the available pets.",
  "settings.packs.note":
    "Custom pack import is not wired into the pet renderer yet. The built-in Scrybe, Clack, and Shane Hollander packs are safe to switch between.",
  "settings.packs.openFolder": "Open packs folder",
  "settings.scale": "Scale",
  "settings.animationSpeed": "Animation Speed",
  "settings.sound": "Sound Effects",
  "settings.feed": "Activity Feed",
  "settings.autoHide": "Auto Hide in Fullscreen",
  "settings.restart": "Restart Pet",
  "settings.resetPosition": "Reset Position",
  "command.title": "Pet: toggle",
  "command.description":
    "Control the floating desktop companion. Use /pet on, /pet off, /pet restart, or /pet status.",
  "command.restarting": "Restarting the pet",
  "command.status.running": "Pet is running",
  "command.status.stopped": "Pet is stopped",
  "command.status.visible": "visible",
  "command.status.hidden": "hidden",
  "command.status.offline": "no state yet",
} as const

export default en
