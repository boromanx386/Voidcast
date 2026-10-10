# Coding Panel

The coding panel is a standalone workspace beside the chat for editing real project files: file tree, file preview, inline text editing, and a terminal — plus git status colors and git actions. Everything here is grounded in `electron-app/src/components/CodingPanel.tsx`, `electron-app/src/components/coding/FileTree.tsx`, `FilePreview.tsx`, `FilePreviewEdit.tsx`, `TerminalView.tsx`, and `electron-app/src/hooks/useCodingSession.ts`.

**Also see:** how **multi-chat** and **Team workers** edit code — [multi-chat-and-team.md](multi-chat-and-team.md).

## Enabling

- The panel is available when the desktop runtime can access local files (`app.codingPanelAvailable`); web-standalone cannot.
- The header shows a **code/coding toggle button** that calls `setShowCodingPanel`; the chat screen renders `CodingPanel` beside the chat only when `showCodingPanel && codingPanelAvailable`.
- The `coding.enabled` setting also gates tool availability: the agent's local coding tools (file read/write/search + terminal) are only registered when `toolsEnabled.coding` is on.
- Defaults: `enabled: true`, `showFileTree: true`, `showFilePreview: true`, `showTerminal: true`, `showWeb: false`.
- The panel header carries the **mode switch** — `◆ CODING` / `● WEB`. `CODING` is the pane stack; `WEB` turns the whole body into the built-in browser (see below). Leaving WEB restores the exact pane combination you had before it.
- The section toolbar has three pane buttons: **FILES**, **PREVIEW** and **TERM**. They combine freely (the last remaining pane cannot be turned off) and are hidden while the panel is in WEB mode.

## Setting the Project Path

- `CodingSettings.projectPath` (top-level alias `codingProjectPath` for backward compatibility) selects the root folder.
- The panel header has a **Pick folder** action (`invokePickCodingDirectory`) that opens a native directory picker and calls `onUpdateProjectPath`.
- `projectPath` is also set by the agent (`set_coding_project`/path tool) and by new-chat-for-project flows. Sessions persist their own coding context memo.
- With no project, the tree shows an empty status (`noProject`).

## File Tree

- `FileTree` renders `CodingFileNode` entries (`type: 'file' | 'directory'`, `name`, `path`, `size`) loaded via `invokeListCodingDirectory`; directories expand lazily by toggling.
- The FILES header shows the active **git branch** label; files with git changes get status colors (from `parseGitStatusText` / `buildGitStatusByPath`), and the tree supports **dirty-only** filtering, staging/unstaging, and discard actions.
- Selecting a file (`onSelectFile`) opens it in the preview.
- The tree refreshes when `fileTreeRevision` increments (agent mutations on disk) and when directory changes are observed (`invokeCodingWatchProject`).
- Ignored/generated folders (`node_modules`, `dist`, …) are shown **dimmed** instead of hidden; a **double-click** opens the path in the OS file manager (`openPath`/shell).

## File Preview

- `FilePreview` renders the selected file's content. Modes:
  - `file` — read-only source view with syntax highlighting (`languageFromPreviewPath`, `highlightPreviewLine`).
  - `diff` — unified diff coloring (`+`/`-`/`@@` lines), with staged vs unstaged variants; stage/unstage/discard actions in the header.
  - `image` — data-URL image preview (`loadCodingPreviewImage`).
- Diff/stage actions call git IPC (`invokeCodingGit`); file content is loaded via `invokeReadCodingFile`.

## In-Preview Editing (FilePreviewEdit)

- In `file` mode the preview header shows an **Edit** button (`onStartEdit`), switching the tab to `FilePreviewEdit`.
- `FilePreviewEdit` is a textarea with a synchronized highlighted overlay, plus **Find** (`findQuery`), **Replace** (`replaceQuery`), match-case toggle, match navigation (`matchIndex`), and scroll-linked highlight (`buildFindHighlightHtml`).
- Save (`onSaveEdit`) writes the draft through `invokeWriteCodingFile`; Cancel discards. While busy, the editor is disabled (`editBusy`).
- The agent's edits also drive the preview: a `revealRequest` expands parent directories and opens the file with highlighting after an `apply_code_edit` / file-write tool runs.

