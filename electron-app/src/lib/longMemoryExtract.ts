import { streamOllamaChat, type OllamaModelOptions } from '@/lib/ollama'
import { ollamaMessagesToOpenRouter, streamOpenRouterChat } from '@/lib/openrouter'
import type { LongMemoryCandidate, LongMemoryKind } from '@/types/longMemory'

type Turn = { role: 'user' | 'assistant'; content: string }

type ExtractParams = {
  provider: 'ollama' | 'openrouter'
  ollamaBaseUrl: string
  ollamaModel: string
  openrouterBaseUrl: string
  openrouterApiKey: string
  openrouterModel: string
  modelOptions?: OllamaModelOptions
  turns: Turn[]
  signal?: AbortSignal
}

const allowedKinds = new Set<LongMemoryKind>(['preference', 'project', 'fact', 'constraint', 'task'])
const lowSignalSecrets = [
  /api[_-]?key/i,
  /token/i,
  /password/i,
  /secret/i,
  /bearer\s+[a-z0-9\-_\.]+/i,
  /sk-[a-z0-9]+/i,
]

function transcript(turns: Turn[]): string {
  return turns
    .map((t) => `${t.role === 'user' ? 'USER' : 'ASSISTANT'}: ${t.content.trim()}`)
    .join('\n\n')
    .slice(0, 24000)
}

export function extractJsonArray(raw: string): unknown[] {
  const text = raw.trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim()
  const source = fenced || text
  const start = source.indexOf('[')
  const end = source.lastIndexOf(']')
  if (start < 0 || end < start) return []
  const body = source.slice(start, end + 1)
  try {
    const parsed = JSON.parse(body)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function sanitizeCandidate(raw: unknown): LongMemoryCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = typeof r.kind === 'string' ? r.kind.trim().toLowerCase() as LongMemoryKind : 'fact'
  if (!allowedKinds.has(kind)) return null
  const text = typeof r.text === 'string' ? r.text.trim().replace(/\s+/g, ' ') : ''
  if (!text || text.length < 6) return null
  for (const re of lowSignalSecrets) {
    if (re.test(text)) return null
  }
  const tags = Array.isArray(r.tags)
    ? r.tags.map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 12)
    : []
  const importance = Number.isFinite(Number(r.importance)) ? Number(r.importance) : 0.5
  const confidence = Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : 0.7
  if (confidence < 0.35) return null
  return {
    kind,
    text: text.slice(0, 400),
    tags,
    importance: Math.max(0, Math.min(1, importance)),
    confidence: Math.max(0, Math.min(1, confidence)),
  }
}

export async function extractLongMemoryCandidates(params: ExtractParams): Promise<LongMemoryCandidate[]> {
  const convo = transcript(params.turns)
  if (!convo.trim()) return []
  const system = [
    'You extract durable user memory from a chat transcript.',
    'Return ONLY strict JSON array, no prose.',
    'Keep only stable and useful items for future chats.',
    'Never include secrets, credentials, tokens, private keys, passwords.',
  ].join(' ')
  const user = [
    'Extract up to 10 memory items.',
    'Schema per item: {"kind":"preference|project|fact|constraint|task","text":"...","tags":["..."],"importance":0..1,"confidence":0..1}.',
    'Only include facts likely to remain useful beyond this chat.',
    '',
    'Transcript:',
    convo,
  ].join('\n')

  let raw = ''
  if (params.provider === 'openrouter') {
    const out = await streamOpenRouterChat({
      baseUrl: params.openrouterBaseUrl,
      apiKey: params.openrouterApiKey,
      model: params.openrouterModel,
      messages: ollamaMessagesToOpenRouter([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]),
      modelOptions: { ...params.modelOptions, temperature: 0.1 },
      signal: params.signal,
      onDelta: () => undefined,
    })
    raw = out.content
  } else {
    const out = await streamOllamaChat({
      baseUrl: params.ollamaBaseUrl,
      model: params.ollamaModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      modelOptions: { ...params.modelOptions, temperature: 0.1 },
      signal: params.signal,
      onDelta: () => undefined,
    })
    raw = out.content
  }

  const parsed = extractJsonArray(raw)
  const cleaned = parsed.map(sanitizeCandidate).filter((x): x is LongMemoryCandidate => Boolean(x))
  const dedup = new Map<string, LongMemoryCandidate>()
  for (const c of cleaned) {
    const key = `${c.kind}:${c.text.toLowerCase()}`
    const prev = dedup.get(key)
    if (!prev || (c.confidence ?? 0) > (prev.confidence ?? 0)) dedup.set(key, c)
  }
  return Array.from(dedup.values()).slice(0, 10)
}
