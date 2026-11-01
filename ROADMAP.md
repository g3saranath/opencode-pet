# Roadmap: OpenCode Pet

This document records the planned phases for OpenCode Pet. Completed phases are
marked. Planned phases are not started yet. See `docs/pet-baseline.md` for the
current working baseline and `README.md` for usage.

## Status

- Phase 1 (Performance and Security Hardening): complete. Review request:
  https://github.com/g3saranath/opencode-pet/pull/8
- Phase 1.5 and later phases: planned, not started.

## Phase 1: Performance and Security Hardening (complete)

Delivered:

- Shared security primitives: safe child-process environment allow-list,
  process-name validation, path containment, and IPC payload validation.
- Electron overlay lifecycle cleanup: timer registry, drag and cursor
  arm/disarm, visibility handling, and quit cleanup.
- Renderer pause and resume for animations while hidden, plus unload cleanup.
- Plugin resource limits: cleared flush timer, capped event accumulators,
  ownership token, and event shape validation.
- GUI control panel with `/pet` commands and the `Ctrl+Alt+Shift+P`
  start/stop shortcut.
- Self-contained GUI bundle so OpenCode's GUI loader does not need external
  modules.
- Automated tests: 222 root tests and 12 GUI tests pass; typecheck and lint
  are clean; the GUI build succeeds.

## Phase 1.5: Memory and Performance Optimization

Goal: Make OpenCode Pet lightweight, efficient, and reliable during long
development sessions.

### 1. Performance profiling

- Measure Electron main, renderer, and child-process memory separately.
- Record baseline RAM and CPU usage.
- Measure startup time, FPS, and animation responsiveness.
- Identify the actual memory and CPU bottlenecks before optimizing.

### 2. Electron process optimization

- Review Electron process architecture.
- Reduce unnecessary process overhead.
- Optimize background tasks and event handling.
- Avoid unnecessary Chromium resource consumption.
- Preserve desktop functionality and stability.

### 3. Renderer optimization

- Reduce unnecessary DOM elements and rendering.
- Prevent redundant state updates.
- Optimize event listeners and cleanup.
- Avoid unnecessary layout calculations and repainting.
- Keep animations smooth.

### 4. Sprite and asset optimization

- Load only assets required by the active pet.
- Avoid loading every pet's sprites into memory.
- Optimize PNG dimensions and file sizes without reducing visual quality.
- Implement efficient image caching.
- Release unused resources when switching pets.

### 5. CPU optimization

- Eliminate unnecessary polling.
- Use event-driven updates wherever possible.
- Optimize animation loops and cursor tracking.
- Avoid background work when hidden or disabled.

### 6. RAM optimization

- Identify memory retention and leaks.
- Release unused references and resources.
- Prevent duplicate asset loading.
- Monitor memory growth during long sessions.

### 7. Long-running stability tests

- Run 30-minute, 1-hour, and extended-session tests.
- Monitor memory growth, CPU usage, FPS, and process count.
- Test repeated pet switching, hiding, showing, and restarting.
- Verify no memory leaks, orphan processes, or performance degradation.

### 8. Before-and-after benchmarks

Record:

- Total Electron process-group RAM.
- Individual process RAM.
- CPU usage.
- Startup time.
- Animation FPS.
- Memory growth over time.

Compare the results against the original baseline.

Success criteria: Lower RAM and CPU usage, stable long-running performance,
smooth animations, and no loss of functionality.

## Phase 2: Universal Pet Pack System

Goal: Make any valid pet pack work without code changes, using one manifest
schema and one adapter layer.

Planned features:

- Automatic pet pack discovery.
- Standardized manifest schema.
- Universal sprite and animation adapters.
- Compatibility with Codex pet packs and other supported formats.
- Dynamic Active Pet selection based only on valid installed pets.
- Pet preview and metadata.
- Safe installation and uninstall management.
- Preserve existing built-in and community pets.

Success criteria: Existing pets keep working, valid packs are discovered
automatically, invalid packs are ignored safely, and the active pet list only
offers valid installed pets.

## Phase 3: Pet Import and Export

Goal: Let users move pet packs in and out safely, with validation before
anything reaches the pet runtime.

Planned features:

- Import pet ZIP packages.
- Validate manifests and required sprites.
- Verify image dimensions and transparency.
- Protect against ZIP bombs and path traversal.
- Reject malformed or unsafe packages.
- Export installed pets into shareable ZIP packages.
- Never execute code from imported pet packs.

Success criteria: Valid packages import and export cleanly, malformed or
unsafe packages are rejected, and imported packs cannot run code.

## Phase 4: AI Pet Generation

Goal: Let users create a complete pet from reference images without leaving
OpenCode.

Planned features:

- Pet creation wizard.
- Pet name and reference image upload.
- Optional character prompt.
- Reference-image-first identity preservation.
- Generate all required animation sprites.
- Transparent 512x512 PNG output.
- Preview, regenerate, save, and install.
- Export generated pets as ZIP packages.

Success criteria: Generated sprites meet the required dimensions and
transparency, the character stays consistent across frames, preview and
regenerate work, and the exported pack imports cleanly.

## Phase 5: Community Pet Marketplace

Goal: Make community pets easy to discover, install, and update.

Planned features:

- Browse and discover community pets.
- One-click installation.
- Ratings and collections.
- Author information and version management.
- Safe package distribution and updates.

Success criteria: Browsing and installation work, every package is validated
before install, author and version information is visible, and unsafe
packages are blocked.

## Phase 6: Pet Plugin SDK

Goal: Let developers extend pets without changing OpenCode itself.

Allow developers to create:

- Custom animations.
- Visual effects.
- Themes.
- Behaviors.
- Animation extensions.

Success criteria: A documented SDK and a sample extension exist, extensions
load safely, and no OpenCode core changes are required.

## Roadmap Rules

- Do not start future phases automatically.
- Complete and verify each phase before moving forward.
- Preserve existing functionality and pet packs.
- Keep the pet optional and lightweight.
- Prioritize security, stability, and performance.
- Maintain modular architecture.
- Update documentation as each phase is completed.
- Do not claim planned features are implemented.
