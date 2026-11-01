// Shared settings for the floating pet.
//
// The GUI and the Electron app both use this module so they cannot disagree
// about defaults, valid ranges, or file layout. Every write is atomic, like
// shared/state-protocol.js, so a reader never sees a half-written file.
"use strict";

const fs = require("fs");
const path = require("path");

const CONFIG_FILE_NAME = "config.json";
const TEMP_FILE_NAME = "config.json.tmp";
const POS_FILE_NAME = "pos.json";
const POS_TEMP_FILE_NAME = "pos.json.tmp";

const DEFAULT_CONFIG = {
  version: 2,
  enabled: true,
  autoLaunch: true,
  pet: "scrybe",
  scale: 1.0,
  animationSpeed: 1.0,
  muted: false,
  autoHideFullscreen: false,
  feed: false,
  visible: true,
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.0;
const MIN_SPEED = 0.5;
const MAX_SPEED = 2.0;

function clampNumber(value, min, max, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeConfig(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const config = { ...DEFAULT_CONFIG };

  if (typeof source.version === "number" && Number.isFinite(source.version)) {
    config.version = Math.max(1, Math.round(source.version));
  }
  if (typeof source.enabled === "boolean") config.enabled = source.enabled;
  if (typeof source.autoLaunch === "boolean") config.autoLaunch = source.autoLaunch;
  if (typeof source.pet === "string" && source.pet.trim()) {
    config.pet = source.pet.trim();
  }
  config.scale = clampNumber(source.scale, MIN_SCALE, MAX_SCALE, DEFAULT_CONFIG.scale);
  config.animationSpeed = clampNumber(
    source.animationSpeed,
    MIN_SPEED,
    MAX_SPEED,
    DEFAULT_CONFIG.animationSpeed,
  );
  if (typeof source.muted === "boolean") config.muted = source.muted;
  if (typeof source.autoHideFullscreen === "boolean") {
    config.autoHideFullscreen = source.autoHideFullscreen;
  }
  if (typeof source.feed === "boolean") config.feed = source.feed;
  if (typeof source.visible === "boolean") config.visible = source.visible;

  return config;
}

function normalizePosition(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const x = raw.x;
  const y = raw.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function configPath(options) {
  const dir = (options && options.dir) || null;
  if (!dir) throw new Error("pet-config: a directory is required");
  return path.join(dir, CONFIG_FILE_NAME);
}

function posPath(options) {
  const dir = (options && options.dir) || null;
  if (!dir) throw new Error("pet-config: a directory is required");
  return path.join(dir, POS_FILE_NAME);
}

function readConfig(options) {
  const file = configPath(options);
  try {
    const raw = JSON.parse(require("fs").readFileSync(file, "utf8"));
    return normalizeConfig(raw);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config, options) {
  const dir = (options && options.dir) || null;
  if (!dir) throw new Error("pet-config: a directory is required");
  const normalized = normalizeConfig(config);
  const file = path.join(dir, CONFIG_FILE_NAME);
  const tmp = path.join(dir, TEMP_FILE_NAME);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(normalized));
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    return normalizeConfig({});
  }
  return normalized;
}

function updateConfig(patch, options) {
  const current = readConfig(options);
  const merged = { ...current, ...(patch && typeof patch === "object" ? patch : {}) };
  return writeConfig(merged, options);
}

function readPosition(options) {
  const file = posPath(options);
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return normalizePosition(raw);
  } catch {
    return null;
  }
}

function writePosition(position, options) {
  const dir = (options && options.dir) || null;
  if (!dir) throw new Error("pet-config: a directory is required");
  const normalized = normalizePosition(position);
  if (!normalized) return null;
  const file = path.join(dir, POS_FILE_NAME);
  const tmp = path.join(dir, POS_TEMP_FILE_NAME);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(normalized));
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    return null;
  }
  return normalized;
}

module.exports = {
  CONFIG_FILE_NAME,
  POS_FILE_NAME,
  DEFAULT_CONFIG,
  MIN_SCALE,
  MAX_SCALE,
  MIN_SPEED,
  MAX_SPEED,
  normalizeConfig,
  normalizePosition,
  readConfig,
  writeConfig,
  updateConfig,
  readPosition,
  writePosition,
  configPath,
  posPath,
};