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
├── BrowserPane.tsx  Coding panel WEB mode — chrome for the native browser view
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
- `useSttInput` — speech-to-text input (OpenRouter Whisper or local Whistle via the tools-server).
- `useTtsPlayback` — text-to-speech playback + auto-voice.
- `useCodingSession` — the coding panel session state (owner-aware shell feed).

### Session agent runtime

`src/lib/sessionAgentStore.ts` holds per-chat (and draft) **agent slots**: messages, busy, tool phase, active tool activities, media meta, abort controller, coding project freeze, and ephemeral `subAgentPanel` live state. Product write-up: [multi-chat-and-team.md](multi-chat-and-team.md). UI messages can persist `subAgentActivity` and intermediate `agentProgress` blocks for the analysis card / tool-round drafts across reloads (`chatSessionsStorage` + `normalizeSubAgentActivity`). Concurrent runs are capped (`MAX_CONCURRENT_AGENT_RUNS = 3`).

---

## Settings: load / save / normalize

`src/lib/settings.ts` is the single source of truth for settings.

- **Model types:** `AppSettings` and `CodingSettings`, plus provider enums (`LlmProvider`, `TtsProvider`, `SttProvider`, `ImageProvider`), `VoiceMode`, `LlmThinkLevel`, `AgentChatMode` (`agent` | `plan` | `team`), `UiTheme`, `ToolsEnabled`, `SubAgentConfig`, and the image/music profile types.
- **Storage:** settings persist in `localStorage` under `voidcast-settings-v1`.
- **Pipeline:** `loadSettings()` reads + normalizes (migrating legacy shapes, applying clamps), `saveSettings()` writes back, and normalizer functions produce a complete well-typed settings object. Clamp helpers enforce bounds (e.g. `clampCodingPanelWidth`, `clampCodingFileTreeHeight`).
- **Agent editability:** `AGENT_EDITABLE_SETTINGS_FIELDS` lists which settings the agent may change; API-key fields are excluded.
- **Cross-cutting constants:** coding splitter defaults/bounds, OpenRouter TTS/image model defaults, Runware configured image/music models, sub-agent token defaults (16K/ctx, 2K out).

`src/types/` holds the shared domain types: `voidcast.ts` (Screen), `chat.ts` (AgentChatMode, SystemPromptPreset, `UiMessage` including `plan`, `subAgentActivity`, and `agentProgress`), `coding.ts`, and `longMemory.ts`.

---

## Agent loop

The assistant (agent) loop lives in `src/lib/`:

- **`agentToolLoop`** — the round-based loop. Each assistant turn may run multiple tool-call rounds, bounded by `agentMaxToolRounds` (clamped 5–120). Adjacent allowlisted read-only tools run concurrently (up to 4 by default) and commit results in provider order; serial or mutating tools form barriers. Intermediate assistant drafts are preserved before a tool round replaces the stream, and tool lifecycle callbacks drive the live activity strip.
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

### Built-in browser (main process)

`electron-app/electron/main/browser/` owns the Voidcast browser — the coding panel WEB view that agent `browser_*` tools drive:

