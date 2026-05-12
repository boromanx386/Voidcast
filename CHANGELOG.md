# Changelog

All notable changes to this project will be documented in this file.

## [2.5.0] — 2026-05-12

### Added

- **Reddit tool**: read-only `reddit_feed` agent tool via the TTS server (`POST /tools/reddit`) using Reddit's public JSON endpoints (no API key, no OAuth).
  - Three modes in one tool: subreddit feed (`subreddit` + `sort` hot/new/top/rising/controversial/best, with `time` window for top/controversial), search (`query`, optionally restricted to a subreddit), and post fetch (`post_url` returns post + top comments).
  - New backend module `tts-server/reddit_tool.py` (httpx + JSON parsing, validates host against an allowlist of `reddit.com` / `redd.it`).
  - New TS client `electron-app/src/lib/redditTool.ts`.
  - Tool definition added to `toolDefinitions.ts` and gated by a new `toolsEnabled.reddit` toggle in `ToolsOptionsPanel`.
  - System hint `TOOLS_REDDIT_HINT` registered in `chatMessages.ts` and applied in `App.tsx` when the toggle is on.
  - New tool phase `reddit` (⬢ icon, Reddit orange `text-orange-400`) wired through `agentToolPhase.ts` and `App.tsx` `TOOL_PHASE_UI`.
- **OpenRouter voice input (STT)**: optional speech-to-text in the chat composer via OpenRouter Whisper (`POST https://openrouter.ai/api/v1/audio/transcriptions`). Enable **STT_PROVIDER** in TTS options (`none` or `openrouter`), set **OPENROUTER_STT_MODEL** (default `openai/whisper-large-v3-turbo`), reuse **OPENROUTER_API_KEY** from General settings, then use the microphone control next to the composer to record (WebM) and append the transcript to the input. New helper module `electron-app/src/lib/stt.ts`; settings fields `sttProvider` and `openrouterSttModel` in `settings.ts`.
- **Fork chat session**: **FORK** on a session row duplicates that session (same messages and hidden context summary), opens the copy with title suffix `(fork)`, clears per-session UI state (images/audio tool metadata), and persists via existing session storage.
- **Export chat to Markdown**: **EXP** button on every session row exports the full conversation as a `.md` file. Includes title, export timestamp, role headers, message content, image/file attachment notes. Sanitizes the filename from the session title.

### Changed

- `reddit_feed` feed/search output now always emits the canonical `post: https://www.reddit.com/r/<sub>/comments/<id>/...` permalink as the primary URL plus a `id=<base36>` field, with external media moved to a secondary `media:` line only when it differs. Previously, video/image posts surfaced only the `v.redd.it` / `i.redd.it` URL, which the agent could not pass back into `post_url` for a deep dive.
- `reddit_feed` `post_url` argument now also accepts a bare base36 post id (e.g. `1t8kumi`) or thing-id form (`t3_1t8kumi`), not just full URLs. Tool description and `TOOLS_REDDIT_HINT` updated to steer the agent toward the `post:`/`id=` values and away from `media:` URLs.
- `reddit_feed` feed/search output now appends a machine-readable `POST_INDEX` recap at the bottom (`[N] id=<base36> — <short title>`). LLMs hallucinate short alphanumeric ids when reasoning over long tool blocks; the recap gives one canonical, easy-to-copy mapping per call so the agent does not need to re-scan the formatted post list.
- `TOOLS_REDDIT_HINT` rewritten with hard rules: never guess/reconstruct an id from memory, never use a `media:` URL as `post_url`, and fall back to `query` search instead of relying on ids from earlier turns once the conversation has moved on.

## [2.4.1] - 2026-05-10

### Added

- **Edit message**: click any user message to edit its text inline; Save truncates history after that message and regenerates the assistant reply from the edited text. Cancel reverts to the original. Edit mode supports Enter (save) and Escape (cancel) shortcuts.
- **Reminder tools**: full CRUD reminder system for agent-driven notes and scheduled reminders.
  - `add_reminder` — create general or scheduled reminders (ISO datetime)
  - `list_reminders` — filter by today, tomorrow, or date ranges
  - `delete_reminder` — remove by ID or search text
  - `update_reminder` — reschedule or edit text/tags by search text
  - New IndexedDB storage layer: `reminderStorage.ts`
  - Tool definitions in `toolDefinitions.ts`, always available (no toggle)
  - Tool execution handlers in `ollamaAgent.ts` `executeToolCall`
  - UI integrated into `GeneralOptionsPanel` with orange accent (same styling as long memory)
  - New `ClockIcon` component in Lucide outline style
  - Tool phase: `reminder` with ⧗ icon and orange styling
  - Agent hints for reminder usage in `App.tsx`
