# OpenDeck Architecture

## Current Choice

Step 1 uses Electron rather than Tauri.

Reasoning:

- the hardware layer is already strongest in Node through `@elgato-stream-deck/node`
- the plugin API is intentionally JavaScript-first
- the UI goal depends on a flexible desktop web stack for drag-and-drop, preview rendering, and future motion work

This keeps the first milestone focused on product architecture instead of cross-runtime plumbing.

## Layer Map

### Renderer

Files:

- `src/renderer/index.html`
- `src/renderer/main.mjs`
- `src/renderer/previewRenderer.mjs`

Responsibilities:

- render the deck grid and plugin palette
- handle drag-and-drop assignment
- draw polished key previews on canvas
- send RGBA pixel buffers through the preload bridge for live hardware rendering

### Preload Bridge

Files:

- `electron/preload.js`
- `src/main/ipc/channels.js`

Responsibilities:

- expose a narrow, explicit API to the renderer
- keep Node and Electron internals out of the web context

### Main Process

Files:

- `electron/main.js`
- `src/main/runtime/AppRuntime.js`
- `src/main/ipc/registerHandlers.js`

Responsibilities:

- boot the app
- create the browser window
- own long-lived services
- route IPC commands to the right subsystem

### Stream Deck Service

Files:

- `src/main/services/streamDeck/StreamDeckService.js`
- `src/main/services/streamDeck/defaultDeckProfile.js`
- `src/main/services/obs/ObsService.js`
- `src/main/services/storage/AppStateStore.js`

Responsibilities:

- detect connected Stream Deck devices
- open the active device
- read its control layout
- render raw RGBA buffers onto physical keys
- trigger assigned actions from physical button presses
- fall back to a mock deck when no hardware is connected

### OBS Service

Responsibilities:

- store OBS connection settings
- connect to OBS Studio through its built-in WebSocket endpoint
- fetch the available scenes
- switch to a configured program scene when an assigned key fires

### Plugin System

Files:

- `src/main/services/plugins/PluginManager.js`
- `src/main/services/plugins/PluginImportService.js`
- `plugins/*`

Responsibilities:

- scan bundled plugins plus a writable user plugin directory
- validate `manifest.json`
- load `index.js`
- register action handlers with a single `registerAction()` function
- import plugin folders from GitHub URLs into the writable user plugin directory
- leave room for marketplace-feed resolvers that eventually point to plugin sources
- expose a catalog back to the renderer

## Data Flow

1. Electron starts `AppRuntime`.
2. `AppRuntime` loads persisted state, scans plugins, and discovers Stream Deck hardware.
3. The renderer requests bootstrap state over IPC.
4. The renderer draws the OBS panel, deck grid, and plugin palette.
5. When an action is dropped onto a key:
   - the renderer asks the main process to persist the assignment
   - the renderer redraws the preview canvas
   - the renderer sends the RGBA buffer to the main process
   - the Stream Deck service writes the image to the physical key
6. When the user or the physical device triggers a key action, the main process calls the plugin handler.

## Plugin Design Principles

The current API aims to stay boring in the best way:

- manifest for metadata
- one entry script for behavior
- one registration function for actions
- no bundler required
- no framework lock-in for plugin authors

That gives us a low-friction base before we add richer concepts like settings UIs, action configuration, or background workers.

## Recommended Next Steps

1. Persist layouts and plugin settings to disk instead of memory only.
2. Add a dedicated action execution context with logging, notifications, and shell command helpers.
3. Move plugin execution into isolated workers or utility processes for safety.
4. Add icon import, text editing, and multi-state key previews.
5. Support multiple connected Stream Decks with per-device profiles.
6. Add first-run diagnostics and a friendlier in-app Linux setup helper.

The repo already includes Linux distro guidance in `docs/linux-compatibility.md`, Fedora alpha packaging notes in `docs/fedora-alpha.md`, portable `udev` rule files under `linux/udev/`, and an Electron Builder workflow for Linux alpha artifacts.
