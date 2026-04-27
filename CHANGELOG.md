# Changelog

All notable changes to this project will be documented in this file.

## [2.3.1] - 2026-04-27

### Added

- MIT licensing package for public release prep:
  - root `LICENSE`
  - `THIRD_PARTY_NOTICES.md`
- Expanded `README.md` with:
  - features overview
  - cloud-first usage note
  - roadmap section
  - screenshots section with labeled UI previews
- General settings update controls:
  - `AUTO_UPDATE` toggle
  - manual `CHECK FOR UPDATE` flow when auto-update is off

### Changed

- Options tab labels renamed:
  - `RUNWARE` -> `IMAGE`
  - `RUNWARE_MUSIC` -> `MUSIC`
- Removed mobile QR/LAN block from General options UI (temporarily hidden).
- Footer build label now shows runtime app version via Electron IPC.

### Fixed

- Auto-update toggle now controls actionable update behavior:
  - syncs toggle state to updater runtime
  - supports startup checks when enabled
  - prompts user to install after update download

## [2.2.3] - 2026-04-27

### Changed

- Version bump to `2.2.3`.
- Runtime build version display replaced hardcoded footer text.

## [2.2.2] - 2026-04-27

### Added

- GitHub release publish flow for updater:
  - `electron-builder` GitHub publish config
  - `build:publish` script

### Fixed

- Runware request reliability in desktop app via Electron/main-proxy routing.
- Improved Local TTS guidance and external setup UX messaging.

### Packaging

- Main installer kept lean:
  - includes Electron app + tools-server resources
  - excludes heavy local TTS dependencies/models
- Added split Python entrypoints/dependency profiles for tools-only vs local TTS mode.
