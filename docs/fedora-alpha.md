# Fedora Alpha Guide

This repo now includes a Fedora-friendly alpha packaging path for OpenDeck.

## Current status

As of June 17, 2026:

- the Linux AppImage build has been produced successfully from WSL2 Ubuntu
- the RPM build path is wired up and reaches the final packaging stage
- the only blocker on this specific WSL machine is that `rpmbuild` is not installed there

That means the current alpha is already testable on Fedora through the AppImage, and the RPM can be produced on Fedora itself or in GitHub Actions.

## What the alpha build produces

- `.rpm` for Fedora users who want a normal `dnf` install flow
- `.AppImage` as a portable fallback for quick testing

The recommended Fedora target is the RPM build because it can run post-install steps for Stream Deck access.

## Build the Fedora alpha locally on Linux

On Fedora:

```bash
sudo dnf install -y rpm-build libappindicator-gtk3 libnotify nss libXScrnSaver xdg-utils at-spi2-core
npm ci
npm run check
npm run dist:linux:fedora
```

Artifacts will be written to `dist/`.

If you ever hit a machine where `node-hid` cannot use its bundled prebuilds, install the normal compiler toolchain and then run:

```bash
npm run install:app-deps
```

## Install on Fedora

```bash
sudo dnf install ./dist/OpenDeck-0.1.0-alpha.3-linux-x86_64.rpm
```

The RPM post-install script attempts to install an `udev` access rule automatically and reload the rules.

If the Stream Deck still does not appear:

1. Unplug and reconnect the Stream Deck.
2. Log out and back in if your session still does not pick up the new `uaccess` permissions.
3. Verify the rule exists at `/usr/lib/udev/rules.d/60-opendeck-user.rules` or `/etc/udev/rules.d/60-opendeck-user.rules`.

## AppImage fallback

```bash
chmod +x ./dist/OpenDeck-0.1.0-alpha.3-linux-x86_64.AppImage
./dist/OpenDeck-0.1.0-alpha.3-linux-x86_64.AppImage
```

The AppImage is great for quick streaming tests, but it does not install `udev` rules system-wide by itself. If hardware access fails, use the rules in `linux/udev/`.

## GitHub Actions build

The workflow `.github/workflows/alpha-release.yml` builds the Fedora alpha artifacts plus a Windows portable build on GitHub Actions, uploads them as downloadable build artifacts, and can publish them to a GitHub pre-release when you push a version tag.

That means you do not need a Fedora machine locally just to produce the first testable alpha package.
