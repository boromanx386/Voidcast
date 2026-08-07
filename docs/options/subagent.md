# Sub-Agent Tab

> Grounded in `electron-app/src/components/options/SubAgentOptionsPanel.tsx` and the `SubAgentConfig` type in `electron-app/src/lib/settings.ts`. In the tab bar this is the **SUB** tab.

## What a sub-agent is

The sub-agent is a **separate model instance** the main agent can delegate tasks to — most commonly **vision/image understanding** or **coding-style sub-tasks** — so the main chat model can stay focused on the conversation while heavy side-tasks run against a different (often smaller/faster) model, e.g. `llava:13b`.

## `SubAgentConfig` fields

All fields live under `settings.subAgent`:

| Field | Type / Default | Meaning |
| --- | --- | --- |
| `enabled` | `boolean`, default `false` | Master switch — enables sub-agent delegation from chat |
| `codingEnabled` | `boolean`, default `false` | Enable sub-agent use for coding-style delegated tasks |
| `provider` | `SubAgentProviderId` (same provider id space as `LlmProvider`), default `'ollama'` | Provider for vision/delegated tasks |
| `model` | `string`, default `'llava:13b'` | Model for vision/delegated tasks |
| `codingProvider` | provider id, default `'ollama'` | Provider for coding-style delegations (falls back to `provider`) |
| `codingModel` | `string`, default `'llava:13b'` | Model for coding-style delegations |
| `openrouterProviderOnly` | `string`, default `''` | OpenRouter provider lock applied when `provider === 'openrouter'` (mirrors the LLM tab behavior) |
| `codingOpenrouterProviderOnly` | `string`, default `''` | Same lock, applied for coding delegations |
| `outputTokens` | `number`, default `SUB_AGENT_DEFAULT_OUTPUT_TOKENS = 2048` | Max output tokens for the sub-agent |
| `contextTokens` | `number`, default `SUB_AGENT_DEFAULT_CONTEXT_TOKENS = 16384` | Context window budget for the sub-agent |
| `showAnalysisWindow` | `boolean`, default `true` | Show the sub-agent analysis window in the UI while it works |

`subAgentConfigForRole(sub, 'coding')` merges the coding fields onto the shared `model`/`provider` slots (so callers can use one config for both roles).

The OpenRouter provider lock helpers (`withSubAgentOpenRouterProvider`, `getOpenRouterProviderOnly`) keep sub-agent requests locked to a single provider when the user configured one, exactly like the main LLM tab.

## Panel behavior

`SubAgentOptionsPanel` receives `settings`, `setSettings`, plus the same model-loading props as the LLM tab (`loadModels`, `modelsLoading`, `ollamaModels`, `modelsError`) so you can refresh the Ollama model list when picking `codingModel`/`model`. It exposes:

- master enable toggle,
- provider + model selectors for both **vision/delegated** and **coding** roles,
- OpenRouter provider-only lock inputs (when the selected provider is OpenRouter),
- output/context token budgets,
- the analysis-window toggle.

## How it is used from chat

When the sub-agent is enabled:

1. The agent registers a **delegation tool** (sub-agent tool) usable during a chat turn.
2. For a vision request (attached image), the chat flow calls the sub-agent with `subAgentConfigForRole(subAgent, 'vision')` — i.e. `provider`/`model` — passes the image, and returns the description into the main conversation.
3. For coding-style delegation, the config uses `subAgentConfigForRole(subAgent, 'coding')` — i.e. `codingProvider`/`codingModel` (or the plain fields when coding ones are empty).
4. Results (including the analysis window content when `showAnalysisWindow`) are surfaced to the user and/or fed back to the main agent for the final answer.

Implementations: `electron-app/src/lib/codingSubAgent.ts` and `electron-app/src/lib/subAgent.ts`.
