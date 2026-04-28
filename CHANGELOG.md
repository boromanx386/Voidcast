# Changelog

All notable changes to this project will be documented in this file.

## [2.3.4] - 2026-04-28

### Added

- Unified `+` attach flow in chat composer that opens a single picker for both images and supported files.
- File attachment snapshots in chat context/history for: `txt`, `md`, `pdf`, `docx`, `csv`, `json`, `js`, `ts`, `py`, `java`, `cs`, `html`, `css`.
- Desktop extraction of `pdf`/`docx` text into attachment snapshot content (with truncation safeguards).

### Fixed

- TTS health status now refreshes correctly when switching provider/API-key so Runware xAI mode no longer shows false OFFLINE.
- Removed repeated file snapshot replay in follow-up turns; snapshots now stay bound to the original attachment message.

### Changed

- Reduced header height and hamburger button size for a tighter chat top bar.
- Set minimal as default UI theme and fallback for unknown theme values.
- Footer system area now prioritizes context usage readout and now shows `CTX` (prompt tokens / context window) plus `OUT` (generated tokens) separately.
- Removed runtime clock display from chat UI.

## [2.3.3] - 2026-04-27

### Added

- `save_pdf` can embed images from the current user message (PNG/JPEG) after the text body, using `embed_attached_images` and/or `attached_image_indices` in the tool call.

## [2.3.2] - 2026-04-27

### Added

- Save PDF formatter now preserves explicit single-line breaks inside blocks.
- Save PDF list parsing now supports:
  - `-`, `*`, and `•` unordered list markers
  - ordered list markers like `1.`, `2.`, ...
  - continuation lines merged into the previous list item

### Changed

- Save PDF list rendering now uses hanging indents for wrapped list content.
- Tool guidance text updated so agents can format PDF content more consistently.

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
