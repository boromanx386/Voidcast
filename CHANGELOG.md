# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed

- **Sub-agent model list with OpenRouter LLM**: Ollama models are always loaded from the configured Ollama URL for the SUB options tab, even when the main LLM provider is OpenRouter or NVIDIA.

### Added

- **Sub-agent vision in history**: after `image_recall` runs the vision sub-agent, descriptions are saved on the chat session and replayed once in prior-turn context next to the matching image (user attachments and saved generated paths). No duplicate injection in the live catalog block or cache-short-circuit on repeat tool calls.

## [2.6.1]

### Added

- **Context compression (chat memory)**: long threads summarize into a hidden session buffer (provider-aware) while the full chat stays in the UI; older turns are omitted from the LLM payload via `contextCompressedThroughIndex`. **AUTO_COMPRESS** toggle in Options → LLM (default on at ~90% `num_ctx`); manual **COMPRESS** remains when auto is off.

### Changed

- **Context compression UX**: with auto-compress on, the yellow COMPRESS/IGNORE banner at ~78% is hidden; a short status line appears only while compressing or waiting for an idle turn. Removed **HISTORY_MESSAGES** from LLM options (always full history in UI).

### Fixed

- **Legacy compressed sessions**: chats with a summary but no compress index are migrated on load so the API does not resend the full thread plus the summary.

## [2.5.9]

### Fixed

- **Reminder / long-memory delete sync**: user-data sync now carries delete timestamps end-to-end and the tools server persists tombstones on disk, so deleted reminders / memories no longer reappear from stale LAN snapshots or after a tools-server restart.
- **Packaged tools-server ownership on Windows**: the installed app now starts only the bundled `voidcast-tools-server.exe` when no local server is already running, and kills the full child process tree on tray **Quit**, so packaged builds no longer leave behind orphan Python/tools-server processes without breaking an external `start-tts-local.bat` server on `:8765`.

### Changed

- **`captureSpawnCommand` refactor** (`electron-app/electron/main/index.ts`): extracted shared spawn wrapper with object parameters, replaced ~80 lines of duplicated logic across `runGitCapture`, `runRipgrepCapture`, and `runCommandCapture`.
- **Reverse-proxy dedup** (`tts-server/main.py`): made `bearer_key` optional in `_reverse_proxy` and simplified `ollama_proxy` to delegate instead of duplicating the full reverse-proxy implementation.

## [2.5.7]

### Added

- **Sub-agent vision**: non-vision main agents can now delegate image description to a separate vision-capable model (Ollama multimodal or OpenRouter). When `image_recall` is called with `purpose: vision`, the sub-agent describes the image and the text result is appended to the tool output — the main agent never sees raw base64.
- **Sub-agent `contextTokens`**: configurable `num_ctx` sent to Ollama sub-agent calls (default 8192, max 128K). OpenRouter ignores this parameter.
- **Sub-agent provider auto-detection**: if the sub-agent model name contains `:` (e.g. `llava:13b`) it routes to Ollama; otherwise it routes to OpenRouter.

### Changed

- **`autoSaveChat` now works as intended**: when ON, new chat sessions are auto-created and saved on the first message (previously only already-saved sessions were auto-updated). When OFF, a save button appears for manual saving; once manually saved, the session auto-updates on subsequent messages.
- **Sub-agent output config**: `maxTokensPerImage` renamed to `outputTokens` (default 300 → 1024). Old key is migrated automatically.
- **Sub-agent prompt**: removed the hardcoded "3 to 5 sentences" limit — `max_tokens` is now the only output cap.
- **Sub-agent UI**: `contextTokens` and `outputTokens` sliders side by side in the same row.

## [2.5.5] — 2026-05-20

### Added

