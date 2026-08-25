import type { LlmProvider } from '@/lib/settings'
import { streamOllamaChat, type OllamaApiMessage, type OllamaModelOptions } from '@/lib/ollama'
import { isOpenAiCompatibleCloudLlmProvider, resolveCloudLlmChatConfigForProvider } from '@/lib/cloudLlm'
import { ollamaMessagesToOpenRouter, streamOpenRouterChat } from '@/lib/openrouter'

type ContextTurn = { role: 'user' | 'assistant'; content: string }

function buildTranscript(turns: ContextTurn[]): string {
  return turns
    .map((t) => `${t.role === 'user' ? 'USER' : 'ASSISTANT'}: ${t.content.trim()}`)
    .join('\n\n')
}

/**
 * Build a compact hidden summary used as internal memory when context is near full.
 * This summary is never shown as a chat message.
 */
export async function compressConversationContext(params: {
  provider: LlmProvider
  ollamaBaseUrl: string
  ollamaModel: string
  openrouterBaseUrl: string
  openrouterApiKey: string
  openrouterModel: string
  openrouterProviderOnly?: string
  nvidiaBaseUrl?: string
  nvidiaApiKey?: string
  nvidiaModel?: string
  deepseekBaseUrl?: string
  deepseekApiKey?: string
  deepseekModel?: string
  openaiBaseUrl?: string
  openaiApiKey?: string
  openaiModel?: string
  opencodeGoBaseUrl?: string
  opencodeGoApiKey?: string
  opencodeGoModel?: string
  crofaiBaseUrl?: string
  crofaiApiKey?: string
  crofaiModel?: string
  turns: ContextTurn[]
  existingSummary?: string
  modelOptions?: OllamaModelOptions
  signal?: AbortSignal
}): Promise<string> {
  const transcript = buildTranscript(params.turns)
  if (!transcript.trim()) return params.existingSummary?.trim() ?? ''

  const system =
    'You are compressing conversation context for an assistant memory buffer. Produce a concise, factual summary for future turns. Keep critical user preferences, constraints, unresolved tasks, concrete facts, and recent decisions. Use short bullet lines. Do not include meta commentary.'
  const userPrompt = [
    'Existing memory summary (may be empty):',
    params.existingSummary?.trim() || '(none)',
    '',
    'Conversation transcript to compress:',
    transcript,
    '',
    'Return only the updated compressed memory.',
  ].join('\n')
  const messages: OllamaApiMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: userPrompt },
  ]
  const modelOptions = { ...params.modelOptions, temperature: 0.2 }

  let content = ''
  if (isOpenAiCompatibleCloudLlmProvider(params.provider)) {
    const cfg = resolveCloudLlmChatConfigForProvider(params.provider, params)
    if (!cfg) return params.existingSummary?.trim() ?? ''
    const out = await streamOpenRouterChat({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages: ollamaMessagesToOpenRouter(messages),
      modelOptions,
      signal: params.signal,
      thinkLevel: params.provider === 'deepseek' ? 'off' : cfg.thinkLevel,
      providerOnly: params.provider === 'openrouter' ? cfg.providerOnly : undefined,
      onDelta: () => undefined,
    })
    content = out.content
  } else {
    const out = await streamOllamaChat({
      baseUrl: params.ollamaBaseUrl,
      model: params.ollamaModel,
      messages,
      modelOptions,
      signal: params.signal,
      onDelta: () => undefined,
    })
    content = out.content
  }
  return content.trim()
}
