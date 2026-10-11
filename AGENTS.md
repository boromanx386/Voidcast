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

No Serbian anywhere in tracked files — not in comments, not in `echo`/`info`/`warn`/`die`
messages, not in log strings. The owner speaks Serbian, but the codebase stays uniform
English. When adding a message or a comment, write it in English first.

## 2. Never commit generated output

These are build artifacts and stay out of git:

```
electron-app/release/     electron-app/dist/      electron-app/node_modules/
tts-server/dist/          tts-server/web-ui/      tts-server/__pycache__/
.venv/                    .ruff_cache/            .voidcast/
```

If one of them shows up in `git status`, fix `.gitignore` — do not `git add` it.

## 3. Line endings

`.gitattributes` forces **LF** for `*.sh` and `*.py`.
Never save a shell script or Python file as CRLF — `start-dev.sh` / `build-linux.sh`
must stay runnable on Linux.

---

## 4. Layout

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

## 5. Commands

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

## 6. Before saying "done"

Actually run these and read the output — never claim a check passed without seeing it:

```bash
node --check scripts/release.mjs
bash -n start-dev.sh && bash -n build-linux.sh
cd electron-app && npx tsc --noEmit     # after touching .ts/.tsx
cd electron-app && npm run lint
```

After editing a version string, verify **all four** places:
`electron-app/package.json`, `electron-app/package-lock.json` (root `version` **and**
`packages[""].version`), and the default `appVersion` in
`electron-app/src/hooks/useAppSettings.ts`.

---

## 7. Versioning & release

- Single source of truth: `version` in `electron-app/package.json`.
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

## 8. Auto-update

- Windows (NSIS) and Linux **AppImage** update themselves via `electron-updater`,
  reading `latest.yml` / `latest-linux.yml`.
- `.deb` **cannot** auto-update — manual download only. Don't promise otherwise in docs.
- A release is only usable if it contains: the installer, its `.blockmap`, and the
  matching `latest*.yml`.

## 9. Platform-specific things

- Tools-server binary resolution is platform-aware in `electron/main/index.ts`:
  `voidcast-tools-server.exe` on Windows vs `voidcast-tools-server` on Linux/macOS,
  resolved from `process.resourcesPath`.
- `electron-app/electron-builder.json` ships it via the `extraResources` filter
  `voidcast-tools-server*`.
- On Linux the `build-linux.sh` / `start-dev.sh` scripts must keep the executable bit
  and the AppArmor/Electron-sandbox workaround.
- Bundled ripgrep is Windows-only; other platforms fall back to the system `rg`.

---

## 10. Style

- Follow the existing ESLint + Prettier config in `electron-app/`; run
  `npm run format` before committing.
- React: function components + hooks; shared state lives in `src/hooks/`.
- Python: keep it `ruff`-clean.
- Comments explain **why**, not what. Short, English, no decoration.

## 11. How to work here

- Make the smallest change that solves the task. Don't refactor neighbouring code.
- Don't add dependencies without asking.
- Don't delete files you weren't asked to delete.
- Never invent output: if you didn't run the command, don't quote its result.
- Commit messages: conventional-ish prefixes — `feat:`, `fix:`, `chore:`, `ci:`, `docs:`.
- Ask before committing or pushing. The owner reviews every diff first.
- Finish by reporting: what changed, what you verified, and what is still uncommitted.
