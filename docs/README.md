# Voidcast Documentation

Voidcast is an Electron desktop AI chat + coding assistant. It combines a multi-provider LLM chat with agent tool use, long-term memory, TTS/STT voice, image/music generation, and a standalone coding panel for real project work.

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
- [**control-api.md**](control-api.md) — opt-in loopback API to list, read and stop chats from a local agent
- [**settings-reference.md**](settings-reference.md) — full field-by-field settings reference
- [**architecture.md**](architecture.md) — screens, hooks, `sessionAgentStore`, agent loop, workers, types
- [**development.md**](development.md) — run from source, lint, build for Windows and Linux, release, repository layout
- [**benchmark.md**](benchmark.md) — cheap models on real tasks: tasks, tokens, hidden checks
- [**options/README.md**](options/README.md) — Options screen overview: seven tabs, auto-save, agent-editable vs hidden settings

### Options tabs

- [**general.md**](options/general.md) — theme, cloud API keys, notifications, auto-update, long-term memory
- [**llm.md**](options/llm.md) — provider and per-provider endpoints/models, generation defaults, think level, system prompt
- [**media.md**](options/media.md) — image generation (OpenRouter vs Runware) and music (Runware ACE-Step or Google Lyria 3 through OpenRouter)
- [**tts.md**](options/tts.md) — text-to-speech and speech-to-text
- [**tools.md**](options/tools.md) — tool flags, tool rounds, MCP servers, coding project path, PDF output directory
- [**skills.md**](options/skills.md) — Agent Skills discovery, `read_skill`, the catalog hint
- [**subagent.md**](options/subagent.md) — vision sub-agent, coding explore and workers

## Quick Start

1. Install the desktop app (Electron) — Windows installer or Linux AppImage/`.deb` from [Releases](https://github.com/boromanx386/Voidcast/releases/latest). On first launch you land on the chat screen.
2. Open **Options** and plug in a provider you already pay for (**OpenRouter, NVIDIA NIM, DeepSeek, OpenCode Go**, or any endpoint through **Custom** — OpenAI, Anthropic, LM Studio, vLLM…), or stay keyless with **Ollama** — see [getting-started.md](getting-started.md).
3. Type your first message. Cycle **Agent → Ask → Plan → Team** with the mode chip (or `Shift+Tab`).
4. **Multi-chat:** start work in one session, open another session, send there — both can run (see [multi-chat-and-team.md](multi-chat-and-team.md)).
5. **Team workers:** Options → SUB → enable coding sub-agent; set a project path; Team mode; multi-area task.
6. Enable the **Coding panel** and set a project path for the tree/terminal — see [coding.md](coding.md).

## Runtime

Voidcast runs only as the Electron desktop app: cloud API keys stored locally, encrypted with the OS key store, Ollama access (your machine or Ollama's hosted models) + local TTS server, coding tools (file read/write/terminal), skills discovery, MCP servers, auto-update (Windows installer and Linux AppImage).

Settings normalization lives in `electron-app/src/lib/settings.ts` (`loadSettings` / `saveSettings` / `normalizeSettingsCandidate`). See [architecture.md](architecture.md) for details.
