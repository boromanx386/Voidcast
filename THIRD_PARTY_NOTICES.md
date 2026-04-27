# Third-Party Notices

This project includes third-party software packages distributed under their own
licenses.

## Source of dependency licenses

- Node/Electron dependencies are defined in:
  - `electron-app/package.json`
  - root `package-lock.json`
- Python dependencies are defined in:
  - `tts-server/requirements-tools.txt`
  - `tts-server/requirements-tts.txt`

## Common license families in current dependency tree

Based on package metadata in lockfiles and dependency manifests, the project
includes packages under licenses such as:

- MIT
- ISC
- Apache-2.0
- BSD/0BSD-style

## Runtime-distributed Python dependencies

The core installer is designed to include tools-server requirements (without
heavy local TTS stack). Runtime deps referenced for tools mode:

- fastapi
- uvicorn
- pydantic
- httpx
- beautifulsoup4
- ddgs
- yt-dlp
- youtube-transcript-api

Optional external local TTS deps (not bundled in core installer):

- torch
- torchaudio
- omnivoice

## Compliance note

When distributing binaries publicly, include this file together with `LICENSE`
and keep dependency metadata (`package-lock.json`, requirements files) available
in the source repository.

If you add new dependencies, re-check their licenses before release.
