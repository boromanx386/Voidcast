# Development

How to run Voidcast from source, build it and cut a release. Rules for contributors and AI agents working in the repo are in [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Tech Stack

- **Electron + React + TypeScript**
- **Tailwind CSS**
- **Python 3.12** (bundled tools server)
- **IndexedDB** (local storage)
- **Ripgrep** (optional, for fast file search)

---

## Development & Building

Requires Node.js 20+ and Python 3.12+ with a repo `.venv`. Full desktop builds run on **Windows** (NSIS installer) and **Linux** (AppImage + `.deb`).

On Linux two one-shot scripts do the whole setup:

```bash
bash start-dev.sh     # dev: installs deps + venv, then tools server + Electron (HMR)
bash build-linux.sh   # build: freezes the Linux tools server, then AppImage + .deb
```

### Install dependencies

```bash
cd electron-app && npm install
```

### Development mode

From the **repo root**:

```bash
npm run dev
```

Vite starts Electron with hot reload. Electron launches the Python tools server on `http://127.0.0.1:8765` and gives it the desktop session credential.

### Lint & format

From `electron-app/`:

```bash
npm run lint         # eslint .
npm run lint:fix     # eslint . --fix
npm run format       # prettier --write .
npm run format:check # prettier --check .
```

### Building the production app

```bash
cd electron-app && npm run build
```

Compiles the main process and renderer, builds the tools executable, then packages with `electron-builder` (Windows installer).

On Linux, `bash build-linux.sh` from the repo root runs the same pipeline end to end — PyInstaller freezes the Linux tools server first, then `electron-builder --linux` writes the AppImage and `.deb` into `electron-app/release/<version>/`.

### Releasing

The version lives in `electron-app/package.json`. Bump it, then:

```bash
npm run release                # commit + tag vX.Y.Z + push
npm run release -- --dry-run   # show what it would do
```

The pushed tag makes GitHub Actions (`.github/workflows/release.yml`) build Windows and Linux on their own runners and publish **one** Release with both installers plus the `latest*.yml` update manifests.

### Packaging Model

Voidcast uses a **bundled Python tools server** for reliable operation:

- **Development**: `npm run dev` from the repo root (tools on port **8765**)
- **Production**: the installer bundles the tools server and starts it automatically

This approach ensures all users get the same environment without manual Python setup.

---

## Repository Layout

```
├── electron-app/                    # Electron + React desktop app
│   ├── electron/
│   │   ├── main/                    # Main process (window, browser panel, housekeeping, IPC)
│   │   ├── preload/                 # contextBridge preload scripts
│   │   └── electron-env.d.ts
│   ├── src/
│   │   ├── App.tsx                  # Thin shell (chat vs options routing)
│   │   ├── hooks/                   # App state: sessions, agent, TTS/STT, attachments…
│   │   ├── components/chat/         # Chat UI (header, sidebar, messages, composer…)
│   │   ├── components/options/      # Options panels (LLM, TTS, image, skills, tools…)
│   │   └── lib/                     # Shared tool catalog/handlers, settings, providers, helpers
│   ├── public/                      # Static assets served as-is
│   ├── test/                        # Vitest unit tests
│   ├── electron-builder.json        # Packaging + GitHub publish config
│   └── release/                     # Build output (gitignored)
├── tts-server/                      # Python tools + TTS/STT server (FastAPI)
│   ├── main.py                      # Combined app (tools + web UI)
│   ├── tts_main.py                  # TTS-only entry
│   ├── tools_main.py                # Tools-only entry for dev
│   ├── pdf_tool.py                  # ReportLab PDF renderer for save_pdf
│   ├── stt_whistle.py               # Offline Whistle STT (cactus-needle)
│   ├── voidcast-tools-server.spec   # PyInstaller spec for the bundled tools exe
│   ├── fonts/                       # Noto Sans TTFs (bundled into tools exe)
│   └── vendor/                      # Bundled native engines + Whistle model
├── docs/                            # Docs (architecture, chat, coding, options…)
├── demos/                           # Screenshots & demo assets used in the README
├── scripts/                         # Build/release helpers (tools exe, release…)
├── site/                            # Landing page (static site)
├── skills/voidcast/                 # Agent skill + CLI for the local control API
├── CHANGELOG.md                     # Release history
├── LICENSE                          # MIT
├── THIRD_PARTY_NOTICES.md           # Bundled third-party licenses
├── LOCAL_TTS_SETUP.md               # Local tools/TTS server setup
├── start-dev.bat                    # One-click dev launcher
└── start-tts-local.bat              # Run the local tools/TTS server only
```
