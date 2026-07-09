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
│   ├── components/        # UI: chat, options, coding panel, markdown, themes
│   ├── lib/               # Agent tools, providers, settings, storage, helpers
│   └── types/             # Shared TypeScript types
├── test/                  # Vitest unit tests
├── dist-electron/         # Built main + preload (gitignored)
└── build/                 # electron-builder output
```

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
