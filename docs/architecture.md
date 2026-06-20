# DeckSmith Architecture

## Current Choice

DeckSmith currently uses Electron rather than Tauri for the alpha foundation.

Why this fits the product:

- the hardware layer is strongest in Node through `@elgato-stream-deck/node`
- the plugin API is intentionally JavaScript-first
- the desktop editor needs polished drag-and-drop, canvas previews, and fast iteration
- Linux packaging for Fedora-style alpha testing is already wired around the Electron toolchain

This keeps the early roadmap focused on a real Linux-first desktop app instead of splitting effort across multiple runtimes.

## System Map

### Renderer

Files:

- `src/renderer/index.html`
- `src/renderer/main.mjs`
- `src/renderer/previewRenderer.mjs`
- `src/renderer/styles.css`

Responsibilities:

- render the deck canvas based on the detected physical Stream Deck model
- show the action browser, plugin installer, OBS controls, and profile automation UI
- let users drag an action from the sidebar onto a key
- persist assignments immediately through the preload bridge
- render live key previews on canvas before sending image buffers to hardware
- poll bootstrap state so profile switches, plugin installs, and OBS updates appear without restart

### Preload Bridge

Files:

- `electron/preload.js`
- `src/main/ipc/channels.js`

Responsibilities:

- expose a narrow API to the renderer
- keep Electron and Node internals out of the web context
- provide explicit IPC calls for:
  - bootstrap state
  - profile switching and profile creation
  - profile rule updates
  - plugin inspection and installation
  - layout assignment changes
  - OBS connection commands
  - hardware key rendering

### Main Process Runtime

Files:

- `electron/main.js`
- `src/main/runtime/AppRuntime.js`
- `src/main/ipc/registerHandlers.js`

Responsibilities:

- boot all long-lived DeckSmith services
- assemble one bootstrap payload for the renderer
- coordinate profile state, layout state, plugin state, OBS state, and active device state
- react to Linux active-window changes and auto-switch profiles when rules match

### Stream Deck Service

Files:

- `src/main/services/streamDeck/StreamDeckService.js`
- `src/main/services/streamDeck/defaultDeckProfile.js`

Responsibilities:

- detect connected Elgato hardware through HID
- expose the active device layout as rows, columns, and key pixel sizes
- switch between physical hardware and a mock deck when no device is present
- write RGBA key buffers to the selected deck
- emit button-down events back into the runtime

### Layout and Profile Services

Files:

- `src/main/services/layout/LayoutService.js`
- `src/main/services/profiles/ProfileService.js`
- `src/main/services/storage/AppStateStore.js`

Responsibilities:

- persist per-device, per-profile key assignments
- clone one profile layout into another when creating a new profile
- track the active profile per connected deck
- store application-awareness rules such as:
  - match OBS by process name on X11
  - match a game window title on GNOME Wayland
  - match an app class on Hyprland

### Plugin System

Files:

- `src/main/services/plugins/PluginManager.js`
- `src/main/services/plugins/PluginImportService.js`
- `plugins/*`

Responsibilities:

- scan bundled plugins plus the writable user plugin directory
- validate `manifest.json`
- load `index.js`
- register plugin actions through a simple JavaScript contract
- install plugins from:
  - GitHub repository URLs
  - direct plugin-folder URLs on GitHub
  - direct `.zip` plugin packages
  - future marketplace JSON feeds that resolve to one of the above
- trigger a re-scan so new actions appear immediately

### Linux Active Window Service

Files:

- `src/main/services/linux/LinuxActiveWindowService.js`

Responsibilities:

- poll the current desktop focus on Linux
- choose the best backend automatically:
  - `hyprctl activewindow -j` for Hyprland
  - `xdotool` plus `ps` for X11 desktops
  - `gdbus` with `org.gnome.Shell.Eval` for GNOME Wayland
- normalize focus data into a shared shape:
  - backend
  - title
  - process name
  - app id
  - pid
- notify `ProfileService` when the focused app changes

### OBS Service

Files:

- `src/main/services/obs/ObsService.js`

Responsibilities:

- persist OBS WebSocket connection settings
- auto-connect when possible
- expose scenes, inputs, studio mode, stream state, and record state
- power the built-in OBS action plugin

## Feature Architecture

### 1. Visual Drag-and-Drop Grid

Renderer flow:

