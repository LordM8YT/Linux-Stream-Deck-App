# OpenDeck Alpha Foundation

OpenDeck is a Linux-first, open-source alternative to the Elgato Stream Deck app, with two early priorities:

- a polished desktop UI that feels intentionally designed, not purely utilitarian
- a plugin system that is simple enough for independent developers to understand in minutes

The repo now contains the first alpha foundation for an Electron-based desktop app, including built-in core actions, live OBS Studio control, and a Fedora-friendly Linux packaging path.

## Why Electron First

Electron is the best fit for the first milestone because the main process can talk directly to Node-based HID libraries while the renderer stays free to build a rich drag-and-drop interface in plain web technologies.

This foundation keeps the entire app in JavaScript while leaving room to revisit Tauri later if footprint becomes a bigger concern than runtime simplicity.

## What Is Included

- `electron/`
  - Electron entrypoint and preload bridge.
- `src/main/`
  - Device discovery and rendering service backed by `@elgato-stream-deck/node`.
  - Plugin loader that scans `/plugins` for folders containing `manifest.json` and `index.js`.
  - Persistent layout state and OBS connection settings stored in the app data directory.
  - OBS WebSocket service for scene discovery and scene switching.
- `src/renderer/`
  - Desktop UI with an OBS connection panel, plugin palette, drag-and-drop deck grid, and key inspector.
  - Canvas-based previews that can be sent directly to hardware as raw RGBA buffers.
- `build/`
  - Electron Builder icon assets and Linux RPM post-install scripts.
- `plugins/com.linuxstreamdeck.demo.hello/`
  - Example plugin showing the minimum viable developer experience.
- `plugins/com.linuxstreamdeck.core/`
  - Built-in system actions for opening URLs, launching apps, and running commands.
- `plugins/com.linuxstreamdeck.obs/`
  - Built-in OBS Studio actions for scenes, audio, streaming, recording, and studio mode.
- `docs/architecture.md`
  - Structural overview and next-step recommendations.
- `CONTRIBUTING.md`
  - Contributor workflow, setup, and PR expectations.

## Quick Start

```bash
npm install
npm start
```

If you ever update native HID dependencies and need a manual Electron-native refresh, run:

```bash
npm run install:app-deps
```

If no Stream Deck is attached, the app boots into a mock 15-key deck so plugin authors can still iterate on the UI and API.

If a real Stream Deck is attached, physical button presses now trigger assigned actions directly on the hardware.

## Fedora Alpha Packaging

The repo now ships with an Electron Builder path for Linux alpha builds:

```bash
npm run dist:linux:fedora
```

That produces:

- an `.rpm` package for Fedora and other RPM-based desktops
- an `.AppImage` fallback for quick portable testing

As of June 17, 2026, the AppImage build has been verified from WSL2 Ubuntu. The RPM path is configured and builds up to the final packaging step, but requires `rpmbuild` to be installed on the Linux builder machine.

Detailed Fedora notes live in `docs/fedora-alpha.md`.

## Built-In Alpha Actions

The current alpha now includes two built-in action tracks:

- `Core Actions`
  - open a URL or custom protocol
  - launch an app or executable path
  - run a shell command with a timeout
- `OBS Studio`
  - switch scenes
  - mute or unmute inputs
  - start or stop streaming
  - start or stop recording
  - toggle source visibility
  - control studio mode transitions

## OBS Live Control

The current alpha includes a first live-useful OBS path:

- connect to OBS Studio over its built-in WebSocket endpoint
- fetch available scenes
- assign the bundled `OBS Studio -> Switch Scene` action to any key
- choose the target scene in the key inspector
- trigger the action either from the UI or by pressing the physical Stream Deck key

OBS Studio ships with obs-websocket built in on OBS 28.0.0 and later.

## GitHub Releases

The workflow at `.github/workflows/alpha-release.yml` now builds Linux alpha artifacts on version tags like `v0.1.0-alpha.4`, uploads them to Actions, and can publish them to a GitHub pre-release.

## Plugin Contract

In development, plugins live in `/plugins`.

In a packaged app build:

- bundled plugins ship inside the app
- user plugins are loaded from the app data plugin folder
- plugins can be imported from GitHub links directly in the Plugins tab
- marketplace JSON feeds can later point to plugin sources without changing the core import UI

That gives testers a writable plugin location even when OpenDeck is installed from an RPM.

Required files:

- `manifest.json`
- `index.js`

Minimal manifest example:

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

Minimal plugin entry:

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

## Hardware Notes

The app targets `@elgato-stream-deck/node`, which wraps the HID transport and key rendering pipeline for Stream Deck devices. On Linux, users will still need the correct `udev` rules so their session can access the hardware device.

For cross-distro support, the repo now includes Linux-specific guidance and portable `udev` rules in:

- `linux/udev/60-opendeck-user.rules`
- `linux/udev/60-opendeck-headless.rules.example`
- `docs/linux-compatibility.md`
- `docs/fedora-alpha.md`

## License

OpenDeck is licensed under `GPL-3.0-or-later`.

That means forks and redistributed modified versions must stay under the same GPL family terms, keep notices intact, and make their source available under the same license when they distribute the app.

Open source licenses still allow commercial redistribution, so the thing that stops someone from passing a fork off as the official project is the branding policy in `TRADEMARKS.md`, not the GPL by itself.

## Contributing

If you want to help build OpenDeck, start with `CONTRIBUTING.md`.
