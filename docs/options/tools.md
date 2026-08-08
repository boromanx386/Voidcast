# Tools Tab

> Grounded in `electron-app/src/components/options/ToolsOptionsPanel.tsx` and `electron-app/src/lib/settings.ts`. This tab controls which tools the chat agent can use, how long tool loops may run, MCP server connectivity, the coding project path, and the PDF output directory.

## Tool enable flags (`toolsEnabled`)

Type: `ToolsEnabled`, all booleans. Defaults: all `true`.

| Tool key | Purpose |
| --- | --- |
| `webSearch` | Web search |
| `weather` | Weather lookup |
| `scrape` | Fetch a public URL in the main process → plain text (HTML stripped) |
| `pdf` | Save text as PDF into `pdfOutputDir` (main process) |
| `youtube` | YouTube search / video info / transcript (TTS server: yt-dlp + transcript API) |
| `reddit` | Reddit read-only feed / search / post fetch via public JSON endpoints (TTS server) |
| `runwareImage` | Generate images via Runware API |
| `runwareMusic` | Generate music/audio via Runware ACE-Step model |
| `coding` | Local coding tools (file read/write/search + terminal command execution) |
| `enterPlan` | Agent can switch the conversation into Plan mode (read-only plan flow) |

Each flag has a toggle in the panel (`ToolToggle`). If a tool is disabled, the agent no longer registers that tool in its toolset.

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

The agent registers tools from the enabled set above (`webSearch`, `weather`, `scrape`, `pdf`, `youtube`, `reddit`, `runwareImage`, `runwareMusic`, `coding`, `enterPlan`) plus:

- MCP tools from enabled servers (when `mcpEnabled`).
- The `read_skill` tool and skills catalog when `skillsEnabled` (see [Skills](skills.md)).
- When coding tools + coding sub-agent are on: **`coding_explore`** (read-only nested map) and **`run_coding_workers`** (1–2 parallel mutable workers) in Agent/Team — not Plan. See [Sub-Agent](subagent.md) and [coding.md](../coding.md).
- Vision sub-agent paths when `subAgent.enabled` (image describe / `image_recall`).

Registration also depends on **chat mode** (e.g. Team omits `enter_plan_mode`). Definitions: `electron-app/src/lib/toolDefinitions.ts`.