## Terminal View

- `TerminalView` renders `TerminalLine` rows (`stream: 'stdout' | 'stderr' | 'system'`), auto-scrolls to bottom (sticky when within 48px), shows stderr/system styling, and has optional **CLEAR** (`onClear`) and **STOP** (`running` + `onStop`) controls.
- Manual commands are run via `invokeExecuteCodingCommand`; output is streamed from the main process (`consumeLastExecuteCommandStreamed`, `expandTextToTerminalLines`, `MAX_TERMINAL_ROWS`).
- Agent `execute_command` tool output is mirrored into the panel via `agentShellFeed` (per-chat-session terminal ownership keyed by `codingOwnerId` / `runtimeKey`); `agentShellEpoch` clears stale lines when switching sessions.
- `commandRunning` / `onStopCommand` reflect the foreground agent or manual run (`activeCodingRunId`, `stopCodingCommand` in `useVoidcastApp`).

## WEB — built-in browser (`showWeb`)

- The **WEB** toolbar button turns the panel body into the **Voidcast browser**: a real Chromium `WebContentsView` owned by the main process, rendered *over* the panel area by `electron-app/src/components/BrowserPane.tsx`.
- WEB is **exclusive**: enabling it turns `showFileTree` / `showFilePreview` / `showTerminal` off (the previous combination is remembered in the component and restored when you leave WEB or click one of the three panes). The commit bar and the `RUN` row are hidden while WEB is active.
- The same view is what the agent drives through the `browser_*` tools (see [options/tools.md](options/tools.md)) — you can watch the agent work and take over at any time. A `SHOT` button saves a viewport JPEG and `↗` opens the current URL in the system browser.
- Chrome above the view: status dot (`LIVE` / `IDLE` / `ERROR` / `DESKTOP APP ONLY`), back/forward/reload, URL bar, `GO`, `SHOT`, `↗`. The native view is glued to the host rect through a `ResizeObserver` → `voidcast:browser-set-bounds` (a native view does not follow CSS), and it is hidden on unmount so it can never float over the rest of the UI.
- **Browser profile** (`coding.browserProfile`): pages run in `persist:voidcast-browser-<key>`, where the key is derived from the setting — empty (default) = one profile per coding **project path**, `shared` = one profile for the whole app, anything else = a named profile you can reuse across projects. Cookies/logins persist between runs. The header shows the active key and the red `CLR` button wipes that profile's cookies/storage/cache. Changing the project or the setting closes the open pages, because a Chromium partition cannot be swapped on a live page. The switch does not depend on this panel being open: every agent call carries the project path and re-derives the key, so the agent never inherits the previous project's cookies while WEB is closed. The key is computed from a case-folded, trailing-separator-stripped path, so two spellings of the same project are one profile — and a page that was still loading when the partition changed is discarded instead of being adopted. Use per-project profiles with sites you log into: the agent reads untrusted pages, so keeping logins apart limits the blast radius. The session itself is hardened per partition: permissions are **denied** unless they are `fullscreen`, `clipboard-sanitized-write` or `pointerLock` (Electron would otherwise auto-approve camera, microphone, geolocation, notifications and clipboard reads), downloads are routed into `<project>/.voidcast/browser/downloads` instead of the OS Downloads folder, and a page that asks for HTTP Basic/Digest auth gets a **sign-in bar** in the panel — remembered credentials are `safeStorage`-encrypted and `CLR` forgets them together with the cookies.
- Requires the desktop runtime (the standalone web build shows `DESKTOP APP ONLY`). Registering the agent tools additionally requires `toolsEnabled.browser`.

