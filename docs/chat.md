# Chat Screen

The chat screen (`electron-app/src/components/chat/ChatScreen.tsx`) is the main UI. It composes `ChatHeader`, `ChatSidebar`, the message list, `ChatToolResultBanner`, `ChatErrorBanner`, `ContextWarningBanner`, `MemoryPreviewModal`, `ChatComposer`, `ChatDragOverlay`, and optionally `CodingPanel` in a chat⇄panel split. All state comes from one `useVoidcastApp()` instance passed down as `app`.

## Header (ChatHeader.tsx)

- Sessions sidebar toggle, VOIDCAST brand, coding-panel toggle (desktop only), Window controls.

## Model Switcher (ChatSystemStatus.tsx, ModelSwitcherPopup.tsx)

- `ChatSystemStatus` shows the active provider (Ollama / OpenRouter / NVIDIA / DeepSeek / OpenAI / OpenCode Go / CrofAI), model, and context-limit source.
- Clicking opens `ModelSwitcherPopup` with provider presets (`OPENROUTER_LLM_PRESET_MODELS`, `DEEPSEEK_LLM_PRESET_MODELS`, `OPENAI_LLM_PRESET_MODELS`, `NVIDIA_LLM_PRESET_MODELS`, `OPENCODE_GO_LLM_PRESET_MODELS`, `CROFAI_LLM_PRESET_MODELS` from `electron-app/src/lib/cloudLlmPresets.ts`), live Ollama models, and pinned models (`pinnedModels`, ids like `openrouter:openai/gpt-5.6-terra`). Selection updates `llmProvider` + model fields via `applyModelSwitcherSelection`.

## Sessions Sidebar (ChatSidebar.tsx, SessionItem.tsx)

- Sessions grouped by project (`groupSessionsByProject`) with busy/unread indicators.
- **New chat** `newChat()` (Ctrl+N); new chat for a project: `newChatForProject()`.
- **Open** `openSession(id)`, **Fork** `forkSession(id)`, **Export to markdown** `exportSessionToMarkdown(id)`, **Delete** `deleteSession(id)` (pending-confirm via `pendingDeleteId`), **Rename** inline (`startRenameSession`/`commitRenameSession`/`cancelRenameSession`).
- `sessionsSidebarCollapsed` hides it (auto on ≤640px).
- **Multi-chat:** more than one session can have a busy agent at the same time (see [multi-chat-and-team.md](multi-chat-and-team.md)).

## Multi-chat (concurrent agent runs)

Product overview: [multi-chat-and-team.md](multi-chat-and-team.md).

- Runtime: `sessionAgentStore` — one slot per session (or draft key), holds messages, busy, abort, media, sub-agent activity writes.
- **Cap: 3** concurrent runs (`MAX_CONCURRENT_AGENT_RUNS`). Extra start → error until another finishes or Stop.
- Coding isolation: frozen project path, shell owner by runtime key, terminal feed per chat; same-project double-run can be refused.
- Switch sessions freely while A runs; B can send. Background finish may mark DONE-style unread until opened.
- Draft auto-save can rekey `__draft__` → real session id mid-run.
- Composer can take a draft while busy; **steer** mid-turn aborts and resends with correction (separate from Stop).

## Composer (ChatComposer.tsx)

- Multiline textarea with send/stop, image & file chips, STT record, mode and preset menus. Send enabled with non-empty input or pending attachments and not busy; "pending draft" shown while busy.
- **Agent mode toggle**: cycles `Agent → Team → Plan` (`MODE_CYCLE = ['agent','team','plan']`, also `Shift+Tab`). `AgentChatMode = 'agent' | 'plan' | 'team'` in `electron-app/src/types/chat.ts`; normalized by `normalizeAgentChatMode`.
  - **Agent** — full tool implementation; coding workers optional if SUB coding is on.
  - **Ask** — read-only Q&A (web/research/coding read/explore); no Plan card, no `enter_plan_mode`, no mutations/workers.
  - **Plan** — read-only; plan artifact + Approve & Build → **Agent** (or **Team** if composer already Team).
  - **Team** — prefers **`run_coding_workers`** (≤2 parallel); requires coding SUB. No `enter_plan_mode`.
- **System prompt preset** menu (`default|code|creative|teacher`, `SYSTEM_PROMPT_PRESETS` in settings.ts).
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
- `onChatDrop` reads files into `FileAttachmentSnapshot` (name, path, mime, size, ext, content) → `pendingImages`/`pendingFiles`; picker via `openChatAttachmentPicker`.

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

## Long-Term Memory (MemoryPreviewModal.tsx)

- Candidates `LongMemoryCandidate` (kind preference/project/fact/constraint/task, text, tags, importance, confidence) shown for confirmation; `confirmSaveLongMemory` saves, `longMemoryBusy` shows progress. `longMemoryDefaultEnabled` toggles auto-retrieval in new chats. Types in `electron-app/src/types/longMemory.ts`; logic in `useLongMemoryUi`.

## Context / Compression

- **Footer CTX popup** (`ChatSystemStatus.tsx`): click the CTX meter for auto-compress toggle (`contextAutoCompress` at ~90%) and **COMPRESS NOW** (`summarizeContextNow`) anytime — useful on 1M-ctx models when you want to shrink early. Disabled while the agent is busy or a compress is already running.
- **Warning banner** (`ContextWarningBanner.tsx`): shows `CTX_USAGE %` when `shouldWarn`, `contextAutoCompress` off, not dismissed — COMPRESS / IGNORE.
- Auto-compress near 90% of the model context limit stores `hiddenContextSummary` (never rendered) + `contextCompressedThroughIndex`.

## Tool-Result & Error Banners

- `ChatToolResultBanner` shows one-shot results (e.g. `PDF_EXPORT_RESULT`) with DISMISS; `ChatErrorBanner` shows agent/tool errors.

## TTS Auto-Voice & STT Input

- **TTS**: `useTtsPlayback` reads replies when `autoVoice` on; `ttsProvider` (`local` OmniVoice HTTP, `runware-xai`, `openrouter-tts`), `voiceMode` (`design`/`clone`), `voiceInstruct`, `cloneRefText`, `ttsSpeed`, `ttsNumStep`, `ttsDurationSec`, `ttsChunkMaxChars`, `runwareXaiVoice`, `runwareTtsModel`, `runwareTtsSpeed`. A read/speaker icon per assistant message triggers `onRead`/`abortTts`.
- **STT**: `useSttInput` with `sttProvider` (`none`/`openrouter`, Whisper model `openrouterSttModel`); record button shows `isRecording`, `recordingDuration`, `sttPending`; transcript fills composer.

## Reminders

- `reminderNotificationsEnabled` fires a desktop notification when a scheduled reminder is due; reminders are stored in `lib/reminderStorage.ts` and managed from `useVoidcastApp` (`deleteReminder`, `markReminderDone`). `reminderNotificationsEnabled` + `notificationSoundsEnabled` + `notificationSoundVolume` control alerting (see settings-reference).
