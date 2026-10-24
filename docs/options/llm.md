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

### Ollama
One provider among the others: models on your own machine, or Ollama's hosted models (billed by Ollama, never by Voidcast). It is only the *default* because it needs no API key.
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

<p align="center">
  <img src="https://raw.githubusercontent.com/boromanx386/Voidcast/main/demos/voidcast-options-openrouter.png" width="720" alt="Agent tab with OpenRouter selected — model, provider lock and the LIST ALL provider table"/>
</p>
<p align="center"><em>OpenRouter in the Agent tab: <code>OPENROUTER_PROVIDER</code> locked to one upstream, with <b>LIST ALL</b> showing every provider for the model.</em></p>

### NVIDIA
NVIDIA's free developer tier: no subscription and no paid plan to buy, so there is nothing to cancel or upgrade. It is also the slowest of the cloud providers in practice — free capacity is shared, so throughput varies and large models can crawl. Third-party lists put the free tier at roughly 40 requests/minute, which is indicative, not a contract.
- `nvidiaBaseUrl` — default `https://integrate.api.nvidia.com/v1`
- `nvidiaApiKey` — local key
- `nvidiaModel` — default `'nvidia/nemotron-3-super-120b-a12b'`

### DeepSeek
- `deepseekBaseUrl` — default `https://api.deepseek.com`
- `deepseekApiKey` — local key
- `deepseekModel` — default `'deepseek-v4-pro'`

### OpenAI (native)
This slot is a plain OpenAI Chat Completions client and `openaiBaseUrl` is a normal editable field, which makes it the supported way to run against any **OpenAI-compatible server**: vLLM (`http://localhost:8000/v1`), llama.cpp `llama-server` (`http://localhost:8080/v1`), LM Studio, TGI, SGLang, llama-cpp-python, or Ollama's own `/v1` route. Read-only on LAN web clients, which proxy `/api/openai/*` through the desktop app.
- `openaiBaseUrl` — default `https://api.openai.com/v1` (OpenAI Chat Completions)
- `openaiApiKey` — local key
- `openaiModel` — default `'gpt-5.6-sol'`; any id can be typed in, so a self-hosted model name works

### OpenCode Go
- `opencodeGoBaseUrl` — default `https://opencode.ai/zen/go/v1` (OpenAI-compatible chat models)
- `opencodeGoApiKey` — local key
- `opencodeGoModel` — default `'deepseek-v4-pro'`
- Voidcast sends a stable `x-opencode-session` header for each chat so OpenCode Go can route and cache the conversation correctly.

#### Three wire formats (`openCodeGoApiStyle`)

OpenCode Go serves its models over more than one protocol, and `openCodeGoApiStyle(model)` (`electron-app/src/lib/cloudLlmPresets.ts`) picks the endpoint per model — it is derived from the model id, not a setting:

| Style | Endpoint | Models |
| --- | --- | --- |
| `openai-chat` | `{base}/chat/completions` | the default — DeepSeek V4, Kimi, GLM, MiMo, LongCat, Step, … |
| `anthropic-messages` | `{base}/messages` | `claude-haiku-5-5`, `minimax-m3`, `minimax-m2.7`, `qwen3.8-max`, `qwen3.8-flash`, `qwen3.7-plus` |
| `opencode-responses` | `{base}/responses` | the Contributor tier — `grok-4.6`, `grok-4.7`, `muse-spark-1.2-contributor`, `muse-spark-1.3-contributor`, `gpt-5.6-luna`, `gpt-6-luna` |

- **Responses is a real adapter, not a shim.** `electron-app/src/lib/openResponses.ts` flattens Voidcast's internal OpenAI-shaped history into Responses `input` items: tools are flat (`{type:'function', name, parameters}`), an assistant tool call is its own `function_call` item whose result is a `function_call_output` linked by `call_id` (there is no `role: 'tool'`), the system prompt is `instructions`, and the output cap is `max_output_tokens` — default 16 384, stepping down to 8 192 then 4 096 if a model rejects the cap with a 400. Responses SSE events are folded back into the same tool-call/usage shapes the chat-completions parser produces, so the rest of the app never sees a difference. Only the network loop differs: it lives in `openrouter.ts`.
- **Routing is by family, with a runtime fallback.** Go publishes no ids for Responses-only models, so the static rules match families (`grok*`, `muse-spark*`, `gpt-<ver>-luna`) plus explicit per-id pins. If a model the rules do not know answers `/chat/completions` with `ModelProtocolUnsupported`, the turn is replayed on the format that worked and `rememberOpenCodeGoApiStyle` caches it for the rest of the session (in-memory on purpose: one extra probe per model per run, never a stale hint across restarts).
- **Contributor models are paste-in.** They are not preset entries — put the slug from the Go dashboard into the custom model field and the API style routes it to `{base}/responses`. `npm run check:models --apply` resolves the endpoint per model from models.dev, suggests the right ones and can write pins into `OPENCODE_GO_RESPONSES_MODELS`.
- **The routing keys off the OpenCode Go URL.** `isOpenCodeGoApi()` (`electron-app/src/lib/openrouter.ts`) accepts `…/opencode.ai/zen/go…` or the local proxy path `/api/opencode-go`. Point `opencodeGoBaseUrl` at another host and the turn takes the plain Chat Completions path, adapter and all — so a self-hosted gateway that must serve all three formats has to sit behind one of those two paths.


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
