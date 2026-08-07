# Chat Screen

The chat screen (`electron-app/src/components/chat/ChatScreen.tsx`) is the main UI. It composes `ChatHeader`, `ChatSidebar`, the message list, `ChatToolResultBanner`, `ChatErrorBanner`, `ContextWarningBanner`, `MemoryPreviewModal`, `ChatComposer`, `ChatDragOverlay`, and optionally `CodingPanel` in a chat⇄panel split. All state comes from one `useVoidcastApp()` instance passed down as `app`.

## Header (ChatHeader.tsx)

- Sessions sidebar toggle, VOIDCAST brand, coding-panel toggle (desktop only), Window controls.

## Model Switcher (ChatSystemStatus.tsx, ModelSwitcherPopup.tsx)

- `ChatSystemStatus` shows the active provider (Ollama / OpenRouter / NVIDIA / DeepSeek / OpenAI / OpenCode Go), model, and context-limit source.
- Clicking opens `ModelSwitcherPopup` with provider presets (`OPENROUTER_LLM_PRESET_MODELS`, `DEEPSEEK_LLM_PRESET_MODELS`, `OPENAI_LLM_PRESET_MODELS`, `NVIDIA_LLM_PRESET_MODELS`, `OPENCODE_GO_LLM_PRESET_MODELS` from `electron-app/src/lib/cloudLlmPresets.ts`), live Ollama models, and pinned models (`pinnedModels`, ids like `openrouter:openai/gpt-5.6-terra`). Selection updates `llmProvider` + model fields via `applyModelSwitcherSelection`.

## Sessions Sidebar (ChatSidebar.tsx, SessionItem.tsx)

- Sessions grouped by project (`groupSessionsByProject`) with busy/unread indicators.
- **New chat** `newChat()` (Ctrl+N); new chat for a project: `newChatForProject()`.
- **Open** `openSession(id)`, **Fork** `forkSession(id)`, **Export to markdown** `exportSessionToMarkdown(id)`, **Delete** `deleteSession(id)` (pending-confirm via `pendingDeleteId`), **Rename** inline (`startRenameSession`/`commitRenameSession`/`cancelRenameSession`).
- `sessionsSidebarCollapsed` hides it (auto on ≤640px).

## Composer (ChatComposer.tsx)

- Multiline textarea with send/stop, image & file chips, STT record, mode and preset menus. Send enabled with non-empty input or pending attachments and not busy; "pending draft" shown while busy.
- **Agent mode toggle**: cycles `Agent → Team → Plan` (`MODE_CYCLE = ['agent','team','plan']`, also `Shift+Tab`). `AgentChatMode = 'agent' | 'plan' | 'team'` in `electron-app/src/types/chat.ts`; normalized by `normalizeAgentChatMode`.
  - **Agent** — full tool implementation.
  - **Plan** — read-only; banner "Plan mode … Approve & build on the plan card"; produces editable `PlanArtifact` (`PlanArtifactCard.tsx`) with steps, optional A/B/C approaches, research; Approve & Build starts build.
  - **Team** — prefers up to 2 parallel coding workers (`run_coding_workers`); requires Options → SUB → coding sub-agent.
- **System prompt preset** menu (`default|code|creative|teacher`, `SYSTEM_PROMPT_PRESETS` in settings.ts).
- **Long-memory** extract button (`extractLongMemoryNow`, `longMemoryBusy`).
- Placeholder from theme/mode (`getChatComposerPlaceholder`).

## Message Rendering (ChatMessageList.tsx, ChatMessage.tsx)

- Renders `UiMessage`: user/assistant roles; assistant `thinking` (Ollama `thinking`/OpenRouter `reasoning`) above reply; images (`images[]`, `imageMimes[]`, names/paths); `fileAttachments` chips; generated image URLs/paths; embedded `plan` artifacts.
- Assistant content is **markdown** via `ChatMarkdown` (`components/ChatMarkdown.tsx`); user content auto-links.
- Editing re-sends with attachments (`useChatAttachments`).

## File Drag-Drop Attachments (ChatDragOverlay.tsx, useChatAttachments)

- Drag shows overlay "DROP FILES TO ATTACH"; images (PNG/JPEG/WebP…) and files (TXT/MD/PDF/DOCX/CSV/JSON/code).
- `onChatDrop` reads files into `FileAttachmentSnapshot` (name, path, mime, size, ext, content) → `pendingImages`/`pendingFiles`; picker via `openChatAttachmentPicker`.

## Sub-Agent Delegation (SubAgentPanel.tsx)

- With `subAgent.enabled` (or `codingEnabled`), vision/explore/worker tasks run on a separate model (e.g. `llava:13b`, `gpt-4o`, `codingModel`).
- Floating panel logs `VISION ▲ / EXPLORE ▲ / WORKERS ▲ / SUB_AGENT ▲` with WORKING/DONE, levels (ok/warn/err), worker slots; collapsible; `showAnalysisWindow` controls visibility.
- Vision → `describeImages`; exploration → read-only `coding_explore`.

## Long-Term Memory (MemoryPreviewModal.tsx)

- Candidates `LongMemoryCandidate` (kind preference/project/fact/constraint/task, text, tags, importance, confidence) shown for confirmation; `confirmSaveLongMemory` saves, `longMemoryBusy` shows progress. `longMemoryDefaultEnabled` toggles auto-retrieval in new chats. Types in `electron-app/src/types/longMemory.ts`; logic in `useLongMemoryUi`.

## Context / Compression Warning (ContextWarningBanner.tsx)

- Shows `CTX_USAGE % (promptTokens/maxTokens)` when `contextUsageInfo.shouldWarn`, `contextAutoCompress` off, not dismissed.
- Dismiss (`setContextWarnDismissed`) or compress now (`summarizeContextNow`, `contextCompressBusy`).
- Auto-compress near 90% of `llmNumCtx` stores `hiddenContextSummary` (never rendered) + `contextCompressedThroughIndex`.

## Tool-Result & Error Banners

- `ChatToolResultBanner` shows one-shot results (e.g. `PDF_EXPORT_RESULT`) with DISMISS; `ChatErrorBanner` shows agent/tool errors.

## TTS Auto-Voice & STT Input

- **TTS**: `useTtsPlayback` reads replies when `autoVoice` on; `ttsProvider` (`local` OmniVoice HTTP, `runware-xai`, `openrouter-tts`), `voiceMode` (`design`/`clone`), `voiceInstruct`, `cloneRefText`, `ttsSpeed`, `ttsNumStep`, `ttsDurationSec`, `ttsChunkMaxChars`, `runwareXaiVoice`, `runwareTtsModel`, `runwareTtsSpeed`. A read/speaker icon per assistant message triggers `onRead`/`abortTts`.
- **STT**: `useSttInput` with `sttProvider` (`none`/`openrouter`, Whisper model `openrouterSttModel`); record button shows `isRecording`, `recordingDuration`, `sttPending`; transcript fills composer.

## Reminders

- `reminderNotificationsEnabled` fires a desktop notification when a scheduled reminder is due; reminders are stored in `lib/reminderStorage.ts` and managed from `useVoidcastApp` (`deleteReminder`, `markReminderDone`). `reminderNotificationsEnabled` + `notificationSoundsEnabled` + `notificationSoundVolume` control alerting (see settings-reference).
