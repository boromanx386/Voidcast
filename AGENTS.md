# AGENTS.md

Rules for AI coding agents (and humans) working in this repository.
Local conventions only — read this **before** touching anything.

---

## 1. Language: English only

Everything that lives in the repo is **English**:

- code, identifiers, comments, JSDoc
- CLI / terminal output of the shell scripts (`start-dev.sh`, `build-linux.sh`)
- commit messages, tags, branch names
- docs, README, CHANGELOG

---

## 2. Layout

| Path | What it is |
|---|---|
| `electron-app/` | Electron main process + React/Vite renderer |
| `tts-server/` | FastAPI "tools server" on port 8765 — search, scrape, YouTube, PDF, TTS/STT, LAN web UI |
| `scripts/release.mjs` | release helper (bump, commit, tag, push) |
| `.github/workflows/release.yml` | cross-platform build + publish pipeline |
| `start-dev.sh` / `build-linux.sh` | Linux one-shot dev / build scripts |
| `start-dev.bat` | Windows dev launcher |
| `site/` | GitHub Pages marketing site |
| `docs/` | documentation |

## 3. Commands

Repo root:

```bash
npm run dev                                   # tools server + Electron (Windows)
bash start-dev.sh                             # Linux dev (auto-installs apt/Node/venv on first run)
bash build-linux.sh                           # Linux package -> AppImage + .deb
bash build-linux.sh --dir                     # fast unpacked build, no installer
npm run release -- --bump patch               # bump + commit + tag + push
npm run release -- --bump minor --dry-run     # show what would happen
```

`electron-app/`:

```bash
npm run dev           npm run build           npm run build:ci
npm run lint          npm run lint:fix
npm run format        npm run format:check
```

---

## 4. Versioning & release

- Single source of truth: `version` in `electron-app/package.json`. A bump must keep
  **all four** spots in sync: that file, `electron-app/package-lock.json` (root `version`
  **and** `packages[""].version`), and the default `appVersion` in
  `electron-app/src/hooks/useAppSettings.ts`.
- The git tag **must** equal it (`vX.Y.Z`) — `release.yml` fails the build on a mismatch.
- `npm run release -- --bump patch|minor|major` bumps all four spots, commits, tags and
  pushes. CI then runs a matrix (`windows-latest` + `ubuntu-latest`), each OS builds its
  own installer, and one job publishes **a single GitHub Release** with the installers
  plus `latest*.yml` update manifests.
- **PyInstaller cannot cross-compile.** Each OS freezes its own tools-server binary.
  Never reuse a Windows artifact on Linux or vice versa.
- **Never rewrite or re-point a published tag.** If a release went out broken, ship the
  next patch version instead.
- The publish job uses `fail_on_unmatched_files: true` on purpose — an empty release must
  fail loudly rather than publish with zero assets.

## 5. Auto-update

- Windows (NSIS) and Linux **AppImage** update themselves via `electron-updater`,
  reading `latest.yml` / `latest-linux.yml`.
- `.deb` **cannot** auto-update — manual download only. Don't promise otherwise in docs.
- A release is only usable if it contains: the installer, its `.blockmap`, and the
  matching `latest*.yml`.

## 6. Platform-specific things

- Tools-server binary resolution is platform-aware in `electron/main/index.ts`:
  `voidcast-tools-server.exe` on Windows vs `voidcast-tools-server` on Linux/macOS,
  resolved from `process.resourcesPath`.
- `electron-app/electron-builder.json` ships it via the `extraResources` filter
  `voidcast-tools-server*`.
- On Linux the `build-linux.sh` / `start-dev.sh` scripts must keep the executable bit
  and the AppArmor/Electron-sandbox workaround.
- Bundled ripgrep ships per platform (`@vscode/ripgrep-win32-x64` on Windows,
  `@vscode/ripgrep-linux-x64` on Linux). `electron/main/index.ts` resolves the binary
  from `app.asar.unpacked` and, if it is missing or not executable, warns and falls back
  to a system `rg` or `VOIDCAST_RG_PATH`.

---

## 7. Style

- Follow the existing ESLint + Prettier config in `electron-app/`; run
  `npm run format` before committing.
- React: function components + hooks; shared state lives in `src/hooks/`.
- Python: keep it `ruff`-clean.
- Comments explain **why**, not what. Short, English, no decoration.
