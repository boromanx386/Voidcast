# Chat Screen

The chat screen (`electron-app/src/components/chat/ChatScreen.tsx`) is the main UI. It composes `ChatHeader`, `ChatSidebar`, the message list, `ChatToolResultBanner`, `ChatErrorBanner`, `ContextWarningBanner`, `MemoryPreviewModal`, `ChatComposer`, `ChatDragOverlay`, and optionally `CodingPanel` in a chat⇄panel split. All state comes from one `useVoidcastApp()` instance passed down as `app`.

## Header (ChatHeader.tsx)

- Sessions sidebar toggle, VOIDCAST brand, coding-panel toggle (desktop only), Window controls.
- **Bind-folder prompt**: `codingToolsNeedFolder` shows when coding tools are on and **this chat** has no folder (`activeCodingProjectPath` empty). There is no app-level default that could satisfy it — binding a folder is always a per-chat action.

## Model Switcher (ChatSystemStatus.tsx, ModelSwitcherPopup.tsx)

- `ChatSystemStatus` shows the active provider (Ollama / OpenRouter / NVIDIA / DeepSeek / OpenAI / OpenCode Go), model, and context-limit source.
- **The padlock is the only per-chat lock; the switcher is a normal model change**: `ChatSystemStatus` renders a padlock (`LockIcon`, `.status-item .lock`, once the chat has an id) that calls `toggleModelLockForActiveChat` — on, it copies the resolved model into `ChatSession.model` (glowing `is-locked`, Options no longer reaches that chat); off, it clears the field (muted, back to Options). `activeModelId` is that model else `currentPinnedModelId(settings)`, so an unlocked chat follows Options live. Picking in `ModelSwitcherPopup` does **not** lock: per-chat on a locked chat, app-level through `applyScopedModelToSettings` on an unlocked one. `useChatAgent` freezes the id into `turnSettings` and the Plan handoff passes it on as `forceModel`; `saveOrUpdateSession` and `forkSession` keep the model.
- Clicking opens `ModelSwitcherPopup` with provider presets (`OPENROUTER_LLM_PRESET_MODELS`, `DEEPSEEK_LLM_PRESET_MODELS`, `OPENAI_LLM_PRESET_MODELS`, `NVIDIA_LLM_PRESET_MODELS`, `OPENCODE_GO_LLM_PRESET_MODELS` from `electron-app/src/lib/cloudLlmPresets.ts`), live Ollama models, and pinned models (`pinnedModels`, ids like `openrouter:openai/gpt-5.6-terra`). Selection updates `llmProvider` + model fields via `applyModelSwitcherSelection`.

## Sessions Sidebar (ChatSidebar.tsx, SessionItem.tsx)

- If saved chats cannot load at startup, the chat screen pauses and offers **Retry loading chats**. Retrying restores the saved conversations and active chat once storage is available. This also applies when migrating history from an older installation. **Continue without saved chats** opens the chat screen anyway, with saving switched off for the rest of the run (a banner says so), so the unread history is never overwritten.
- Sessions grouped by project (`groupSessionsByProject`). Rows are **one line** (`SessionItem`, ~28px) showing the title only — the timestamp is in the row tooltip on hover, not persistent.
- **Folder headers carry the group's state**, so a **collapsed** folder still tells you what is inside: a green pulsing dot while any session in it is busy (count in the tooltip), otherwise a cyan dot for an unread completion; the folder holding the open chat keeps its bold cyan label/edge plus an active dot. A folder is auto-collapsed unless it holds the open chat (`storedCollapsed = toggled ?? !isActiveGroup`), and a filter query expands everything.
- **Filter** — the search field narrows the list by chat title and project path.
- **Resizable** — drag the sidebar edge; width is clamped to 220–460 px (default 288), persisted under `SIDEBAR_WIDTH_KEY`, and a double-click on the edge resets it.
- **Row actions sit behind one `⋯` overflow menu** at the row's right edge (shown on hover or keyboard focus, not after a click; the menu flips above the row near the bottom of the list): **Fork chat** `forkSession(id)`, **Export .md** `exportSessionToMarkdown(id)` — writes the full transcript through `buildSessionMarkdown`: every turn plus its streamed reasoning (a `<details>Thinking</details>` block), the intermediate agent rounds captured before each tool call (`agentProgress`, a `<details>Agent rounds</details>` block), the sub-agent activity card, Plan-mode artifacts as task lists, the coding-turn evidence line and turn duration, not only the final replies —, **Rename** inline (`startRenameSession`/`commitRenameSession`/`cancelRenameSession`), **Delete** `deleteSession(id)` (red, pending-confirm via `pendingDeleteId`).
- **New chat** `newChat()` (Ctrl+N); new chat for a project: `newChatForProject()`; **Open** `openSession(id)`.
- `sessionsSidebarCollapsed` hides it (auto on ≤640px).
- **Multi-chat:** more than one session can have a busy agent at the same time (see [multi-chat-and-team.md](multi-chat-and-team.md)).

