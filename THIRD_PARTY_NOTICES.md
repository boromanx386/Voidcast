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
- reportlab (PDF export for `save_pdf` / `POST /tools/pdf`)
- pillow (raster image handling for embedded images in PDFs)
- cactus-needle (local speech-to-text engine; see below)

## Bundled local speech-to-text engine (cactus-needle / Whistle)

The desktop tools-server bundles **cactus-needle** (the "needle" inference
engine) and the **Whistle** ASR model to provide fully offline speech-to-text
(`sttProvider: 'whistle'`, `POST /stt/transcribe`).

Bundled artifacts live in `tts-server/vendor/cactus/` and are embedded into the
tools-server binary by `tts-server/voidcast-tools-server.spec`:

- `whistle.cact` — Whistle model weights (~16.9 MB)
- `libneedle.dll` — needle native inference engine (Windows x64)

All of the above are licensed under the **Apache License 2.0**:

| Component | Upstream | License |
| --- | --- | --- |
| cactus-needle (Python package) | https://pypi.org/project/cactus-needle/ | Apache-2.0 |
| needle engine (libneedle) | https://huggingface.co/Cactus-Compute/needle3 | Apache-2.0 |
| Whistle model weights | https://huggingface.co/Cactus-Compute/whistle | Apache-2.0 |

A copy of the governing Apache-2.0 license text is at
`tts-server/vendor/cactus/LICENSE`; attribution is recorded in
`tts-server/vendor/cactus/NOTICE`. The components are redistributed unmodified.

> Note: Whistle supports 7 languages (English, German, French, Spanish, Italian,
> Dutch, Polish). Serbian is not among them — use the OpenRouter provider for it.

Optional external local TTS deps (not bundled in core installer):

- torch
- torchaudio
- omnivoice

## Compliance note

When distributing binaries publicly, include this file together with `LICENSE`
and keep dependency metadata (`package-lock.json`, requirements files) available
in the source repository.

If you add new dependencies, re-check their licenses before release.
