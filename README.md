# Voidcast

**Desktop AI agent environment with built-in coding tools and real tool calling.**

One app. Four themes. Connects to your existing API accounts — no subscriptions.

![Voidcast Screenshot](screenshot.png)

---

## What You Can Do

**Browse and create without leaving chat**  
Agent invokes search, Reddit, YouTube, weather, image generation, and music generation — results appear inline.

**Control the app from chat**  
Change themes, toggle voice, or update settings directly via natural commands in the conversation.

**Work with your code**  
The agent reads your project, edits files, runs git commands, and executes shell commands — all from the integrated IDE panel.

**It remembers**  
Remembers facts across sessions. Asks before saving anything.

---

## Get Started (One Click)

| Windows | Status |
|---------|--------|
| [Download Installer](https://github.com/boromanx386/Voidcast/releases) | One-click setup. No Python. No pip. No terminal. |

1. Download `Voidcast_Setup.exe` from [Releases](https://github.com/boromanx386/Voidcast/releases)
2. Run it. Next → Next → Done.
3. Add your API keys in **Options → Provider API Keys**.
4. Start the agent.

> 💡 **First launch to first chat: under 60 seconds.**

Requires Windows 10/11. The installer bundles the Python tools server — no manual setup needed.

---

## The Agent & Tools

Voidcast runs an **agent tool loop**: the model decides when to call a tool, the app executes it, and the result goes back to the model.

Available tools:

- **Web Search** — real-time DuckDuckGo search
- **Weather** — current conditions + forecast
- **YouTube** — search videos + fetch transcripts
- **Reddit** — browse subreddits, search posts, read threads
- **Web Scrape** — fetch and summarize public pages
- **PDF Export** — save any chat session as formatted PDF
- **Image Generation** — Runware text-to-image
- **Image Edit** — Runware image transformation
- **Music / Audio Generation** — Runware AI soundtracks
- **Reminders** — set, list, update, delete scheduled notes
- **Settings Agent** — change app config via chat commands

The agent loop supports both **local models via Ollama** and **cloud endpoints via OpenRouter and NVIDIA NIM**.

---

## Coding Tools

Right-side panel with file tree, file preview, and terminal output. The agent acts as a junior dev in your project folder:

- `list_directory`, `read_file`, `write_file`, `edit_code`
- `search_files` (with ripgrep fallback)
- `glob_files`
- `git_status`, `git_diff`, `git_log`, `git_show`
- `execute_command` (with timeout + background support)

All coding operations are scoped to your configured project directory.

---

## Runs on Free Cloud APIs

Voidcast does not charge anything. It connects to free tiers of providers you can sign up for:

| Provider | What You Get |
|----------|-------------|
| **OpenRouter** | Claude, GPT-4o, DeepSeek, Gemini + 100 others |
| **Ollama** | Open-source models (Llama, Qwen, Gemma, Mistral...) |
| **NVIDIA NIM** | Enterprise-grade inference for open models |
| **Runware** | Image generation + AI music |

All you need are free accounts and API keys. No credit card required.

---

## Context Compression

Local and small-context models hit a wall after long chats. Voidcast uses a custom module to compress conversation history so the agent can maintain coherence across long tool loops without losing the thread.

---

## Long-Term Memory

Cross-chat memory is stored locally in IndexedDB. The assistant can remember facts about you across sessions, with your control:

- Review before save
- Delete anytime
- Confidence and importance scoring

---

## Image-Aware Chat

Paste images into the chat. The assistant can analyze them and, when needed, recall them from conversation history for iterative visual work.

---

## Themes & UI

Four built-in themes: **Dark** (default), **Matrix**, **Minimal**, and **Light**. Switch anytime in Options.

Other UX features:
- **Edit any message inline** — history regenerates from that point
- **Fork chat session** — explore a different branch of the conversation
- **Export to Markdown** — entire chat as `.md`
- **Thinking blocks** — collapsible reasoning for models like DeepSeek, QwQ, etc.

---

## Speech & Audio

- **Text-to-Speech** — Local OmniVoice (requires `.venv` setup, see `LOCAL_TTS_SETUP.md`), Runware xAI, or OpenRouter TTS
- **Speech-to-Text** — OpenRouter Whisper (push-to-talk)

---

## Tech Stack

- **Electron + React + TypeScript**
- **Tailwind CSS**
- **Python 3.12** (bundled tools server)
- **IndexedDB** (local storage)
- **Ripgrep** (optional, for fast file search)

---

## Development & Building

### Install dependencies

```bash
npm install
```

### Development mode

```bash
npm run dev
```

This starts both the Electron main process and Vite dev server with HMR.

### Building the production app

```bash
npm run build
```

This compiles both the main process and renderer, then packages the app with `electron-builder`.

### Packaging Model

Voidcast uses a **bundled Python tools server** for reliable operation:

- **Development**: Starts a local Python HTTP server on `localhost:8000`
- **Production**: The server is bundled into the packaged app and launched automatically

This approach ensures all users get the same environment without manual Python setup.

---

## Runtime Expectations

The bundled Python server exposes these endpoints:

| Endpoint | Purpose |
|----------|---------|
| `POST /search` | Web search |
| `POST /scrape` | Web scraping |
| `POST /pdf` | PDF export |
| `POST /weather` | Weather data |
| `POST /image` | Image generation |
| `POST /runware` | Runware image/music |

---

## Repository Layout

```
├── electron-app/         # Main Electron application
├── local-tools-server/   # Python tools server
│   ├── main.py           # FastAPI server
│   └── requirements.txt  # Python dependencies
├── assets/               # Application assets (icons, images)
└── releases/             # Build output directory
```

---

## License & Third-Party

MIT License.

Voidcast uses:
- **Electron** — MIT
- **Tailwind CSS** — MIT
- **Lucide Icons** — ISC
- **Runware** — Commercial API (free tier available)

---

Built by a solo dev. Issues and PRs welcome.
