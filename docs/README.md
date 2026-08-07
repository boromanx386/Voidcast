# Voidcast Documentation

Voidcast is an Electron desktop AI chat + coding assistant (with a web/LAN client variant). It combines a multi-provider LLM chat with agent tool use, long-term memory, TTS/STT voice, image/music generation, and a standalone coding panel for real project work.

In chat, the assistant ("Void") can act as a plain model, a Plan-mode explorer, an Agent with full tools, or a Team mode that spawns up to 2 parallel coding workers. The coding panel gives direct file-tree, file-preview/edit, and terminal access beside the chat.

## Docs Index

- [**README.md**](README.md) — this index
- [**getting-started.md**](getting-started.md) — install/launch, first chat, choosing a provider, API keys, where settings are stored
- [**chat.md**](chat.md) — the chat screen end to end: composer, modes, model switcher, sessions, message rendering, attachments, sub-agents, memory, context warnings, tool banners, voice
- [**coding.md**](coding.md) — the coding panel: enabling, project path, file tree, preview/edit, terminal, splitters, how the agent edits files
- [**settings-reference.md**](settings-reference.md) — full field-by-field settings reference (every `AppSettings` + `CodingSettings` key, type, default, bounds)
- [**architecture.md**](architecture.md) — developer-oriented overview: screens, components, hooks, settings pipeline, agent loop, types

## Quick Start

1. Install the desktop app (Electron). On first launch you land on the chat screen.
2. Open **Options** and pick an LLM provider: local **Ollama** (no account) or a cloud provider (**OpenRouter, NVIDIA, DeepSeek, OpenAI, OpenCode Go**) — see [getting-started.md](getting-started.md).
3. Type your first message in the composer. Switch between **Agent / Team / Plan** modes with the mode button (or `Shift+Tab`).
4. Enable the **Coding panel** (header button or Options → Tools → coding) and set a project path to start editing real files — see [coding.md](coding.md).

## Web-Standalone vs Desktop (Electron)

The same UI runs in three environments:

- **Desktop (Electron)** — full experience: cloud API keys stored locally (`localStorage`), local Ollama + TTS server access, coding tools (file read/write/terminal), skills discovery, MCP servers, auto-update.
- **LAN web client** (phone/tablet browser pointed at the desktop server) — the UI works but `applyWebRuntimeOverrides` in `electron-app/src/lib/settings.ts` strips cloud secrets, forces `voiceMode: 'design'`, disables STT, and routes localhost API URLs through the desktop proxy.
- **Web standalone** (browser-only) — no Electron preload, no local file access, no skills/MCP/terminal; cloud providers work if you enter keys (they persist only in that browser's `localStorage`).

Settings normalization lives in `electron-app/src/lib/settings.ts` (`loadSettings` / `saveSettings` / `normalizeSettingsCandidate`). See [architecture.md](architecture.md) for details.
