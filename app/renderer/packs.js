// Sprite-sheet pet packs the renderer can play instead of the built-in Scrybe
// art. Loaded as a plain script before pet.js (exposes window.PetPacks), like
// labels.js.
//
// No packs ship yet. The Clack and Shane Hollander entries this list used to
// hold pointed at art that was never committed, so choosing them silently fell
// back to Scrybe. To add a pack, commit its art (and confirm it may be
// redistributed), add `.pack-mode` styles to style.css, register it here, and
// list it in the settings page (experiments/gui-hello-pet/src/gui.tsx).
//
// Entry shape, keyed by the `pet` setting:
//   "my-pack": {
//     url: "../my-pack/spritesheet.webp", // relative to renderer/index.html
//     cols: 8, rows: 11, frameW: 192, frameH: 208,
//     map: { idle: 0, thinking: 7, working: 2, waiting: 3, happy: 4, error: 6, sleeping: 5 },
//   },
(function (root) {
  "use strict";
  root.PetPacks = {};
})(typeof globalThis !== "undefined" ? globalThis : this);