### Session titles

A new chat is named immediately from the first prompt (`deriveSessionTitle` in `electron-app/src/lib/chatHints.ts`: the first 60 characters, whitespace collapsed), so the sidebar is never blank and no send waits on the network. After the first reply lands, `useChatSessions` asks the **coding sub-agent** model for a real topic title — one tool-free `callSubAgentChat` call, 32 output tokens (`electron-app/src/lib/chatTitle.ts`). The seed is the first user message plus the head of the first assistant reply, with code blocks and URLs stripped.

Rules that keep it from fighting the user:

- The result replaces the title only while it is still machine-derived. Renaming a chat is final.
- One attempt per session id, and only chats created during the current app run qualify — a restart titles new chats only, never the stored ones.
- Titles keep the language of the prompt, capped at 12 words / 60 characters.
- An empty **Sub-Agent → coding model** turns generation off and the derived title stays.

### Prompt hints

Options → Sub-Agent → `ENABLE_PROMPT_HINT` adds a hint button to the composer, next to Send. It makes one tool-free call to the **coding sub-agent** model (`electron-app/src/lib/promptHint.ts` → `callSubAgentChat`) that rewrites the current draft against the whole text conversation: every user message and every agent reply between them, in order, capped at 12k characters with the oldest turns dropped first. Tool output is excluded by construction — tool results live in `subAgentActivity` / `codingTurnEvidence` / `agentProgress`, never in message content.

Rules:

- The rewritten prompt replaces the draft. Nothing is sent: you review it, edit it, then send it yourself.
- While the field still holds exactly the hint result, an undo chip restores the draft you had before it. The chip disappears as soon as you type, so it can never clobber newer text.
- A draft gets **rewritten**. An empty field with a conversation behind it flips the same button into **suggest mode**: the model proposes the next prompt to send, in the conversation's language, as a normal draft you can edit before sending. Which one applies is decided by a pure `resolveHintMode` (`electron-app/src/lib/promptHint.ts`) that the engine and the composer's disabled state both read, so the button cannot promise a mode the call would refuse.
- The button is disabled when there is neither a draft nor a conversation, while a turn is running, and while context compression holds the composer.
- A model that hands the draft straight back leaves the composer untouched.
- Default off, and an empty coding sub-agent model leaves the button inert.

## Multi-chat (concurrent agent runs)

Product overview: [multi-chat-and-team.md](multi-chat-and-team.md).

