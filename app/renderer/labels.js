// Bubble label logic shared by the renderer and the tests.
// Loaded as a plain script in the browser (exposes window.PetLabels) and
// required directly by node tests (module.exports).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PetLabels = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // tool -> [bubbleEmoji, label, floatingProp]
  const TOOL_LOOK = {
    edit:      ["\u270F\uFE0F", "editing", "\u270D\uFE0F"],
    write:     ["\u270F\uFE0F", "writing", "\u270D\uFE0F"],
    patch:     ["\u270F\uFE0F", "editing", "\u270D\uFE0F"],
    read:      ["\uD83D\uDCD6", "reading", "\uD83D\uDCD6"],
    bash:      ["\u2699\uFE0F", "running", "\uD83E\uDDEA"],
    grep:      ["\uD83D\uDD0D", "searching", "\uD83D\uDD0D"],
    glob:      ["\uD83D\uDCC2", "looking", "\uD83D\uDD2E"],
    list:      ["\uD83D\uDCC2", "looking", "\uD83D\uDD2E"],
    webfetch:  ["\uD83C\uDF10", "browsing", "\uD83E\uDD89"],
    websearch: ["\uD83C\uDF10", "searching", "\uD83E\uDD89"],
    task:      ["\uD83E\uDD16", "delegating", "\uD83E\uDE84"],
    todowrite: ["\uD83D\uDCDD", "planning", "\uD83D\uDCDC"],
    question:  ["\u2753", "asking", "\u2753"],
    delete:    ["\uD83D\uDDD1\uFE0F", "removing", "\uD83D\uDDD1\uFE0F"],
    move:      ["\uD83D\uDCE6", "moving", "\uD83D\uDCE6"],
    mkdir:     ["\uD83D\uDCC1", "creating", "\uD83D\uDCC1"],
    notebook:  ["\uD83D\uDCD3", "editing", "\uD83D\uDCD3"],
    fetch:     ["\uD83C\uDF10", "fetching", "\uD83E\uDD89"],
    search:    ["\uD83D\uDD0D", "searching", "\uD83D\uDD0D"],
    agent:     ["\uD83E\uDD16", "delegating", "\uD83E\uDE84"],
    computer:  ["\uD83D\uDDA5\uFE0F", "using", "\uD83D\uDDA5\uFE0F"],
  };

  const STATE_LOOK = {
    thinking: [null, ""],
    working:  ["\uD83E\uDE84", "casting"],
    waiting:  ["\u2753", "your call?"],
    happy:    ["\u2728", "done!"],
    error:    ["\uD83D\uDCA5", "uh oh"],
    sleeping: [null, ""],
    idle:     [null, ""],
  };

  // Wizard verbs shown only while working with no specific tool or target.
  const WORKING_VERBS = [
    "casting", "conjuring", "scrying", "brewing", "weaving",
    "channeling", "summoning", "divining", "enchanting", "scribing",
  ];

  // Decide what the bubble shows. Priority:
  //   1. known tool -> its label, overridden by the target (file, command)
  //   2. unknown tool -> tool name plus target
  //   3. state label -> overridden by the target
  // `generic` is true only for a bare working state (rotate the verbs).
  function resolveBubble(state, tool, detail) {
    const d = detail == null ? "" : String(detail);
    let emoji = null;
    let text = "";
    let prop = "";
    let toolClass = null;

    if (tool && TOOL_LOOK[tool]) {
      toolClass = "tool-" + tool;
      const look = TOOL_LOOK[tool];
      emoji = look[0];
      text = look[1];
      prop = look[2] || "";
      if (d) text = d;
      return { emoji, text, prop, toolClass, generic: false };
    }

    if (tool && tool !== "tool") {
      emoji = "\uD83E\uDE84";
      text = d ? tool + " " + d : tool;
      return { emoji, text, prop: "", toolClass: null, generic: false };
    }

    if (STATE_LOOK[state]) {
      emoji = STATE_LOOK[state][0];
      text = STATE_LOOK[state][1];
    }
    if (d) text = d;

    const generic = state === "working" && !tool && !d;
    return { emoji, text, prop, toolClass: null, generic };
  }

  return { TOOL_LOOK, STATE_LOOK, WORKING_VERBS, resolveBubble };
});
