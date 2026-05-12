# Voidcast

**Desktop AI agent dashboard with free cloud provider aggregation, integrated coding IDE, and cyberpunk terminal UI.**

Connects to **Ollama**, **OpenRouter**, **NVIDIA NIM**, and **Runware** free tiers — one app, zero subscriptions.

![Voidcast logo](logo.jpg)

## Why I Built This

I was paying $60/month for 4 different AI apps. I built Voidcast so I wouldn't have to.

It connects to **free cloud APIs** and gives you a single cyberpunk terminal with real tool calling, image/music generation, and a built-in coding IDE.

## Provider Stack (All Free Tiers)

| Provider | What You Get | Cost |
|----------|-------------|------|
| **Ollama** | Open-source models (Llama, Qwen, Gemma, Mistral...) pulled from cloud or run locally | Free |
| **OpenRouter** | Access to 100+ models: Claude, GPT-4o, DeepSeek, Gemini... via free endpoints | Free tier |
| **NVIDIA NIM** | Enterprise-grade inference for open-source models | Free tier |
| **Runware** | Image generation + AI music/soundtrack generation | Free credits |

You just need free accounts and API keys. No credit card required.

## Core Features

### 🤖 Agent with Tool Calling
The model decides when to call tools. Not a premium feature — it's the default.

- **Web Search** — real-time DuckDuckGo search
- **Weather** — current conditions + forecast
- **YouTube** — search + transcript summaries
- **Reddit** — browse subreddits, search posts, read threads and comments
- **Web Scrape** — fetch and summarize any public page
- **PDF Export** — save any chat session as formatted PDF
- **Image Generation** — Runware text-to-image
- **Image Edit** — Runware image transformation
- **Music Generation** — Runware AI audio/soundtracks
- **Reminders** — set, list, update, delete scheduled notes
- **Settings Agent** — change app config via chat commands

### 💻 Built-in Coding IDE
Right-side panel with file tree, file preview, and terminal output. The agent acts as a junior dev in your project folder:

- `list_directory`, `read_file`, `write_file`, `edit_code`
- `search_files` (with ripgrep fallback)
- `glob_files`
- `git_status`, `git_diff`, `git_log`, `git_show`
- `execute_command` (with timeout + background support)

### 🧠 Context Compression
Custom module that compresses chat history so even smaller free-tier models handle long agent loops without losing coherence.

### 📝 Long-term Memory
Cross-chat memory stored locally in IndexedDB. The assistant remembers facts about you across sessions — with your control (review before save, delete anytime).

### 🎨 Cyberpunk Terminal UI
Dark, neon, minimal. Matrix-green theme included. Because staring at a bland white chat box for hours kills the soul.

### ⚡ UX Power Features
- **Edit any message inline** — history regenerates from that point
- **Fork chat session** — explore a different branch of the conversation
- **Export to Markdown** — entire chat as `.md`
- **Thinking blocks** — collapsible reasoning for models like DeepSeek, QwQ
- **Image-aware chat** — paste images, the agent recalls and analyzes them iteratively

## Image-aware Workflow

Voidcast can reuse images from chat history as working context for later turns. The assistant can describe, analyze, compare, and edit prior images — enabling iterative visual workflows inside one conversation instead of isolated one-shot calls.

Combined with strong text-rendering image models, this becomes a serious tool for chart/diagram generation and iterative visual refinement.

## Optional TTS

- **Local TTS** — external OmniVoice-compatible server (for users with capable local hardware)
- **OpenRouter TTS** — cloud TTS via GPT-4o Mini TTS model
- **Runware xAI TTS** — cloud text-to-speech via Runware

## Tech Stack

- **Electron + React + TypeScript** — Desktop app
- **Tailwind CSS** — Styling with `theme-matrix.css` cyberpunk theme
- **Python 3.13** — Bundled tools server (no pip install required for standard features)
- **IndexedDB** — Local storage for chats, reminders, long memory

## Installation

