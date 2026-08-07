# Settings Reference

Complete field-by-field reference for the Voidcast settings model. All keys come directly from the `AppSettings` and `CodingSettings` interfaces in `electron-app/src/lib/settings.ts`. Settings are stored in `localStorage` under `voidcast-settings-v1` and normalized on load.

Grouped by the Settings tab they belong to.

---

## General tab

| Key | Type | Default / bounds | What it controls |
| --- | --- | --- | --- |
| `uiTheme` | `UiTheme` | obsidian (cyberpunk shell vs calmer zinc/indigo) | Visual chrome / theme. |
| `autoSaveChat` | `boolean` | on | When on, chat sessions auto-save. When off, a manual save button appears. |
| `autoUpdate` | `boolean` | on (desktop) | Check for app updates automatically on startup (desktop only). |
| `reminderNotificationsEnabled` | `boolean` | on | Renderer fires a desktop notification when a scheduled reminder becomes due. |
| `notificationSoundsEnabled` | `boolean` | off | Play the user-selected reply/error sound files on chat events. |
| `notificationSoundVolume` | `number` | 0–1 | Output volume for chat notification sounds. |
| `lanWebAccessEnabled` | `boolean` | off (desktop only) | Push cloud API keys to the local TTS server so LAN/phone web clients can use the proxy. Default off — keys stay in localStorage only. |
| `longMemoryDefaultEnabled` | `boolean` | on | Default for new chats: whether to include long-term memory retrieval. |

### Cloud API keys (General → Cloud API Keys)

These six providers store their API keys/URLs here (keys are local to this device):

| Key | Provider |
| --- | --- |
| `openrouterApiKey` / `openrouterBaseUrl` | OpenRouter |
| `openaiApiKey` / `openaiBaseUrl` | OpenAI |
| `deepseekApiKey` / `deepseekBaseUrl` | DeepSeek |
| `nvidiaApiKey` / `nvidiaBaseUrl` | NVIDIA |
| `opencodeGoApiKey` / `opencodeGoBaseUrl` | OpenCode Go |
| `runwareApiKey` | Runware (image/music generation) |

> API keys are sensitive and stored locally. The agent's editable settings exclude API key fields.

---

## LLM tab

| Key | Type | What it controls |
| --- | --- | --- |
| `llmProvider` | `LlmProvider` | Active backend: `'ollama' \| 'openrouter' \| 'nvidia' \| 'deepseek' \| 'openai' \| 'opencodego'`. |
| `llmTemperature` | `number` | Sampling temperature passed to the model (higher = more random). |
| `llmNumCtx` | `number` | Context window size in tokens (`options.num_ctx` for Ollama). |
| `contextAutoCompress` | `boolean` | Auto-run context compression when prompt usage reaches ~90% of `llmNumCtx`. |
| `llmThinkLevel` | `LlmThinkLevel` | `think` level. Thinking models default to on unless `think: false` is sent; OpenRouter/NVIDIA reasoning shows in the UI when not `off`. |
| `llmSystemPrompt` | `string` | System message prepended to each request. |
| `longMemoryDefaultEnabled` | `boolean` | Whether new chats include long-term memory retrieval by default. |
| `pinnedModels` | `string[]` | User-pinned model IDs (e.g. `"openai/gpt-4.1"`). |

### Provider-specific fields

| Provider | Keys |
| --- | --- |
| Ollama | `ollamaBaseUrl`, `ollamaModel` |
| OpenRouter | `openrouterBaseUrl`, `openrouterModel`, `openrouterProviderOnly` (provider.only lock, no fallbacks), `openrouterProviderByModel` (per-model provider slug map; empty = default routing) |
| NVIDIA | `nvidiaBaseUrl`, `nvidiaModel` |
| DeepSeek | `deepseekBaseUrl`, `deepseekModel` |
| OpenAI (native) | `openaiBaseUrl` (`https://api.openai.com/v1`), `openaiModel` |
| OpenCode Go | `opencodeGoBaseUrl` (`https://opencode.ai/zen/go/v1`), `opencodeGoModel` |

---

## Media tab (images)

| Key | Type | What it controls |
| --- | --- | --- |
| `imageProvider` | `ImageProvider` | `'runware' \| 'openrouter'` backend for `generate_image` / `edit_image_runware`. |
| `openrouterImageModel` | `string` | OpenRouter model id for image generation when `imageProvider` is `openrouter`. Default `google/gemini-3.1-flash-lite-image`. |
| `openrouterImageProfiles` | `Record<string, RunwareModelProfile>` | Per-model width/height/quality when using OpenRouter. |
| `runwareImageModel` | `string` | Default Runware model id for text-to-image (e.g. `runware:400@6` FLUX 9B). |
| `runwareEditModel` | `string` | Default Runware model id for image editing with references. |
| `runwareWidth` | `number` | Default output width for generated images. |
| `runwareHeight` | `number` | Default output height for generated images. |
| `runwareSteps` | `number` | Default inference steps (fewer = faster, lower quality). |
| `runwareCfgScale` | `number` | Default guidance scale (model-dependent effect). |
| `runwareNegativePrompt` | `string` | Optional default negative prompt. |
| `runwareModelProfiles` | `Record<string, RunwareModelProfile>` | Per-model defaults for generation/edit parameters. |
| `runwareAutoSaveImages` | `boolean` | If true, each generated image is saved automatically to the output folder. |
| `runwareImageOutputDir` | `string` | Auto-save generated Runware images here (desktop app). |
| `runwareApiBaseUrl` | `string` | Runware REST base URL (kept for back-compat; UI no longer exposes it). |
| `runwareApiKey` | `string` | Runware API key (stored locally). |

