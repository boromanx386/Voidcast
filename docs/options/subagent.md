# Sub-Agent Tab

> Grounded in `electron-app/src/components/options/SubAgentOptionsPanel.tsx`, `SubAgentConfig` in `electron-app/src/lib/settings.ts`, runtime in `subAgent.ts` / `codingSubAgent.ts` / `codingWorkers.ts`, and UI in `SubAgentPanel.tsx` + `subAgentPanelState.ts`.

## What a sub-agent is

A **separate model (and provider)** the main chat agent can call for side work, so the main model stays on orchestration / final answer. Two independent roles:

| Role | Setting | Used for |
| --- | --- | --- |
| **Vision** | `provider` + `model` | Image describe / `image_recall` when `enabled` |
| **Coding** | `codingProvider` + `codingModel` | `coding_explore` and `run_coding_workers` when `codingEnabled` |

Coding runs use the same providers as the main LLM tab (Ollama, OpenRouter, NVIDIA, DeepSeek, OpenAI, OpenCode Go), including provider locks for OpenRouter and the main LLM’s cloud API keys (including **OpenCode Go**).

Sub chat calls hardcode **temperature 0.2** and disable **thinking** where the API supports it. They do **not** inherit the main composer’s think level or temp.

## Explore vs workers (coding role)

| | **Explore** (`coding_explore`) | **Workers** (`run_coding_workers`) |
| --- | --- | --- |
| Mode | Agent, Team, Plan (read-only tools overall in Plan) | Agent (optional), Team (preferred). **Not** Plan |
| Tools | Read-only: list/read/search/glob/symbols, git, types, processes | Explore set **+** `write_file`, `edit_code`, `execute_command` |
| Parallel | 1 nested loop | Up to **2** tasks in parallel |
| Rounds | Default 8, max 12 (ceiling; may finish early with `done`) | Default **100**, max **100** |
| Scope | Soft `path_prefix` hints for search/list | **`path_prefix` hard-scopes writes/edits**; reads can use the whole project (read char budget); file locks between workers |
| Nesting | Cannot nest | Cannot nest workers; cannot call explore/workers again from a worker |
| Main while running | Main **awaits** tool result (blocked by design) | Same — main is sequential until digests return |

Workers among themselves run in parallel (`Promise.all`). Main cannot fire-and-forget workers and keep calling other tools until they finish.

## `SubAgentConfig` fields

All fields live under `settings.subAgent`:

| Field | Type / Default | Meaning |
| --- | --- | --- |
| `enabled` | `boolean`, default `false` | Vision / image sub-agent |
| `codingEnabled` | `boolean`, default `false` | Explore + coding workers |
| `provider` / `model` | vision role | e.g. Ollama `llava:…` or cloud vision model |
| `codingProvider` / `codingModel` | coding role | Often a strong text model for tool loops |
| `openrouterProviderOnly` / `codingOpenrouterProviderOnly` | `string` | OpenRouter provider lock per role |
| `outputTokens` | default **2048** | Max output; **not** shown in Options UI (forced on normalize) |
| `contextTokens` | default **16384** | Context budget; **not** shown in Options UI |
| `showAnalysisWindow` | `boolean`, default `true` | Show the **in-chat** analysis card (see below) |

`subAgentConfigForRole(sub, 'vision' | 'coding')` projects the right provider/model onto a single config for callers.

## Panel behavior (Options → SUB)

- Master toggles: enable vision SUB, enable **coding** SUB
- Provider + model + pin chips for **vision** and **coding** (same pin model helpers as LLM tab)
- OpenRouter provider-only when that provider is selected
- **SHOW_ANALYSIS_IN_CHAT** — collapsible activity card in the message stream (not a floating window)

## Analysis card in chat

- Component: `SubAgentActivityCard` (`SubAgentPanel.tsx`), state reducers in `subAgentPanelState.ts`
- Live progress is written onto the **assistant message for that turn** as `UiMessage.subAgentActivity`
- Stays in **timeline order** under that reply after later user prompts
- **Persists** with the session (IndexedDB) when the chat is saved; reload restores a collapsed card
- Expand / collapse / dismiss (dismiss drops activity from the message)
- Shows VISION / EXPLORE / WORKERS, event log, worker slots, digests

## How tools are used

1. **Vision** — `enabled` → describe images / image tools use vision config  
2. **coding_explore** — `codingEnabled` → nested JSON tool loop, digest only back to main  
3. **run_coding_workers** — `codingEnabled` + agent/team + coding tools + project path → 1–2 tasks with `goal` + optional `path_prefix` + optional `max_rounds`

Sources: `subAgent.ts`, `codingSubAgent.ts`, `codingWorkers.ts`, `toolHandlers/codingHandlers.ts`, `toolDefinitions.ts`.