- Runtime: `sessionAgentStore` — one slot per session (or draft key), holds messages, busy, abort, media, sub-agent activity writes.
- **Cap: 3** concurrent runs (`MAX_CONCURRENT_AGENT_RUNS`). Extra start → error until another finishes or Stop.
- Coding isolation: **the folder belongs to the chat** (`ChatSession.codingProjectPath`; a draft keeps its own `draftCodingProjectPath` until `claimSessionIdForDraft` writes it). `activeCodingProjectPath` feeds the coding panel and the header, and `useChatAgent` freezes the **sending** chat's root into `turnSettings` through `codingProjectPathForRuntimeKey(runtimeKey)` — a background run never picks up the chat on screen. There is no app-level coding folder field: the root travels as an explicit turn value (`buildAgentTurnContext({ codingProjectPath })`), not on `settings`.
- Shell owner by runtime key, terminal feed per chat. **Two chats in different folders run in parallel** — the guard that refused a second project is gone, because every coding tool call carries its own root. Same-folder peers are allowed too and the agent gets a non-blocking context hint. The browser is per project too: each project keeps its own pages, active tab and profile switch, so two chats in different folders can never close or steal each other's tabs.
- Switch sessions freely while A runs; B can send. Background finish may mark DONE-style unread until opened.
- Plan escalation binds to the session that owns the run, not the one on screen, so a background chat's plan handoff (card + draft) can never land in the viewed chat.
- Window-level mirrors (`hiddenContextSummary`, `contextCompressedThroughIndex`, `imageVisionCache`, composer mode) are written per session for a background run; a run only touches the view-level copy while its own chat is the one on screen.
- Draft auto-save can rekey `__draft__` → real session id mid-run.
- Composer can take a draft while busy; **steer** mid-turn aborts and resends with correction (separate from Stop) — except while a Team-mode worker batch runs, when a text-only steer is queued to the workers instead (see [multi-chat-and-team.md](multi-chat-and-team.md)).

## Composer (ChatComposer.tsx)

- Multiline textarea with send/stop, image & file chips, STT record, mode and think-level menus. Send enabled with non-empty input or pending attachments and not busy; "pending draft" shown while busy.
- **Locked during context compression**: while `contextCompressBusy` is set (manual **COMPRESS NOW** in the CTX popup, or auto-compress) the textarea, send button and toolbar are disabled and a spinner banner explains why; Enter does nothing and `onSend` refuses outright, so a prompt cannot race the summary write.
- **Agent mode toggle**: cycles `Agent → Ask → Plan → Team` (`MODE_CYCLE = ['agent','ask','plan','team']` in ChatComposer.tsx, also `Shift+Tab`). `AgentChatMode = 'agent' | 'ask' | 'plan' | 'team'` in `electron-app/src/types/chat.ts`; normalized by `normalizeAgentChatMode`. The mode is **per chat** (`ChatSession.agentMode`; `settings.agentMode` only seeds new chats), so a chat running in the background cannot change the mode shown on this one.
  - **Agent** — full tool implementation; coding workers optional if SUB coding is on.
  - **Ask** — read-only Q&A (web/research/coding read/explore); no Plan card, no `enter_plan_mode`, no mutations/workers.
  - **Plan** — read-only; plan artifact + Approve & Build → **Agent** (or **Team** if composer already Team).
  - **Team** — prefers **`run_coding_workers`** (≤2 parallel); requires coding SUB. No `enter_plan_mode`.
  - Ask and Plan hide mutating tools and the executor also refuses them (`PLAN_MODE_BLOCKED_TOOLS`), so a call from earlier Agent turns in the same chat still fails. Trusting a project folder only lets its `.mcp.json` servers start; in Ask and Plan those servers can be browsed (`mcp_list_tools`, `mcp_get_tool`) but not called.
- **Think level** menu: per-chat override of `llmThinkLevel` (`off|low|medium|high|on`), stored on the session as `thinkLevel`. **Default** (shown as `think <level>*`) follows Options → LLM → `THINK_LEVEL`; the override is applied to `turnSettings` at send time, so it reaches every provider. There are no system prompt presets — behaviour is switched by the mode menu, tone by `llmSystemPrompt`.
- **Long-memory** extract button (`extractLongMemoryNow`, `longMemoryBusy`).
- Placeholder from theme/mode (`getChatComposerPlaceholder`).

