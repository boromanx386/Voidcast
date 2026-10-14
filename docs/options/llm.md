# LLM Tab

> Grounded in `electron-app/src/components/options/LlmOptionsPanel.tsx` and `electron-app/src/lib/settings.ts`. All settings auto-save as you change them; see the README for agent-editable vs hidden fields.

<p align="center">
  <img src="https://raw.githubusercontent.com/boromanx386/Voidcast/main/demos/voidcast-options-llm.png" width="720" alt="Options → LLM tab"/>
</p>
<p align="center"><em>Options → LLM.</em></p>

## Provider selector (`llmProvider`)

Type: `LlmProvider = 'ollama' | 'openrouter' | 'nvidia' | 'deepseek' | 'openai' | 'opencode-go'`
Default: `'ollama'`

The active provider determines which provider-specific group of fields is shown and used for chat completion requests.

## Per-provider settings

### Ollama (local)
- `ollamaBaseUrl` — default `http://localhost:11434`; on desktop a local proxy may be used.
- **CSP note:** the renderer's `connect-src` allows `https:`/`wss:` plus loopback `http:`/`ws:` only, so an Ollama server reached over plain HTTP at a **non-loopback** address (e.g. `http://192.168.1.50:11434`) is blocked until that origin is added to `index.html`.
- `ollamaModel` — default `'llama3.2'`. A **Refresh/load models** button populates this from the Ollama server (`loadModels`, `ollamaModels`, `modelsLoading`, `modelsError`); you can also type a custom model id.

### OpenRouter (cloud)
- `openrouterBaseUrl` — default `https://openrouter.ai/api/v1`
- `openrouterApiKey` — stored locally (hidden from the agent)
- `openrouterModel` — default `'openrouter/free'`

One key for 300+ models (Claude, GPT, Gemini, DeepSeek, Llama, Qwen...), plus optional image models and TTS. OpenRouter can also serve the same model from several upstream providers, and Voidcast exposes that routing directly:

- **Pin the provider per model** — `openrouterProviderOnly` (string slug, e.g. `'anthropic'`, `'openai'`, `'deepinfra'`) is the lock for the **currently selected model**. When set, requests use `provider.only` and never fall back to another provider; leave it empty for OpenRouter's default load balancing.
- **Remembered per model** — `openrouterProviderByModel` (`Record<string, string>`) stores a lock **per model id**. Selecting a model that has a saved lock restores it into `openrouterProviderOnly`; editing the lock updates both.
- **LIST ALL** — queries OpenRouter for every provider serving the selected model and renders a table: **provider · CTX · IN/OUT price (per 1M) · recent uptime**. Click a row to apply that provider as the current model's lock. Desktop requests hit OpenRouter directly; LAN web requests use the local proxy.
- **Sticky routing for upstream cache** — each chat sends a stable `session_id`, so OpenRouter keeps routing the conversation to the same upstream provider and that provider's prompt cache stays warm. Cache-friendly prompt ordering (a byte-identical system prompt + history prefix, with volatile context on the final user turn) is **not** OpenRouter-specific: it holds for **every** provider, and cached-token counts are read back from Ollama, OpenAI, DeepSeek and OpenRouter alike. See [../chat.md](../chat.md).
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
- Voidcast sends a stable `x-opencode-session` header for each chat so OpenCode Go can route and cache the conversation correctly.


## Generation/context defaults

- `llmTemperature` (`number`, default `0.8`) — sent as `options.temperature` to Ollama.
- `llmNumCtx` (`number`, default `100_000`) — Ollama `options.num_ctx`, the context window size in tokens.
- `contextAutoCompress` (`boolean`, default `true`) — auto-run context compression when prompt usage reaches ~90% of the model context limit. Also toggled from the chat footer **CTX** popup; **COMPRESS NOW** there works anytime regardless of this setting.
- `longMemoryDefaultEnabled` (`boolean`, default `true`) — default for new chats: whether to include long-term memory retrieval.

## Think level (`llmThinkLevel`)

Type: `LlmThinkLevel = 'off' | 'low' | 'medium' | 'high' | 'on'`, default `'on'`.

Thinking-capable models default to thinking unless `think: false` is sent; OpenRouter/NVIDIA reasoning is shown in the UI when the level is not `off`.

## System prompt (`llmSystemPrompt`)

Default is the built-in “Void” persona prompt. This is one of the **agent-editable** fields. Presets (`code`, `creative`, `teacher`) extend/override it per chat mode; the text you type here is the base system message prepended to each request.

## Agent-editable / hidden reminder

`llmSystemPrompt`, `llmNumCtx`, and `llmTemperature` are in `AGENT_EDITABLE_SETTINGS_FIELDS`; API keys are hidden from the agent (`AGENT_HIDDEN_SETTINGS_FIELDS`).