- **Coding context memory persistence and modularization**: extracted `CodingContextMemo` logic from `App.tsx` into a dedicated `codingContextMemo.ts` module with full type safety. Introduced per-project `localStorage` persistence (`voidcast-coding-project-memo-v1`) so recent files, directories, searches, git operations, command history, and failures survive app restarts. Session memory (`recentSearches`, `recentGitOps`) is kept in the active chat; project snapshots (`recentFiles`, `recentFailures`, `recentCommands`, `lastDirectory`) hydrate new chats when the same repo is reopened. `resolveMemoForSession` handles the cross-layer merge. `edit_code` and `write_file` now append `(edited)` / `(written)` labels to `recentFiles`. `execute_command` entries store `{ command, ok, snippet }` with a 150-character output preview (`commandResultSnippet`), so the assistant can see whether `npm run build` succeeded without re-running it. Tool failures are tracked with specific error text and tool name (`recentFailures`). `isCodingToolFailure()` validates failure format per-tool to avoid false positives from normal output. Backward-compatible `normalizeCommandEntry` migrates old string-format command entries.
- **Edit line range tracking**: `edit_code` results now include exact start/end line numbers (e.g. `lines 2102-2104`) parsed from the CRLF-aware `applySnippetEdit` in `codingEol.ts`. `formatEditedFileMemoEntry()` extracts this range and stores `App.tsx (edited lines 2102-2104)` in `recentFiles`, so the assistant knows precisely where changes occurred without re-reading the file.
- **Ollama think levels**: boolean thinking toggle replaced with **off / low / medium / high / on** in LLM options (`settings.ts`, `ollama.ts`).

### Fixed

- **Android / web image attachment**: `splitChatAttachmentFiles` + `probeFileAsImage` decode gallery files with empty `type` or no extension (`createImageBitmap` → `readAsDataURL` fallback). File input snapshot clones via `arrayBuffer()` before `input.value = ''` to stop Android from dropping `File` refs. Web standalone uses a visible `<label>` pointing to `sr-only` input instead of hidden `display: none` + programmatic `click()`. Better error messages guide users to JPEG/PNG on phone (`imageAttachment.ts`, `App.tsx`).
- **Music false image claim guard**: `generate_music_runware` turns no longer trigger the image hallucination reprompt. `isMusicFocusedUserText()` detects music requests; `shouldGuardFalseImageClaims()` skips the guard when the user asked for music. `stripMusicUrlArtifacts()` removes `audio_url:` lines before image claim analysis. `RUNWARE_IMAGE_CDN_RE` tightened to `im.runware` only, excluding `api.runware.ai` (`agentToolUtils.ts`, `agentToolLoop.ts`, `ollamaAgent.ts`, `openrouterAgent.ts`).
- **LAN install + phone web UI**: tools server binds **`0.0.0.0`**; web UI resolves from Electron resources and is bundled in the PyInstaller tools exe and Windows installer (`copy-web-ui-to-install.ps1`, `electron-builder.json`).
- **Reminder toast duplicates after sync**: `notifiedAt` is preserved across LAN/user-data merge and `updatedAt` bumps when a toast fires, so the 30s heartbeat does not re-notify the same reminder.
- **`edit_code` on CRLF files (Windows)**: matches `find_text` with exact, CRLF-expanded, or LF-normalized strategies while preserving on-disk line endings; `read_file` exposes `lineEndings` and adds a model-only CRLF hint.
- **Image catalog + attach vision**: catalog index **1 = current attachment**; vision runs on attach; ordering distinguishes attachments vs generated images more reliably.
- **Forced `web_search`**: uses raw user text only, with tighter freshness heuristics (fewer false triggers).
- **Blood Moon theme validation**: `uiTheme` validation message and tool description now include `blood-moon` as a valid option (`ollamaAgent.ts`, `toolDefinitions.ts`, `App.tsx`).

### Changed

- **Tool-round chat stream**: the in-progress assistant reply text is cleared between model rounds (after tools / forced reprompts), so each stream shows only the current round’s answer. **THINKING** still accumulates across rounds in the same bubble (`---` separators). API history still keeps full turns for the model.