## Message Rendering (ChatMessageList.tsx, ChatMessage.tsx)

- Renders `UiMessage`: user/assistant roles; assistant `thinking` (Ollama `thinking`/OpenRouter `reasoning`) above reply; collapsible intermediate `agentProgress` round drafts; images (`images[]`, `imageMimes[]`, names/paths); `fileAttachments` chips; generated image URLs/paths; embedded `plan` artifacts; optional **`subAgentActivity`** card (vision / explore / workers) on that turn’s assistant message.
- Assistant content is **markdown** via `ChatMarkdown` (`components/ChatMarkdown.tsx`); user content auto-links.
- Editing re-sends with attachments (`useChatAttachments`).

While tools are running, the busy indicator shows each active tool by name. Adjacent read-only calls can appear together when the shared agent loop executes them in parallel; serial and mutating calls remain ordered.

## File Drag-Drop Attachments (ChatDragOverlay.tsx, useChatAttachments)

- Drag shows overlay "DROP FILES TO ATTACH"; images (PNG/JPEG/WebP…) and files (TXT/MD/PDF/DOCX/CSV/JSON/code).
- Clipboard paste can also queue images as pending attachments.
- `onChatDrop` reads files into `FileAttachmentSnapshot` (name, path, mime, size, ext, content) → `pendingImages`/`pendingFiles`; picker via `openChatAttachmentPicker`. Attachments are materialized to real files on disk for the turn, so tools receive an actual path rather than only in-memory bytes.

## Image Catalog (vision references)

- The session keeps a chronological catalog of images. It is **stable**: index 1 is the oldest image in the conversation and indexes never renumber; each line also carries a permanent id like `[img_1a2b3c4d]` (`imageCatalogId` in `lib/imageVisionCache.ts`, exposed via `lib/chatImageCatalog.ts`).
- `image_recall` and `edit_image_runware` accept `reference_image_ids` (preferred — ids never change across turns), `reference_image_indexes` (1-based positions), and/or `reference_image_paths`. Unknown ids are reported back in the tool error.
- `show_image` puts an existing image in the chat (desktop only). It takes the same three references; `reference_image_paths` also accepts absolute paths outside the project. Files outside the catalog are copied into the image output folder, so the chat does not depend on the original.
- Images saved during a turn by `generate_image`, `edit_image_runware`, `show_image` or an MCP tool join the catalog immediately, so the same turn can recall or edit them.

## Showing audio (`show_audio`)

- `show_audio` puts an existing audio file in the chat with a player (desktop only), for example a clip a script cut or mixed, or a sound asset in the project. It takes `paths`: absolute anywhere on the PC, or relative to the coding project.
- MP3, WAV, FLAC, OGG and M4A, up to 50 MB per file. Each file is copied into the app's `generated-audio` folder (the same place `generate_tts` uses without `output_path`), so the player keeps working after the original changes.
- Audio from `generate_tts` and `generate_music_runware` already gets a player, so the agent does not need this tool for those. There is no audio counterpart to `image_recall`: the agent cannot listen to the file.

## Sub-agent activity and workers (SubAgentPanel.tsx)

Full table: [multi-chat-and-team.md](multi-chat-and-team.md) and [options/subagent.md](options/subagent.md).

- With `subAgent.enabled` and/or `codingEnabled`, vision / explore / workers use separate models (vision vs coding roles).
- Activity is a **collapsible card on the assistant message** for the turn (not a floating window). Options → SUB → **SHOW_ANALYSIS_IN_CHAT**.
- Live progress + digests; auto-collapses when done; **persists with the session** when saved (reload keeps the card on that message).
- **Vision** → image describe. **Explore** → read-only `coding_explore`. **Workers** → `run_coding_workers` (1–2 parallel; main awaits).
- Main does **not** call other tools while a worker batch is in flight.

