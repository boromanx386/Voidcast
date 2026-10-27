# Contributing to Voidcast

Thanks for wanting to help. Voidcast is a solo project, so small, focused changes are the
easiest to review and merge.

## Before you start

- **Bugs:** open an issue with your OS, the Voidcast version (shown at the bottom of the
  chat sidebar), the provider and model you used, and steps to reproduce. Logs or a
  screenshot help a lot.
- **Features:** open an issue first so we can agree on the shape before you write code.
  A PR that arrives without one may be the wrong size or direction.
- **Security problems:** do not open a public issue — see [SECURITY.md](SECURITY.md).

## Setup

You need Node.js 20+ and Python 3.12+.

```bash
cd electron-app && npm install
```

Windows, from the repo root:

```bash
npm run dev
```

Linux, from the repo root (installs apt packages, Node and the Python venv on first run):

```bash
bash start-dev.sh
```

Both start the Python tools server on port 8765 and the Electron app with hot reload.
[docs/architecture.md](docs/architecture.md) explains how the pieces fit together.

## Making a change

From `electron-app/`, before you open a PR:

```bash
npm run lint
npm run format
npm test
```

Python code in `tts-server/` should be `ruff`-clean.

House rules (the full list is in [AGENTS.md](AGENTS.md)):

- Everything in the repo is in **English** — code, comments, commit messages, docs.
- React: function components and hooks; shared state lives in `src/hooks/`.
- Comments explain **why**, not what.
- Add or update a unit test in `electron-app/test/` when you change behaviour.
- A user-visible change adds an entry under `## [Unreleased]` in
  [CHANGELOG.md](CHANGELOG.md), and updates the page in [docs/](docs/) it makes stale.
- Don't bump the version — releases are cut by the maintainer.

## Commits and PRs

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) with
a scope, as in the existing history:

```
feat(coding): search_files matches snake, kebab and compact spellings
fix(workers): reuse a clean typecheck probe instead of checking twice
```

Keep one logical change per PR, describe what you changed and how you tested it, and
mention which OS you tested on — Voidcast ships for both Windows and Linux.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE) that covers the project.
