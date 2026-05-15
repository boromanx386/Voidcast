# Voidcast

**Desktop AI agent with real tool calling — search, images, music and code from one chat. One-click Windows install.**

Bring your own API keys (OpenRouter, NVIDIA NIM, Runware) or install **Ollama** locally — all support free tiers. **Voidcast is free.**

![Voidcast](logo.jpg)

*Voidcast is a solo hobby project — I built it for myself to learn AI and programming, and I’m sharing it in case it helps others too. If you use it and find it useful, that’s real motivation to keep improving it. Issues, ideas, and PRs are welcome.*

---

## What You Can Do

**Browse and create without leaving chat**  
Agent invokes search, Reddit, YouTube, weather, image generation and edit, music generation, PDF — results appear inline.

**Control the app from chat**  
Change themes, toggle voice, or update settings directly via natural commands in the conversation.

**Work with your code**  
The agent reads your project, edits files, runs git commands, and executes shell commands — all from the integrated IDE panel.

**It remembers**  
Remembers facts across sessions — only when you ask for it.

---

## Get Started (One Click)

| Windows | Status |
|---------|--------|
| [Download Installer](https://github.com/boromanx386/Voidcast/releases) | One-click setup. No Python. No pip. No terminal. |

1. Download `Voidcast_Setup.exe` from [Releases](https://github.com/boromanx386/Voidcast/releases)
2. Run it. Next → Next → Done.
3. Add your API keys in **Options → General → CLOUD_API_KEYS** (stored only on this PC).
4. Start the agent.

> 💡 **First launch to first chat: under 60 seconds.**

Requires Windows 10/11. The installer bundles the Python tools server — no manual setup needed.

---

## Updates (desktop)

The packaged Windows app can check [GitHub Releases](https://github.com/boromanx386/Voidcast/releases) for new versions (optional — off by default).

In **Options → General**:

- **`AUTO_UPDATE`** — when enabled, checks on startup, downloads in the background, and prompts **Install now** / **Later** when ready.
- When disabled, use **`CHECK FOR UPDATE`** anytime for a manual check.

You choose whether updates run automatically; nothing is forced without your toggle.

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

The agent loop supports both **local models via Ollama** and **cloud endpoints via Ollama, OpenRouter and NVIDIA NIM**.

---

## Coding Tools

Right-side panel with file tree, file preview, and terminal output. The agent acts as a junior dev in your project folder:

- `list_directory`, `read_file`, `write_file`, `edit_code`
- `search_files` (with ripgrep fallback)
- `glob_files`
- `git_status`, `git_diff`, `git_log`, `git_show`
- `execute_command` (with timeout + background support)

All coding operations are scoped to your configured project directory.

**Faster code search (optional):** install [ripgrep](https://github.com/BurntSushi/ripgrep) and put `rg` on your system `PATH`. `search_files` then uses it for large trees; without it, the same tool falls back to a built-in walk (slower, same results style).

---

## Runs on Free Cloud APIs

Voidcast does not charge anything. It connects to free tiers of providers you can sign up for:

| Provider | What You Get |
|----------|-------------|
| **OpenRouter** | Claude, GPT-4o, DeepSeek, Gemini + 100 others |
| **Ollama** | Open-source models (Llama, Qwen, Gemma, Mistral...) |
| **NVIDIA NIM** | Enterprise-grade inference for open models |
| **Runware** | Image generation, image edit, and AI music (pay-per-use, typically pennies) |

All you need are free accounts and API keys. Chat LLMs can stay on free tiers (Ollama, or cloud free credits); **TTS, STT, and image/music runs are very cheap** — usually cents per session, not dollars.

**Multimodal pricing:** OpenRouter Whisper (STT) and TTS voices bill per minute or request at low rates. Runware charges per image or audio clip at similarly small amounts. Voidcast adds no markup; see each provider’s pricing page for current numbers.

**Privacy:** API keys and app settings stay on your machine (local app storage). Voidcast has no cloud account and never receives your keys — the desktop app talks to OpenRouter, NVIDIA NIM, Runware, or Ollama directly from your PC.

---

## Context Compression

Local and small-context models hit a wall after long chats. Voidcast uses a custom module to compress conversation history so the agent can maintain coherence across long tool loops without losing the thread.

---

## Long-Term Memory

Cross-chat memory is stored locally in IndexedDB:

- Saved when you ask the agent to remember something
- Edit or delete anytime in **Options → General**
- Optional **USE_LONG_MEMORY_GLOBALLY** to include memories in every chat

---

## Image-Aware Chat

Paste images into the chat. The assistant can analyze them and, when needed, recall them from conversation history for iterative visual work. **Generate or edit** images via Runware from the same thread.

---

## Themes & UI

Five built-in themes: **Minimal** (default), **Dystopian**, **Matrix**, **Light**, and **Blood Moon**. Switch anytime in Options or via chat.

Other UX features:
- **Edit any message inline** — history regenerates from that point
- **Fork chat session** — explore a different branch of the conversation
- **Export to Markdown** — entire chat as `.md`
- **Thinking blocks** — collapsible reasoning for models like DeepSeek, QwQ, etc.

---

## Speech & Audio

- **Text-to-Speech** — Local OmniVoice (free on your PC; requires `.venv` setup, see `LOCAL_TTS_SETUP.md`), or cloud via Runware / OpenRouter TTS (very low cost per reply)
- **Speech-to-Text** — OpenRouter Whisper (push-to-talk; inexpensive per recording)

Cloud voice options are pay-per-use; see **Runs on Free Cloud APIs** above for typical costs.

---

## Tech Stack

- **Electron + React + TypeScript**
- **Tailwind CSS**
- **Python 3.12** (bundled tools server)
- **IndexedDB** (local storage)
- **Ripgrep** (optional, for fast file search)

---

## Development & Building

Requires Node.js, Python 3.12+ with a repo `.venv`, and Windows for the full desktop build.

### Install dependencies

```bash
cd electron-app && npm install
```

From the repo root (optional): `npm install` pulls in `concurrently` for the dev script.

### Development mode

From the **repo root**:

```bash
npm run dev
```

Starts the Python tools server on `http://127.0.0.1:8765` and the Electron app with Vite HMR.

### Building the production app

```bash
cd electron-app && npm run build
```

Compiles the main process and renderer, builds the tools executable, then packages with `electron-builder` (Windows installer).

### Packaging Model

Voidcast uses a **bundled Python tools server** for reliable operation:

- **Development**: `npm run dev` from the repo root (tools on port **8765**)
- **Production**: the installer bundles the tools server and starts it automatically

This approach ensures all users get the same environment without manual Python setup.

---

## Runtime Expectations

The bundled Python server (default `http://127.0.0.1:8765`) exposes endpoints such as:

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Server health check |
| `POST /tools/search` | Web search |
| `POST /tools/scrape` | Web scraping |
| `POST /tools/weather` | Weather data |
| `POST /tools/youtube` | YouTube search / transcripts |
| `POST /tools/reddit` | Reddit feed / posts |
| `POST /tools/pdf` | PDF export |
| `POST /tools/runware_proxy` | Runware image / music proxy |
| `POST /tts` | Text-to-speech (local OmniVoice setup) |

---

## Repository Layout

```
├── electron-app/         # Main Electron application
├── tts-server/           # Python tools + TTS server
│   ├── main.py           # Combined FastAPI app (tools + web UI)
│   ├── tools_main.py     # Tools-only entry for dev
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

Maintained by one developer. [Open an issue](https://github.com/boromanx386/Voidcast/issues) anytime.
