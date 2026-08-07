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

export type SubAgentWorkerSlot = {
  id: string
  label: string
  status: 'running' | 'done' | 'error'
  /** e.g. "3/50" */
  progress?: string
  lastLine?: string
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
  const next = [
    ...events,
    { id: nextEventId(), at: Date.now(), text, level, workerId },
  ]
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

export function applyVisionStart(
  prev: SubAgentPanelState,
  imageCount: number,
): SubAgentPanelState {
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
    events: pushEvent(
      prev.kind === 'vision' && prev.busy ? prev.events : [],
      text,
      'info',
    ),
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

export function applyVisionDone(
  prev: SubAgentPanelState,
  formatted: string,
): SubAgentPanelState {
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

export function applyCodingStart(
  prev: SubAgentPanelState,
  label: string,
): SubAgentPanelState {
  const parsed = parseCodingStartLabel(label)
  const isNewBatch =
    parsed.kind === 'workers' &&
    !parsed.workerId &&
    /1\s*[–-]\s*2|starting/i.test(parsed.raw)
  const isNewExplore =
    parsed.kind === 'explore' &&
    (!prev.busy || prev.kind !== 'explore')
  const isNewWorkerPass =
    isNewBatch ||
    (parsed.kind === 'workers' &&
      parsed.workerId &&
      (!prev.busy || prev.kind !== 'workers'))

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

/** Apply final coding digest; extract per-worker blocks when present. */
export function applyCodingDone(
  prev: SubAgentPanelState,
  formatted: string,
): SubAgentPanelState {
  const text = formatted.trim() || '[Sub-agent returned no digest.]'
  const isErr = /^\s*error\b/i.test(text) || /\berror\s*:/i.test(text)
  const isPartial = /round budget|max rounds|without done|synthesized|stopped at/i.test(text)

  let workers = prev.workers.map((w) => ({
    ...w,
    status: (isErr ? 'error' : 'done') as SubAgentWorkerSlot['status'],
  }))

  // "---\nWORKER 1:\n..." or "WORKER 1:\n"
  const blocks = text.split(/\n---\n|\n---\s*\n/).map((b) => b.trim()).filter(Boolean)
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

  const level: SubAgentPanelLevel = isErr ? 'err' : isPartial ? 'warn' : 'ok'
  const summary =
    workers.length > 1
      ? `Workers finished (${workers.length})`
      : prev.kind === 'explore'
        ? 'Explore complete'
        : 'Sub-agent complete'

  return {
    ...prev,
    open: true,
    busy: false,
    collapsed: true,
    kind: prev.kind === 'idle' ? (workers.length ? 'workers' : 'explore') : prev.kind,
    title:
      prev.kind === 'explore'
        ? 'EXPLORE'
        : workers.length
          ? 'WORKERS'
          : prev.title,
    progress: isErr ? 'error' : isPartial ? 'partial' : 'done',
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