## [2.5.3] — 2026-05-15

### Added

- **Blood Moon theme**: new `blood-moon` interface theme (dark monochrome with red accents) selectable in **Options → General**. Registered in `settings.ts`, `main.tsx`, and `theme-blood-moon.css`.
- **Bidirectional long-memory and reminder sync**: desktop and LAN web can merge entries through the TTS server (`POST /tools/user-data`, `tts-server/user_data.py`). New `userDataSync.ts` orchestrates pull/push; storage layers in `longMemoryStorage.ts` and `reminderStorage.ts` gain merge helpers. Context compression (`contextCompress.ts`) now respects the active LLM provider. Plain-HTTP clients use `makeUuidV4` from `runwareUuid.ts` when `crypto.randomUUID` is unavailable. Launcher script renamed `start-tts.bat` → `start-tts-local.bat`.
- **Shared `NumericSettingInput`**: reusable options control for numeric fields with mobile-friendly steppers (used in Runware image/music panels and LLM/TTS options) instead of raw `<input type="number">` rows.

### Fixed

- **Mobile chat URL overflow**: long Reddit/HTTPS links no longer spill past the message bubble on narrow viewports. `ChatMarkdown` now breaks links and list text (`break-all`, `overflow-wrap: anywhere`, `min-w-0` on flex list rows); message bubbles and the mobile messages scroller clip horizontal overflow.
- **Runware image hallucination guard**: assistant turns that claim an `image_url` without a matching `generate_image` / `edit_image_runware` tool result trigger an automatic reprompt (`agentToolLoop.ts`, `agentToolUtils.ts`). The chat UI only renders Runware images from confirmed tool metadata, not URLs pasted in assistant prose.
- **Chronological image catalog for edit/recall**: tool hints and catalog indexing now follow chat order (1 = newest, including generated images). Generated CDN URLs are fetched into the catalog when not auto-saved; per-turn catalog hints steer the model on which attachment index to pass to `edit_image_runware`.
- **LAN web without local API keys**: phone/tablet web UI strips local secrets from settings and syncs cloud keys (OpenRouter, Runware, etc.) through `tts-server/cloud_secrets.py` so generation still works on the LAN build without embedding keys in the browser bundle.
- **STT disabled on mobile web**: microphone / OpenRouter transcription controls are hidden on phone layouts where recording is unreliable (`platform.ts`).

### Changed

- **Desktop window title**: cleared the Electron `BrowserWindow` title and `index.html` `<title>` so the Windows title bar no longer shows "Voidcast" (the taskbar may still use the executable name from the installer).
- **Header label**: AI panel title renamed to **Void Agent** (was generic "AI").
- **Blood Moon theme polish**: second pass replaced the initial crimson-void palette (heavy gradients, glitch RGB, display fonts) with calmer monochrome (`10 10 12` background) and red reserved for accents only; body uses JetBrains Mono / Inter.
- **Agent tool-call decision making**: removed `shouldRequireToolCall` keyword-matching heuristic from `agentToolUtils.ts`, `ollamaAgent.ts`, and `openrouterAgent.ts`. Both Ollama and OpenRouter agents now pass `mustCallTool: false` to the shared tool loop, letting the model decide autonomously whether to invoke a tool based on the tool descriptions in the system prompt instead of being forced by regex keywords.
- **`TOOLS_TRUTH_HINT` placement and wording**: moved from the end to the **beginning** of the tools hint block in `App.tsx` so it stays in the high-attention region of the system prompt across long sessions. Text tightened to an explicit mandatory rule starting with `Tool-call truth (highest priority):`. Side-effect tool hints (`save_pdf`, music, etc.) gained stronger **MANDATORY** / **CRITICAL** phrasing in the same pass.

## [2.5.2] — 2026-05-14

### Fixed

