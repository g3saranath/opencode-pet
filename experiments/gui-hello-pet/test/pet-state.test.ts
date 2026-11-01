import { test } from "node:test"
import assert from "node:assert/strict"
import {
  applyCommand,
  normalizeCommandArg,
  readRuntimeState,
  PET_STATES,
  runtimeLabel,
} from "../src/pet-state.ts"

test("normalizeCommandArg trims and lowercases", () => {
  assert.equal(normalizeCommandArg("  On "), "on")
  assert.equal(normalizeCommandArg(null), "")
  assert.equal(normalizeCommandArg(42), "42")
})

test("/pet with no argument toggles", () => {
  assert.equal(applyCommand(true, ""), false)
  assert.equal(applyCommand(false, ""), true)
  assert.equal(applyCommand(true, "   "), false)
})

test("/pet on always shows", () => {
  assert.equal(applyCommand(false, "on"), true)
  assert.equal(applyCommand(true, "on"), true)
  assert.equal(applyCommand(false, "ON"), true)
  assert.equal(applyCommand(false, "enable"), true)
  assert.equal(applyCommand(false, "show"), true)
})

test("/pet off always hides", () => {
  assert.equal(applyCommand(true, "off"), false)
  assert.equal(applyCommand(false, "off"), false)
  assert.equal(applyCommand(true, "OFF"), false)
  assert.equal(applyCommand(true, "disable"), false)
  assert.equal(applyCommand(true, "hide"), false)
})

test("unknown argument toggles rather than doing nothing", () => {
  assert.equal(applyCommand(true, "foo"), false)
  assert.equal(applyCommand(false, "foo"), true)
})

test("readRuntimeState rejects bad input", () => {
  assert.deepEqual(readRuntimeState(null), { available: false, state: "idle", ts: 0 })
  assert.deepEqual(readRuntimeState("idle"), { available: false, state: "idle", ts: 0 })
  assert.deepEqual(readRuntimeState({}), { available: false, state: "idle", ts: 0 })
  assert.deepEqual(readRuntimeState({ state: "nope" }), { available: false, state: "idle", ts: 0 })
})

test("readRuntimeState accepts a valid payload", () => {
  const result = readRuntimeState({ state: "working", ts: 1234, detail: "editing" })
  assert.deepEqual(result, { available: true, state: "working", ts: 1234, detail: "editing" })
})

test("readRuntimeState drops a non-string detail", () => {
  const result = readRuntimeState({ state: "happy", ts: 9, detail: 5 })
  assert.equal(result.detail, undefined)
})

test("readRuntimeState coerces a bad timestamp to zero", () => {
  const result = readRuntimeState({ state: "idle", ts: "nope" })
  assert.equal(result.ts, 0)
})

test("PET_STATES contains every runtime state", () => {
  assert.ok(PET_STATES.includes("idle"))
  assert.ok(PET_STATES.includes("sleeping"))
  assert.equal(PET_STATES.length, 7)
})

test("runtimeLabel falls back when offline", () => {
  assert.equal(runtimeLabel(undefined, false), "Pet offline")
})

test("runtimeLabel reflects a live state", () => {
  assert.equal(runtimeLabel("working", true), "Working")
})
