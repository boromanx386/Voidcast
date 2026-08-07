# TTS / STT Tab

> Grounded in `electron-app/src/components/options/TtsOptionsPanel.tsx` and `electron-app/src/lib/settings.ts`. In web builds the tab is labeled **TTS**; in desktop builds **TTS/STT**.

## TTS provider (`ttsProvider`)

Type: `TtsProvider = 'local' | 'runware-xai' | 'openrouter-tts'`
Default: `'openrouter-tts'`

- **`local`** — your local OmniVoice HTTP server (default URL `http://127.0.0.1:8765`, field `ttsBaseUrl`). Voice design uses Qwen-style voice design; setup links point to OmniVoice docs.
- **`runware-xai`** — Runware cloud xAI TTS (`runwareTtsModel`, default `'xai:tts@0'`). Uses xAI/gemini/minimax voices and sends `buildRunwareTtsSpeechPayload`-style options.
- **`openrouter-tts`** — OpenRouter-hosted TTS (`openrouterTtsModel`, default `'google/gemini-3.1-flash-tts-preview'`, optional `openrouterTtsVoice`). Changing model resets the voice so the UI can re-offer voices valid for that model.

The panel includes a **refresh TTS** button (`refreshTts`) to re-probe the local server.

## STT provider (`sttProvider`)

Type: `SttProvider = 'none' | 'openrouter'`, default `'none'`.

- **`none`** — speech-to-text disabled.
- **`openrouter`** — OpenRouter Whisper transcription. Model field: `openrouterSttModel`, default `'openai/whisper-large-v3-turbo'`.

## Voice options (local / OmniVoice)

### Voice instruct (`voiceInstruct`)
Free-text instruction describing the voice to synthesize (used in voice-design flow).

### Voice mode (`voiceMode`)

Type: `VoiceMode = 'auto' | 'design' | 'clone'`, default `'design'`.

- `auto` — no instruction used.
- `design` — use `voiceInstruct`.
- `clone` — use a reference audio file (`cloneRef`, picked via `onPickCloneFile`, cleared with `onClearClone`) plus optional reference text `cloneRefText`. Empty `cloneRefText` means the model may fall back to Whisper transcription (slower).

### Auto voice (`autoVoice`)
`boolean`, default `false`. When on, TTS playback starts automatically after the assistant reply finishes. Agent-editable.

### Speed / steps / duration / chunking
- `ttsSpeed` (`number`, default `1.0`) — generate speed; >1 is faster.
- `ttsNumStep` (`number`, default `32`) — diffusion steps; fewer = faster, lower quality.
- `ttsDurationSec` (`number | null`, default `null`) — fixed duration in seconds; `null` = automatic.
- `ttsChunkMaxChars` (`number`, default `300`) — long text is split into chunks; approximate characters per chunk.

## Runware xAI options (when `ttsProvider === 'runware-xai'`)

- `runwareXaiVoice` — voice id (default `'eve'`; valid ids from `RunwareXaiVoice`: `una`, `leo`, `eve`, `ara`, `sal`, `rex`, plus model-dependent voice lists).
- `runwareTtsModel` — Runware TTS model id (default `'xai:tts@0'`); changing it may reset voice/language availability.
- `runwareXaiLanguage` — optional language code (e.g. `'en'`); auto-detect when empty. Some models support language boosting.
- `runwareXaiPositivePrompt` — optional positive prompt for voice design/custom voice (style/emotion description).
- `runwareTtsSpeed` — Runware TTS speed, `number` clamp 0.25–4, default `1.0` (`clampRunwareTtsSpeed`).
- `openrouterTtsModel` / `openrouterTtsVoice` — when using the OpenRouter TTS backend instead.

## Voice-anchor baking (`voiceBakePhrase`)

Type: `string`, default `'This is my reference voice for consistent synthesis.'`

In `auto`/`design` modes, baking a voice anchor stores a short line which is spoken once to produce a consistent voice reference across chunks. The panel exposes:
- `voiceAnchor` — current baked anchor (if any)
- `onBakeVoiceAnchor` — start baking with the configured phrase
- `onClearVoiceAnchor` — remove the baked anchor

This is the `voiceBakePhrase` field in `AppSettings` (stored via `electron-app/src/lib/voiceAnchorStorage.ts`).
