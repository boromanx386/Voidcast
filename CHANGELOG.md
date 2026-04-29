# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [2.3.6] - 2026-04-29

### Added

- Bundled tools-only backend executable in the Windows installer so web search / scrape / YouTube tools work out-of-the-box without requiring a separate Python installation or manual venv setup.
- OpenRouter GPT-4o Mini TTS provider (`openrouter-tts`) using `openai/gpt-4o-mini-tts-2025-12-15` for cloud-based text-to-speech.
- OpenRouter TTS voice selection presets in options (`alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `onyx`, `nova`, `sage`, `shimmer`, `verse`, `marin`, `cedar`).

### Fixed

- OpenRouter TTS now correctly forwards API key/model/voice from app settings into synthesis requests.
- OpenRouter TTS requests now enforce `response_format: mp3` and normalize playback blob type to `audio/mpeg` to prevent playback failures.

## [2.3.5] - 2026-04-28

### Added

- OpenRouter provider support for chat streaming and tool-calling flows (parallel to existing Ollama path).
- OpenRouter settings in LLM options: provider switch, base URL, model selection, and preset model profiles with manual override.
- OpenRouter API key field in General options (local-device storage wording + direct key link).
- Automatic retry/backoff handling for OpenRouter `429` and `503` responses, plus fallback to `openrouter/free` after repeated upstream failures.

### Fixed

- Desktop CSP `connect-src` now allows external HTTPS/WSS endpoints, preventing immediate `Failed to fetch` errors for OpenRouter calls.
- OpenRouter renderer request headers trimmed to avoid blocked/forbidden header issues in desktop runtime.

### Changed

- Increased file attachment snapshot truncation limit from `200KB` to `400KB` for chat attachment ingestion, desktop extraction, and persisted session storage.
- Updated General options copy to clarify desktop-local Runware API key storage wording.
- Added direct link in General options to [Runware](https://runware.ai/) for API key setup.
- Tool-round streaming now preserves assistant text in the same chat bubble instead of clearing content between rounds, so post-tool output appends rather than replacing prior analysis.
- Version bump to `2.3.5`.

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
