# Voidcast Workspace

Desktop AI chat app (Electron + React) with local Ollama integration, tools API, optional Local TTS, and Runware image/music/TTS support.

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