### RunwareModelProfile

```ts
type RunwareModelProfile = {
  width: number
  height: number
  steps: number
  cfgScale: number
  gptQuality?: 'auto' | 'low' | 'medium' | 'high'  // GPT Image models only
}
```

Configured Runware image models: FLUX 9B (`runware:400@6`), Z Image Turbo (`runware:z-image@turbo`), GPT Image 2 (`openai:gpt-image@2`).

---

## Media tab (music, ACE-Step)

| Key | Type | What it controls |
| --- | --- | --- |
| `runwareMusicModel` | `string` | Active Runware music model id (`runware:ace-step@v1.5-turbo` or `runware:ace-step@v1.5-base`). |
| `runwareMusicModelProfiles` | `Record<string, RunwareMusicModelProfile>` | Per-variant defaults for the ACE-Step music family. |
| `runwareMusicGuidanceType` | `'apg' \| 'cfg'` | Music guidance type. |
| `runwareMusicVocalLanguage` | `string` | Vocals language (ISO 639-1 code or `unknown`). |
| `runwareAutoSaveMusic` | `boolean` | If true, each generated music file is saved automatically to the output folder. |
| `runwareMusicOutputDir` | `string` | Auto-save generated Runware music here (desktop app). |

Legacy / back-compat mirrors (kept in sync with the active profile):

| Key | Type |
| --- | --- |
| `runwareMusicOutputFormat` | `'MP3' \| 'WAV' \| 'FLAC' \| 'OGG'` |
| `runwareMusicDurationSec` | `number` |
| `runwareMusicSteps` | `number` (turbo caps at 20, base allows up to 300) |
| `runwareMusicCfgScale` | `number` |
| `runwareMusicSeed` | `number \| null` (optional fixed seed for reproducibility) |

### RunwareMusicModelProfile

```ts
type RunwareMusicModelProfile = {
  outputFormat: 'MP3' | 'WAV' | 'FLAC' | 'OGG'
  durationSec: number
  steps: number
  cfgScale: number
  seed: number | null
}
```

---

## TTS / STT tab

| Key | Type | What it controls |
| --- | --- | --- |
| `ttsProvider` | `TtsProvider` | `'local'` (OmniVoice HTTP server) \| `'runware-xai'` \| `'openrouter-tts'`. |
| `ttsBaseUrl` | `string` | Base URL for the local TTS server. |
| `openrouterTtsModel` | `string` | Default OpenRouter TTS model id (`google/gemini-3.1-flash-tts-preview`). |
| `openrouterTtsVoice` | `string` | Optional OpenRouter TTS voice id/preset. |
| `sttProvider` | `SttProvider` | `'none'` (disabled) \| `'openrouter'` (OpenRouter Whisper). |
| `openrouterSttModel` | `string` | OpenRouter STT (Whisper) model id. |
| `voiceInstruct` | `string` | Voice instruction text. |
| `voiceMode` | `VoiceMode` | `'design'` (instruct) \| `'clone'` (ref_audio + optional ref_text). |
| `cloneRefText` | `string` | Reference transcript for clone; empty = model may use Whisper (slower). |
| `autoVoice` | `boolean` | Play TTS automatically after the assistant reply finishes. |
| `ttsSpeed` | `number` | TTS generate speed (>1 faster). |
| `ttsNumStep` | `number` | Diffusion steps (fewer = faster, lower quality). |
| `ttsDurationSec` | `number \| null` | Fixed duration in seconds; `null` = automatic. |
| `ttsChunkMaxChars` | `number` | Long text split into chunks; approximate chars per chunk. |
| `runwareXaiVoice` | `string` | xAI TTS voice id when Runware xAI provider is selected. |
| `runwareTtsModel` | `string` | Runware TTS model id for cloud speech synthesis. |
| `runwareXaiLanguage` | `string` | Optional xAI language code (auto-detect when empty). |
| `runwareXaiPositivePrompt` | `string` | Optional positive prompt for Qwen voice design/custom voice (style/emotion description). |
| `runwareTtsSpeed` | `number` | Runware TTS speed (0.25–4). Default 1.0. |
| `voiceBakePhrase` | `string` | Short line spoken when baking a voice anchor (auto/design → consistent chunks). |

---

## Tools tab