## Chat ⇄ Panel Split (width)

- A vertical `role="separator"` divider sits between chat and the coding panel; drag with the pointer (or use arrow keys, `Shift` for 32px steps, `Home` = max, `End` = min).
- Clamp constants in `electron-app/src/lib/settings.ts`:
  - `CODING_PANEL_WIDTH_DEFAULT = 416`
  - `CODING_PANEL_WIDTH_MIN = 280`
  - `CODING_PANEL_WIDTH_MAX = 1200`
- `clampCodingPanelWidth(px, containerWidth?)` also caps to 85% of the container. The persisted value is `coding.panelWidthPx`; `ChatScreen` keeps a width ratio so maximize/restore and ResizeObserver changes feel stable.

## FILES ⇄ Preview/Terminal Split (height)

- Inside the panel, the FILES section and the rest (preview/terminal) are split vertically by a horizontal divider that calls `CodingUiVisibilityPatch.fileTreeHeightPx`.
- Clamp constants:
  - `CODING_FILE_TREE_HEIGHT_DEFAULT = 220`
  - `CODING_FILE_TREE_HEIGHT_MIN = 100`
  - `CODING_FILE_TREE_HEIGHT_MAX = 480`
- `clampCodingFileTreeHeight(px, containerHeight?)` caps to 70% of the container height.

## Preview ⇄ Terminal Split (height)

- A draggable horizontal divider between the file preview and the terminal, shown only when **both** are visible (preview + terminal). It calls `CodingUiVisibilityPatch.terminalHeightPx`.
- When the terminal is visible without the preview (or with terminal + commit but no preview), it fills the remaining space with no divider; commit-only uses natural height.
- Clamp constants in `electron-app/src/lib/settings.ts`:
  - `CODING_TERMINAL_HEIGHT_DEFAULT = 200`
  - `CODING_TERMINAL_HEIGHT_MIN = 80`
  - `CODING_TERMINAL_HEIGHT_MAX = 480`
- Drag direction follows the bottom-anchored pane (drag up grows the terminal). Keyboard: ↑/↓ 16px step, `Shift` 32px, `Home` = max, `End` = min.

## How the Agent Applies File Edits

- The agent's coding tools live in `electron-app/src/lib/codingTools.ts` (IPC to the Electron main process) and are wired into the tool loop via `toolHandlers`, `toolDefinitions`, `applyAgentToolResult`.
- Tools: list directory, read file, write file (full rewrite), apply code edits (search/replace blocks), terminal command execution, git status/stage/discard, and (when coding SUB is on):
  - **`coding_explore`** — read-only nested sub-agent (map repo → compact digest).
  - **`run_coding_workers`** — 1–2 parallel coding workers on the **coding** sub model (`codingWorkers.ts`).
- After a file mutation the session bumps `codingFileTreeNonce` / `codingGitNonce`; the open panel refreshes tree + git colors, and `codingRevealParentDirs` expands parents + opens the changed file in preview.
- Manual edits via the UI write through the same `invokeWriteCodingFile` path, keeping preview, tree, and git status in sync.

### Parallel coding workers (`run_coding_workers`)

- Available in **Agent** (optional) and **Team** (preferred); not in Plan.
- Requires Options → SUB → **ENABLE_CODING_SUB_AGENT**, coding tools on, and a project path.
- Up to **2** tasks per call; each has `goal`, optional **`path_prefix`**, optional `max_rounds` (default/max **100**).
- **Two workers run in parallel** with each other; the **main** agent is **blocked** until the batch returns digests (one tool step).
- **Writes/edits** are rejected outside `path_prefix` when it is set (file or directory). **Reads** may span the whole project (read budget). **File locks** reduce two workers writing the same path.
- Workers cannot nest another `run_coding_workers` or `coding_explore`.
- See [options/subagent.md](options/subagent.md) for explore vs workers and analysis UI.
