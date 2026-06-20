# DeckSmith

DeckSmith is a Linux-first, open-source alternative to the Elgato Stream Deck app.

The current alpha focuses on three things:

- a polished desktop editor that feels like a real app
- native Linux-friendly Stream Deck support without Wine
- a simple plugin model that normal developers can actually build on

Right now the alpha already includes:

- hardware-aware deck detection
- drag-and-drop key assignment
- OBS Studio integration
- profile switching groundwork
- direct plugin import from GitHub or zip URLs

## Screenshots

### Main Workspace

![DeckSmith main workspace](.github/readme/decksmith-overview.png)

### Key Inspector

![DeckSmith key inspector](.github/readme/decksmith-key-inspector.png)

## Quick Start

### 1. Install dependencies

```bash
npm install
```

If Electron-native dependencies ever need a refresh:

```bash
npm run install:app-deps
```

### 2. Start the app

```bash
npm start
```

### 3. Try it with or without hardware

If no Stream Deck is connected, DeckSmith starts with a mock 15-key layout so you can still test the UI, OBS flow, profiles, and plugins.

If a real Stream Deck is connected, DeckSmith detects the model and reshapes the deck grid to match the physical device automatically.

### 4. Connect OBS Studio

In OBS Studio, enable the built-in WebSocket server.

Then in DeckSmith:

1. Open the OBS connection panel.
2. Enter the WebSocket URL and password.
3. Click `Save and Connect`.
4. Refresh scenes if needed.

OBS includes obs-websocket by default in OBS `28.0.0` and later.

### 5. Assign your first key

1. Select a key in the deck grid.
2. Open the `Keys` browser in the right rail.
3. Drag an action onto the key, or click an action while a key is selected.
4. Adjust its config in the panel below the deck UI.
5. Trigger it from the app or from the physical Stream Deck.

### 6. Create a profile

1. Use the profile picker in the toolbar.
2. Click `New`.
3. Name the profile.
4. DeckSmith clones the current layout into the new profile so you can branch quickly.

### 7. Add an application-awareness rule

This is the first step toward automatic Linux profile switching.

1. Focus the app you care about, like OBS Studio.
2. Open the inspector area.
3. In `Profile Automation`, click `Use Focused App` or `Use Window Title`.
4. DeckSmith stores a rule for the current profile.

On Linux, the backend watcher currently targets:

- `xdotool` on X11
- `hyprctl` on Hyprland
- `gdbus` plus GNOME Shell on GNOME Wayland

### 8. Import a plugin

In the `Plugins` tab, paste one of these:

- a GitHub repository URL
- a direct GitHub plugin-folder URL
- a direct plugin `.zip` URL
- a marketplace JSON feed URL that resolves to a plugin source

Then use:

- `Preview Source` to inspect it first
- `Import Plugin` to install it into your writable local plugin folder

DeckSmith rescans plugins immediately after import, so new actions appear without a restart.

## Linux Notes

DeckSmith is being built specifically to behave well across mainstream Linux desktops and distros, including Fedora-style systems and gaming-focused installs.

### Hardware permissions

Native hardware access still depends on working `udev` rules. This repo includes:

- `linux/udev/60-decksmith-user.rules`
- `linux/udev/60-decksmith-headless.rules.example`
- `docs/linux-compatibility.md`
- `docs/fedora-alpha.md`

### Focus watcher dependencies

Automatic profile switching depends on what your desktop exposes:

- X11 desktops should have `xdotool`
- Hyprland should have `hyprctl`
- GNOME Wayland uses `gdbus` and GNOME Shell APIs

The watcher is scaffolded and wired into the runtime, but Linux desktop behavior should still be tested compositor by compositor.

## Build Packages

### Fedora and RPM-friendly Linux builds

```bash
npm run dist:linux:fedora
```

This produces:

- a Linux `.rpm`
- a Linux `.AppImage`

### Generic Linux directory build

```bash
npm run dist:linux:dir
```

### Windows portable build

```bash
npm run dist:win
```

This produces a portable Windows `.exe` in `dist/`.

## GitHub Releases

Version tags such as `v0.1.0-alpha` trigger `.github/workflows/alpha-release.yml`.

That workflow is set up to publish:

- a Linux `.rpm`
- a Linux `.AppImage`
- a Windows portable `.exe`

## Plugin Tutorial

In development, plugins live in `/plugins`.

In packaged builds:

- bundled plugins ship inside the app
- user plugins are loaded from the app data plugin folder
- imported plugins are written into the writable user plugin folder

Each plugin needs:

- `manifest.json`
- `index.js`

Minimal manifest:

```json
{
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "actions": [
    {
      "id": "my-action",
      "name": "My Action",
      "defaultLabel": "GO",
      "accentColor": "#3dd9c1"
    }
  ]
}
```

Minimal entry script:

```js
module.exports.activate = async ({ registerAction }) => {
  registerAction({
    id: 'my-action',
    onTrigger: async ({ slot, deck, assignment, services }) => {
      console.log(`Triggered ${slot.slotId} on ${deck.productName}`);
    }
  });
};
```

Example plugins already in the repo:

- `plugins/io.decksmith.demo.hello/`
- `plugins/io.decksmith.core/`
- `plugins/io.decksmith.obs/`

## Project Layout

- `electron/`
  - Electron entrypoint and preload bridge.
- `src/main/`
  - Runtime, device services, plugin loading, profile state, Linux focus watching, and OBS integration.
- `src/renderer/`
  - Desktop UI, drag-and-drop deck editor, action browser, plugin import UI, and inspector panels.
- `docs/architecture.md`
  - Structural overview of DeckSmith's runtime and feature communication flow.
- `docs/linux-compatibility.md`
  - Linux distro guidance and setup notes.
- `docs/fedora-alpha.md`
  - Fedora packaging and testing notes.

## Why Electron First

Electron is the right fit for the current milestone because it keeps the whole app in JavaScript while still letting the main process talk directly to Node-based HID libraries.

That gives DeckSmith a faster path to a polished Linux desktop app today, while still leaving room to revisit Tauri later if footprint matters more than implementation speed.

## Features

### Current alpha capabilities

- detects connected Stream Deck hardware and adapts the UI to match
- falls back to a mock deck when no hardware is attached
- supports drag-and-drop key assignment with immediate save
- renders canvas key previews and sends them to hardware
- includes built-in OBS actions for scenes, audio, stream, record, source visibility, and studio mode
- includes built-in core actions for URLs, launching apps, and shell commands
- supports local plugin scanning from `manifest.json` plus `index.js`
- supports plugin import from GitHub, plugin folders, and zip URLs
- includes profile creation and rule-based auto-switching groundwork for Linux
- packages for Linux plus a Windows portable build

### Still early / next to improve

- hardware repaint after automatic profile switches should become fully main-process-driven
- Linux focus detection should be tested on more Wayland compositors
- profile export/import is not built yet
- multi-page deck navigation is not built yet
- plugin isolation is not built yet

## License

DeckSmith is licensed under `GPL-3.0-or-later`.

That means forks and redistributed modified versions must stay under the same GPL family terms, keep notices intact, and make their source available under the same license when they distribute the app.

The thing that stops someone from passing a fork off as the official project is the branding policy in `TRADEMARKS.md`, not the GPL alone.

## Contributing

If you want to help build DeckSmith, start with `CONTRIBUTING.md`.
