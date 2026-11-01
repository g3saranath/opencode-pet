// Loads the built bundle the way OpenCode Desktop's window host does: Node
// modules are inert stubs and there is no `process`. The bundle must load and
// register its settings page and /pet command without touching Node; a single
// top-level Node call (the original `os.homedir()` bug) makes the whole page
// disappear.
//
// Run `npm run build` first; the committed dist/ is what the app loads.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import * as vm from "node:vm"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const BUNDLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/gui-experimental.cjs")

// Any use of a Node module at load time throws, with the module and member.
function forbidden(name: string) {
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key === "symbol") return undefined
        throw new Error(`${name}.${String(key)} touched while loading the bundle`)
      },
    },
  )
}

// solid-js/web: any member is a harmless function.
const solidStub = new Proxy({}, { get: () => () => () => ({}) })

function loadInWindowHost() {
  const requested: string[] = []
  const guiStub = {
    Plugin: { define: (definition: unknown) => definition },
    Ipc: { define: (contract: unknown) => contract },
    Command: "Command",
    SettingsPage: "SettingsPage",
  }
  const sandbox: Record<string, unknown> = {
    console: { info() {}, error() {}, warn() {}, log() {} },
    exports: {},
    module: { exports: {} },
    require: (name: string) => {
      requested.push(name)
      if (name === "solid-js/web") return solidStub
      if (name === "effect") return require("effect")
      if (name === "@opencode/plugin/gui") return guiStub
      if (name.startsWith("node:") || name === "electron") return forbidden(name)
      throw new Error(`unexpected module ${name}`)
    },
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(BUNDLE, "utf8"), sandbox, { filename: BUNDLE })
  return { definition: (sandbox.exports as Record<string, any>).default, requested }
}

test("the bundle loads in the window host without touching Node", () => {
  const { definition, requested } = loadInWindowHost()
  assert.equal(typeof definition.main, "function")
  assert.equal(typeof definition.setup, "function")
  // Only modules the app provides (or stubs) are required at load time; the
  // electron and child_process requires stay inside main-process functions.
  assert.deepEqual(
    [...new Set(requested)].sort(),
    ["@opencode/plugin/gui", "effect", "node:fs", "node:os", "node:path", "solid-js/web"],
  )
})

test("the window entry registers the settings page and /pet without touching Node", () => {
  const { definition } = loadInWindowHost()
  const added: Array<{ kind: string; item: any }> = []
  definition.setup({
    main: () => ({ state: () => undefined }),
    add: (kind: string, factory: () => unknown) => added.push({ kind, item: factory() }),
    t: (key: string) => key,
    toast: { show() {} },
  })
  assert.deepEqual(added.map((entry) => entry.kind), ["SettingsPage", "Command"])
  const page = added[0].item
  assert.equal(page.id, "pet")
  assert.ok(page.entries.length > 0)
  assert.equal(added[1].item.slash.name, "pet")
  assert.ok(
    !JSON.stringify(page.entries).includes("clack"),
    "packs without art in the repo are not offered",
  )
})
