# LLM Tab

> Grounded in `electron-app/src/components/options/LlmOptionsPanel.tsx` and `electron-app/src/lib/settings.ts`. All settings auto-save as you change them; see the README for agent-editable vs hidden fields.

## Provider selector (`llmProvider`)

Type: `LlmProvider = 'ollama' | 'openrouter' | 'nvidia' | 'deepseek' | 'openai' | 'opencode-go' | 'crofai'`
Default: `'ollama'`

The active provider determines which provider-specific group of fields is shown and used for chat completion requests.

## Per-provider settings

### Ollama (local)
- `ollamaBaseUrl` — default `http://localhost:11434`; on desktop a local proxy may be used.
- `ollamaModel` — default `'llama3.2'`. A **Refresh/load models** button populates this from the Ollama server (`loadModels`, `ollamaModels`, `modelsLoading`, `modelsError`); you can also type a custom model id.

### OpenRouter (cloud)
- `openrouterBaseUrl` — default `https://openrouter.ai/api/v1`
- `openrouterApiKey` — stored locally (hidden from the agent)
- `openrouterModel` — default `'openrouter/free'`
- **Provider-only lock** — `openrouterProviderOnly` (string, e.g. `'openai'`). When set, OpenRouter requests use `provider.only` and never fall back to other providers. Kept in sync with `openrouterProviderByModel[openrouterModel]`.
- **Per-model provider mapping** — `openrouterProviderByModel` (`Record<string, string>`). Maps each OpenRouter model id to a provider slug lock. If a model has a lock, requests for that model go only to that provider; otherwise OpenRouter default routing is used. Editing the lock for the current model updates `openrouterProviderOnly` too.
- **Pinned models** — `pinnedModels` (`string[]`). Provider-specific ids like `'openrouter:anthropic/claude-sonnet-5'` or `'openrouter:openai/gpt-5.6-sol'`. Pinned models appear as quick-select chips in the panel (and in the chat model picker); toggle a pin on/off per candidate model.

### NVIDIA
- `nvidiaBaseUrl` — default `https://integrate.api.nvidia.com/v1`
- `nvidiaApiKey` — local key
- `nvidiaModel` — default `'nvidia/nemotron-3-super-120b-a12b'`

### DeepSeek
- `deepseekBaseUrl` — default `https://api.deepseek.com`
- `deepseekApiKey` — local key
- `deepseekModel` — default `'deepseek-v4-pro'`

### OpenAI (native)
- `openaiBaseUrl` — default `https://api.openai.com/v1` (OpenAI Chat Completions)
- `openaiApiKey` — local key
- `openaiModel` — default `'gpt-5.6-sol'`

### OpenCode Go
- `opencodeGoBaseUrl` — default `https://opencode.ai/zen/go/v1` (OpenAI-compatible chat models)
- `opencodeGoApiKey` — local key
- `opencodeGoModel` — default `'deepseek-v4-pro'`

### CrofAI
- `crofaiBaseUrl` — default `https://crof.ai/v1` (OpenAI-compatible; see [crof.ai/docs](https://crof.ai/docs))
- `crofaiApiKey` — local key
- `crofaiModel` — default `'deepseek-v4-pro'`
- THINKING_LEVEL maps to CrofAI `reasoning_effort` (`low` / `medium` / `high` / `none`)
- LAN web clients proxy via TTS `/api/crofai/*`

## Generation/context defaults

- `llmTemperature` (`number`, default `0.8`) — sent as `options.temperature` to Ollama.
- `llmNumCtx` (`number`, default `100_000`) — Ollama `options.num_ctx`, the context window size in tokens.
- `contextAutoCompress` (`boolean`, default `true`) — auto-run context compression when prompt usage reaches ~90% of `num_ctx`.
- `longMemoryDefaultEnabled` (`boolean`, default `true`) — default for new chats: whether to include long-term memory retrieval.

## Think level (`llmThinkLevel`)

Type: `LlmThinkLevel = 'off' | 'low' | 'medium' | 'high' | 'on'`, default `'on'`.

Thinking-capable models default to thinking unless `think: false` is sent; OpenRouter/NVIDIA reasoning is shown in the UI when the level is not `off`.

## System prompt (`llmSystemPrompt`)

Default is the built-in “Void” persona prompt. This is one of the **agent-editable** fields. Presets (`code`, `creative`, `teacher`) extend/override it per chat mode; the text you type here is the base system message prepended to each request.

## Agent-editable / hidden reminder

`llmSystemPrompt`, `llmNumCtx`, and `llmTemperature` are in `AGENT_EDITABLE_SETTINGS_FIELDS`; API keys are hidden from the agent (`AGENT_HIDDEN_SETTINGS_FIELDS`).
