# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [2.8.8] — 2026-08-28

### Added

- **Footer CTX popup**: click the CTX meter for auto-compress (90%) toggle + **COMPRESS NOW** anytime — useful on large-context models before you hit the limit.
- **Parallel tool rounds and live progress**: adjacent read-only tool calls run concurrently (up to 4), while serial/mutating tools remain barriers; the chat shows active tool names and preserves intermediate assistant drafts in collapsible round blocks.
- **OpenRouter provider listing**: Options → LLM can list all providers serving the selected OpenRouter model, including context, pricing, and uptime; clicking a provider applies the per-model routing lock.
- **Folder shortcut for new chats**: the folder button beside **New chat** opens the project folder picker and starts the new chat bound to the selected folder.

### Changed

- **Cloud model catalogs refreshed**: OpenRouter, NVIDIA, OpenCode Go, and CrofAI presets and context-window metadata were updated against current provider catalogs. The model checker now supports all four catalogs and an interactive `--apply` workflow.

## [2.8.6] — 2026-08-25

### Added

- **CrofAI LLM provider**: OpenAI-compatible chat at [`https://crof.ai/v1`](https://crof.ai/docs) — presets from `/v1/models`, API key in General, THINKING_LEVEL → `reasoning_effort`, sub-agents / pins / CTX meter, LAN proxy via TTS `/api/crofai/*`.
- **OpenRouter presets**: [Ox Alpha](https://openrouter.ai/stealth/ox-alpha) (`stealth/ox-alpha`, free · 1M · multimodal) and DeepSeek V4 Flash Vision Exp (`deepseek/deepseek-v4-flash-vision-exp`).
- **OpenCode Go presets**: `deepseek-v4-flash-vision-exp`, `ox-alpha-free`, and `longcat-2.0` (all `/v1/chat/completions`).

### Fixed

- **Stale chat images no longer auto-injected into later turns**: keyword matches like “analyze / describe / inspect” no longer re-attach the newest session image as if the user just uploaded it. Vision bytes go only with images attached on the current message; older images stay in the catalog for explicit `image_recall`.

## [2.8.4] — 2026-08-13

### Added

- **Multi-chat concurrent agents**: run agents in several sessions at once (soft cap **3**). Each chat has an isolated runtime slot (`sessionAgentStore`): messages, abort, tool phase, media. Switch sessions while others keep working; busy/unread sidebar indicators; background finish can show a DONE-style affordance. Coding tools isolate by **project path**, shell owner, and terminal feed; draft→session rekey mid-run. Extra starts past the cap are refused until a run finishes or you Stop.
- **Team mode + coding workers**: composer cycles **Agent → Ask → Plan → Team**. Team prefers early **`run_coding_workers`** (up to **2** parallel workers on the coding sub-agent model). Agent may call workers when helpful; Plan and Ask have no workers. Team and Ask drop `enter_plan_mode`. Approve & Build follows the composer (**Team** if selected, else **Agent**).
- **Ask mode**: read-only Q&A (no Plan fence/card). Mutating tools, workers, settings/reminder writes, and `mcp_call` are off; system/tool hints match read-only scope. For a plan card use Plan; for edits use Agent/Team.
- **`run_coding_workers` tool**: 1–2 path-oriented tasks, optional `path_prefix` (hard write/edit scope), file locks between workers, default/max **100** tool rounds per worker, force digest if the model never ends with `done`. Main **awaits** the batch (workers parallel with each other only). No nesting.
- **Coding explore / sub providers**: `coding_explore` read-only nested map; SUB panel providers aligned with main (OpenRouter / NVIDIA / DeepSeek / OpenAI / OpenCode Go + Ollama), openrouter locks, pins; internal CTX/OUTPUT defaults (16k / 2k). OpenCode Go workers use the real API key.
- **In-chat sub-agent analysis card**: VISION / EXPLORE / WORKERS progress on the **assistant message** (collapsible, dismissible); persists with the session when saved. Options → SUB → **SHOW_ANALYSIS_IN_CHAT** (replaces floating panel).
- **Steer mid-turn**: while the agent is working, type a correction and press **Enter** (or the compass Steer button) to abort the live turn and immediately start a new one with a course-correction frame for the model. Plain stop still only cancels. Steered user bubbles show a `STEER` badge.
- **Sticky unsaved drafts** (auto-save off): drafts stay in the sidebar so you can leave and return without losing them until you Save.
- **Clipboard paste images** as pending chat attachments.
- **Product docs**: [docs/multi-chat-and-team.md](docs/multi-chat-and-team.md) plus updates across chat / coding / SUB / architecture.
- **Resizable preview ↔ terminal split** in the coding panel: a draggable horizontal divider between file preview and the terminal (only when both are visible; commit bar sits inside the terminal stack when dirty). Persisted height (`terminalHeightPx`, default 200px, clamped 80–480) with pointer-drag + keyboard support (↑/↓ 16px step, Shift 32px, Home/End for min/max). Terminal-only (or terminal + commit, no preview) fills remaining space with no divider; commit-only uses natural height.
- **Terminal auto-scroll**: streamed output follows to the bottom while you're at the end, but does not yank the scroll position if you've scrolled up to read older output.

### Changed

- Coding worker round budget raised (and documented) to **100** rounds.
- **Save icon only while unsaved** (auto-save off): the SAVE affordance now shows only for sessions that are genuinely still drafts (`unsaved` flag), not whenever any new message arrives. Saving a chat once removes the flag, and from then on the session auto-persists — the save icon no longer reappears for already-saved chats.
- **Ignored/generated dirs shown dimmed** instead of hidden: heavy folders (node_modules, dist, …) stay visible in the coding file tree, rendered dimmed, and a double-click opens the path in the OS app.
- **Agent bubble bold de-accented per theme**: bold formatting in the assistant bubble no longer uses the theme accent on **Minimal zinc** (full-neutral bubble — h1, bullets, links and blockquotes also neutral), **Blood Moon** (neutral ivory bold), and **Terminal** (only bold neutralized, amber accents kept for the rest). **Matrix** bold switched from harsh phosphor green to a softer green.

### Fixed

- **Coding file preview stays scrollable in the split pane**: with a preview ↔ terminal split, the file preview keeps its own independent scroll area instead of losing it when the terminal pane is shown.
- **Coding terminal stays scrollable when the pane is shrunk**: shrinking the terminal no longer clips streamed output — the terminal keeps its scrollback and only follows the end when you're already at the bottom.
- **Multi-chat agent run slot leaks + concurrency race**: fixed runtime-slot leaks and a race where concurrent multi-chat runs could step on each other's tool phase / abort state.
- **Multi-chat project concurrency + worker shell locks**: clarified and enforced per-project concurrency and shell-owner locking so parallel multi-chat or worker runs on the same project path no longer corrupt each other's terminal feed or edits.
- **Worker edits update the parent coding memo (no race)**: a `run_coding_workers` batch now patches the parent session's coding memo after a successful worker `edit_code` instead of racing on stale digests.
- **Terminal resize snap-back + bottom pane sizing**: releasing the preview ↔ terminal drag used to reset height — an effect re-applied stale `terminalHeightPx` as soon as the resize flag cleared, before settings persisted. Drag direction follows the bottom-anchored pane (drag up grows the terminal). Splitter and fixed height apply only with preview + terminal; commit-only stays natural; terminal without preview fills.

## [2.8.2] — 2026-08-07

### Added

- **Soft-deny whole-file re-reads**: `read_file` now refuses a full re-read of a path already in the session digests or this turn's working-set cache, returning a compact digest reminder (with `force:true` / `start_line` / `end_line` guidance) instead of re-dumping the file. New `force` parameter escapes the guard. Soft-deny reminders are not re-added to the cache, so the working set stays stable.
- **Plan handoff lands in the user message**: on `enter_plan_mode`, the prior agent-mode exploration is injected as a real user-lane block (not just a tools hint), so the Plan turn actually starts from that research.
- **Richer plan handoff draft + tool trail**: when escalating to Plan mode, the pre-plan agent reply stays visible as a `→ Plan mode · kept as draft before plan` note (the real reply when substantial, otherwise the explored-file digests), and the Plan context now carries a compact one-line-per-event tool trail with **HARD CONSTRAINT** no-reexplore hints so Plan mode does not redo the research from scratch. Streamed content is no longer cleared between tool rounds.
- **Covered-path memo block**: session covered paths (the soft-deny list) are surfaced in the coding memo above the digests, so the agent sees what is already in context; `read_file` / `find_symbols` results stay pinned longer in long tool loops (read pin 3 → 6, outlines 2 → 4, keep-read rounds 8 → 12).
- **Per-project new-chat button**: project-folder groups in the sessions sidebar get a `+` button (revealed on hover) that starts a brand-new chat already bound to that folder.
- **Type while the agent is busy**: the composer no longer disables input during a running turn; a draft status shows when you've queued text or attachments while the agent runs (see also **Steer mid-turn**).
- **LAN access token for phone/web clients**: the LAN QR/URL now carries a shared access token (`?t=...`), sent as `x-voidcast-access-token` on every same-origin request and stripped from the address bar (session-persisted so refresh keeps working). Server-side CORS relaxed to wildcard origin with `allow_credentials=False`.

### Changed

- **Terminal theme contrast softened**: replaced the pure-black background with a warm dark-charcoal backdrop and dimmed the amber/phosphor accents so the phosphor reads as a quiet glow instead of neon glare. Fixed the `coding-terminal` selector typo and stripped the UTF-8 BOM from the theme file.
- **Matrix theme more black, less green**: background surfaces pulled toward near-black (`1 3 1` / `2 6 2`) and the digital-rain backdrop dropped from 0.42 to 0.18 opacity; message bubbles, header, input and sidebar borders dimmed, and the body green text-glow removed — green now accents rather than floods.
- **Build prompt stays internal**: clicking **Build plan** on a plan card no longer dumps the full `formatPlanForBuildPrompt` (all steps + code) into the chat. The build prompt still goes to the model, but the visible user bubble is a short `Build approved plan: <title>` label.
- **No duplicate plan todo list**: removed `PlanBuildProgress` (a second, redundant step list) — the plan artifact card in the message is the single live view of build steps.
- **Long-memory picker moved to the composer**: the header brain icon is gone; the long-memory extractor now lives next to the system-prompt preset chip as a bare icon (with a busy spinner), smaller than the surrounding toolbar buttons.
- **Coding panel stays collapsed on file reveal**: when the agent edits/reveals a file, the preview and file-tree toggles are no longer force-enabled — the panel only loads the file into preview state if the section is already open, and no longer reflows the layout (which used to scroll the app back to top).
- **Higher default context for cloud providers**: OpenRouter, NVIDIA, OpenAI and OpenCode Go defaults raised from 128k to 256k tokens.
- **OpenRouter LLM presets refreshed**: added Opus 5, Qwen3.8 Max, Muse Spark 1.2, Ling 3.0 Flash, Nemotron Nano, Cohere North Mini Code; dropped outdated models.
- **Sub-agent long-memory toggle removed**: `USE_FOR_LONG_MEMORY` dropped — long-memory extraction now always follows the main LLM (the sub-agent is vision / coding only). The `memoryEnabled` setting is stripped on load.

### Fixed

- **Thinking bubble follow button**: removed the pin emoji (`📌` / `📍`) from the follow toggle — clean text only.
- **Long-memory picker with OpenCode Go / OpenAI sub-provider**: when extraction ran through a sub-agent provider, `opencode-go` / `openai` now route to their own endpoints instead of falling back to OpenRouter.
- **Coding file tree when no folder selected**: the tree now clears stale files/dirs and shows a clear bold **No folder selected** state instead of leftovers from the previous project.

### Security

- **Closed LAN auth and CORS holes for phone/web access**: every tools-server proxy / data / TTS route (`/tools/*`, `/api/*`, `/tts`) is now gated behind `require_lan_access` — loopback (the desktop) is always allowed, non-loopback callers must present the shared access token (`x-voidcast-access-token` or `Authorization: Bearer`). Removed the invalid `allow_credentials=True` + `["*"]` wildcard-CORS combination (`allow_credentials=False` now); a new `/tools/access-token` endpoint lets the desktop LAN panel fetch the token to embed in the phone URL.

## [2.8.0] — 2026-08-03

### Added

- **Shared agent tools architecture**: tool execution moved out of the Ollama-centric path into a shared catalog + domain handlers (`toolHandlers/` for web, media, coding, app, MCP, image recall) and `agentToolExecutor`, so Ollama / OpenRouter / cloud adapters share one executor. Shared `ChatWithToolsCommonParams` + `buildToolExecutorOptions` in `agentParams.ts` remove duplicated tool-loop wiring.
- **OpenCode Go LLM provider**: OpenAI-compatible chat provider preset (`opencode-go`) with settings, model list, and desktop CORS via the local TTS reverse proxy (`/api/opencode-go/...`). Reasoning fields sanitized for Go; `reasoning_content` round-tripped on tool turns (including empty string when tool_calls are present).
- **Pinned model switcher**: status-bar popup to jump between pinned models; pin IDs scoped with a provider prefix so OpenRouter / NVIDIA / DeepSeek / OpenCode Go no longer collide on the same model slug.
- **PDF/DOCX chat attachment text extraction on drag-and-drop**: renderer sends the file buffer over IPC (`parseChatAttachmentBuffer`); main uses the same `extractTextFromBuffer` path as the native picker (`pdf-parse` / mammoth), so DnD and picker stay in sync. Web-standalone without the bridge still attaches metadata only.
- **Plan-mode research persistence**: research/context from Plan mode carries into the Approve & Build phase instead of being dropped on handoff.
- **`find_symbols` coding tool**: read-only symbol outline (functions, classes, methods, interfaces, types, exports, headings) with 1-based line numbers for a single file. Regex-based per-language heuristics (TS/JS, Python, Go, Rust, Markdown) — zero new deps. Output line numbers mirror `read_file`'s `N|` convention and feed straight into `edit_code` `start_line`/`end_line` anchoring. Supports an optional `query` filter on symbol name and a `max_symbols` cap. Wired through the full pipeline (tool definition → handler → IPC bridge → preload → main), plus the `coding_outline` UI phase, a clear-result digest, Plan-mode read-only allowlist, tool-choice hint, and docs. Available in Plan mode (read-only).
- **`check_types` Python support**: auto-detects Python projects (requirements/pyproject/ruff markers or `.py` paths) and runs **ruff check** first, then **pyright** if ruff is missing. TypeScript/`tsc` path unchanged. Same unified `file:line:col — code: message` report format.
- **Terminal theme**: raw retro CLI amber-phosphor on dark-black — terminal-style scrollbar, cyan/amber highlights, CRT scanline texture, `IBM Plex Mono` monospace, amber `#ffb000` accents, phosphor glow on focused inputs and buttons. Added `uiTheme.css` rules and registered `terminal` in settings and the theme picker.
- **Hardened coding tools — structural digests**: cleared tool results (`git_diff`, `search_files`, `list_directory`) now emit a compact digest (line count, file count, summary) instead of raw multi-thousand-char dumps; Plan mode gets the digest without full text. Git `git_show` gains a `path` parameter for single-file diff; `git_diff` accepts a `path` prefix. `check_types` supports optional `paths` to filter after edits.
- **Hardened coding tools — safer edits**: `edit_code` now requires an exact `find_text` match (no model-invented fuzzy diffs). Fallback strategy: tries exact, then CRLF-expanded, then LF-normalized; on mismatch returns the first 200 chars of the actual file content and a `closest_matches` list with 50-char context lines. `write_file` writes to a temp file and renames (atomic), with auto-closing trailing newline and optional `start_line`/`end_line` range for large files (400 lines or ~25k chars per call).
- **Hardened coding tools — process control**: three new tools `list_processes` (active shell processes with runId, command, status), `stop_process` (kill foreground/background by runId), and `read_process_output` (poll last ~64KB of stdout/stderr with an `offset` for incremental reads). Added `run_in_background` flag to `execute_command` for dev servers/watchers that stay running after printing success. Stdout/stderr ring buffer (~256KB per process).
- **Qwen TTS extras**: Top-level Runware `positivePrompt` (style/emotion) for `customvoice` / `voicedesign`, plus `speech.speed` (0.25–4) and `speech.language` for Qwen models. Playback and bake-phrase preview pass the new settings through. New settings: `runwareXaiPositivePrompt` (string) and `runwareTtsSpeed` (default 1.0).
- **Runware TTS voice catalogs**: synced voice presets from current Runware schemas — full xAI (dropped invalid `auto`), Gemini (30), Inworld 1.5 (~73), MiniMax multilingual library, Fish Audio (+Ethan/Hannah/Egirl). Invalid/legacy voice ids reset to the model default on load.
- **OpenAI Chat Completions provider**: first-class `openai` preset wired through settings, model list, sub-agents, and the LAN proxy (like DeepSeek). `reasoning_effort` is forced to `none` whenever tools are active (OpenAI rejects it with tool calling), and stream usage is requested so the CTX meter can show real token counts.
- **Per-chat system prompt presets**: composer preset chip (`default` / `code` / `creative` / `teacher`) — select a persona per chat session, stored with the session. Presets ship in the chip as a dropup menu styled like the pinned-LLM chips.
- **`check_types` Go + Rust support**: auto-detects Go (`go.mod` / `.go` → `go vet`) and Rust (`Cargo.toml` / `.rs` → `cargo check --message-format=json`), parsing `file:line:col` diagnostics into the same unified report format as TS/`tsc` and Python.
- **`git_restore` / `git_stash` coding tools**: undo a bad edit on a tracked path (`git restore` from the index, or to `HEAD` with `to_head`) and checkpoint without committing (`git stash list / push / pop`). Both are blocked in Plan mode.
- **Turn summary + post-edit working-set patch**: a compact last-turn digest is carried into the next prompt so the agent knows what changed; the file cache is patched after a successful `edit_code` instead of being invalidated wholesale.
- **File digests across turns harvested into Plan research**: session-scoped digests from `read_file` / `find_symbols` / edits survive turn boundaries, so the Build phase reuses Plan knowledge without re-reading whole files.
- **Exploration carried into Plan mode**: on `enter_plan_mode` handoff the coding memo is synced via ref and its digests/summary are injected into the Plan turn, softening explore pressure so Plan mode does not re-read everything from scratch.

### Changed

- **Cloud API key fields collapsed into a provider chip selector**: one dynamic key input with per-provider chips (showing whether a key is set), defaulting to the active LLM provider — replaces the long list of separate key inputs in Options → General.

- **Session folders default collapsed**; coding panel width range widened.
- **Coding panel stays collapsed** when the agent edits files (no auto-expand on every write/edit).

### Fixed

- OpenCode Go desktop chat no longer fails with opaque `Failed to fetch` (missing CORS) — requests go through the TTS proxy.
- OpenCode Go multi-turn / tool-loop 400s from incompatible OpenRouter-style `reasoning` payloads — sanitized + `reasoning_content` echoed on tool turns.
- Pinned-model IDs colliding across providers (same slug on OpenRouter vs NVIDIA / DeepSeek / OpenCode Go).
- Gemini image generation no longer snaps dimensions to multiples of 16.
- Command stdout throttle is flushed before the agent snapshot so the final chunk of a long-running command's output is not lost.

## [2.7.9] — 2026-07-24

### Added

- **Chat keyboard shortcuts**: Ctrl+S to save session, Ctrl+N for new chat, Shift+Tab to toggle Plan/Agent mode.
- **Coding process tracking**: The agent sees active shell processes (foreground/background) as a CTX hint — knows about running dev servers, watchers, and agent-browser sessions.
- **Background process promotion**: Long-lived CLI commands auto-promote to background after 2.5s of idle output; stop button targets only foreground runs.
- **MAX_TOOL_ROUNDS setting**: Configurable in Options → Tools (default 50, range 5–120) with soft wrap-up and hard budget-exhausted fallback.
- **Background processes survive chat switches**: Switching sessions no longer kills background processes — only foreground runs are stopped.
- **App quit cleanup**: Active coding processes are killed on app quit.
- **image_recall decoupled from Runware**: Vision recall is always available regardless of Runware image tool toggle.
- **Sub-agent vision/coding split**: Separate endpoints and provider lock for sub-agent vision and coding.
- **Matrix theme overhaul**: Classic green-black palette with digital code rain.
- **Chat sessions grouped by project folder**: General chats + project-specific groups in the sidebar.
- **Custom Windows title bar**: Cyber-btn header controls replace native caption buttons.
- **OpenRouter/NVIDIA LLM presets refresh**: Updated model catalog.
- **False coding claim reprompting**: Agent is reprompted when it claims completion without real tool calls.
- **OpenRouter provider memory**: Provider slug is remembered per model.

### Changed

- **Composer**: Stop button merged into send button (replaces header diamond mark).
- **Chat sessions sidebar**: Sessions grouped by project folder; General chats at the top.
- **Matrix theme**: Classic green-black with digital code rain.
- **Coding sub-agent**: Uses trim + clear-old-results instead of compress for context management.
- **read_file UX**: No longer auto-reveals the coding panel.

### Fixed

- Long-lived shell commands no longer stall the tool budget.
- OpenRouter provider slug is now correctly remembered per model across chat sessions.

## [2.7.7] — 2026-07-18

### Added

- **MCP client (desktop)**: connect stdio and remote HTTP/SSE servers from `~/.voidcast/mcp.json` (optional project `.mcp.json`). Progressive discovery via `mcp_list_tools` → `mcp_get_tool` → `mcp_call` → `mcp_read_result`; large results spill to disk under `~/.voidcast/mcp-results/`. Per-server enable toggles in Options → Tools.
- **MCP OAuth**: remote servers with `"oauth": true` support browser sign-in (PKCE); tokens stored under `~/.voidcast/mcp-oauth/`. SIGN_IN / SIGN_OUT in the MCP panel.
- **MCP project trust**: untrusted project `.mcp.json` is ignored until you approve **TRUST_PROJECT_MCP** (preview of commands/URLs first).
- **MCP reliability**: reconcile servers when project/enabled map changes (no stale cross-project tools), connect/call timeouts, and chat Stop cancels in-flight MCP calls.
- **Model-aware CTX meter**: cloud providers (OpenRouter / DeepSeek / NVIDIA) use per-model context windows instead of Ollama `llmNumCtx`. DeepSeek V4 Pro/Flash use **1M**; OpenRouter presets include `tencent/hy3-preview` (262K).
- **Custom Windows title bar** with native overlay window controls.

### Changed

- **CONTEXT_WINDOW** setting is shown only for Ollama — cloud providers ignore `num_ctx`; the footer CTX bar uses each model’s native limit (tooltip shows the source).

### Fixed

- TypeScript build: import `OAuthDiscoveryState` from the MCP SDK client auth module.

## [2.7.5] — 2026-07-13

### Added

- **`search_files` ranked harness**: collects up to 2000 raw matches, scores by filename/path/definition-like lines and recent session files, returns contextual blocks (±2 lines, `>>>` markers) with a top-files summary instead of a flat line dump.
- **Bundled ripgrep**: desktop builds ship `@vscode/ripgrep` (`VOIDCAST_RG_PATH` override, then system `rg`, then walk fallback). No manual ripgrep install required on Windows.
- **Shared coding skip list** (`codingProjectSkip.ts`): one source for search, glob, and file-tree exclusions (`release/`, `dist-electron/`, minified/hashed bundles, etc.).
- **`check_types` coding tool**: read-only TypeScript typecheck (`tsc --noEmit`) scoped to the coding project. Supports `path_prefix` for monorepo subfolders (e.g. `electron-app`) and optional `paths` to filter errors after edits. Available in Plan mode. Unit tests for `tsc` output parsing.
- **Unit tests** for search ranking/formatting, project skip rules, Vite dev URL detection, and chat-sessions IndexedDB storage.

### Changed

- **Chat sessions storage**: sessions move from a single `localStorage` JSON blob to **IndexedDB** (`voidcast-chat-sessions-v2`, one record per session + meta). First launch migrates existing chats automatically; the legacy `localStorage` key is kept for rollback. Saves are debounced (~400ms) with a flush on tab hide / unload.
- **`search_files` tool copy** and README: document ranked contextual output and bundled ripgrep.
- **Coding tool hints** and Options → Tools copy: document `check_types` alongside git and shell tools.
- **File tree**: hides `release/` and `dist-electron/` like other generated folders.

### Fixed

- **Settings startup race**: first React paint before Electron preload could treat the desktop shell as LAN web, strip cloud API keys from `localStorage`, and point `ttsBaseUrl`/cloud API bases at the Vite dev server (`localhost:5173`). Detection now falls back to the Electron user agent; desktop save/load never strips secrets; Vite URLs are repaired on load; missing cloud keys show a clear error instead of opaque 401s.
- **Search noise**: `release/`, `dist-electron/`, and Vite/Rollup hashed bundles no longer dominate `search_files` results.
- **Chat layout**: wider assistant bubbles and improved word wrapping in chat markdown and composer.

## [2.7.2] — 2026-07-12

### Added

- **LAN web access toggle + QR**: Options → General → **LAN_WEB_ACCESS** (default off). When enabled, cloud API keys are pushed to the local server for phone clients and the panel shows a QR code / LAN URL (multi-IP select, copy, refresh, keys-registered status). When disabled, registered keys are cleared from the server.
- **Plan mode**: composer toggle **AGENT | PLAN**. In Plan mode the agent explores read-only (no write/edit/shell/media/settings mutations), then ends with a structured plan card — editable title/steps, optional approaches when tradeoffs matter, and **Approve & Build**.
- **Something else…**: on a draft plan card, describe your preferred approach and **Revise plan** — the agent stays in Plan mode and returns an updated plan (does not build yet).
- **Approve & Build**: switches to Agent mode, implements the chosen plan, shows a sticky **Building plan** progress panel, and auto-checks steps as `write_file` / `edit_code` / `execute_command` succeed. Stop/error reopens the plan as draft with **Retry Build**; `built` only when real tool progress happened.
- **Plan persistence**: plan artifacts normalize on session load; interrupted mid-build (`approved`) reopens as draft after reload.
- **Plan mode UI polish**: composer banner, calmer plan card labels, theme-aware empty state in Plan mode, and Minimal/Obsidian styling for plan elements.
- **Pinned sessions sidebar**: chat sessions live in a left column (toggle in header); no overlay navigation menu. Mobile defaults to collapsed under 640px width.
- **Coding file preview syntax highlighting**: highlight.js for source files in preview mode (diff and image preview unchanged).
- **Coding preview inline edit**: **✎ Edit** in the preview header — textarea editor with find/replace (match highlights, **Enter** / **↓** navigation, **Ctrl+G** / **Ctrl+Shift+G**), **Save** / **Cancel**, unsaved-change guard, and Electron focus recovery after native confirm dialogs.
- **Markdown preview in coding panel**: `.md` / `.mdx` files render via `ChatMarkdown` by default; **Source** toggle returns to highlighted raw view.
- **Sub-agent long memory toggle**: `USE_FOR_LONG_MEMORY` in Options → SUB — independent from vision; extract uses the sub-agent model only when this is on.
- **Sub-agent default context**: `CONTEXT_TOKENS` default raised to 64K (65536) for new installs.
- **`image_recall` focus**: optional `focus` argument steers sub-agent vision (what the main agent needs from the image). Cache is keyed per image+focus; generic recalls (no focus) stay backward-compatible.
- **OpenRouter provider lock**: Options → LLM optional **OPENROUTER_PROVIDER** slug below the model — when set, requests use `provider.only` with no fallbacks.
- **Agent-initiated Plan mode** (`ENTER_PLAN_MODE` in Options → Tools): the agent can call `enter_plan_mode` on complex/risky tasks; handoff reuses the same user turn (no duplicate bubble) and preserves attachments.
- **Explicit plan progress**: during Approve & Build the agent calls `update_plan_progress` (step id / 1-based index) to check off steps — file edits no longer auto-advance the checklist.

### Changed

- **Cloud API keys copy**: General options no longer repeats “forwarded for LAN web” under every key — one CLOUD_API_KEYS blurb; LAN details live in the access panel when enabled.
- **Media options tab**: IMAGE and MUSIC tabs merged into one **MEDIA** tab (Image tool + Music tool sections). Tool activity chips use `IMAGE_GEN` / `MUSIC_GEN`. Settings keys and tool names unchanged (`runwareApiKey`, `generate_image`, etc.).
- **Image provider**: Media → Image tool can use **Runware** or **OpenRouter** (same key pattern as TTS). OpenRouter presets include Gemini Flash Image and **GPT Image 2**; per-model width/height/quality profiles. Default: [`google/gemini-3.1-flash-lite-image`](https://openrouter.ai/google/gemini-3.1-flash-lite-image). Runware API base URL removed from options UI (hardcoded default).
- **Plan approaches**: default to a single flat plan; offer 2 (rarely 3–4) approaches only when there are real tradeoffs — no filler A/B/C.
- **OpenRouter LLM presets**: refresh catalog (Fusion, Claude Sonnet 5, GPT-5.6 Sol/Terra/Luna, Grok 4.5, GLM 5.2, Tencent Hy3; drop stale free entries).
- **Composer layout**: full-width textarea, Agent/Plan dropdown in toolbar, commit bar collapsed by default, neutral opaque panel splitters (no neon glow under dividers).
- **Coding preview scrolling**: file and diff views use `pre` layout (no line wrap) with horizontal scroll like a code editor.

### Fixed

- **OpenRouter image crash**: OpenRouter `data:image/...` payloads are saved to disk immediately (user cache or auto-save folder) instead of being held in React state / localStorage; preview uses local paths like Runware CDN images.
- **OpenRouter image options**: quality and dimensions always come from the OpenRouter model profile when that provider is selected (not the Runware model profile).
- **Coding panel survives Options**: chat/coding shell stays mounted while Settings is open — selected file, tree expansion, and preview state are preserved.
- **TTS after Options**: single global `<audio>` element in the app shell (was duplicated per screen; ref stayed null after leaving Options).
- **Sub-agent Ollama routing**: namespaced local models like `sorc/qwen…:9b` (both `/` and `:`) no longer route to OpenRouter. Detection treats OpenRouter route variants (`:free`, `:nitro`, …) as cloud; other `ns/name:tag` ids go to Ollama. Selecting from the SUB model list also stores an explicit `provider`.
- **Sub-agent vision cache short-circuit**: repeat `image_recall` on the same image reuses the session `imageVisionCache` instead of calling the sub-agent API again. History replay behavior is unchanged.
- **Coding image preview**: safer `readImageFile` error handling so TypeScript correctly narrows failure vs success payloads.

## [2.7.1] — 2026-07-09

### Added

- **Agent Skills catalog**: progressive-disclosure system — models see a name/description catalog of installed instruction packs in the system prompt; full `SKILL.md` bodies load on demand via `read_skill`. New **SKILLS** tab in Options panel with RESCAN and skill listing (source, description). Skill source labels (`agents` / `claude` / `cursor` / `project`) shown in the UI and catalog. (Initial global-only discovery: `~/.agents/skills`, `~/.claude/skills`, `~/.cursor/skills`.)
- **Project AGENTS.md / CLAUDE.md**: when a coding project is open, Voidcast injects `AGENTS.md` / `CLAUDE.md` from the project root into the system prompt — repo-wide conventions on every turn.
- **Project-local skills**: skills discovered from `.cursor/skills`, `.claude/skills`, `.agents/skills`, and `skills/` relative to the coding project root. Project skills override globals with the same name.
- **Git status colors in the file tree**: dirty files are color-coded (M=yellow, A=green, D=red, ?=gray, R=magenta, U=orange). File tree header shows branch name + ahead/behind counts.
- **Stage / unstage / discard actions**: inline `+` / `−` / `↶` buttons on each dirty file row in the file tree, plus the same actions in the file preview header.
- **Commit bar**: input + **COMMIT** / **COMMIT ALL** / **DISCARD ALL** buttons below the file tree when changes exist. COMMIT commits only staged files; COMMIT ALL stages everything first (`git add -A`) then commits.
- **Diff preview with line numbers**: clicking a dirty file opens a unified diff (staged or unstaged) with line numbers, `@@` hunk headers, `+` green / `-` red highlighting. Staged/unstaged toggled automatically by the status state.
- **Dirty-only toggle**: "DIRTY N" / "ALL · N" button in the file tree header filters the tree to show only changed files and their parent directories.
- **Resizable chat ↔ coding panel split**: draggable vertical divider between chat and the coding panel, with persisted width (`panelWidthPx` in settings, default 416px, clamped 280–720). Keyboard support: ←/→ (16px step, Shift+32px), Home/End for max/min.
- **Resizable file tree ↔ preview/terminal vertical split**: draggable horizontal divider inside the coding panel between the file tree and the lower sections (preview/terminal/commit bar). Persisted height (`fileTreeHeightPx` in settings, default 220px, clamped 100–480). Keyboard support: ↑/↓ (16px step, Shift+32px), Home/End for max/min.

### Changed

- **Chat typography**: body text and composer now use **IBM Plex Sans** at 15px/1.65 leading (was Rajdhani 14px). Heading tracking adjusted (`tracking-tight` instead of `tracking-wide`). Font families moved to CSS custom properties (`--font-body`, `--font-mono`, `--font-display`) so each theme overrides cleanly — Minimal uses sans-serif, Matrix uses monospace, others use IBM Plex Sans. Rajdhani font removed from Google Fonts imports.
- **Skills catalog hint**: project skills are marked `[project]` in the catalog; added override-global disclaimer.
- **Rediscovery path**: `discoverAgentSkills` and `readAgentSkillBody` accept an optional `projectPath` parameter — electron main process scans project roots first for skill resolution.

### Fixed

- `videos/` directory added to `.gitignore`.

## [2.7.0] — 2026-06-16

### Added

- **DeepSeek LLM provider**: direct OpenAI-compatible API at `https://api.deepseek.com` — presets `deepseek-v4-pro` and `deepseek-v4-flash`, API key in General options, THINKING_LEVEL maps to DeepSeek reasoning mode, full agent tool loop (70 rounds), context compress and long-memory extraction. LAN web clients proxy via TTS server at `/api/deepseek/*`.

### Changed

- **Cloud LLM routing**: shared `cloudLlm.ts` resolves OpenRouter, NVIDIA, and DeepSeek chat config from settings (used by chat agent, context compress, long memory).

### Fixed

- **Chat attachments**: strengthen coding tool hints — tool results injected after attachments so the agent sees the full workspace context. Fixed silent `order_tools` collision with attachment message metadata.
- **Reddit RSS retry**: replaced fragile manual retry loop with `tenacity` (exponential backoff + jitter, respects `Retry-After` header). Raised timeouts for Reddit's slow RSS feeds (45 s fetch / 35 s read).

## [2.6.6] — 2026-06-14

### Added

- **OpenRouter LLM presets**: Kimi K2.7 Code, Qwen3.7 Plus, Qwen3.7 Max, GLM 4.7 Flash, Nemotron 3 Ultra (Free).

### Fixed

- **OpenRouter / NVIDIA tool loop**: raised `MAX_TOOL_ROUNDS` from 18 to 70 (same as Ollama) so long agent turns with many tool calls no longer stop silently with an empty reply.

## [2.6.4] — 2026-06-14

### Added

- **Sub-agent vision in history**: after `image_recall` runs the vision sub-agent, descriptions are saved on the chat session and replayed once in prior-turn context next to the matching image (user attachments and saved generated paths). No duplicate injection in the live catalog block or cache-short-circuit on repeat tool calls.
- **Per-theme chat UX**: empty-state copy and composer placeholder text now match the active UI theme (Minimal, Dystopian, Matrix, Light, Blood Moon, Obsidian).
- **Unit tests** for extracted chat helpers: `chatHints`, `chatImageCatalog`, `runwareMessageMeta`.

### Changed

- **Frontend architecture refactor** (no user-facing behavior change): `App.tsx` is a thin orchestrator; chat and options screens compose dedicated components; state lives in hooks (`useVoidcastApp`, `useChatAgent`, `useChatSessions`, `useChatAttachments`, `useTtsPlayback`, `useSttInput`, `useLongMemoryUi`, `useCodingSession`). Agent tool-result side effects moved to `applyAgentToolResult.ts`.
- **Cloud LLM presets**: OpenRouter and NVIDIA model dropdowns and stored model ID migrations centralized in `cloudLlmPresets.ts` (updated preset lists for 2026 models).
- **OpenRouter requests**: removed automatic retry with `openrouter/free` when the selected model fails — the app now retries only the model you chose (429/502/503/504 backoff unchanged).
- **Obsidian theme**: muted functional accent colors on composer mic, TTS/SPEAK, send, and header controls (`theme-obsidian.css`).

### Fixed

- **Sub-agent model list with OpenRouter LLM**: Ollama models are always loaded from the configured Ollama URL for the SUB options tab, even when the main LLM provider is OpenRouter or NVIDIA.

## [2.6.2]

### Added

- **Cloud TTS model presets** for OpenRouter and Runware in TTS options.

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
