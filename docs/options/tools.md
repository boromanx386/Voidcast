# Tools Tab

> Grounded in `electron-app/src/components/options/ToolsOptionsPanel.tsx` and `electron-app/src/lib/settings.ts`. This tab controls which tools the chat agent can use, how long tool loops may run, MCP server connectivity, the coding project path, and the PDF output directory.

<p align="center">
  <img src="https://raw.githubusercontent.com/boromanx386/Voidcast/main/demos/voidcast-options-tools.png" width="720" alt="Options → Tools tab"/>
</p>
<p align="center"><em>Options → Tools.</em></p>

## Tool enable flags (`toolsEnabled`)

Type: `ToolsEnabled`, all booleans. Defaults: all `true`.

| Tool key | Purpose |
| --- | --- |
| `webSearch` | Web search |
| `weather` | Weather lookup |
| `scrape` | Fetch a public URL in the main process → plain text (HTML stripped) |
| `browser` | Drive the built-in Voidcast browser (coding panel **WEB** view) with agent `browser_*` tools |
| `pdf` | Save text as PDF into `pdfOutputDir` (main process) |
| `youtube` | YouTube search / video info / transcript (TTS server: yt-dlp + transcript API) |
| `runwareImage` | Generate images via Runware API |
| `runwareMusic` | Generate music/audio via Runware ACE-Step model |
| `coding` | Local coding tools (file read/write/search + terminal command execution) |
| `enterPlan` | Agent can switch the conversation into Plan mode (read-only plan flow) |

Each flag has a toggle in the panel (`ToolToggle`). If a tool is disabled, the agent no longer registers that tool in its toolset.

### Built-in browser (`browser_*`)

`browser` gates the Voidcast-owned browser: a real Chromium `WebContentsView` inside the app window (the coding panel **WEB** view), driven by the main process over in-process CDP (`webContents.debugger`). It needs no external Chrome and no browser skill — the agent and you share the same view.

| Tool | Access | Purpose |
| --- | --- | --- |
| `browser_navigate_page` | write | Open an `http(s)` URL (localhost allowed) and return the final URL; `wait: false` replies as soon as the navigation starts |
| `browser_take_snapshot` | read | Accessibility snapshot; every line is `<uid> <role> name="..."` |
| `browser_click` | write | Trusted real mouse click on the element with that `uid` |
| `browser_fill` | write | Focus the `uid` element, **replace** what it holds with the text (optional Enter submit) |
| `browser_press_key` | write | Press one key or a chord: a character (`1`, `a`, `+`), a physical code (`Digit1`, `KeyA`, `Numpad1`, `F5`) or a name (`Enter`, `Escape`, `Tab`, `ArrowUp`, …), optionally with modifiers (`Control+A`) |
| `browser_take_screenshot` | write | Save a JPEG into `<project>/.voidcast/browser/shots/` — viewport by default, one element via `uid`, whole document via `full_page` |
| `browser_emulate` | write | Emulate a device viewport / dark mode for responsive QA (`reset` clears it) |
| `browser_status` | read | Browser state: profile, active url/title, open pages, whether the active page is **painted in the panel**, a held sign-in, the last download |
| `browser_list_console_messages` | read | Recent console messages / page errors |
| `browser_list_network_requests` | read | Recent network requests (method, status, url) |
| `browser_wait_for` | read | Wait for a CSS selector, visible text, a URL substring and/or network idle before acting |
| `browser_handle_dialog` | write | Choose accept/dismiss for JS dialogs (dialogs are always auto-answered, so they can never freeze the page) |
| `browser_list_pages` | read | List every open page and mark the current one (`*`) |
| `browser_new_page` | write | Open a new page (tab); it becomes current unless `background` is set |
| `browser_select_page` | write | Make a page current — agent tools **and** the panel follow |
| `browser_close_page` | write | Close a page and report the new current page |

Notes:

- Multi-page: the agent can keep up to **8 pages** open (each is a live Chromium renderer, so the cap is about memory). The coding panel renders **only the current page**; once more than one is open the pane header shows a page selector plus `n/total`. Links that open a new window (`target=_blank`, `window.open`) become a page in this browser instead of the system browser, so the flow never leaves the panel.
- Plan/Ask mode registers only the read-only tools (`browser_navigate_page`, `browser_click`, `browser_fill`, `browser_press_key`, `browser_new_page`, `browser_close_page` and `browser_handle_dialog` are in `PLAN_MODE_BLOCKED_TOOLS`).
- Element addressing uses the accessibility tree (`Page` → `Accessibility.getFullAXTree`), **not** CSS selectors. Snapshots are taken after every navigation or UI change; `uid` values are only valid for the latest snapshot.
- Clicks and typing are dispatched as real CDP input events (`Input.dispatchMouseEvent` / `Input.insertText` / `Input.dispatchKeyEvent`), so React/Vue apps react exactly as they would to a real user. `browser_fill` selects the field's existing value first, so filling an already-filled input replaces it instead of appending (`Input.insertText` only replaces the current *selection*).
- Input is built to match a real keyboard, which is what canvas games need: `browser_press_key` sends a consistent `key`/`code`/`keyCode` (`1` → `key="1"`, `code="Digit1"`, `keyCode=49`; a physical code Chromium does not recognise is dropped and the page then sees `code=""`), and every click/fill/key press focuses the page first — `document.hasFocus()` is false on a freshly loaded page, and games ignore input while it is. The **current page also stays visible even when the panel is not painting it**, because a hidden renderer stops `requestAnimationFrame` outright and a game loop then never advances (only background pages are hidden, exactly like background tabs).
- Known limitation for games: `requestPointerLock()` still fails under CDP-dispatched input (Chromium requires transient user activation, which injected input does not grant), so a mouse-look game that insists on the pointer lock cannot be driven yet — keyboard/click games without it are fine.
- Every tool call carries the coding project path, so the browser profile is re-derived even while the WEB panel is not mounted. Switching project therefore never lets the agent drive the previous project's logged-in session; a page still loading when the partition changed is discarded, and the tool asks for a fresh snapshot instead of acting on it.
- `browser_take_screenshot` returns a **file path**, not image bytes — pass that path to **`image_recall`** to actually look at the page (keeps the tool result small).
- Clicks scroll the element into view first and use its **border** box: an element below the fold is not hit-testable, and dispatching at its off-screen coordinates silently does nothing. Screenshot clips use **document** coordinates, which is a different space from the viewport-space quad CDP returns (both verified in a spike).
- `browser_emulate` sets viewport metrics and/or `prefers-color-scheme` for the current page. While a viewport override is active, captures come back scaled by the device scale factor (390×844 at dsf 3 → 1170×2532), and full-page shots are clamped to 16000px tall.
- Screenshots work whether or not the **WEB** view is on screen: every capture is wrapped in a short `Page.startScreencast`, which forces the compositor to produce a frame (~50ms either way). Without that, a hidden view waits ~3.9s on a static page and times out on an animated one.
- Also available to you manually: the WEB view's own URL bar, back/forward/reload, a `SHOT` button, and `↗` (open the current URL in the system browser).
- Session hardening is on by default: permissions are **denied** unless they are `fullscreen`, `clipboard-sanitized-write` or `pointerLock`. Without a handler Electron auto-approves camera, microphone, geolocation, notifications and clipboard reads for any page, which is the wrong default for a browser the agent drives over untrusted content. The panel shows the last denial.
- Downloads never go to the OS Downloads folder: they land in **`<project>/.voidcast/browser/downloads`** (or `userData/browser-downloads/<profile>` when no project is open) under a de-duplicated file name, and the panel shows the last one. `.voidcast/` is git-ignored.
- HTTP auth (Basic/Digest) is answered from the **encrypted** per-profile store when "remember" was ticked on an earlier prompt; otherwise Chromium holds the page open and the WEB panel renders a sign-in bar. The agent never receives the password — `browser_navigate_page` fails fast with *HTTP authentication required…* instead of sitting on the 25s load timeout. `CLR` also forgets remembered sign-ins.

## Max agent tool rounds (`agentMaxToolRounds`)

Type: `number`, default `50`, clamped to `AGENT_MAX_TOOL_ROUNDS_MIN = 5` .. `AGENT_MAX_TOOL_ROUNDS_MAX = 120` (`clampAgentMaxToolRounds`).

Max agent↔tool loop rounds per assistant turn (main agent only). Nested **workers** have a separate round budget (default/max **100**); **explore** uses a lower cap (default **8** / max **12**). A soft wrap-up warning fires near the main limit and a hard wrap-up after exhaustion.

## MCP servers

- **`mcpEnabled`** (`boolean`, default `false`) — connect to MCP servers from `~/.voidcast/mcp.json` plus project `.mcp.json` files and register their tools with the agent (desktop only).
- **Per-server enable** — `mcpServerEnabled` (`Record<string, boolean>`). Key = server id from mcp.json; missing key = enabled. Set `false` to keep a server in config but not connect/expose its tools. The `McpServersSection` panel lists discovered servers with per-server toggle/connect/status handling.
- **Trusted project paths** — `mcpTrustedProjectPaths` (`string[]`, default `[]`). Project roots the user explicitly trusted to load `.mcp.json` MCP servers from. Untrusted project configs are ignored until approved here (managed by `electron-app/src/lib/mcpProjectTrust.ts`).
- The panel refreshes the MCP server list (scans `~/.voidcast/mcp.json` and trusted project `.mcp.json` files) and shows connection/test actions per server.

## Coding project path

- `coding.projectPath` (`CodingSettings.projectPath`, default `''`) and its backward-compatible top-level alias **`codingProjectPath`** (`string`, default `''`).
- Choosing a folder applies the project path immediately via `applyCodingProjectPath` (passed from `OptionsScreen`).
- Other coding panel layout fields live in `CodingSettings` (`showFileTree`, `showFilePreview`, `showTerminal`, `panelWidthPx`, `fileTreeHeightPx`) and are adjusted in the coding panel, not this tab.
- Top-level `coding.enabled` toggles the standalone coding panel (also mirrored by the `coding` tool flag).

## PDF output directory (`pdfOutputDir`)

Type: `string`, default `''`.

Where the `save_pdf` tool writes files **without showing a save dialog**. Empty = the tool returns an error until a directory is set. Pick via folder dialog (main process) or type a path. `effectivePdfOutputDir` is passed to this panel from `OptionsScreen` so the shown path reflects any runtime overrides.

## Tools the agent registers

The agent registers tools from the enabled set above (`webSearch`, `weather`, `scrape`, `browser`, `pdf`, `youtube`, `runwareImage`, `runwareMusic`, `coding`, `enterPlan`) plus:

- MCP tools from enabled servers (when `mcpEnabled`).
- The `read_skill` tool and skills catalog when `skillsEnabled` (see [Skills](skills.md)).
- When coding tools + coding sub-agent are on: **`coding_explore`** (read-only nested map) and **`run_coding_workers`** (1–2 parallel mutable workers) in Agent/Team — not Plan. See [Sub-Agent](subagent.md) and [coding.md](../coding.md).
- Vision sub-agent paths when `subAgent.enabled` (image describe / `image_recall`).

Registration also depends on **chat mode** (e.g. Team omits `enter_plan_mode`). Definitions: `electron-app/src/lib/toolDefinitions.ts`.
