# Voidcast — Electron App

This folder contains the Electron + React + TypeScript desktop frontend for **Voidcast**.

## What's inside

```
├── electron/              # Electron main process (IPC handlers, git, updater, preload)
│   ├── main/index.ts      # Window management, IPC, skill discovery, git capture
│   └── preload/index.ts   # Context bridge (exposes safe IPC to renderer)
├── src/                   # React renderer
│   ├── App.tsx            # Thin orchestrator (chat vs options routing)
│   ├── hooks/             # App state: sessions, agent loop, TTS/STT, attachments…
│   ├── components/        # UI: chat (sidebar, Plan cards), options, coding panel (preview/edit), themes
│   ├── lib/               # Agent tools, plan artifacts, providers, settings, storage
│   └── types/             # Shared TypeScript types
├── test/                  # Vitest unit tests (incl. plan-artifact)
├── dist-electron/         # Built main + preload (gitignored)
└── build/                 # electron-builder output
```

## Plan mode

Composer toggle **AGENT | PLAN**. Plan mode is read-only exploration → structured plan card (approaches A/B/C, editable steps) → **Approve & Build** runs Agent mode with live step auto-check.

**Coding panel preview:** syntax-highlighted source, rendered Markdown for `.md`/`.mdx`, inline edit with find/replace. See [`../README.md`](../README.md) and [`../CHANGELOG.md`](../CHANGELOG.md).

## Quick start

```bash
cd electron-app
npm install
npm run dev       # Vite HMR + Electron
npm run build     # Production build + Windows installer
```

## See also

- [`../README.md`](../README.md) — full Voidcast documentation
- [`../CHANGELOG.md`](../CHANGELOG.md) — release history
- [`../LOCAL_TTS_SETUP.md`](../LOCAL_TTS_SETUP.md) — local TTS setup
