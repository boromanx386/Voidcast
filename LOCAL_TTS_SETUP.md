# Local TTS Setup (External to Voidcast Installer)

Voidcast desktop installer intentionally ships without heavy Local TTS dependencies.

Use this guide when you want OmniVoice local speech synthesis on your machine.

## What Voidcast expects

Set `TTS_SERVER_URL` in app settings to a server that provides:

- `GET /health`
- `POST /tts`

Optional tool endpoints used by the app:

- `POST /tools/search`
- `POST /tools/weather`
- `POST /tools/scrape`
- `POST /tools/runware_proxy`

Default URL: `http://127.0.0.1:8765`

## Quick start (this repository)

From repository root:

1. Create Python virtual environment in repo root (`.venv`)
2. Install tools requirements:
   - `pip install -r tts-server/requirements-tools.txt`
3. Install local TTS requirements (external/heavy):
   - `pip install -r tts-server/requirements-tts.txt`
4. Start TTS-enabled server:
   - `start-tts.bat`

Then in Voidcast:

1. Open `Options -> TTS`
2. Set provider to `Local OmniVoice`
3. Verify `TTS_SERVER_URL` points to your running server
4. Click `CHECK_TTS_STATUS`

## Notes

- If only tools requirements are installed, server runs in tools-only mode and `/tts` returns disabled.
- Keep Local TTS installation versioned independently from the main Voidcast installer.
- For support, share the exact `/health` response and the error shown in app.