Download the latest Windows installer from [Releases](https://github.com/boromanx386/Voidcast/releases).

Or run in dev mode:
```bash
npm install
npm run dev
```

Requires [Node.js](https://nodejs.org/) and Python 3.12 (for tools server).

### Configuration

1. Get free API keys:
   - [OpenRouter](https://openrouter.ai/) (for GPT-4o, Claude, DeepSeek...)
   - [NVIDIA NIM](https://build.nvidia.com/) (for enterprise open models)
   - [Runware](https://runware.ai/) (for images and music)
   - [Ollama](https://ollama.com/) (for open-source models)

2. Paste them in **Options → Provider API Keys**

3. Select your model and start the agent.

## Roadmap

- Add more practical built-in tools for everyday assistant workflows
- Custom User Tools (Tool Builder)
- Expand long-memory controls with richer curation (search/edit/tagging)
- Expand support for additional Runware models with safer default profiles
- Add optional integrations with other API providers
- Linux / Mac builds

## Repository Layout

- `electron-app/` - Electron renderer/main app
- `tts-server/` - Python HTTP server for tools (and optional local OmniVoice TTS)
- `LOCAL_TTS_SETUP.md` - external Local TTS setup guide

## Development Setup

From repository root:

1. Install Node dependencies:
   - `npm install`
2. Create Python virtual env in repo root (`.venv`)
3. Install Python tools deps:
   - `pip install -r tts-server/requirements-tools.txt`
4. Optional (recommended for faster `search_files` in coding tools):
   - install [ripgrep](https://github.com/BurntSushi/ripgrep) and ensure `rg` is on your `PATH`

## Run (Development)

- Default dev (tools server + Electron):
  - `npm run dev`
- Start tools server only:
  - `npm run dev:tts`
- Start local TTS-enabled server (external/heavy deps required):
  - `npm run dev:tts:local`

## Build Installer

From `electron-app/`:

- `npm run build`

Output folder:

- `electron-app/release/<version>/`

For manual distribution, `Voidcast_<version>_Setup.exe` is enough.

### Packaging Model

Main installer includes:

- Electron app
- Python tools server resources
- Bundled tools-only backend executable (`voidcast-tools-server.exe`) so web search / scrape / YouTube / **PDF** tools work without a separate Python install (fonts bundled via PyInstaller `--add-data`).

Main installer does **not** include:

- Local OmniVoice TTS heavy dependencies (`torch`, model packages, model cache)

Local TTS is external by design. See:

- `LOCAL_TTS_SETUP.md`

## Updates (GitHub Releases)

Updater is wired with `electron-updater` and `electron-builder` GitHub publish config.

Configured in:

- `electron-app/electron-builder.json` (`publish.provider=github`)
- `electron-app/electron/main/update.ts`

### One Release Flow

1. Bump version in `electron-app/package.json`
2. Create a GitHub token with repo release permissions
3. Set token in shell:
   - PowerShell: `$env:GH_TOKEN = "<your_token>"`
4. Build + publish from `electron-app/`:
   - `npm run build:publish`

This publishes release artifacts needed by auto-update (`Setup.exe`, blockmap, latest metadata).

### Client Behavior

- In app, use **Check update** UI
- If new version exists, app downloads and offers restart/install

Keep Local TTS updates/versioning independent from core app releases.

## Runtime Expectations

App expects `TTS_SERVER_URL` to expose at least:

- `GET /health`
- `POST /tts` (only available when local TTS stack is installed/enabled)

Tools endpoints (server-side helpers):

- `POST /tools/search`
- `POST /tools/weather`
- `POST /tools/scrape`
- `POST /tools/youtube`
- `POST /tools/pdf` (Markdown-lite → PDF; optional embedded images)
- `POST /tools/runware_proxy`

## License

This repository is released under the MIT License.

- `LICENSE`

## Third-party Licenses

Third-party notices and dependency license families are documented in:

- `THIRD_PARTY_NOTICES.md`

For full dependency metadata, see:

- `package-lock.json`
- `electron-app/package.json`
- `tts-server/requirements-tools.txt`
- `tts-server/requirements-tts.txt`

---

Built with spite and caffeine by a solo dev from Serbia.
