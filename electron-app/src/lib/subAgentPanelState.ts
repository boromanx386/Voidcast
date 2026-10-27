/**
 * Ephemeral UI state for the in-chat Sub-agent activity card.
 * Not persisted — rebuilt from live callbacks during a turn.
 */

export type SubAgentPanelKind = 'idle' | 'vision' | 'explore' | 'workers'

export type SubAgentPanelLevel = 'info' | 'ok' | 'warn' | 'err'

export type SubAgentPanelEvent = {
  id: string
  at: number
  text: string
  level: SubAgentPanelLevel
  workerId?: string
}

/** What one worker cost: wall time, model rounds and tokens. Filled when it finishes. */
export type SubAgentWorkerMetrics = {
  durationMs: number
  /** Time spent waiting on the model, summed over rounds. */
  modelMs: number
  rounds: number
  toolCalls: number
  promptTokens: number
  completionTokens: number
  cachedPromptTokens: number
  /** Rounds whose response carried no usage; when > 0 the token totals are a lower bound. */
  unreportedRounds: number
}

export type SubAgentWorkerSlot = {
  id: string
  label: string
  status: 'running' | 'done' | 'error'
  /** e.g. "3/50" */
  progress?: string
  lastLine?: string
  metrics?: SubAgentWorkerMetrics
}

function compactCount(n: number): string {
  return n >= 10_000
    ? `${Math.round(n / 1000)}k`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n)
}

/** One-line cost summary, e.g. "24s · 6 rounds · 9 tools · 18.2k in (12k cached) / 1.1k out". */
export function formatWorkerMetrics(m: SubAgentWorkerMetrics): string {
  const secs =
    m.durationMs >= 10_000 ? Math.round(m.durationMs / 1000) : +(m.durationMs / 1000).toFixed(1)
  const lowerBound = m.unreportedRounds > 0 ? '≥' : ''
  const cached = m.cachedPromptTokens > 0 ? ` (${compactCount(m.cachedPromptTokens)} cached)` : ''
  return [
    `${secs}s`,
    `${m.rounds} round${m.rounds === 1 ? '' : 's'}`,
    `${m.toolCalls} tool${m.toolCalls === 1 ? '' : 's'}`,
    `${lowerBound}${compactCount(m.promptTokens)} in${cached} / ${lowerBound}${compactCount(m.completionTokens)} out`,
  ].join(' · ')
}

function normalizeWorkerMetrics(raw: unknown): SubAgentWorkerMetrics | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  return {
    durationMs: num(o.durationMs),
    modelMs: num(o.modelMs),
    rounds: num(o.rounds),
    toolCalls: num(o.toolCalls),
    promptTokens: num(o.promptTokens),
    completionTokens: num(o.completionTokens),
    cachedPromptTokens: num(o.cachedPromptTokens),
    unreportedRounds: num(o.unreportedRounds),
  }
}

export type SubAgentPanelState = {
  open: boolean
  busy: boolean
  collapsed: boolean
  kind: SubAgentPanelKind
  title: string
  /** Primary progress line for header (e.g. "image 2/4", "round 3/8") */
  progress: string
  /** Latest status or final digest body */
  text: string
  events: SubAgentPanelEvent[]
  workers: SubAgentWorkerSlot[]
}

const MAX_EVENTS = 40

export function emptySubAgentPanelState(): SubAgentPanelState {
  return {
    open: false,
    busy: false,
    collapsed: false,
    kind: 'idle',
    title: 'SUB_AGENT',
    progress: '',
    text: '',
    events: [],
    workers: [],
  }
}

let eventSeq = 0
function nextEventId(): string {
  eventSeq += 1
  return `sae-${Date.now()}-${eventSeq}`
}

function pushEvent(
  events: SubAgentPanelEvent[],
  text: string,
  level: SubAgentPanelLevel = 'info',
  workerId?: string,
): SubAgentPanelEvent[] {
  const next = [...events, { id: nextEventId(), at: Date.now(), text, level, workerId }]
  return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
}