- `viewManager.ts` — the page registry: **one `WebContentsView` per open page** (max 8, each a live Chromium renderer) added to `win.contentView`, one shared `persist:voidcast-browser-<key>` partition for all of them, `detach()` before close. The `<key>` comes from `coding.browserProfile`: empty = one profile per project path (`configureBrowser` re-derives it and closes the old pages when the project or the setting changes), `shared` = one app-wide, anything else = a named profile. `ensureBrowser` re-derives the key on **every** call that knows the project path, because the panel (the other caller of `configureBrowser`) only exists while WEB mode is open; `profileEpoch` is bumped on each switch (and on shutdown) so a page still booting in the previous partition is discarded by `newPageInWindow` instead of being registered into the new profile. `clearBrowserData` wipes cookies/storage/cache for the active key. Tabs exist for the agent; the panel is a viewport onto the **current page** only. `target=_blank` / `window.open` become a page here instead of the system browser.
- **Layout and paint are separate concerns.** Every page always keeps a real viewport: parked pages sit off-screen at the *panel's* size — never 0×0, and never the fallback size once the panel is known, so switching tabs does not reflow. Only the current page is painted, and only while the panel asks for it (`panelRect` / `visible` in `voidcast:browser-status`), so it can never float over the rest of the UI.
- `cdp.ts` — `CdpSession` over `webContents.debugger`: per-command timeout, accessibility snapshot with `uid → backendDOMNodeId`, trusted input (`Input.dispatchMouseEvent` / `insertText` / `dispatchKeyEvent`), console/network ring buffers.
- `Page.captureScreenshot` waits for a compositor frame, so every capture runs inside a short `Page.startScreencast` (frames acked). Measured on Electron 33: 67ms visible, 3.9s parked, timeout on an animated page — the screencast makes screenshots independent of whether the panel is on screen.
- `ipc.ts` — `registerBrowserIpc(() => win)` called from `electron/main/index.ts`; all `voidcast:browser-*` channels resolve `{ ok } | { ok: false, error }`.
- Ordering rule (spike-derived): create → `addChildView` → `loadURL('about:blank')` → **then** `debugger.attach('1.3')` and enable domains. Sending any CDP command before the view's first navigation hangs forever.
- Bounds are deliberately **not** clamped against the window size: a stale window measurement used to collapse the rect to 0×0, which presents exactly as "nothing renders" plus "every screenshot times out".
- The renderer never talks to CDP: `BrowserPane.tsx` only positions the view and renders chrome; the agent path is tool handler → preload bridge → IPC → CDP.
- **Session hardening happens once per partition**, before the first page in it loads (`hardenSession`): a deny-by-default `setPermissionRequestHandler` (Electron auto-approves camera, microphone, geolocation, notifications and clipboard reads when no handler is set) with a three-entry allowlist, a matching `setPermissionCheckHandler`, and the `will-download` router. Downloads are funnelled into `<project>/.voidcast/browser/downloads` (or `userData/browser-downloads/<profile>` with no project) under a sanitized, de-duplicated file name, so a page the agent was steered to can never overwrite something in the OS Downloads folder.
- **HTTP auth (Basic/Digest)** is wired per page with `webContents.on('login')`. A remembered credential — `safeStorage`-encrypted (OS keychain) in `userData/browser-auth/<profile>.json` — is answered silently; anything else is held open and surfaced as a sign-in bar in the panel (`auth` in `voidcast:browser-status`), because Chromium otherwise cancels the authentication and leaves the page hanging on a 401 forever. `withAuthWatch` turns a held request into a fast, readable navigation error instead of a 25s timeout, and `CLR` / `clearBrowserData` deletes the stored credentials together with the cookies.
- **Input aims to match a physical keyboard**, which is what canvas games notice: `keys.ts` resolves a token to a consistent `key`/`code`/`keyCode` (`1` → `key="1"`, `code="Digit1"`, `keyCode=49`; `Control+A` works too), because Chromium silently DROPS a `code` it does not recognise — the old "Key1" reached the page as `code=""`, which broke every game switching on `event.code`. `clickByUid`, `fillByUid` and `pressKey` also focus the view first (`webContents.focus()`), since `document.hasFocus()` is false on a freshly loaded page and games ignore input — and refuse `requestPointerLock()` — while it is.
- **Profile housekeeping** (`browser/maintenance.ts`) stops `userData/Partitions` from growing without bound. Every profile the app touches is recorded in `browser-profiles.json`; a **trim** drops only re-downloadable caches (`clearCache`, `clearCodeCaches` and the `cachestorage`/`shadercache`/`serviceworkers` storages), so cookies, local storage and logins survive. It runs once per app run for every inactive profile whose caches passed 100 MB (`runBrowserMaintenance`, fired from `hardenSession`), and again whenever a profile is left behind in `applyProfile`. A profile is **deleted** only when this build never recorded it, nothing has touched it for a week, and it is not in use this run — that is what removes leftovers of renamed folders and the pre-normalisation keys, while a project that is merely unopened keeps its session.
- **The active page is never hidden.** Parked pages are laid out off-screen, but only *background* pages get `setVisible(false)`: a hidden renderer stops `requestAnimationFrame` outright, so a game loop (or any rAF-driven app) freezes the moment the panel stops painting it, even though the agent keeps driving it. Known limitation: `requestPointerLock()` still fails under CDP-dispatched input (injected events do not grant transient user activation), so a mouse-look game that insists on the pointer lock cannot be driven yet.
