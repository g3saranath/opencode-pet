"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainFile = path.join(__dirname, "..", "app", "main.js");
const source = fs.readFileSync(mainFile, "utf8");

const required = [
  "transparent: true",
  "frame: false",
  "skipTaskbar: true",
  "focusable: false",
  "alwaysOnTop: true",
  "acceptFirstMouse: true",
  "useContentSize: true",
  "backgroundThrottling: false",
  "setAlwaysOnTop(true, \"screen-saver\")",
  "setIgnoreMouseEvents(true, { forward: true })",
];

for (const token of required) {
  test("floating pet keeps: " + token, () => {
    assert.ok(source.includes(token), "missing window contract token: " + token);
  });
}