export type ParsedCodingLabel = {
  kind: SubAgentPanelKind
  title: string
  progress: string
  workerId?: string
  workerLabel?: string
  raw: string
}

/**
 * Parse labels emitted by explore / workers / vision callbacks.
 * e.g. "WORKER 1 · 3/50", "SUB_AGENT · EXPLORE (2/8)", "WORKERS 1–2 · starting"
 */
export function parseCodingStartLabel(label: string): ParsedCodingLabel {
  const raw = label.trim()
  const workerMatch = raw.match(/^WORKER\s+(\d+)\s*[·•]\s*(.+)$/i)
  if (workerMatch) {
    const n = workerMatch[1]!
    const rest = workerMatch[2]!.trim()
    return {
      kind: 'workers',
      title: `WORKER ${n}`,
      progress: rest,
      workerId: `worker-${n}`,
      workerLabel: `Worker ${n}`,
      raw,
    }
  }
  if (/^WORKERS\b/i.test(raw)) {
    return {
      kind: 'workers',
      title: 'WORKERS',
      progress: raw.replace(/^WORKERS\s*/i, '').replace(/^[·•]\s*/, ''),
      raw,
    }
  }
  const exploreMatch = raw.match(/EXPLORE\s*\((\d+)\s*\/\s*(\d+)\)/i)
  if (exploreMatch || /EXPLORE/i.test(raw)) {
    return {
      kind: 'explore',
      title: 'EXPLORE',
      progress: exploreMatch ? `${exploreMatch[1]}/${exploreMatch[2]}` : raw,
      raw,
    }
  }
  return {
    kind: 'workers',
    title: 'CODING',
    progress: raw,
    raw,
  }
}

export function applyVisionStart(prev: SubAgentPanelState, imageCount: number): SubAgentPanelState {
  const text = `Analyzing ${imageCount} image(s)…`
  return {
    ...prev,
    open: true,
    busy: true,
    collapsed: false,
    kind: 'vision',
    title: 'VISION',
    progress: `0/${imageCount}`,
    text,
    events: pushEvent(prev.kind === 'vision' && prev.busy ? prev.events : [], text, 'info'),
    workers: [],
  }
}

export function applyVisionProgress(
  prev: SubAgentPanelState,
  current: number,
  total: number,
): SubAgentPanelState {
  const text = `Image ${current}/${total}…`
  return {
    ...prev,
    open: true,
    busy: true,
    kind: 'vision',
    title: 'VISION',
    progress: `${current}/${total}`,
    text,
    events: pushEvent(prev.events, text, 'info'),
  }
}

export function applyVisionDone(prev: SubAgentPanelState, formatted: string): SubAgentPanelState {
  const text = formatted.trim() || '[Sub-agent returned no descriptions.]'
  const level: SubAgentPanelLevel = /error/i.test(text) ? 'err' : 'ok'
  return {
    ...prev,
    open: true,
    busy: false,
    collapsed: true,
    kind: 'vision',
    title: 'VISION',
    progress: 'done',
    text,
    events: pushEvent(prev.events, 'Vision analysis complete', level),
  }
}

export function applyCodingStart(prev: SubAgentPanelState, label: string): SubAgentPanelState {
  const parsed = parseCodingStartLabel(label)
  const isNewBatch =
    parsed.kind === 'workers' && !parsed.workerId && /1\s*[–-]\s*2|starting/i.test(parsed.raw)
  const isNewExplore = parsed.kind === 'explore' && (!prev.busy || prev.kind !== 'explore')
  const isNewWorkerPass =
    isNewBatch ||
    (parsed.kind === 'workers' && parsed.workerId && (!prev.busy || prev.kind !== 'workers'))

  let workers = prev.workers
  let events = prev.events

  if (isNewBatch || isNewExplore || (isNewWorkerPass && !parsed.workerId)) {
    workers = []
    events = []
  }

  if (parsed.kind === 'workers' && parsed.workerId) {
    if (!prev.busy || prev.kind !== 'workers') {
      workers = []
      events = []
    }
    const existing = workers.find((w) => w.id === parsed.workerId)
    const slot: SubAgentWorkerSlot = {
      id: parsed.workerId,
      label: parsed.workerLabel || parsed.title,
      status: 'running',
      progress: parsed.progress,
      lastLine: parsed.progress,
    }
    workers = existing
      ? workers.map((w) => (w.id === parsed.workerId ? { ...w, ...slot } : w))
      : [...workers, slot]
  } else if (isNewBatch) {
    workers = [
      { id: 'worker-1', label: 'Worker 1', status: 'running', progress: 'starting' },
      { id: 'worker-2', label: 'Worker 2', status: 'running', progress: 'starting' },
    ]
  }

  return {
    ...prev,
    open: true,
    busy: true,
    collapsed: false,
    kind: parsed.kind,
    title: parsed.kind === 'explore' ? 'EXPLORE' : parsed.kind === 'workers' ? 'WORKERS' : 'CODING',
    progress: parsed.progress,
    text: label,
    events: pushEvent(events, label, 'info', parsed.workerId),
    workers,
  }
}

