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

// A stand-in pack: the repo ships none yet (see app/renderer/packs.js).
const TEST_PACK = {
  url: "../test-pack/spritesheet.webp",
  cols: 8,
  rows: 11,
  frameW: 192,
  frameH: 208,
  map: { idle: 0, thinking: 7, working: 2, waiting: 3, happy: 4, error: 6, sleeping: 5 },
};

function createRenderer(options = {}) {
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
    PetPacks: options.packs || { "test-pack": TEST_PACK },
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
    sprite: get("sprite"),
    pendingRaf,
    unsubscribed: () => unsubscribed,
    unload: () => windowListeners.beforeunload(),
  };
}

test("hiding pauses CSS animations and the pack rAF loop", () => {
  const r = createRenderer();

  // Switch to a sprite-sheet pack so there is an animation loop to pause.
  r.handlers.config({ pet: "test-pack" });
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
  r.handlers.config({ pet: "test-pack" });
  assert.equal(r.pendingRaf.size, 1);

  r.unload();
  assert.equal(r.unsubscribed(), 4, "all four subscriptions removed");
  assert.equal(r.pendingRaf.size, 0, "rAF cancelled on unload");
});

test("an unregistered pack keeps the built-in art and starts no loop", () => {
  // The default registry is empty; these ids used to point at art that was
  // never committed. Prototype keys must not count as packs either.
  for (const id of ["clack", "shane-hollander", "constructor", "__proto__", "scrybe"]) {
    const r = createRenderer({ packs: {} });
    r.handlers.config({ pet: id });
    assert.equal(r.pendingRaf.size, 0, id);
    assert.equal(r.sprite.style.backgroundImage, "", id);
  }
});

test("the pack loop writes the frame only when it changes", () => {
  const r = createRenderer();
  let writes = 0;
  let position = "";
  Object.defineProperty(r.sprite.style, "backgroundPosition", {
    configurable: true,
    get: () => position,
    set: (value) => {
      writes++;
      position = value;
    },
  });
  r.handlers.config({ pet: "test-pack", animationSpeed: 1 });
  writes = 0; // ignore the reset in loadPet

  // Ten display frames inside one 120ms sheet frame, then one past it.
  const step = (now) => {
    const [id, cb] = r.pendingRaf.entries().next().value;
    r.pendingRaf.delete(id);
    cb(now);
  };
  for (let i = 0; i < 10; i++) step(i * 10);
  assert.equal(writes, 1, "one write for the first frame");
  step(130); // advances the sheet
  step(140); // shows the next frame
  assert.equal(writes, 2, "one more write once the frame changes");
});

test("every registered pack has its art in the repo", () => {
  const rendererDir = path.join(__dirname, "..", "app", "renderer");
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(rendererDir, "packs.js"), "utf8"), sandbox, {
    filename: "packs.js",
  });
  assert.ok(sandbox.PetPacks && typeof sandbox.PetPacks === "object", "packs.js exposes PetPacks");
  for (const [id, pack] of Object.entries(sandbox.PetPacks)) {
    assert.ok(fs.existsSync(path.join(rendererDir, pack.url)), `${id}: ${pack.url} is missing`);
  }

  const html = fs.readFileSync(path.join(rendererDir, "index.html"), "utf8");
  assert.ok(
    html.indexOf('src="packs.js"') !== -1 && html.indexOf('src="packs.js"') < html.indexOf('src="pet.js"'),
    "packs.js loads before pet.js",
  );
});