| Key | Type | What it controls |
| --- | --- | --- |
| `toolsEnabled` | `ToolsEnabled` | Per-tool enable flags (see below). |
| `agentMaxToolRounds` | `number` | Max agent↔tool loop rounds per assistant turn (clamped 5–120). Soft wrap-up warning near the end; hard wrap-up after exhaustion. |
| `mcpEnabled` | `boolean` | Connect to MCP servers from `~/.voidcast/mcp.json` (+ project `.mcp.json`) and register their tools (desktop only). |
| `mcpServerEnabled` | `Record<string, boolean>` | Per-server enable flags (server id from mcp.json). Missing key = enabled; `false` keeps a server configured but not connected. |
| `mcpTrustedProjectPaths` | `string[]` | Project roots explicitly trusted to load `.mcp.json` servers from. Untrusted project configs ignored until approved in Options → Tools. |
| `codingProjectPath` | `string` | Backward-compatible top-level alias for the coding project path. |
| `pdfOutputDir` | `string` | Where `save_pdf` writes files (no dialog). Empty = tool returns an error until set. |

### ToolsEnabled flags

```ts
type ToolsEnabled = {
  webSearch: boolean    // web_search tool
  weather: boolean      // get_weather tool
  scrape: boolean       // scrape_url (public URL → plain text)
  pdf: boolean          // save_pdf into pdfOutputDir
  youtube: boolean      // YouTube search / video info / transcript
  reddit: boolean       // Reddit read-only feed / search / post fetch
  runwareImage: boolean // generate_image / edit via Runware API
  runwareMusic: boolean // generate music via Runware ACE-Step
  coding: boolean       // local coding tools (read/write/search + terminal)
  enterPlan: boolean    // agent can switch conversation into Plan mode
}
```

---

## Skills tab

| Key | Type | What it controls |
| --- | --- | --- |
| `skillsEnabled` | `boolean` | Discover Agent Skills from `~/.agents`, `~/.claude`, and `~/.cursor/skills` and expose a catalog + `read_skill` tool (desktop only). |

---

## Sub-Agent tab

| Key | Type | What it controls |
| --- | --- | --- |
| `subAgent.enabled` | `boolean` | When true, `image_recall` runs a sub-agent instead of returning base64. |
| `subAgent.codingEnabled` | `boolean` | Enables coding context management: deterministic trim of noisy tool output, clearing stale tool results from old rounds, and the read-only `coding_explore` tool. |
| `subAgent.model` | `string` | Vision (+ long-memory) model id (e.g. `llava:13b`, `gpt-4o`). |
| `subAgent.provider` | `SubAgentProviderId` | Explicit backend for the vision model; inferred via `detectSubAgentProvider` when omitted. |
| `subAgent.codingModel` | `string` | Coding explore model id (text-capable); migrates from `model` when missing. |
| `subAgent.codingProvider` | `SubAgentProviderId` | Explicit backend for the coding model. |
| `subAgent.openrouterProviderOnly` | `string` | OpenRouter provider slug lock for the vision model (no fallbacks). |
| `subAgent.codingOpenrouterProviderOnly` | `string` | OpenRouter provider slug lock for the coding model. |
| `subAgent.outputTokens` | `number` | Max generated tokens per sub-agent call (internal default 2048; not in Options UI). |
| `subAgent.contextTokens` | `number` | Ollama num_ctx for sub-agent calls (internal default 16384; cloud ignores). |
| `subAgent.showAnalysisWindow` | `boolean` | Show the floating analysis panel during vision/coding sub-agent (default on). |

---

## Coding panel (`settings.coding` — CodingSettings)

| Key | Type | Default / bounds | What it controls |
| --- | --- | --- | --- |
| `enabled` | `boolean` | off | Whether the coding panel is shown. |
| `projectPath` | `string` | — | Root folder the coding tools read/write within. |
| `showFileTree` | `boolean` | on | Show the file tree section. |
| `showFilePreview` | `boolean` | on | Show the file preview section. |
| `showTerminal` | `boolean` | off | Show the terminal section. |
| `panelWidthPx` | `number` | 416 (280–1200) | Coding panel width in px (chat ↔ panel split). |
| `fileTreeHeightPx` | `number` | 220 (100–480) | File tree section height in px (FILES ↔ preview/terminal split). |

### Splitter clamp constants

```ts
CODING_PANEL_WIDTH_DEFAULT = 416      // panelWidthPx default
CODING_PANEL_WIDTH_MIN     = 280
CODING_PANEL_WIDTH_MAX     = 1200

CODING_FILE_TREE_HEIGHT_DEFAULT = 220 // fileTreeHeightPx default
CODING_FILE_TREE_HEIGHT_MIN     = 100
CODING_FILE_TREE_HEIGHT_MAX     = 480
```

`clampCodingPanelWidth(px, containerWidth?)` and `clampCodingFileTreeHeight(px, containerHeight?)` enforce these bounds (and cap at 85% of container width / 70% of container height when the container is known).
