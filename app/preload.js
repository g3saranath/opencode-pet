"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Every subscription returns an unsubscribe function. Without one, a renderer
// reload stacks a second listener on the same channel and the pet reacts twice
// to every state change.
function subscribe(channel, cb) {
  if (typeof cb !== "function") return () => {};
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("pet", {
  onState: (cb) => subscribe("pet:state", cb),
  onMove: (cb) => subscribe("pet:move", cb),
  onConfig: (cb) => subscribe("pet:config", cb),
  onVisibility: (cb) => subscribe("pet:visibility", cb),
  setIgnore: (ignore) => ipcRenderer.send("pet:set-ignore", ignore),
  dragStart: (offset) => ipcRenderer.send("pet:drag-start", offset),
  dragEnd: () => ipcRenderer.send("pet:drag-end"),
  contextMenu: () => ipcRenderer.send("pet:context-menu"),
});
