# Voidcast Documentation

Voidcast is an Electron desktop AI chat + coding assistant (with a web/LAN client variant). It combines a multi-provider LLM chat with agent tool use, long-term memory, TTS/STT voice, image/music generation, and a standalone coding panel for real project work.

**Highlights**

- **Multi-chat** — up to 3 agent runs at once across sessions; switch chats while another is still working  
- **Team mode** — main orchestrates; up to **2 parallel coding workers** (`run_coding_workers`) for multi-file edits  
- **Agent / Ask / Plan / Team** — full tools, read-only Q&A, plan + Approve & Build, or workers  
- **Coding panel** — file tree, preview/edit, terminal next to chat  

See [**multi-chat-and-team.md**](multi-chat-and-team.md) for multi-chat + workers end to end.

## Docs Index

- [**README.md**](README.md) — this index
- [**getting-started.md**](getting-started.md) — install/launch, first chat, choosing a provider, API keys, where settings are stored
- [**multi-chat-and-team.md**](multi-chat-and-team.md) — concurrent chats, Agent/Ask/Plan/Team, coding workers, analysis card
- [**chat.md**](chat.md) — the chat screen: composer, sessions, messages, attachments, sub-agents, memory, context, voice
- [**coding.md**](coding.md) — coding panel + how the agent (and workers) edit files
- [**settings-reference.md**](settings-reference.md) — full field-by-field settings reference
- [**architecture.md**](architecture.md) — screens, hooks, `sessionAgentStore`, agent loop, workers, types

## Quick Start

1. Install the desktop app (Electron). On first launch you land on the chat screen.
2. Open **Options** and pick an LLM provider: local **Ollama** (no account) or a cloud provider (**OpenRouter, NVIDIA, DeepSeek, OpenAI, OpenCode Go, CrofAI**) — see [getting-started.md](getting-started.md).
3. Type your first message. Cycle **Agent → Ask → Plan → Team** with the mode chip (or `Shift+Tab`).
4. **Multi-chat:** start work in one session, open another session, send there — both can run (see [multi-chat-and-team.md](multi-chat-and-team.md)).
5. **Team workers:** Options → SUB → enable coding sub-agent; set a project path; Team mode; multi-area task.
6. Enable the **Coding panel** and set a project path for the tree/terminal — see [coding.md](coding.md).

## Web-Standalone vs Desktop (Electron)

The same UI runs in three environments:

- **Desktop (Electron)** — full experience: cloud API keys stored locally (`localStorage`), local Ollama + TTS server access, coding tools (file read/write/terminal), skills discovery, MCP servers, auto-update.
- **LAN web client** (phone/tablet browser pointed at the desktop server) — the UI works but `applyWebRuntimeOverrides` in `electron-app/src/lib/settings.ts` strips cloud secrets, forces `voiceMode: 'design'`, disables STT, and routes localhost API URLs through the desktop proxy.
- **Web standalone** (browser-only) — no Electron preload, no local file access, no skills/MCP/terminal; cloud providers work if you enter keys (they persist only in that browser's `localStorage`).

Settings normalization lives in `electron-app/src/lib/settings.ts` (`loadSettings` / `saveSettings` / `normalizeSettingsCandidate`). See [architecture.md](architecture.md) for details.
