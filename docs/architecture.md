# Architecture

Developer-oriented overview of Voidcast's codebase. This is about how the app is put together — screens, components, hooks, settings, the agent loop, and types — not how to use the product (see the other docs for that).

All paths are relative to `electron-app/`.

---

## Screens

The app has exactly two top-level screens (`Screen` type in `src/types/voidcast.ts`):

- **`chat`** — the chat workspace (chat + optional coding panel).
- **`options`** — the Settings screen with its 7 tabs.

`src/App.tsx` switches between them and holds the options overlay/state.

### Options tabs

`src/components/options/OptionsScreen.tsx` defines `OPTIONS_SECTIONS` — exactly 7 tabs:

1. general
2. llm
3. media
4. tts
5. tools
6. skills
7. subAgent

Each tab maps to a panel component under `src/components/options/`:

| Tab | Panel |
| --- | --- |
| general | `GeneralOptionsPanel.tsx` |
| llm | `LlmOptionsPanel.tsx` |
| media | `MediaOptionsPanel.tsx` → `RunwareOptionsPanel.tsx` + `RunwareMusicOptionsPanel.tsx` |
| tts | `TtsOptionsPanel.tsx` |
| tools | `ToolsOptionsPanel.tsx` |
| skills | `SkillsOptionsPanel.tsx` |
| subAgent | `SubAgentOptionsPanel.tsx` |

---

## Component layout

```
src/components/
├── chat/       Chat screen — ChatScreen, ChatComposer, ChatHeader,
│               ChatSidebar, ModelSwitcher, SubAgentPanel,
│               MemoryPreviewModal, ContextWarningBanner,
│               ChatToolResultBanner, ChatSystemStatus, ChatDragOverlay
├── coding/     Coding panel — FileTree, FilePreview, FilePreviewEdit, TerminalView
└── options/    Settings — one panel per tab (see table above)
```

- `chat/ChatScreen.tsx` composes the header, composer, message list, and the optional coding panel.
- `chat/ChatComposer.tsx` is the input area, including the agent-mode toggle (Plan / Agent / Team) and file drag-drop overlay.
- `components/coding/*` render the standalone coding panel (file tree, file preview with in-place editing, terminal), driven by `CodingSettings`.

---

## Hooks

Specialized state hooks live in `src/hooks/`:

- `useVoidcastApp` — top-level app wiring (screen switching, options, reminders).
- `useAppSettings` — loads/normalizes/saves settings and exposes an update function.
- `useChatSessions` — chat session list, active session, CRUD (new / rename / delete / fork / export); sticky unsaved drafts when auto-save is off.
- `useChatAgent` — runs the agent loop for the **visible** runtime key; binds mid-run rekey draft → session.
- `useLongMemoryUi` — long-term memory management UI state.
- `useSttInput` — speech-to-text input (OpenRouter Whisper).
- `useTtsPlayback` — text-to-speech playback + auto-voice.
- `useCodingSession` — the coding panel session state (owner-aware shell feed).

### Session agent runtime

`src/lib/sessionAgentStore.ts` holds per-chat (and draft) **agent slots**: messages, busy, tool phase, media meta, abort controller, coding project freeze, and ephemeral `subAgentPanel` live state. UI messages can persist `subAgentActivity` for the analysis card across reloads (`chatSessionsStorage` + `normalizeSubAgentActivity`).

---

## Settings: load / save / normalize

`src/lib/settings.ts` is the single source of truth for settings.

- **Model types:** `AppSettings` and `CodingSettings`, plus provider enums (`LlmProvider`, `TtsProvider`, `SttProvider`, `ImageProvider`), `VoiceMode`, `LlmThinkLevel`, `AgentChatMode` (`agent` | `plan` | `team`), `UiTheme`, `ToolsEnabled`, `SubAgentConfig`, and the image/music profile types.
- **Storage:** settings persist in `localStorage` under `voidcast-settings-v1`.
- **Pipeline:** `loadSettings()` reads + normalizes (migrating legacy shapes, applying clamps), `saveSettings()` writes back, and normalizer functions produce a complete well-typed settings object. Clamp helpers enforce bounds (e.g. `clampCodingPanelWidth`, `clampCodingFileTreeHeight`).
- **Agent editability:** `AGENT_EDITABLE_SETTINGS_FIELDS` lists which settings the agent may change; API-key fields are excluded.
- **Cross-cutting constants:** coding splitter defaults/bounds, OpenRouter TTS/image model defaults, Runware configured image/music models, sub-agent token defaults (16K/ctx, 2K out).

`src/types/` holds the shared domain types: `voidcast.ts` (Screen), `chat.ts` (AgentChatMode, SystemPromptPreset, `UiMessage` including `plan` and `subAgentActivity`), `coding.ts`, and `longMemory.ts`.

---

## Agent loop

The assistant (agent) loop lives in `src/lib/`:

- **`agentToolLoop`** — the round-based loop. Each assistant turn may run multiple tool-call rounds, bounded by `agentMaxToolRounds` (clamped 5–120). Tools within a round run **sequentially** (await each result).
- **`agentSkills`** — the Agent Skills catalog + `read_skill` tool (gated by `skillsEnabled`).
- **`agentParams`** — provider/model resolution and inference parameters for a request.
- **`buildAgentTurnContext`** — assembles the context for one agent turn (system prompt, mode hints for Agent/Team/Plan, workers guidance).
- **`toolHandlers/`** — concrete tool implementations, including coding explore/workers in `codingHandlers.ts`.
- Tool definitions are registered per the `toolsEnabled` flags in `ToolsEnabled` and chat mode (e.g. Team does not register `enter_plan_mode`; workers only when coding SUB is on and not Plan).

### MCP

MCP servers are loaded from `~/.voidcast/mcp.json` plus project `.mcp.json`, gated by `mcpEnabled` and per-server `mcpServerEnabled` flags. Project `.mcp.json` files are only trusted after approval in Options → Tools (`mcpTrustedProjectPaths`). Concurrent chats cancel MCP only for their own runtime key.

### Sub-agent

`SubAgentConfig` (in `settings.ts`) configures vision and coding roles. `subAgentConfigForRole(sub, 'vision' | 'coding')` projects fields. Coding path: `codingSubAgent.ts` (explore + trims) and `codingWorkers.ts` (parallel mutable workers). Analysis UI state: `subAgentPanelState.ts`. See [options/subagent.md](options/subagent.md).

---

## Process boundaries

- **Renderer (React)** — all UI, hooks, and the agent loop above.
- **Main / TTS server (Electron)** — handles `save_pdf`, YouTube/Reddit scraping, coding tool IPC (read/write/search + terminal execution), MCP connectivity, auto-update, and LAN web proxy. Desktop-only features (MCP, skills discovery, coding tools, auto-save output folders) are noted as such in the docs.