/**
 * Append one live activity line from a running coding sub-agent (worker wrote a
 * file, typecheck result, steer received, …). Never opens/closes the card and
 * never flips `busy` — it is purely additive to the event log and, when the
 * event names a worker, to that worker's slot. A `status` transition (worker
 * finished / failed) flips only that worker's slot: the batch stays busy until
 * the final `onCodingDone`, so the card cannot collapse while a sibling runs.
 */
export function applyCodingEvent(
  prev: SubAgentPanelState,
  event: {
    workerId?: string
    text: string
    level?: SubAgentPanelLevel
    status?: SubAgentWorkerSlot['status']
    metrics?: SubAgentWorkerMetrics
  },
): SubAgentPanelState {
  const text = event.text.trim()
  if (!text) return prev
  const level = event.level ?? 'info'
  const workers = event.workerId
    ? prev.workers.map((w) =>
        w.id === event.workerId
          ? {
              ...w,
              lastLine: text,
              ...(event.metrics ? { metrics: event.metrics } : {}),
              ...(event.status
                ? {
                    status: event.status,
                    progress: event.status === 'running' ? w.progress : event.status,
                  }
                : {}),
            }
          : w,
      )
    : prev.workers
  return {
    ...prev,
    text,
    workers,
    events: pushEvent(prev.events, text, level, event.workerId),
  }
}

/** Apply final coding digest; extract per-worker blocks when present. */
export function applyCodingDone(prev: SubAgentPanelState, formatted: string): SubAgentPanelState {
  const text = formatted.trim() || '[Sub-agent returned no digest.]'
  const isErr = /^\s*error\b/i.test(text) || /\berror\s*:/i.test(text)
  const isPartial = /round budget|max rounds|without done|synthesized|stopped at/i.test(text)

  let workers = prev.workers.map((w) => ({
    ...w,
    status: (isErr ? 'error' : 'done') as SubAgentWorkerSlot['status'],
  }))

  // "---\nWORKER 1:\n..." or "WORKER 1:\n"
  const blocks = text
    .split(/\n---\n|\n---\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
  const workerUpdates: SubAgentWorkerSlot[] = []
  for (const block of blocks) {
    const m = block.match(/^WORKER\s+(\d+)\s*:?\s*([\s\S]*)$/i)
    if (!m) continue
    const n = m[1]!
    const body = (m[2] || '').trim()
    const id = `worker-${n}`
    const err = /^\s*error\b/i.test(body) || /\berror\s*:/i.test(body)
    const partial = /round budget|max rounds|without done/i.test(body)
    workerUpdates.push({
      id,
      label: `Worker ${n}`,
      status: err ? 'error' : 'done',
      progress: err ? 'error' : partial ? 'partial' : 'done',
      lastLine: body.split('\n')[0]?.slice(0, 120) || (err ? 'failed' : 'done'),
    })
  }
  if (workerUpdates.length > 0) {
    const byId = new Map(workers.map((w) => [w.id, w]))
    for (const u of workerUpdates) byId.set(u.id, { ...byId.get(u.id), ...u })
    workers = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  // With per-worker slots the batch verdict comes from the slots themselves:
  // one worker's failure must not mark a clean sibling as errored (or vice versa).
  const hasWorkers = workers.length > 0
  const anyWorkerErr = hasWorkers && workers.some((w) => w.status === 'error')
  const panelErr = hasWorkers ? anyWorkerErr : isErr
  const level: SubAgentPanelLevel = panelErr ? 'err' : isPartial ? 'warn' : 'ok'
  const summary =
    workers.length > 1
      ? anyWorkerErr
        ? `Workers finished with errors (${workers.length})`
        : `Workers finished (${workers.length})`
      : prev.kind === 'explore'
        ? 'Explore complete'
        : 'Sub-agent complete'

  return {
    ...prev,
    open: true,
    busy: false,
    collapsed: true,
    kind: prev.kind === 'idle' ? (workers.length ? 'workers' : 'explore') : prev.kind,
    title: prev.kind === 'explore' ? 'EXPLORE' : workers.length ? 'WORKERS' : prev.title,
    progress: panelErr ? 'error' : isPartial ? 'partial' : 'done',
    text,
    events: pushEvent(prev.events, summary, level),
    workers,
  }
}

export function closeSubAgentPanel(_prev: SubAgentPanelState): SubAgentPanelState {
  return emptySubAgentPanelState()
}

export function setSubAgentPanelCollapsed(
  prev: SubAgentPanelState,
  collapsed: boolean,
): SubAgentPanelState {
  return { ...prev, collapsed }
}

export function formatSubAgentTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return ''
  }
}