- **Runware audio `unsupportedParameter` on `settings.guidanceType`**: Runware tightened the allow-list for `audioInference` (2026-05-14) and now rejects requests that include `settings.guidanceType` with `{"code":"unsupportedParameter","allowedValues":"'lyrics','bpm','keyScale','timeSignature','vocalLanguage','coverConditioningScale','repaintingStart','repaintingEnd'"}`. The renderer no longer forwards `guidanceType` in the audio payload (`invokeRunwareGenerateMusic` in `lib/runware.ts`), and the short-lived `GUIDANCE_TYPE` dropdown in `RunwareMusicOptionsPanel` has been removed since it can no longer affect the API. The `runwareMusicGuidanceType` setting is still parsed/normalized so older stored configs continue to load without errors; the value is just dropped at send time.
- **Runware audio `unsupportedCFGScaleForModel` on `CFGScale`**: same 2026-05-14 audio-API rebalance also stripped the top-level `CFGScale` parameter (`{"code":"unsupportedCFGScaleForModel","parameter":"CFGScale"}`), even though their docs still link to a `#request-cfgscale` anchor. `invokeRunwareGenerateMusic` no longer sends `CFGScale`, and the `CFG_SCALE` numeric input in `RunwareMusicOptionsPanel` has been removed (the per-model profile field is kept on disk for back-compat in case Runware reverts).
- **Chat scroll position when returning from Options**: previously the chat `<main>` was unmounted while the Options screen was rendered (`if (screen === 'options') return ...` returns a parallel JSX tree), and the existing save/restore `useLayoutEffect` only captured `scrollTop` *after* the unmount — `chatMessagesRef.current` was already `null`, so it always saved `0` and the next return scrolled to the top. Now the scroll position is tracked continuously via an `onScroll` handler on the chat `<main>` and stored in `savedChatScrollRef`; the `useLayoutEffect` on `screen` change still restores it after the `<main>` re-mounts. Auto-scroll effects on `[messages.length]` and `[busy]` don't refire on screen toggles because their dependencies don't change, so the restored position sticks.

### Changed

- **Ollama transient-error retries**: `streamOllamaChat`, `streamOllamaChatOnce` (agent tool loop), and `fetchOllamaModels` now retry on `408`, `425`, `429`, `500`, `502`, `503`, `504` (e.g. hosted Ollama returning `503 model is temporarily overloaded`). Up to 4 attempts with exponential backoff + small jitter, and honors the `Retry-After` header when the server sends one. Each tool round is wrapped — a transient 503 after a tool call no longer aborts the conversation, the same backoff applies on every model round. Cancellation via the existing `AbortSignal` interrupts both the in-flight request and the backoff sleep, so user stop/regenerate still feels instant. The shared retry helper `fetchOllamaWithRetry` is exported from `ollama.ts` so other call sites can reuse the same policy.
- **`save_pdf` rendering polish (`tts-server/pdf_tool.py`)**:
  - Table cells now parse `**bold**` markers via the rich-text wrapper (bold-aware width metrics), so model names like `**OpenAI GPT-5.5 Pro**` render as bold instead of leaking literal `**` characters into the PDF. Header rows are still forced bold regardless of inline markers.
  - Single-asterisk italics (`*caption*`) are stripped during normalization since no italic font is bundled; `**bold**`, `_snake_case_`, and Python dunders like `__name__` are intentionally left alone (guarded against `\w` neighbors to avoid eating math like `5*4`).
  - Duplicate first-heading suppression: when `content` begins with a markdown heading whose text matches the `title` argument (exact match after whitespace/punctuation folding, or prefix-match in either direction for titles ≥ 12 chars), that heading is dropped so the title-block + body don't show the same line twice.

### Added

