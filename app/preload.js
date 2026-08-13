"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pet", {
  onState: (cb) => ipcRenderer.on("pet:state", (_e, payload) => cb(payload)),
  onMove: (cb) => ipcRenderer.on("pet:move", (_e, payload) => cb(payload)),
  onConfig: (cb) => ipcRenderer.on("pet:config", (_e, cfg) => cb(cfg)),
  setIgnore: (ignore) => ipcRenderer.send("pet:set-ignore", ignore),
  dragStart: (offset) => ipcRenderer.send("pet:drag-start", offset),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  contextMenu: () => ipcRenderer.send("pet:context-menu"),
});
