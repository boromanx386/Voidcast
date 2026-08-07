# Media Tab (Settings)

The Media tab controls image generation and music generation backends, model profiles, output quality, and auto-save behavior.

Settings here back the agent's `generate_image`, `edit_image_runware`, and `generate_music_runware` tools. For the full field list see [../settings-reference.md](../settings-reference.md#media-tab-images).

---

## Images

### Backend (`imageProvider`)

Choose which service powers image generation:

- **Runware** — Runware's image API. Uses `runwareImageModel` for text-to-image and `runwareEditModel` for editing with references.
- **OpenRouter** — routes through OpenRouter's image models. Uses `openrouterImageModel`.

### Model profiles

Both backends keep **per-model profiles** (`RunwareModelProfile`) that override the global defaults for a specific model id:

```ts
type RunwareModelProfile = {
  width: number
  height: number
  steps: number
  cfgScale: number
  gptQuality?: 'auto' | 'low' | 'medium' | 'high' // GPT Image models only
}
```

Global defaults (used unless a profile overrides):

| Key | What it controls |
| --- | --- |
| `runwareWidth` | Default output width |
| `runwareHeight` | Default output height |
| `runwareSteps` | Inference steps (fewer = faster, lower quality) |
| `runwareCfgScale` | Guidance scale (model-dependent effect) |
| `runwareNegativePrompt` | Optional default negative prompt |

Configured Runware image models: **FLUX 9B** (`runware:400@6`), **Z Image Turbo** (`runware:z-image@turbo`), **GPT Image 2** (`openai:gpt-image@2`). OpenRouter presets include **Google Nano Banana 2 Lite / 2** and **OpenAI GPT Image 2**.

### Auto-save

- `runwareAutoSaveImages` — when on, every generated image is written automatically to `runwareImageOutputDir`.
- `runwareImageOutputDir` — destination folder (desktop app).

> Your Runware API key (`runwareApiKey`) is stored locally on this device and never exposed to the agent.

---

## Music (ACE-Step)

### Model

Choose the active Runware music model:

- **ACE-Step v1.5 Turbo** (`runware:ace-step@v1.5-turbo`) — fast; inference steps capped at 20.
- **ACE-Step v1.5 Base** (`runware:ace-step@v1.5-base`) — higher quality; allows up to 300 steps.

### Per-model profiles (`RunwareMusicModelProfile`)

```ts
type RunwareMusicModelProfile = {
  outputFormat: 'MP3' | 'WAV' | 'FLAC' | 'OGG'
  durationSec: number
  steps: number
  cfgScale: number
  seed: number | null
}
```

### Global music settings

| Key | What it controls |
| --- | --- |
| `runwareMusicGuidanceType` | `apg` or `cfg` guidance type. |
| `runwareMusicVocalLanguage` | Vocals language (ISO 639-1 code or `unknown`). |
| `runwareAutoSaveMusic` | Save each generated track automatically to the output folder. |
| `runwareMusicOutputDir` | Destination folder for saved music (desktop app). |

The legacy keys `runwareMusicOutputFormat`, `runwareMusicDurationSec`, `runwareMusicSteps`, `runwareMusicCfgScale`, and `runwareMusicSeed` are kept in sync with the active profile for backward compatibility.
