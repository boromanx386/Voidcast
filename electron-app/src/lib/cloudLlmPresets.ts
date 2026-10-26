export type CloudLlmPreset = { id: string; label: string }

/** Curated OpenRouter chat models (verified against GET /api/v1/models). */
export const OPENROUTER_LLM_PRESET_MODELS: CloudLlmPreset[] = [
  { id: 'openrouter/free', label: 'Auto Free Router' },
  { id: 'openrouter/fusion', label: 'OpenRouter Fusion (multi-model)' },
  { id: 'openrouter/auto-beta', label: 'OpenRouter Auto (Beta)' },
  { id: 'deepseek/deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro 0813 (1M ctx)' },
  { id: 'deepseek/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash 0731 (fast · cheap)' },
  {
    id: 'deepseek/deepseek-v4-flash-vision-exp',
    label: 'DeepSeek V4 Flash Vision Exp (multimodal)',
  },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 (latest)' },
  { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5 (flagship)' },
  { id: 'anthropic/claude-fable-5', label: 'Claude Fable 5 (long-horizon coding)' },
  { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol (flagship · coding)' },
  { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra (balanced)' },
  { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna (fast · cheap)' },
  { id: 'openai/gpt-5.6-sol-pro', label: 'GPT-5.6 Sol Pro' },
  { id: 'openai/gpt-5.6-terra-pro', label: 'GPT-5.6 Terra Pro' },
  { id: 'openai/gpt-5.6-luna-pro', label: 'GPT-5.6 Luna Pro' },
  { id: 'x-ai/grok-4.5', label: 'Grok 4.5 (coding · STEM)' },
  { id: 'x-ai/grok-4.6', label: 'Grok 4.6 (flagship · coding)' },
  { id: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'google/gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3' },
  { id: 'moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code (coding)' },
  { id: 'meta/muse-spark-1.2', label: 'Meta Muse Spark 1.2' },
  { id: 'minimax/minimax-m3', label: 'MiniMax M3' },
  { id: 'qwen/qwen3.7-plus', label: 'Qwen3.7 Plus' },
  { id: 'inclusionai/ling-3.0-flash', label: 'Ling 3.0 Flash (ultra-cheap MoE)' },
  { id: 'z-ai/glm-5.2', label: 'GLM 5.2 (reasoning · coding)' },
  { id: 'z-ai/glm-5.3', label: 'GLM 5.3 (reasoning · coding)' },
  { id: 'tencent/hy3', label: 'Tencent Hy3 (reasoning · agentic)' },
  { id: 'tencent/hy3-preview', label: 'Tencent Hy3 Preview (agentic · 256K)' },
  { id: 'poolside/laguna-s-2.1', label: 'Poolside Laguna S 2.1' },
  { id: 'poolside/laguna-s-2.1:free', label: 'Poolside Laguna S 2.1 (Free)' },
  { id: 'nvidia/nemotron-3.5-lightning', label: 'Nemotron 3.5 Lightning (262K ctx · cheap)' },
  { id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning (Free)' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra (Free)' },
  {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    label: 'Nemotron 3 Nano Omni 30B (Free)',
  },
  { id: 'cohere/north-mini-code:free', label: 'Cohere North Mini Code (Free)' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B IT (Free)' },
  { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash (1M ctx)' },
  { id: 'liquid/lfm-2.5-2.6b:free', label: 'LFM 2.5 2.6B (Free · 66K ctx)' },
  { id: 'qwen/qwen3.8-flash', label: 'Qwen3.8 Flash (1M ctx)' },
  { id: 'tencent/hy4-preview', label: 'Hy4 Preview (1M ctx)' },
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (1M ctx)' },
  { id: 'openai/gpt-6-astra', label: 'GPT 6 Astra (1.1M ctx)' },
  { id: 'openai/gpt-6-astra-pro', label: 'GPT 6 Astra Pro (1.1M ctx)' },
  { id: 'anthropic/claude-fable-5.1', label: 'Claude Fable 5.1 (1M ctx)' },
  { id: 'z-ai/glm-5.3-flashx', label: 'GLM 5.3 Flashx (1M ctx)' },
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash (1M ctx)' },
  { id: 'openai/gpt-6-luna', label: 'GPT 6 Luna (1.1M ctx)' },
  { id: 'openai/gpt-6-sol', label: 'GPT 6 Sol (1.1M ctx)' },
  { id: 'qwen/qwen3.8-max-0902', label: 'Qwen3.8 Max 0902 (1M ctx)' },
  { id: 'qwen/qwen3.8-omni-flash', label: 'Qwen3.8 Omni Flash (1M ctx)' },
  { id: 'x-ai/grok-4.7', label: 'Grok 4.7 (500K ctx)' },
  { id: 'xiaomi/mimo-v2.6-flash', label: 'MiMo V2.6 Flash (1M ctx)' },
  { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5 (1M ctx)' },
  { id: 'xiaomi/mimo-v2.6-pro', label: 'MiMo V2.6 Pro (1.1M ctx)' },
  { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5 (1M ctx)' },
  { id: 'openai/gpt-6.1-sol', label: 'GPT 6.1 Sol (1.1M ctx)' },
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5 (1M ctx)' },
  { id: 'mistralai/mistral-large-4-0', label: 'Mistral Large 4 0 (524K ctx)' },
  { id: 'google/gemini-4-argon', label: 'Gemini 4 Argon (1M ctx)' },
  { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash 1017 (1M ctx)' },
  { id: 'minimax/minimax-m3.1-flash', label: 'MiniMax M3.1 Flash (1M ctx)' },
  { id: 'meta/muse-spark-open', label: 'Muse Spark Open (1M ctx)' },
  { id: 'meta/muse-wonder', label: 'Muse Wonder (1M ctx)' },
]

/** Curated DeepSeek chat models (https://api.deepseek.com). */
export const DEEPSEEK_LLM_PRESET_MODELS: CloudLlmPreset[] = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (coding)' },
  { id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash (fast)' },
]

/** Curated OpenAI chat models (https://api.openai.com/v1). Bare ids, not OpenRouter `openai/` routes. */
export const OPENAI_LLM_PRESET_MODELS: CloudLlmPreset[] = [
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol (flagship · coding)' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra (balanced)' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna (fast · cheap)' },
  { id: 'gpt-5.6-sol-pro', label: 'GPT-5.6 Sol Pro' },
  { id: 'gpt-5.6-terra-pro', label: 'GPT-5.6 Terra Pro' },
  { id: 'gpt-5.6-luna-pro', label: 'GPT-5.6 Luna Pro' },
]

/** Curated NVIDIA NIM chat models (integrate.api.nvidia.com/v1/models). */
export const NVIDIA_LLM_PRESET_MODELS: CloudLlmPreset[] = [
  { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3 Ultra 550B' },
  { id: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6' },
  { id: 'google/gemma-4-31b-it', label: 'Gemma 4 31B IT' },
  { id: 'meta/muse-glimmer-30b', label: 'Muse Glimmer 30B' },
  { id: 'poolside/laguna-xs-2.1', label: 'Laguna XS 2.1' },
  { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash' },
  { id: 'deepseek-ai/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
  { id: 'z-ai/glm-5.3', label: 'GLM 5.3' },
  { id: 'stepfun-ai/step-5-preview', label: 'Step 5 Preview' },
  { id: 'nvidia/nemotron-3.5-super-vl-120b-a12b', label: 'Nemotron 3.5 Super VL 120B A12B' },
]

/**
 * OpenCode Go models on OpenAI-compatible `/v1/chat/completions`
 * (https://opencode.ai/docs/go/). Anthropic `/messages` models (Claude Haiku 5.5, MiniMax,
 * some Qwen) are listed here too, and `openCodeGoApiStyle` routes them to `/messages`.
 *
 * Responses-API models (the Contributor tier, e.g. Muse Spark 1.2 Contributor) have no
 * published ids, so they are not preset entries: paste the slug from the Go dashboard into
 * the custom model field and `openCodeGoApiStyle` routes it to `{base}/responses`.
 */
export const OPENCODE_GO_LLM_PRESET_MODELS: CloudLlmPreset[] = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (coding)' },
  { id: 'longcat-2.0', label: 'LongCat 2.0 (1M ctx)' },
  { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
  { id: 'kimi-k2.6', label: 'Kimi K2.6' },
  { id: 'kimi-k3', label: 'Kimi K3' },
  { id: 'glm-5.3', label: 'GLM 5.3' },
  { id: 'glm-5.2', label: 'GLM 5.2' },
  { id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro' },
  { id: 'mimo-v2.5', label: 'MiMo V2.5' },
  { id: 'hy3', label: 'Hy3' },
  { id: 'glm-5.3-flash', label: 'GLM 5.3 Flash (1M ctx)' },
  { id: 'hy4-preview', label: 'Hy4 Preview (1M ctx)' },
  { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (1M ctx)' },
  { id: 'mimo-v2.6-flash', label: 'MiMo V2.6 Flash (1M ctx)' },
  { id: 'mimo-v2.6-pro', label: 'MiMo V2.6 Pro (1M ctx)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (Anthropic Messages)' },
  { id: 'qwen3.8-flash', label: 'Qwen3.8 Flash (1M ctx · Anthropic Messages)' },
  { id: 'qwen3.8-max', label: 'Qwen3.8 Max (1M ctx · Anthropic Messages)' },
  { id: 'omen-alpha', label: 'Omen Alpha' },
  { id: 'gpt-5.6-luna', label: 'GPT 5.6 Luna (1.1M ctx · Responses)' },
  { id: 'gpt-6-luna', label: 'GPT 6 Luna (1.1M ctx · Responses)' },
  { id: 'muse-spark-1.2-contributor', label: 'Muse Spark 1.2 Contributor (1M ctx · Responses)' },
  { id: 'muse-spark-1.3-contributor', label: 'Muse Spark 1.3 Contributor (1M ctx · Responses)' },
  { id: 'beam-free', label: 'Beam Free (1M ctx)' },
  { id: 'kimi-k3.1-pro', label: 'Kimi K3.1 Pro (1M ctx)' },
  { id: 'iceman-contributor-free', label: 'Iceman Contributor Free (262K ctx)' },
  { id: 'step-5-preview', label: 'Step 5 Preview (1M ctx)' },
  { id: 'grok-4.7', label: 'Grok 4.7 (500K ctx · Responses)' },
]

/**
 * Wire format for a provider/model pair.
 * `anthropic-messages` posts to `{base}/messages`; `opencode-responses` to `{base}/responses`.
 */
export type CloudLlmApiStyle = 'openai-chat' | 'anthropic-messages' | 'opencode-responses'

/** OpenCode Go models served only on Anthropic `/zen/go/v1/messages` (https://opencode.ai/docs/go/). */
const OPENCODE_GO_ANTHROPIC_MESSAGES_MODELS: ReadonlySet<string> = new Set([
  'claude-haiku-5-5',
  'minimax-m3',
  'minimax-m2.7',
  'qwen3.8-max',
  'qwen3.8-flash',
  'qwen3.7-plus',
])

/**
 * OpenCode Go families served only on the Responses API (`{base}/responses`).
 *
 * Mirrors `OPENCODE_RESPONSES_FAMILIES` in scripts/check-models.mjs, which resolves the
 * endpoint from models.dev (`provider.npm === '@ai-sdk/openai'`) and falls back to the
 * families the Go docs pin to that endpoint. Against the live catalog (39 models) it is
 * exactly six: grok-4.6, grok-4.7, muse-spark-1.2-contributor, muse-spark-1.3-contributor,
 * gpt-5.6-luna, gpt-6-luna.
 */
const OPENCODE_GO_RESPONSES_FAMILIES: readonly RegExp[] = [
  /^grok/i,
  /^muse-spark/i,
  /^gpt-[0-9.]+-luna/i,
]

/**
 * Per-id pins for a Responses-only model that matches none of the families above.
 * `npm run check:models --apply` writes here; empty while the families cover the catalog.
 */
const OPENCODE_GO_RESPONSES_MODELS: ReadonlySet<string> = new Set<string>([])

/**
 * Wire formats learned at runtime. OpenCode Go answers `/chat/completions` with a
 * `ModelProtocolUnsupported` 400 for models it only serves elsewhere; the caller replays
 * the turn on the format that worked and records it here. That keeps a model the static
 * rules do not know from burning a failed request on every single turn.
 *
 * In-memory on purpose: the probe is one extra request per model per app run, and a stale
 * hint never survives a restart.
 */
const discoveredOpenCodeGoStyles = new Map<string, CloudLlmApiStyle>()

/** Remember the wire format a model turned out to speak, so routing stops probing. */
export function rememberOpenCodeGoApiStyle(model: string, style: CloudLlmApiStyle): void {
  const id = normalizeOpenCodeGoModelId(model)
  if (id) discoveredOpenCodeGoStyles.set(id, style)
}

/** True when an OpenCode Go model is *statically* known to speak the Responses API. */
export function isOpenCodeGoResponsesModel(model: string): boolean {
  const id = normalizeOpenCodeGoModelId(model)
  if (OPENCODE_GO_RESPONSES_MODELS.has(id)) return true
  return OPENCODE_GO_RESPONSES_FAMILIES.some((re) => re.test(id))
}

export function openCodeGoApiStyle(model: string): CloudLlmApiStyle {
  const id = normalizeOpenCodeGoModelId(model)
  if (OPENCODE_GO_ANTHROPIC_MESSAGES_MODELS.has(id)) return 'anthropic-messages'
  const discovered = discoveredOpenCodeGoStyles.get(id)
  if (discovered) return discovered
  if (isOpenCodeGoResponsesModel(id)) return 'opencode-responses'
  return 'openai-chat'
}

const OPENROUTER_MODEL_ALIASES: Record<string, string> = {
  'minimax/minimax-m2.5:free': 'minimax/minimax-m2.5',
  'moonshotai/kimi-k2.6:free': 'moonshotai/kimi-k2.6',
  'baidu/cobuddy:free': 'openrouter/free',
  'z-ai/glm-4.7': 'z-ai/glm-4.7-flash',
}

// DeepSeek retired the V4 Flash ids (and the legacy chat/reasoner pair): the API still accepts
// them but serves DeepSeek-V4.1-Flash, so every saved setting lands on the canonical id.
const DEEPSEEK_MODEL_ALIASES: Record<string, string> = {
  'deepseek-chat': 'deepseek-flash',
  'deepseek-reasoner': 'deepseek-flash',
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  'deepseek/deepseek-v4-pro': 'deepseek-v4-pro',
  'deepseek/deepseek-v4-flash': 'deepseek-flash',
}

const NVIDIA_MODEL_ALIASES: Record<string, string> = {
  'z-ai/glm5': 'z-ai/glm-5.2',
  'z-ai/glm4.7': 'z-ai/glm-5.2',
  'z-ai/glm-4.7': 'z-ai/glm-5.2',
  'stepfun-ai/step-3.5-flash': 'stepfun-ai/step-3.7-flash',
}

export function normalizeOpenRouterModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return OPENROUTER_LLM_PRESET_MODELS[0]?.id ?? 'openrouter/free'
  return OPENROUTER_MODEL_ALIASES[trimmed] ?? trimmed
}

export function normalizeDeepSeekModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return DEEPSEEK_LLM_PRESET_MODELS[0]?.id ?? 'deepseek-v4-pro'
  return DEEPSEEK_MODEL_ALIASES[trimmed] ?? trimmed
}

export function isDeepSeekModelId(model: string): boolean {
  const trimmed = model.trim().toLowerCase()
  if (!trimmed) return false
  if (trimmed.startsWith('deepseek-')) return true
  return (
    trimmed in DEEPSEEK_MODEL_ALIASES || DEEPSEEK_LLM_PRESET_MODELS.some((m) => m.id === trimmed)
  )
}

const OPENAI_MODEL_ALIASES: Record<string, string> = {
  'openai/gpt-5.6-sol': 'gpt-5.6-sol',
  'openai/gpt-5.6-terra': 'gpt-5.6-terra',
  'openai/gpt-5.6-luna': 'gpt-5.6-luna',
  'openai/gpt-5.6-sol-pro': 'gpt-5.6-sol-pro',
  'openai/gpt-5.6-terra-pro': 'gpt-5.6-terra-pro',
  'openai/gpt-5.6-luna-pro': 'gpt-5.6-luna-pro',
}

export function normalizeOpenAiModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return OPENAI_LLM_PRESET_MODELS[0]?.id ?? 'gpt-5.6-sol'
  if (OPENAI_MODEL_ALIASES[trimmed]) return OPENAI_MODEL_ALIASES[trimmed]
  if (trimmed.startsWith('openai/'))
    return (
      trimmed.slice('openai/'.length).trim() || OPENAI_LLM_PRESET_MODELS[0]?.id || 'gpt-5.6-sol'
    )
  return trimmed
}

export function isOpenAiModelId(model: string): boolean {
  const trimmed = model.trim().toLowerCase()
  if (!trimmed) return false
  if (trimmed.startsWith('openai/')) return true
  if (
    trimmed.startsWith('gpt-') ||
    trimmed.startsWith('o1') ||
    trimmed.startsWith('o3') ||
    trimmed.startsWith('o4')
  ) {
    return true
  }
  return OPENAI_LLM_PRESET_MODELS.some((m) => m.id === trimmed)
}

export function normalizeNvidiaModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return NVIDIA_LLM_PRESET_MODELS[0]?.id ?? 'nvidia/nemotron-3-super-120b-a12b'
  return NVIDIA_MODEL_ALIASES[trimmed] ?? trimmed
}

const OPENCODE_GO_MODEL_ALIASES: Record<string, string> = {
  'deepseek/deepseek-v4-pro': 'deepseek-v4-pro',
  // Go dropped the V4 Flash ids and serves V4.1 Flash instead. The bare ids matter most: they
  // were preset entries, so saved settings still hold them and must not resolve to a dead model.
  'deepseek-v4-flash': 'deepseek-v4.1-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-v4.1-flash',
  'deepseek/deepseek-v4-flash': 'deepseek-v4.1-flash',
  'deepseek/deepseek-v4-flash-vision-exp': 'deepseek-v4.1-flash',
  'stealth/ox-alpha': 'ox-alpha-free',
  'meituan/longcat-2.0': 'longcat-2.0',
  'moonshotai/kimi-k2.7-code': 'kimi-k2.7-code',
  'moonshotai/kimi-k2.6': 'kimi-k2.6',
  'moonshotai/kimi-k3': 'kimi-k3',
  'z-ai/glm-5.3': 'glm-5.3',
  'z-ai/glm-5.2': 'glm-5.2',
  'z-ai/glm-5.1': 'glm-5.1',
  'tencent/hy3': 'hy3',
  'anthropic/claude-haiku-5-5': 'claude-haiku-5-5',
  'opencode-go/claude-haiku-5-5': 'claude-haiku-5-5',
}

export function normalizeOpenCodeGoModelId(model: string): string {
  const trimmed = model.trim()
  if (!trimmed) return OPENCODE_GO_LLM_PRESET_MODELS[0]?.id ?? 'deepseek-v4-pro'
  return OPENCODE_GO_MODEL_ALIASES[trimmed] ?? trimmed
}

/** OpenRouter route suffixes after `provider/model:` (not Ollama tags). */
const OPENROUTER_ROUTE_VARIANTS = new Set(['free', 'nitro', 'floor', 'exacto', 'extended'])

export type SubAgentProviderId =
  'ollama' | 'openrouter' | 'deepseek' | 'openai' | 'nvidia' | 'opencode-go'

const SUB_AGENT_PROVIDERS: ReadonlySet<SubAgentProviderId> = new Set([
  'ollama',
  'openrouter',
  'deepseek',
  'openai',
  'nvidia',
  'opencode-go',
])

export function isSubAgentProviderId(
  value: string | null | undefined,
): value is SubAgentProviderId {
  return typeof value === 'string' && SUB_AGENT_PROVIDERS.has(value as SubAgentProviderId)
}

/**
 * Resolve which backend a sub-agent model id should hit.
 *
 * Ollama supports namespaced ids like `sorc/qwen…:9b` (both `/` and `:`).
 * OpenRouter uses `org/model` and optional route variants like `:free`.
 * Prefer an explicit provider from settings when present.
 */
export function detectSubAgentProvider(
  model: string,
  explicit?: SubAgentProviderId | null,
): SubAgentProviderId {
  if (isSubAgentProviderId(explicit)) {
    return explicit
  }
  if (!model) return 'ollama'
  if (isDeepSeekModelId(model)) return 'deepseek'
  // Bare gpt-* / o-series without org/ prefix → native OpenAI (not OpenRouter openai/…)
  if (!model.includes('/') && isOpenAiModelId(model)) return 'openai'

  const hasColon = model.includes(':')
  const hasSlash = model.includes('/')

  // Classic Ollama tags: llava:13b, mistral:latest
  if (hasColon && !hasSlash) return 'ollama'

  // Both `/` and `:` — disambiguate OpenRouter variants vs Ollama namespace/name:tag
  if (hasColon && hasSlash) {
    const variant = model.slice(model.lastIndexOf(':') + 1).toLowerCase()
    if (OPENROUTER_ROUTE_VARIANTS.has(variant)) return 'openrouter'
    return 'ollama'
  }

  // Slash without colon → OpenRouter-style org/model (also covers many NVIDIA routes)
  return 'openrouter'
}