## Agent / Team / Plan (modes)

| Mode | Intent |
| --- | --- |
| **Agent** | Full tools; workers optional if coding SUB on |
| **Ask** | Read-only Q&A; no plan artifact; no workers / mutations |
| **Team** | Orchestrate multi-area; prefer `run_coding_workers`; no `enter_plan_mode` |
| **Plan** | Read-only + plan card; no workers; **Approve & Build** → Agent or Team per composer |

Composer cycles Agent → Ask → Plan → Team (`Shift+Tab` or mode chip).

**How a plan arrives — `submit_plan`**: in Plan mode the model gets a `submit_plan` tool (Plan only) whose arguments are the plan itself — `title`, `summary`, `steps` or `approaches` + `recommended`, and `research`. The plan never appears as text in the bubble; the bubble keeps only a few sentences of prose. `handleSubmitPlan` validates the arguments through `planArtifactFromSubmitArgs` (arrays sent as JSON strings are decoded). An error goes back to the model to fix. A valid call ends the turn in `runSharedToolLoop` without another model round, and `useChatAgent` builds the card from the arguments. When the turn has no tools at all, the prompt still asks for the old ```` ```json plan ```` fence, which is parsed as before (`parsePlanJsonFromText`).

**Plan files**: when the chat has a project folder, every plan is also saved as markdown at `<project>/.voidcast/plans/YYYY-MM-DD-<title-slug>.md` (`withPlanFile` / `formatPlanMarkdown` in `planArtifact.ts`, written by `schedulePlanFileWrite` in `planFile.ts`). The folder gets its own `.gitignore` (`*`), so plans stay out of the project's `git status`. The file holds the summary, a checklist, the approaches, the research and the reply prose under **Notes**. The card shows its path and an **Open** button. The file is rewritten (debounced 400 ms) on card edits, Approve & Build, every `update_plan_progress`, and when the build finishes or stops, so its checklist tracks the card. It is a mirror: edits in the file are overwritten. Later turns see a compact copy of the plan (`formatPlanHistoryNote`), and the build prompt names the file. `.voidcast/` is already skipped by code exploration. Without a project folder there is no file, only the card.

## Long-Term Memory (MemoryPreviewModal.tsx)

- Candidates `LongMemoryCandidate` (kind preference/project/fact/constraint/task, text, tags, importance, confidence) shown for confirmation; `confirmSaveLongMemory` saves, `longMemoryBusy` shows progress. `longMemoryDefaultEnabled` toggles auto-retrieval in new chats. Types in `electron-app/src/types/longMemory.ts`; logic in `useLongMemoryUi`.
- The picker prompt lives in `buildLongMemoryExtractPrompt` (`electron-app/src/lib/longMemoryExtract.ts`). It saves only what the **user** said or confirmed (assistant turns and tool results are context, never a source), skips one-off and in-chat state, defines each kind, and asks for one self-contained sentence per item in the user's language, with English tags added because retrieval is keyword overlap. Up to 60 already-saved memories go along in `<existing_memories>` so the model does not propose them again; the chat goes in `<transcript>` as data. A chat over 24 000 characters keeps its **end**, where preferences usually settle.
- Before the preview, `sanitizeCandidate` drops any item that holds a **secret-shaped value**: known key prefixes (`sk-…`, `ghp_…`, `AKIA…`, JWTs, private-key headers), `Bearer <token>`, a credential word followed by a value (`password: …`, `api_key=…`), or a 32+ character letter-and-digit string. The words alone ("tokenizer", "password manager") do not trigger it.

## Context / Compression

- **Footer CTX popup** (`ChatSystemStatus.tsx`): click the CTX meter for auto-compress toggle (`contextAutoCompress` at ~90%) and **COMPRESS NOW** (`summarizeContextNow`) anytime — useful on 1M-ctx models when you want to shrink early. Disabled while the agent is busy or a compress is already running. The meter shows the last model round of the turn, tool results included; when that is larger than what carries over, the popup adds a **Next turn** row (`historyPromptTokens`).
- **Warning banner** (`ContextWarningBanner.tsx`): shows `CTX_USAGE %` (of the next-turn size) when `shouldWarn`, `contextAutoCompress` off, not dismissed — COMPRESS / IGNORE.
- **What triggers compression**: `shouldWarn` (78%) and `shouldCompress` (90%) are measured on the turn's **first** model round — system prompt, history and the new message — not on the last round. Tool results only live inside the turn that produced them (and are trimmed there by old-result clearing), so a heavy tool turn no longer compresses a short chat.
- **What compression does** (`summarizeContextNow`): it summarizes only the messages the current summary does not cover yet, merged into the existing `hiddenContextSummary` (never rendered), and keeps the newest messages verbatim — up to 10, starting on a user message, within 20% of the context limit (`pickCompressionKeepFrom`). `contextCompressedThroughIndex` points at the start of that verbatim tail. When nothing older than the tail is left, everything is summarized.
- The summary closes the system prompt as `<conversation_summary>`, ahead of the history that continues from it.
- **Edit and resend** (`commitEdit`) rewrites the context as well as the bubbles: the coding memo and CTX usage are reset, the edited message goes to the model once with its attachments, and a summary that covers the edited message is dropped so the raw messages before it come back. If those messages would reach ~90% of the limit and `contextAutoCompress` is on, they are compressed before the resend, keeping the newest of them word for word like a normal compress.
- **Cache-stable ordering**: the system prompt and full history form a byte-identical cached prefix each turn; volatile context (clock, coding memo, live processes, long-term memory) rides on the **final user turn** instead of a trailing system message. Cached-token counts are mapped from the usage block and a `[voidcast] prompt …` cache-hit line is logged.

## Tool-Result & Error Banners

- `ChatToolResultBanner` shows one-shot results (e.g. `PDF_EXPORT_RESULT`) with DISMISS; `ChatErrorBanner` shows agent/tool errors.

## TTS Auto-Voice & STT Input

- **TTS**: `useTtsPlayback` reads replies when `autoVoice` on; `ttsProvider` (`none` disables speech output entirely, `local` OmniVoice HTTP, `runware-xai`, `openrouter-tts`), `voiceMode` (`design`/`clone`), `voiceInstruct`, `cloneRefText`, `ttsSpeed`, `ttsNumStep`, `ttsDurationSec`, `ttsChunkMaxChars`, `runwareXaiVoice`, `runwareTtsModel`, `runwareTtsSpeed`. A read/speaker icon per assistant message triggers `onRead`/`abortTts`; with `ttsProvider === 'none'` it is not rendered at all.
- **STT**: `useSttInput` with `sttProvider` (`none`/`openrouter`/`whistle`; Whisper model `openrouterSttModel`, `whistle` runs offline via the bundled cactus-needle engine); record button shows `isRecording`, `recordingDuration`, `sttPending`; transcript fills composer.

## Reminders

- `reminderNotificationsEnabled` fires a desktop notification when a scheduled reminder is due; reminders are stored in `lib/reminderStorage.ts` and managed from `useVoidcastApp` (`deleteReminder`, `markReminderDone`). `reminderNotificationsEnabled` + `notificationSoundsEnabled` + `notificationSoundVolume` control alerting (see settings-reference).

## Desktop Notification (reply finished)

- When a reply finishes while the window is minimized or hidden in the tray, the desktop app shows an OS toast titled **Voidcast** with a one-line preview of the answer (first non-empty line, light markdown stripped, clamped to 160 chars).
- `notifyAgentDone()` in `lib/agentDoneNotification.ts` is called from `useChatAgent` after a turn completes; the main process (`voidcast:notify-agent-done`) decides whether to actually show it and fires only when the window is not in the foreground. Best-effort: no-ops in web builds or on error.