- `update_settings` tool now supports `autoVoice` (boolean) for agent-driven toggling of automatic TTS speech.
- **Native context menu** (Electron): right-click on any page element shows copy/paste/select-all menu. Editable fields get Undo/Redo/Cut/Copy/Paste/Delete/Select All; non-editable text gets Copy/Select All; links get Open Link.
- Shared agent tool-round engine (`agentToolLoop.ts`) with provider adapters for Ollama and OpenRouter/NVIDIA; neutral tool executor entry (`agentToolExecutor.ts`) and shared helpers (`agentToolUtils.ts`).
- System hint `TOOLS_CODING_CHAT_IMAGE_ASSETS_HINT`: explains chat-stored absolute paths for attachments (`imagePaths`) and saved generations (`generatedImagePaths`), and that coding tools can copy those files into the project via `execute_command` when paths lie outside the project root.

### Changed

- Refactored `runOllamaChatWithTools` and `runOpenRouterChatWithTools` to use the shared loop while preserving behavior (forced first-round scrape/web on Ollama, tool reprompts, image recall flows).
- Chat history for prior user turns with images: text now includes index/path hints for `image_recall` instead of resending raw image bytes in every history message (reduces context bloat; aligns with recall-based vision workflow).
- Extended `TOOLS_RUNWARE_IMAGE_HINT` to document text-only older turns and reliance on `image_recall` for pixels from past messages.
- Tool UI: `image_recall` maps to tool phase `vision` with a distinct indicator style (`tool-indicator.vision`); Runware generate/edit remain under `image`.

### Fixed

- **Auto-scroll behavior**: stops forcing scroll-to-bottom during agent streaming; now scrolls only when a new message is added or when the agent finishes (`busy → false`). Users can freely scroll while the assistant is generating.
- **Reminders not loading in General options**: `refreshReminders()` is now called in the same `useEffect` that loads long memories when opening the General tab.
- `update_settings` changes now immediately refresh the React UI state (previously only `localStorage` was updated, so the UI reflected the change only on the next message).
- TTS playback for the current assistant reply now respects an `autoVoice` change made by the agent within the same turn (reads the latest setting from storage instead of a stale closure).
- Added missing `--color-neon-orange` CSS variable across all themes (fixes `.tool-indicator.reminder` Tailwind error).

### Security

- Hardened Electron renderer bridge by removing globally exposed raw `ipcRenderer` access from preload.
- Added explicit, allowlisted `window.voidcast` methods/events for updater and clipboard-TTS flows, and migrated renderer callers to the allowlisted API.
- Removed unused insecure `open-win` IPC handler that created a `BrowserWindow` with `nodeIntegration: true` and `contextIsolation: false`.

## [2.4.0] - 2026-05-08

### Added

- **Thinking / reasoning stream in chat**: assistant messages can show a collapsible **THINKING** block above the reply when the model streams a trace. Ollama uses `think: true` and `message.thinking` chunks (toggle **THINKING_STREAM (Ollama)** in LLM options). OpenRouter/NVIDIA surfaces `reasoning` / `reasoning_content` deltas when the upstream model sends them. History replays `thinking` on Ollama and `reasoning` on OpenRouter for multi-turn agent loops.
- NVIDIA cloud LLM provider support (`integrate.api.nvidia.com`) across settings, UI, and chat execution paths.
- NVIDIA-specific model presets in LLM options (including Z.AI, MiniMax, DeepSeek, Mistral, Moonshot, and Qwen variants) with manual model override support.
- Desktop Electron `llm-chat-proxy` IPC bridge for NVIDIA fallback requests and richer upstream error details.
- OpenRouter LLM presets: `inclusionai/ring-2.6-1t:free`, `baidu/cobuddy:free`, `openrouter/owl-alpha`, `poolside/laguna-m.1:free`.

### Changed

- Agent tool loops (`runOpenRouterChatWithTools`, `runOllamaChatWithTools`): when the user clearly expects a tool-backed action, the assistant cannot finish with plain text alone until at least one tool has actually run; optional short reprompt rounds apply only **before** any tool executes. After a real tool run in the turn, a final text-only reply is allowed (no false “tool not invoked” error).

### Fixed

