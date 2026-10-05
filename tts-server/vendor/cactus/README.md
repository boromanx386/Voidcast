# Bundled Whistle STT engine (`cactus-needle`)

This folder holds the native artifacts that give Voidcast **fully offline
speech-to-text**. They are embedded into the tools-server binary by
`tts-server/voidcast-tools-server.spec` and resolved at runtime by
`tts-server/stt_whistle.py`.

| File | What it is | Size |
| --- | --- | --- |
| `whistle.cact` | Whistle ASR model weights (2-bit, 7 languages) | ~16.9 MB |
| `libneedle.dll` | needle native inference engine (Windows x64) | ~1.5 MB |

## How it is used

- The renderer records with `MediaRecorder` (WebM/Opus) and resamples the clip
  to 16 kHz mono WAV (`encodeWav16k`, `electron-app/src/lib/stt.ts`).
- It POSTs the base64 WAV to the tools-server route `POST /stt/transcribe`.
- `stt_whistle.transcribe_wav()` calls `needle.transcribe(path, weights=...)`,
  pointing at the bundled `whistle.cact`.

Weights lookup order (see `stt_whistle.py`):

1. `VOIDCAST_WHISTLE_WEIGHTS` environment variable (explicit override).
2. `<sys._MEIPASS>/whistle.cact` when running from the PyInstaller bundle.
3. `~/.cache/cactus-needle/whistle/2.0.0/whistle.cact` (needle's own cache).

When frozen, the server also sets `NEEDLE_LIB_PATH` to the bundled
`libneedle.dll` so a fresh machine needs no download.

## License

All artifacts here are licensed under the **Apache License 2.0**:

- `whistle.cact` — Cactus-Compute/whistle
- `libneedle.dll` — Cactus-Compute/needle3
- `cactus-needle` Python package — PyPI

See [`LICENSE`](LICENSE) (full Apache-2.0 text) and [`NOTICE`](NOTICE)
(attribution), plus the repo-level [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

## Refresh

To re-fetch these artifacts from a machine that has `cactus-needle` installed:

```
copy "%USERPROFILE%\.cache\cactus-needle\whistle\2.0.0\whistle.cact" tts-server\vendor\cactus\
copy "%USERPROFILE%\.cache\cactus-needle\v3\3.1.0\libneedle.dll"       tts-server\vendor\cactus\
```

(Version folders may differ; check `%USERPROFILE%\.cache\cactus-needle\`.)