/** Persistable snapshot: drop transient open=false, cap events. */
export function normalizeSubAgentActivity(raw: unknown): SubAgentPanelState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Partial<SubAgentPanelState>
  if (o.open === false) return undefined
  const kind =
    o.kind === 'vision' || o.kind === 'explore' || o.kind === 'workers' || o.kind === 'idle'
      ? o.kind
      : 'idle'
  const events = Array.isArray(o.events)
    ? o.events
        .filter(
          (e) => e && typeof e === 'object' && typeof (e as SubAgentPanelEvent).text === 'string',
        )
        .slice(-MAX_EVENTS)
        .map((e) => {
          const ev = e as SubAgentPanelEvent
          return {
            id: typeof ev.id === 'string' ? ev.id : nextEventId(),
            at: typeof ev.at === 'number' ? ev.at : Date.now(),
            text: String(ev.text).slice(0, 500),
            level:
              ev.level === 'ok' || ev.level === 'warn' || ev.level === 'err' || ev.level === 'info'
                ? ev.level
                : 'info',
            ...(typeof ev.workerId === 'string' ? { workerId: ev.workerId } : {}),
          }
        })
    : []
  const workers = Array.isArray(o.workers)
    ? o.workers
        .filter(
          (w) => w && typeof w === 'object' && typeof (w as SubAgentWorkerSlot).id === 'string',
        )
        .slice(0, 4)
        .map((w) => {
          const slot = w as SubAgentWorkerSlot
          return {
            id: slot.id,
            label: typeof slot.label === 'string' ? slot.label.slice(0, 40) : slot.id,
            status:
              slot.status === 'done' || slot.status === 'error' || slot.status === 'running'
                ? slot.status
                : 'done',
            ...(typeof slot.progress === 'string' ? { progress: slot.progress.slice(0, 40) } : {}),
            ...(typeof slot.lastLine === 'string' ? { lastLine: slot.lastLine.slice(0, 160) } : {}),
            ...(normalizeWorkerMetrics(slot.metrics)
              ? { metrics: normalizeWorkerMetrics(slot.metrics) }
              : {}),
          }
        })
    : []
  const text = typeof o.text === 'string' ? o.text.slice(0, 12_000) : ''
  return {
    open: true,
    busy: false,
    collapsed: o.collapsed !== false,
    kind,
    title: typeof o.title === 'string' ? o.title.slice(0, 40) : 'SUB_AGENT',
    progress: typeof o.progress === 'string' ? o.progress.slice(0, 80) : '',
    text,
    events,
    workers,
  }
}