- NVIDIA base URL normalization now auto-corrects common misconfigurations (missing `/v1` or accidental `/chat/completions` suffix).
- Retry/backoff now also handles transient upstream `502` and `504` failures.
- Post-abort NVIDIA/OpenAI-compatible requests no longer fail from empty assistant turns in history (`Invalid assistant message`).
- Abort flow no longer allows stale in-flight updates to overwrite current chat state (`runId` guard on stream/tool callbacks).

### Repository

- Ignore local `modal-test/` experiment folder via `.gitignore` so scratch Modal/harness files stay out of version control.

## [2.3.9] - 2026-05-04

### Added

- New `agentToolPhase.ts` module with granular UI tool phases for coding operations: `coding_list`, `coding_read`, `coding_write`, `coding_edit`, `coding_search`, `coding_glob`, `coding_git`, `coding_shell`, plus `settings` and `other` phases.
- Tool indicator CSS styles for image, music, coding, settings, and other phase types.
- **Desktop coding tools** (Electron): optional coding project folder, **Tools** toggle + folder picker, and agent-side tools when coding is enabled:
  - **Panel**: right-side coding panel with expandable file tree, read-only file preview, and terminal; tool calls can append to the panel terminal; **Code** icon toggles the panel.
  - **Main-process IPC** (path-confined to the project): `list_directory`, `read_file` (optional `start_line` / `end_line` / `max_chars`, soft whole-file size limit, internal large read for `edit_code`, skips likely binary files), `write_file`, `edit_code`, `search_files` (optional `path_prefix`; **ripgrep** `rg` on PATH for speed, else built-in walk; shared source extension list with `glob_files`), `glob_files` (extension filter), `execute_command` (timeout, optional background), `git_status`, `git_diff` (optional path, optional staged diff), `git_log`, `git_show`.
  - **Agents**: Ollama and OpenRouter `executeToolCall` wiring plus tool definitions for the above; `list_directory` errors surface to the model instead of returning an empty list.
  - **Note:** For fast `search_files` on large trees, install [ripgrep](https://github.com/BurntSushi/ripgrep) and ensure `rg` is on the system `PATH` (optional; the app falls back automatically).

### Changed

- **`save_pdf` PDF rendering moved to the Python tools server** (`POST /tools/pdf`, ReportLab in `tts-server/pdf_tool.py`). Electron no longer uses `pdf-lib`; the desktop/mobile renderer calls the same HTTP endpoint as other tools. PDF output path is resolved on the host running the tools server. Bundled `voidcast-tools-server.exe` PyInstaller build includes `tts-server/fonts` (Noto Sans). Removed npm deps: `pdf-lib`, `@pdf-lib/fontkit`, `@fontsource/noto-sans`.
- **Coding panel UX**: layout and flex behavior, terminal chunking and row cap with autoscroll, file tree refresh after agent file changes and after **RUN**, panel hidden when coding tools are disabled.
- Chat header **long-memory** and **save session** actions are icon-only buttons (shared brain + save-disk SVGs) with tooltips and `aria-label`s instead of `SAVE_MEM` / `SAVE_CHAT` text.
- **General → LONG_MEMORY** and **LLM → NEW_CHATS_USE_LONG_MEMORY** use the same brain icon next to their headings (`BrainIcon` component).
- Composer hint row below the input no longer shows Ollama model count (`NO_MODELS` / `X MODELS`); the row appears only when there are pending attachments or an unsaved session.

## [2.3.7] - 2026-05-01

### Added

- Long-memory MVP for cross-chat personalization:
  - global `Use long memory` control in `General` options,
  - manual `SAVE_MEM` action in chat header to extract and store durable user memory,
  - memory preview with per-item remove before save,
  - basic long-memory manager in `General` options (list + delete).
- IndexedDB-backed long-memory store with relevance-based retrieval (token overlap + recency + importance/confidence weighting).
- Extraction pipeline that asks the model for strict JSON memory candidates and filters low-confidence/sensitive entries.
- New `update_settings` tool for agent-driven config updates of selected fields (system prompt, context window, temperature, theme, Runware image/edit models, image resolution, and `longMemoryAdd` entry writes).

### Changed

- Long-memory enablement now uses a single global setting (`longMemoryDefaultEnabled`) as source of truth across all chats.
- Chat header save label updated from `SAVE` to `SAVE_CHAT` for clarity.
- Strengthened Runware image/music tool descriptions with explicit mandatory-call wording so the assistant is less likely to claim generation without actually invoking `generate_image` / `generate_music_runware`.
- `update_settings` now updates the active Runware model profile resolution (instead of only legacy width/height fields), and accepts `runwareResolution` in `WIDTHxHEIGHT` format.

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