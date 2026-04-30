# Voidcast Workspace

![Voidcast logo](logo.jpg)

Desktop AI chat app (Electron + React) with local Ollama integration, tools API, optional Local TTS, and Runware image/music/TTS support.

## Features

- Desktop chat UI focused on practical AI workflows (Electron + React).
- Ollama/OpenRouter-based chat orchestration with configurable model and prompt settings.
- Tool-enabled assistant actions (web search, weather, scraping, YouTube, PDF).
- Assistant-managed app configuration via `update_settings` tool for selected options:
  - LLM system prompt, context window, temperature
  - UI theme
  - Runware image resolution (`width`, `height`, or `WIDTHxHEIGHT`)
  - Runware image/edit model selection
  - manual long-memory add (`longMemoryAdd`)
- Built-in context summarization/compression for long conversations.
- Long-memory personalization controls:
  - `SAVE_MEM` in chat header to extract durable memory from current chat
  - optional agent-driven memory write via `update_settings` (`longMemoryAdd`)
  - global long-memory toggle in `General` options
  - memory manager (view/delete saved memory items)
- Runware media support:
  - image generation/editing
  - music generation
  - xAI TTS via Runware
- Optional external Local TTS server support (OmniVoice API-compatible).
- Optional OpenRouter TTS support via GPT-4o Mini TTS model.
- Cloud-first operation path (works without local GPU/CUDA requirements).
- Optional power-user local path for users with capable hardware.
- Windows installer builds with update-ready release artifacts.

## Cloud-first note

This app is oriented to a cloud-friendly workflow and does not require high-end
local hardware to be useful.

### Minimum practical setup (recommended)

- Ollama running (chat + tool orchestration)
- Runware API key/account (media generation: image/music/xAI TTS)

In this scenario, the app works well without GPU/CUDA on the user machine.

For typical chat + tool + media calls, an Ollama free-tier style usage profile
is generally more than enough for testing and normal personal usage.

### Optional local power-user setup

If you have capable hardware (NVIDIA GPU with CUDA), you can also run local
LLM/TTS-heavy workloads:

- local Ollama models on your own machine
- optional external Local TTS server (OmniVoice stack)

Local TTS remains optional and external by design. See:

- `LOCAL_TTS_SETUP.md`

## Image-aware workflow

Voidcast can reuse images from chat history as working context for later turns.

This means the assistant can:

- describe and analyze previously generated/attached images
- evaluate quality and consistency against your prompt goals
- use older images as references for edit operations
- compare multiple prior images and suggest improvements

In practice, this enables iterative visual workflows inside one conversation
instead of isolated one-shot image calls.

Combined with GPT Image 2.0 model (strong text rendering and chart-friendly output),
this becomes a serious tool for:

- chart/diagram generation with readable labels
- visual drafts with embedded text
- iterative image refinement based on prior chat artifacts

## Long memory (current behavior)

Long memory is now available as a controlled workflow:

- `SAVE_MEM` (chat header) runs memory extraction for the current conversation.
- A preview dialog appears before save so entries can be reviewed/removed.
- Saved memory is stored locally in IndexedDB (not as raw full transcripts).
- `General` options contains:
  - global toggle for long-memory usage across chats
  - basic memory manager list with delete actions
- At generation time, when global long memory is enabled, relevant memories are
  retrieved and injected into model context with a strict size cap.

## Roadmap (planned)

Planned product direction for upcoming releases:

- Add more practical built-in tools for everyday assistant workflows
  (research, docs handling, productivity helpers, automation actions).
- Expand long-memory controls with richer curation (search/edit/tagging and
  better conflict resolution across memories).
- Expand support for additional Runware models (image/music/voice) with richer
  per-model presets and safer default profiles.
- Add optional integrations with other API providers beyond the current stack,
  so users can choose the backend that best fits their cost/performance needs.

## Repository layout

- `electron-app/` - Electron renderer/main app
- `tts-server/` - Python HTTP server for tools (and optional local OmniVoice TTS)
- `LOCAL_TTS_SETUP.md` - external Local TTS setup guide

## Install (development)

From repository root:

1. Install Node dependencies:
   - `npm install`
2. Create Python virtual env in repo root (`.venv`)
3. Install Python tools deps:
   - `pip install -r tts-server/requirements-tools.txt`

## Run (development)

- Default dev (tools server + Electron):
  - `npm run dev`
- Start tools server only:
  - `npm run dev:tts`
- Start local TTS-enabled server (external/heavy deps required):
  - `npm run dev:tts:local`

## Build installer

From `electron-app/`:

- `npm run build`

Output folder:

- `electron-app/release/<version>/`

For manual distribution, `Voidcast_<version>_Setup.exe` is enough.

## Packaging model

Main installer includes:

- Electron app
- Python tools server resources
- Bundled tools-only backend executable (`voidcast-tools-server.exe`) so web search / scrape / YouTube tools work without a separate Python install.

Main installer does **not** include:

- Local OmniVoice TTS heavy dependencies (`torch`, model packages, model cache)

Local TTS is external by design. See:

- `LOCAL_TTS_SETUP.md`

## Runtime expectations

App expects `TTS_SERVER_URL` to expose at least:

- `GET /health`
- `POST /tts` (only available when local TTS stack is installed/enabled)

Tools endpoints (server-side helpers):

- `POST /tools/search`
- `POST /tools/weather`
- `POST /tools/scrape`
- `POST /tools/runware_proxy`

## Updates (GitHub Releases)

Updater is wired with `electron-updater` and `electron-builder` GitHub publish config.

Configured in:

- `electron-app/electron-builder.json` (`publish.provider=github`)
- `electron-app/electron/main/update.ts`

### One release flow

1. Bump version in `electron-app/package.json`
2. Create a GitHub token with repo release permissions
3. Set token in shell:
   - PowerShell: `$env:GH_TOKEN = "<your_token>"`
4. Build + publish from `electron-app/`:
   - `npm run build:publish`

This publishes release artifacts needed by auto-update (`Setup.exe`, blockmap, latest metadata).

### Client behavior

- In app, use **Check update** UI
- If new version exists, app downloads and offers restart/install

Keep Local TTS updates/versioning independent from core app releases.

## License

This repository is released under the MIT License.

- `LICENSE`

## Third-party licenses

Third-party notices and dependency license families are documented in:

- `THIRD_PARTY_NOTICES.md`

For full dependency metadata, see:

- `package-lock.json`
- `electron-app/package.json`
- `tts-server/requirements-tools.txt`
- `tts-server/requirements-tts.txt`
