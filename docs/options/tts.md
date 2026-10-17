# TTS / STT Tab

> Grounded in `electron-app/src/components/options/TtsOptionsPanel.tsx` and `electron-app/src/lib/settings.ts`. In web builds the tab is labeled **TTS**; in desktop builds **TTS/STT**.

<p align="center">
  <img src="https://raw.githubusercontent.com/boromanx386/Voidcast/main/demos/voidcast-options-tts.png" width="720" alt="Options → TTS/STT tab"/>
</p>
<p align="center"><em>Options → TTS/STT.</em></p>

## TTS provider (`ttsProvider`)

Type: `TtsProvider = 'none' | 'local' | 'runware-xai' | 'openrouter-tts'`
Default: `'openrouter-tts'`

- **`none`** — speech output disabled. The **SPEAK** button is not rendered on assistant bubbles (the **OPEN IMG** button and the bubble footer stay), `AUTO_VOICE` does not fire, `onRead` returns early, playback already running is aborted, the 15 s health poll stops, `generate_tts` and `synthesizeSpeech` refuse, the footer dot reads **TTS disabled in Options -> TTS**, and the panel hides the provider fields, the TTS-shortcut box, `CHECK_TTS_STATUS`, `AUTO_VOICE`, `ENABLE_TTS_TOOL` and `CHUNK_SIZE`. Model/voice settings are preserved; pick a provider again to bring everything back.
- **`local`** — your local OmniVoice HTTP server (default URL `http://127.0.0.1:8765`, field `ttsBaseUrl`). Voice design uses Qwen-style voice design; setup links point to OmniVoice docs.
- **`runware-xai`** — Runware cloud xAI TTS (`runwareTtsModel`, default `'xai:tts@0'`). Uses xAI/gemini/minimax voices and sends `buildRunwareTtsSpeechPayload`-style options.
- **`openrouter-tts`** — OpenRouter-hosted TTS (`openrouterTtsModel`, default `'google/gemini-3.1-flash-tts-preview'`, optional `openrouterTtsVoice`). Changing model resets the voice so the UI can re-offer voices valid for that model. The preset list includes `google/gemini-3.8-flash-tts` and `google/gemini-3.8-flash-lite-tts` (both share the full 30-voice Gemini catalog via `GEMINI_TTS_VOICES`, as does the 3.1 default) plus `fish-audio/s2.1-pro-free:free` (Fish Audio S2.1 Pro Free).

The panel includes a **refresh TTS** button (`refreshTts`) to re-probe the local server; it is hidden while `ttsProvider === 'none'`.

### Fish Audio voices (free)

Fish Audio models take a **free-form Fish Audio `reference_id`** as their voice, and the app ships a small free catalog (`FISH_AUDIO_TTS_VOICES` in `electron-app/src/lib/settings.ts`) that the voice field offers:

| `reference_id` | Label | Constant |
| --- | --- | --- |
| `d75c270eaee14c8aa1e9e980cc37cf1b` | Peter Griffin | `FISH_AUDIO_PETER_VOICE` (default) |
| `d7c74eccec0c4382bdc56c3a3b63d21f` | Rick Sanchez | `FISH_AUDIO_RICK_VOICE` |
| `1936333080804be19655c6749b2ae7b2` | DL (Male/Old/Narration) | `FISH_AUDIO_NEUTRAL_VOICE` |

- On **OpenRouter** (`openrouter-tts`) the model is `fish-audio/s2.1-pro-free:free`; `openRouterTtsUsesReferenceVoice()` (prefix `fish-audio/`) decides whether the voice field is a reference id or a fixed catalog id, and returns `FISH_AUDIO_TTS_VOICES` for these models.
- On **Runware** (`runware-xai`) it is `fishaudio:s2.1@pro`, whose `RUNWARE_TTS_VOICES_BY_MODEL` entry lists the same family of free references with Peter Griffin first, so he is the model's default voice.
- `FISH_AUDIO_DEFAULT_VOICE = FISH_AUDIO_PETER_VOICE`, so an empty voice field resolves to Peter Griffin instead of a random voice per request. Any other Fish Audio `reference_id` still works — type it into the voice field.

## Agent TTS (`generate_tts`)

When TTS tools are enabled, the agent can call `generate_tts` to synthesize the requested text with the active provider and save a playable audio file. The tool uses the settings from this tab; API keys are never passed as tool arguments.

- `text` — exact text to speak (required; maximum 8,000 characters after sanitization).
- `output_path` — optional project-relative destination such as `public/audio/intro.mp3`; desktop-only and requires a coding project folder. Absolute paths and `..` traversal are rejected.
- `filename` — optional base name when saving to the generated-audio folder.
- `voice_instruct` — optional per-request voice/style instruction when supported by the active provider.

If `output_path` is omitted, the desktop app saves the file in its generated-audio folder and attaches the audio player to the chat result.

## STT provider (`sttProvider`)

Type: `SttProvider = 'none' | 'openrouter' | 'whistle'`, default `'none'`.

- **`none`** — speech-to-text disabled.
- **`openrouter`** — OpenRouter Whisper transcription. Model field: `openrouterSttModel`, default `'openai/whisper-large-v3-turbo'`. Requires an API key and internet.
- **`whistle`** — fully offline transcription via the bundled **cactus-needle** engine and the **Whistle** model (~16.9 MB, Apache-2.0). No API key or internet needed; runs on CPU through the local tools-server (`POST /stt/transcribe`). The renderer records with `MediaRecorder` (WebM/Opus), resamples the clip to 16 kHz mono WAV (`encodeWav16k` in `electron-app/src/lib/stt.ts`), and POSTs it to the server, which calls `needle.transcribe`. The record button appears for both `openrouter` and `whistle`. Desktop-only (hidden in web standalone). Supports English, German, French, Spanish, Italian, Dutch and Polish — **not Serbian**; use `openrouter` for Serbian.

Weights lookup order: `VOIDCAST_WHISTLE_WEIGHTS` env var → `<sys._MEIPASS>/whistle.cact` (packaged) → `~/.cache/cactus-needle/whistle/2.0.0/whistle.cact`. See [Third-Party Notices](../../THIRD_PARTY_NOTICES.md).

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
