# Changelog

## 0.1.0-alpha.4

- Switched the GitHub tag release flow to Linux-only so we can unblock the Linux alpha without rerunning Windows packaging.
- Kept Electron Builder packaging on `--publish never` so GitHub releases are handled only by the explicit release step.

## 0.1.0-alpha.3

- Fixed the GitHub Linux release workflow by removing the failing Ubuntu `install:app-deps` step before packaging.
- Kept the Windows portable build path unchanged for the cross-platform alpha release.

## 0.1.0-alpha.2

- Added a real built-in `Core Actions` plugin with `Open URL`, `Launch App`, and `Run Command`.
- Expanded the built-in OBS plugin with scene, audio, stream, record, studio mode, and source visibility controls.
- Improved the right-side desktop UI so the action browser scrolls independently from the deck editor.
- Added a GitHub Actions release path that can publish Linux artifacts plus a Windows portable build to a GitHub pre-release on version tags.