1. DeckSmith reads the active hardware profile from `StreamDeckService`.
2. The renderer builds a grid with the correct number of rows and columns.
3. Each action card in the sidebar is draggable.
4. Dropping a card onto a key calls `assignAction`.
5. `LayoutService` stores the assignment under the active deck id and active profile id.
6. The renderer redraws the canvas preview and pushes RGBA image data to the hardware key.

Design goal:

- the UI should always feel like a desktop tool, not a browser form
- the grid mirrors the exact connected hardware automatically
- dropping an action is the save operation, so there is no extra “Apply” click

### 2. One-Click Local Plugin Installer

Import flow:

1. The user pastes a GitHub URL, plugin zip URL, or marketplace feed URL.
2. The renderer calls `inspectPluginSource` or `importPlugin`.
3. `PluginImportService` resolves the source type:
   - GitHub repository or folder
   - zip archive
   - marketplace descriptor
4. The service downloads and validates `manifest.json` plus `index.js`.
5. The plugin files are extracted into the writable user `plugins` directory.
6. `PluginManager.scan()` runs again immediately.
7. The renderer receives a fresh plugin catalog without restarting DeckSmith.

Design goal:

- plugin authors should be able to ship simple repos or zip files
- users should not need to manually unzip or copy folders
- a future community marketplace can plug into the same installer contract

### 3. Dynamic Profile Switching on Linux

Runtime flow:

1. `LinuxActiveWindowService` polls the active window every few seconds.
2. The service normalizes the desktop-specific result into one DeckSmith focus payload.
3. `ProfileService.applyAutoSwitch()` compares that payload against the active deck's configured rules.
4. When a rule matches, the active profile id changes in persistent state.
5. The renderer picks up the updated bootstrap state and redraws the grid for the new profile.
6. The current renderer pipeline can then re-push the visible key previews to hardware.

Supported alpha strategy:

- `processName` rules for reliable app matching
- `windowTitle` rules for cases where process names are too generic
- `appId` rules for compositors that expose a better application identifier

## Communication Flow

### Bootstrap

1. Electron starts `AppRuntime`.
2. `AppRuntime` loads stored state from `AppStateStore`.
3. Plugins are scanned.
4. OBS service starts.
5. Stream Deck hardware is detected.
6. Linux focus watching starts.
7. The renderer requests one bootstrap payload and renders the app.

### Key Assignment

1. User drags an action onto a key.
2. Renderer sends `layout:assign-action`.
3. `LayoutService` persists the assignment for the current profile.
4. Renderer redraws the key and pushes the preview buffer to the hardware key.

### Plugin Install

1. User pastes a source URL.
2. Renderer calls `plugins:import`.
3. `PluginImportService` downloads and extracts the plugin.
4. `PluginManager` rescans plugin roots.
5. Renderer refreshes and shows new actions instantly.

### Application Awareness

1. Linux focus changes.
2. `LinuxActiveWindowService` emits the normalized active window.
3. `ProfileService` checks profile rules.
4. If a match is found, `activeProfileId` changes.
5. Renderer refreshes bootstrap state and the visible deck layout changes.

## State Shape

DeckSmith now treats assignments as:

- `deck id -> profile id -> slot id -> assignment`

Profile metadata is stored separately as:

- `deck id -> active profile id + profilesById`

This lets DeckSmith support:

- multiple connected hardware models
- different profiles per device
- cloned starter profiles
- future profile export and sharing

## Why This Matters For Linux

This architecture is designed around Linux pain points instead of treating Linux as a port target:

- hardware is native through Node HID, not Wine
- focus detection has backend-aware adapters for X11 and major Wayland paths
- plugins are just folders with `manifest.json` and `index.js`
- local installation does not depend on a proprietary store
- the UI adapts to whichever Stream Deck model is actually connected

## Recommended Next Steps

1. Move key preview rendering into a shared renderer that both the UI and main process can call, so automatic profile switches can repaint hardware without waiting for the UI loop.
2. Add profile export and import so streamers can share complete DeckSmith layouts.
3. Run plugin code in isolated worker processes for better safety.
4. Add multi-page navigation and folders per profile.
5. Add compositor adapters beyond GNOME and Hyprland for broader Wayland coverage.
6. Ship a small first-run diagnostics panel that checks `udev`, `xdotool`, `hyprctl`, and OBS WebSocket availability.
