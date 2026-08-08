# Getting Started

## Install & Launch

Voidcast is an **Electron desktop app**. Install the packaged build for your platform and launch it; the renderer loads the chat screen (`Screen = 'chat'` from `electron-app/src/types/voidcast.ts`).

- First launch opens a fresh chat session with an empty composer and the **Sessions** sidebar.
- The app also has a **LAN web client** runtime (point a phone/tablet browser at the desktop's server) and a **web-standalone** browser mode. See [README.md](README.md) for the differences.

## First Chat

1. Type a message in the composer at the bottom of the chat screen and press **Send** (or `Ctrl+Enter`).
2. The assistant reply renders as markdown in the message list. TTS auto-voice and STT input are available when enabled (see [chat.md](chat.md) and the TTS options tab).
3. Use the mode button in the composer to switch **Agent / Team / Plan** (cycle with `Shift+Tab`).  
   - **Multi-chat:** you can leave one chat running and open another — see [multi-chat-and-team.md](multi-chat-and-team.md).  
   - **Team workers:** for multi-file work, enable Options → SUB → coding sub-agent, set a coding project path, pick **Team**.
4. New chat: **Ctrl+N** or the **New chat** button in the sidebar.

## Picking a Provider

Open **Options** (gear icon in the header) → **LLM** tab. `llmProvider` is one of:

| value | What it is | Setup |
|---|---|---|
| `ollama` | Local models via `http://localhost:11434` (default) | Install [Ollama](https://ollama.com), `ollama pull llama3.2`, no API key |
| `openrouter` | Cloud routing hub, default `https://openrouter.ai/api/v1`, model `openrouter/free` | OpenRouter API key |
| `nvidia` | NVIDIA NIM cloud, default `https://integrate.api.nvidia.com/v1` | NVIDIA API key |
| `deepseek` | DeepSeek API, default `https://api.deepseek.com`, model `deepseek-v4-pro` | DeepSeek API key |
| `openai` | Native OpenAI Chat Completions, default `https://api.openai.com/v1`, model `gpt-5.6-sol` | OpenAI API key |
| `opencode-go` | OpenCode Go (OpenAI-compatible), default `https://opencode.ai/zen/go/v1`, model `deepseek-v4-pro` | OpenCode Go API key |

Provider default/model presets come from `electron-app/src/lib/cloudLlmPresets.ts`. The **chat system status** area lists the active provider and model; the model switcher popup (`ModelSwitcherPopup.tsx`) shows provider presets, Ollama model fetch, and pinned models (`pinnedModels`, stored as ids like `openrouter:openai/gpt-5.6-terra`).

### Creating API keys

- **OpenRouter**: https://openrouter.ai/keys — paste into **Options → LLM → OpenRouter API key** (or click **Manage models** in the model switcher and select a provider/model there).
- **NVIDIA**: https://build.nvidia.com — API key field `nvidiaApiKey`.
- **DeepSeek**: https://platform.deepseek.com/api_keys — `deepseekApiKey`.
- **OpenAI**: https://platform.openai.com/api-keys — `openaiApiKey`.
- **OpenCode Go**: https://opencode.ai — `opencodeGoApiKey`.

Cloud API keys are kept in renderer `localStorage`; on LAN web clients `saveSettings` strips them (`stripCloudSecrets`).

## Using Local Ollama

- Default `ollamaBaseUrl` is `http://localhost:11434`. Desktop also supports a desktop proxy for web clients.
- `ollamaModel` defaults to `llama3.2`. The model list is fetched from `/api/tags` in `electron-app/src/lib/ollama.ts`.
- Ollama-specific LLM options: `llmTemperature`, `llmNumCtx` (`options.num_ctx`), `llmThinkLevel` (`think`), and `llmSystemPrompt`.
- OpenRouter/NVIDIA reasoning appears in the UI when `llmThinkLevel` is not `off`.

## Where Settings Are Stored

All settings live in `electron-app/src/lib/settings.ts`:

- **Storage**: renderer `localStorage` under the key **`voidcast-settings-v1`** (`STORAGE_KEY`). A legacy key `omnivoice-chat-settings-v1` is read once to migrate.
- **Load**: `loadSettings()` reads `localStorage`, merges over `defaults`, runs `normalizeAll` (llm, subAgent, tts, tools, pdf dir, ui theme, agent mode, runware, notification sounds, lan web access), then `sanitizeDesktopServiceUrls` and `applyWebRuntimeOverrides`.
- **Save**: `saveSettings(s)` writes `JSON.stringify` to `localStorage` (stripping cloud secrets on LAN web clients).
- **Defaults**: `export const defaults: AppSettings` (settings.ts). See [settings-reference.md](settings-reference.md) for every key.

The React state wrapper is `useAppSettings()` in `electron-app/src/hooks/useAppSettings.ts` (loads via `loadSettings`, persists via `saveSettings`).
