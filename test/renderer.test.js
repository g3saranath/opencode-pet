"use strict";

// Behaviour tests for the renderer's hidden-state handling.
//
// app/renderer/pet.js expects a DOM, so this loads it in a VM with a small
// element stub. The assertions are about what the page does when the main
// process reports the window hidden: CSS animations pause and the sprite-sheet
// requestAnimationFrame loop stops, then both resume.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function makeClassList() {
  const set = new Set();
  return {
    add: (...names) => names.forEach((name) => set.add(name)),
    remove: (...names) => names.forEach((name) => set.delete(name)),
    toggle: (name, force) => {
      if (force === undefined) {
        if (set.has(name)) set.delete(name);
        else set.add(name);
      } else if (force) {
        set.add(name);
      } else {
        set.delete(name);
      }
    },
    contains: (name) => set.has(name),
    values: () => Array.from(set),
  };
}

function makeElement(id) {
  const element = {
    id,
    className: "",
    textContent: "",
    style: {
      setProperty() {},
      removeProperty() {},
    },
    classList: makeClassList(),
    addEventListener() {},
    appendChild() {},
    querySelector: () => makeElement("sprite"),
  };
  return element;
}

function createRenderer() {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };

  const body = makeElement("body");
  const handlers = {};
  const windowListeners = {};
  let unsubscribed = 0;
  let rafSeq = 1;
  const pendingRaf = new Map();

  const document = {
    body,
    getElementById: get,
    querySelector: (selector) => (selector === ".sprite" ? get("sprite") : makeElement(selector)),
    createElement: (tag) => makeElement(tag),
    addEventListener() {},
  };

  const window = {
    PetLabels: {
      TOOL_LOOK: { bash: "tool-bash", edit: "tool-edit" },
      WORKING_VERBS: ["casting", "scrying"],
      resolveBubble: () => ({ emoji: "", text: "", prop: "", toolClass: "", generic: false }),
    },
    pet: {
      onState: (cb) => {
        handlers.state = cb;
        return () => {
          unsubscribed++;
        };
      },
      onMove: (cb) => {
        handlers.move = cb;
        return () => {
          unsubscribed++;
        };
      },
      onConfig: (cb) => {
        handlers.config = cb;
        return () => {
          unsubscribed++;
        };
      },
      onVisibility: (cb) => {
        handlers.visibility = cb;
        return () => {
          unsubscribed++;
        };
      },
      dragStart() {},
      dragEnd() {},
      contextMenu() {},
    },
    addEventListener: (type, cb) => {
      windowListeners[type] = cb;
    },
  };

  class FakeImage {
    set src(value) {
      this._src = value;
      if (typeof this.onload === "function") this.onload();
    }
    get src() {
      return this._src;
    }
  }

  const sandbox = {
    console,
    document,
    window,
    Image: FakeImage,
    performance: { now: () => 0 },
    requestAnimationFrame: (cb) => {
      const id = rafSeq++;
      pendingRaf.set(id, cb);
      return id;
    },
    cancelAnimationFrame: (id) => {
      pendingRaf.delete(id);
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "app", "renderer", "pet.js"), "utf8"),
    sandbox,
    { filename: "pet.js" },
  );

  return {
    handlers,
    body,
    pendingRaf,
    unsubscribed: () => unsubscribed,
    unload: () => windowListeners.beforeunload(),
  };
}

test("hiding pauses CSS animations and the pack rAF loop", () => {
  const r = createRenderer();

  // Switch to a sprite-sheet pack so there is an animation loop to pause.
  r.handlers.config({ pet: "clack" });
  assert.equal(r.pendingRaf.size, 1, "pack loop is running");

  r.handlers.visibility(false);
  assert.equal(r.body.classList.contains("paused"), true, "CSS animations paused");
  assert.equal(r.pendingRaf.size, 0, "rAF loop cancelled while hidden");

  r.handlers.visibility(true);
  assert.equal(r.body.classList.contains("paused"), false, "CSS animations resumed");
  assert.equal(r.pendingRaf.size, 1, "rAF loop rescheduled when visible");
});

test("unload removes every IPC listener and stops the loop", () => {
  const r = createRenderer();
  r.handlers.config({ pet: "clack" });
  assert.equal(r.pendingRaf.size, 1);

  r.unload();
  assert.equal(r.unsubscribed(), 4, "all four subscriptions removed");
  assert.equal(r.pendingRaf.size, 0, "rAF cancelled on unload");
});
