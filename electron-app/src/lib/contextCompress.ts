import type { AppSettings, LlmProvider } from '@/lib/settings'
import { isCloudLlmProvider, resolveCloudLlmConfig } from '@/lib/cloudLlm'
import { streamOllamaChat, type OllamaApiMessage, type OllamaModelOptions } from '@/lib/ollama'
import { streamOpenRouterChat } from '@/lib/openrouter'
import { ollamaMessagesToCloudChat } from '@/lib/runwareLlm'

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
  settings: AppSettings
  provider: LlmProvider
  modelOverride?: string
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
  if (isCloudLlmProvider(params.provider)) {
    const cloud = resolveCloudLlmConfig(params.settings, {
      provider: params.provider,
      modelOverride: params.modelOverride,
    })
    if (!cloud) throw new Error('Cloud LLM settings are missing.')
    const out = await streamOpenRouterChat({
      baseUrl: cloud.baseUrl,
      apiKey: cloud.apiKey,
      model: cloud.model,
      messages: ollamaMessagesToCloudChat(messages, cloud.baseUrl, params.provider, cloud.model),
      modelOptions,
      thinkLevel: params.settings.llmThinkLevel,
      signal: params.signal,
      onDelta: () => undefined,
    })
    content = out.content
  } else {
    const out = await streamOllamaChat({
      baseUrl: params.settings.ollamaBaseUrl,
      model: params.modelOverride?.trim() || params.settings.ollamaModel,
      messages,
      modelOptions,
      signal: params.signal,
      onDelta: () => undefined,
    })
    content = out.content
  }
  return content.trim()
}