- **`save_pdf` image embedding for AI-generated images**: new `image_urls` argument lets the agent pass public http(s) URLs (e.g. the `image_url:` value from a prior `generate_image` / `edit_image_runware` turn) into the same call. The tools server fetches each URL with SSRF protection (http(s) only, blocks loopback/private/link-local/multicast hosts), enforces the shared 48 MB total-image cap, supports PNG/JPEG/WebP, and reports per-URL failures back to the model so it can explain skips. `POST /tools/pdf` endpoint and `PdfRequest` model gain the matching `image_urls` field; `savePdf.ts` forwards it; `TOOLS_PDF_HINT` instructs the agent to copy the URL string from the prior tool turn into this array instead of pasting it into the markdown body.
- **`save_pdf` inline image placement**: standalone markdown image lines inside `content` now position images at that exact spot in the PDF. Use `![caption](attached:N)` for the N-th attached image (0-based, same index space as `attached_image_indices`) or `![caption](url:N)` for the N-th entry of `image_urls`. Any image whose marker isn't written inline still falls back to a trailing gallery so existing callers keep working unchanged.
- **Runware music: ACE-Step v1.5 Base preset** alongside the existing Turbo variant. New `runwareMusicModel` setting plus per-model profile map `runwareMusicModelProfiles` (mirrors how image models are configured): each variant remembers its own `outputFormat`, `durationSec`, `steps`, `cfgScale`, and `seed`. Defaults: Turbo `steps=10` / Base `steps=100` (with `steps` cap raised to 300 for Base). New model dropdown in **Options → Runware Music**; switching variants restores its saved values without touching the other. `invokeRunwareGenerateMusic` now picks the model id from `musicDefaults.model` (validated against the allow-list) and applies the per-model `steps` clamp (20 for Turbo, 300 for Base). Migration: on first load, the Turbo profile inherits the old top-level music fields; the Base profile seeds from Runware docs defaults.
- **Drag-and-drop chat attachments**: drop images (PNG / JPEG / WebP / GIF / BMP / AVIF / TIFF / ICO / HEIC / SVG) and supported files (TXT, MD, PDF, DOCX, CSV, JSON, JS, TS, PY, JAVA, CS, HTML, CSS) directly onto the chat screen. Reuses the same limits as the file picker (4 MB / image, max 4 images per message; max 8 files). Drop overlay with hint, gated while a turn is busy or a message is being edited, and a global `dragover`/`drop` guard so a missed drop never navigates the renderer.
- **Reminder desktop notifications**: scheduled reminders fire a native Windows toast (browser `Notification` API forwarded by Electron) when due. New `Reminder.notifiedAt` field plus `listDueUnnotifiedReminders` / `markReminderNotified` helpers in `reminderStorage.ts`. Renderer ticks every 30 s, deduplicates by `tag = reminder.id`, persists `notifiedAt` so it never refires after a refresh. Clicking the toast focuses the window and opens **Options → General**. New `settings.reminderNotificationsEnabled` (default `true`). General panel exposes the toggle plus a `REQUEST PERMISSION` button when the OS state is `default`, with a help line pointing to Windows Settings when permission is `denied`.
- **Chat notification sounds**: choose local audio files for two events — assistant reply done (`ON_REPLY_DONE`) and chat error (`ON_CHAT_ERROR`). New `lib/notificationSoundStorage.ts` (IndexedDB `voidcast-notification-sounds-v1` keyed by kind, stores `{ blob, fileName, mime }`) and `lib/notificationSounds.ts` (blob-URL cache, `playNotificationSound(kind, { volume })`, `looksLikeAudioFile`, accept list). Settings `notificationSoundsEnabled` (default `true`) and `notificationSoundVolume` (0–1, default `0.8`, clamped in normalizer). `CHAT_SOUNDS` section in General options (placed directly under `INTERFACE_THEME`): master toggle, volume slider, two slots with **PICK FILE / CHANGE**, **▶ PREVIEW**, **CLEAR**, error banner, 2 MB cap, accepted formats MP3 / WAV / OGG / M4A / AAC / FLAC / WebM. The reply sound is suppressed when **Auto-voice** is on and the TTS server is reachable so it does not collide with the spoken reply.

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