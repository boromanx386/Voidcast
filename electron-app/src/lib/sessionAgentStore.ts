/**
 * Session-keyed agent runtime store.
 *
 * One slot per chat session (or the unsaved draft). Agent runs bind to a
 * mutable key handle so auto-save can rekey draft → session id mid-run
 * without losing stream updates or concurrency isolation.
 */
import type { Dispatch, SetStateAction } from 'react'
import { useSyncExternalStore } from 'react'
import { normalizeCodingPathKey } from '@/lib/codingActiveProcesses'
import type { AgentToolActivity, AgentToolUiPhase } from '@/lib/agentToolPhase'
import type { ContextUsageInfo } from '@/lib/contextUsage'
import type { RunwareAudioToolMeta, RunwareImageToolMeta } from '@/lib/runwareMessageMeta'
import type { UiMessage } from '@/types/chat'
import {
  emptySubAgentPanelState,
  type SubAgentPanelState,
} from '@/lib/subAgentPanelState'

/** Runtime key for an unsaved draft chat (no ChatSession id yet). */
export const DRAFT_RUNTIME_KEY = '__draft__'

/** Soft cap on simultaneous agent runs (all chats). */
export const MAX_CONCURRENT_AGENT_RUNS = 3

export type SessionAgentMediaState = {
  assistantGeneratedImages: Record<string, string[]>
  assistantSavedImagePaths: Record<string, string[]>
  assistantImageToolMeta: Record<string, Record<string, RunwareImageToolMeta>>
  assistantImageMessageMeta: Record<string, RunwareImageToolMeta>
  assistantGeneratedAudios: Record<string, string[]>
  assistantSavedAudioPaths: Record<string, string[]>
  assistantAudioToolMeta: Record<string, Record<string, RunwareAudioToolMeta>>
  assistantAudioMessageMeta: Record<string, RunwareAudioToolMeta>
}

export type SessionAgentSlot = {
  messages: UiMessage[]
  busy: boolean
  error: string | null
  toolPhase: AgentToolUiPhase | null
  toolActivities: AgentToolActivity[]
  contextUsageInfo: ContextUsageInfo | null
  contextWarnDismissed: boolean
  contextCompressBusy: boolean
  /** Prevents context-auto-compress from re-firing until usage drops. */
  contextOverflowLatch: boolean
  toolResultBanner: { kind: 'pdf'; text: string } | null
  /** Floating sub-agent analysis panel (legacy ephemeral slot; live UI anchors on messages). */
  subAgentPanel: SubAgentPanelState
  media: SessionAgentMediaState
  /**
   * Frozen coding project path for the in-flight run (if any).
   * Used to block concurrent coding on a different folder.
   */
  codingProjectPath?: string
  /**
   * After Stop, tools may still unwind briefly. Same-path advisory uses this
   * grace window so a second chat is warned about a just-stopped peer.
   */
  codingStopGraceUntil?: number
  /** Ephemeral — not serialised. */
  abortController: AbortController | null
  runId: number
}

/** How long after Stop a slot still counts for same-project advisory (ms). */
export const CODING_STOP_GRACE_MS = 3000

export type SessionAgentKeyHandle = {
  /** Mutable: store.rekey updates this. */
  key: string
}

type Listener = () => void

export type MessageSyncHandler = (sessionId: string, messages: UiMessage[]) => void

function emptyMedia(): SessionAgentMediaState {
  return {
    assistantGeneratedImages: {},
    assistantSavedImagePaths: {},
    assistantImageToolMeta: {},
    assistantImageMessageMeta: {},
    assistantGeneratedAudios: {},
    assistantSavedAudioPaths: {},
    assistantAudioToolMeta: {},
    assistantAudioMessageMeta: {},
  }
}

export function createEmptySessionAgentSlot(
  messages: UiMessage[] = [],
): SessionAgentSlot {
  return {
    messages,
    busy: false,
    error: null,
    toolPhase: null,
    toolActivities: [],
    contextUsageInfo: null,
    contextWarnDismissed: false,
    contextCompressBusy: false,
    contextOverflowLatch: false,
    toolResultBanner: null,
    subAgentPanel: emptySubAgentPanelState(),
    media: emptyMedia(),
    codingProjectPath: undefined,
    codingStopGraceUntil: undefined,
    abortController: null,
    runId: 0,
  }
}

function resolveAction<T>(prev: T, action: SetStateAction<T>): T {
  return typeof action === 'function' ? (action as (p: T) => T)(prev) : action
}

function sessionAgentMediaEqual(a: SessionAgentMediaState, b: SessionAgentMediaState): boolean {
  return (
    a.assistantGeneratedImages === b.assistantGeneratedImages &&
    a.assistantSavedImagePaths === b.assistantSavedImagePaths &&
    a.assistantImageToolMeta === b.assistantImageToolMeta &&
    a.assistantImageMessageMeta === b.assistantImageMessageMeta &&
    a.assistantGeneratedAudios === b.assistantGeneratedAudios &&
    a.assistantSavedAudioPaths === b.assistantSavedAudioPaths &&
    a.assistantAudioToolMeta === b.assistantAudioToolMeta &&
    a.assistantAudioMessageMeta === b.assistantAudioMessageMeta
  )
}

/** Top-level slot equality for no-op update short-circuit. */
function sessionAgentSlotShallowEqual(a: SessionAgentSlot, b: SessionAgentSlot): boolean {
  return (
    a.messages === b.messages &&
    a.busy === b.busy &&
    a.error === b.error &&
    a.toolPhase === b.toolPhase &&
    a.toolActivities === b.toolActivities &&
    a.contextUsageInfo === b.contextUsageInfo &&
    a.contextWarnDismissed === b.contextWarnDismissed &&
    a.contextCompressBusy === b.contextCompressBusy &&
    a.contextOverflowLatch === b.contextOverflowLatch &&
    a.toolResultBanner === b.toolResultBanner &&
    a.subAgentPanel === b.subAgentPanel &&
    a.abortController === b.abortController &&
    a.runId === b.runId &&
    a.codingProjectPath === b.codingProjectPath &&
    a.codingStopGraceUntil === b.codingStopGraceUntil &&
    sessionAgentMediaEqual(a.media, b.media)
  )
}

export function runtimeKeyForSession(sessionId: string | null | undefined): string {
  return sessionId?.trim() ? sessionId : DRAFT_RUNTIME_KEY
}

export function isRealSessionRuntimeKey(key: string): boolean {
  return Boolean(key) && key !== DRAFT_RUNTIME_KEY
}

class SessionAgentStore {
  private slots = new Map<string, SessionAgentSlot>()
  private keyListeners = new Map<string, Set<Listener>>()
  private globalListeners = new Set<Listener>()
  /** Live run handles (key is re-pointed on rekey). */
  private keyHandles = new Set<SessionAgentKeyHandle>()
  /** draft → real id so React can still read via the old runtimeKey until re-render. */
  private aliases = new Map<string, string>()
  private messageSync: MessageSyncHandler | null = null
  /** Shared empty snapshot for missing keys (stable when never created). */
  private readonly emptyFallback = createEmptySessionAgentSlot()

  setMessageSync(handler: MessageSyncHandler | null): void {
    this.messageSync = handler
  }

  /** Follow rekey aliases (draft → session id). */
  canonicalKey(key: string): string {
    let k = key
    const seen = new Set<string>()
    while (this.aliases.has(k) && !seen.has(k)) {
      seen.add(k)
      k = this.aliases.get(k)!
    }
    return k
  }

  ensure(key: string, seedMessages?: UiMessage[]): SessionAgentSlot {
    const k = this.canonicalKey(key)
    let slot = this.slots.get(k)
    if (!slot) {
      slot = createEmptySessionAgentSlot(seedMessages ?? [])
      this.slots.set(k, slot)
      this.emit(k)
    }
    return slot
  }

  has(key: string): boolean {
    return this.slots.has(this.canonicalKey(key))
  }

  get(key: string): SessionAgentSlot | undefined {
    return this.slots.get(this.canonicalKey(key))
  }

  /** Snapshot for useSyncExternalStore — ensures the slot exists. */
  getSnapshot(key: string): SessionAgentSlot {
    return this.ensure(key)
  }

  /** Stable empty when key has never been touched (optional). */
  peek(key: string): SessionAgentSlot {
    return this.slots.get(this.canonicalKey(key)) ?? this.emptyFallback
  }

  subscribe(key: string, listener: Listener): () => void {
    // Global subscription avoids missing updates when draft rekeys mid-stream.
    void key
    return this.subscribeGlobal(listener)
  }

  subscribeGlobal(listener: Listener): () => void {
    this.globalListeners.add(listener)
    return () => {
      this.globalListeners.delete(listener)
    }
  }

  private emit(key: string): void {
    const set = this.keyListeners.get(key)
    if (set) for (const l of set) l()
    for (const l of this.globalListeners) l()
  }

  /**
   * Replace slot fields. Emits once only when something actually changed.
   */
  update(
    key: string,
    patch: Partial<SessionAgentSlot> | ((prev: SessionAgentSlot) => SessionAgentSlot),
  ): void {
    const k = this.canonicalKey(key)
    const prev = this.ensure(k)
    const next =
      typeof patch === 'function'
        ? patch(prev)
        : { ...prev, ...patch, media: patch.media ? { ...prev.media, ...patch.media } : prev.media }
    // shallow-normalize media merge when full media object passed
    if (typeof patch !== 'function' && patch.media) {
      next.media = { ...prev.media, ...patch.media }
    }

    // No-op patches must not emit — callers (e.g. context latch reset) re-enter via
    // useSyncExternalStore and would otherwise infinite-loop the tree to death.
    if (typeof patch !== 'function' && sessionAgentSlotShallowEqual(prev, next)) {
      return
    }
    if (typeof patch === 'function' && prev === next) {
      return
    }

    this.slots.set(k, next)
    this.emit(k)
    if (isRealSessionRuntimeKey(k) && next.messages !== prev.messages) {
      this.messageSync?.(k, next.messages)
    }
  }

  setMessages(key: string, action: SetStateAction<UiMessage[]>): void {
    const k = this.canonicalKey(key)
    const prev = this.ensure(k)
    const messages = resolveAction(prev.messages, action)
    if (messages === prev.messages) return
    this.slots.set(k, { ...prev, messages })
    this.emit(k)
    if (isRealSessionRuntimeKey(k)) {
      this.messageSync?.(k, messages)
    }
  }

  setMediaField<K extends keyof SessionAgentMediaState>(
    key: string,
    field: K,
    action: SetStateAction<SessionAgentMediaState[K]>,
  ): void {
    const k = this.canonicalKey(key)
    const prev = this.ensure(k)
    const value = resolveAction(prev.media[field], action)
    if (value === prev.media[field]) return
    this.slots.set(k, {
      ...prev,
      media: { ...prev.media, [field]: value },
    })
    this.emit(k)
  }

  /** React-friendly media setters bound to a runtime key (or handle). */
  mediaSetters(keyOrHandle: string | SessionAgentKeyHandle) {
    const resolve = () => (typeof keyOrHandle === 'string' ? keyOrHandle : keyOrHandle.key)
    return {
      setAssistantGeneratedImages: ((a) =>
        this.setMediaField(resolve(), 'assistantGeneratedImages', a)) as Dispatch<
        SetStateAction<Record<string, string[]>>
      >,
      setAssistantSavedImagePaths: ((a) =>
        this.setMediaField(resolve(), 'assistantSavedImagePaths', a)) as Dispatch<
        SetStateAction<Record<string, string[]>>
      >,
      setAssistantImageToolMeta: ((a) =>
        this.setMediaField(resolve(), 'assistantImageToolMeta', a)) as Dispatch<
        SetStateAction<Record<string, Record<string, RunwareImageToolMeta>>>
      >,
      setAssistantImageMessageMeta: ((a) =>
        this.setMediaField(resolve(), 'assistantImageMessageMeta', a)) as Dispatch<
        SetStateAction<Record<string, RunwareImageToolMeta>>
      >,
      setAssistantGeneratedAudios: ((a) =>
        this.setMediaField(resolve(), 'assistantGeneratedAudios', a)) as Dispatch<
        SetStateAction<Record<string, string[]>>
      >,
      setAssistantSavedAudioPaths: ((a) =>
        this.setMediaField(resolve(), 'assistantSavedAudioPaths', a)) as Dispatch<
        SetStateAction<Record<string, string[]>>
      >,
      setAssistantAudioToolMeta: ((a) =>
        this.setMediaField(resolve(), 'assistantAudioToolMeta', a)) as Dispatch<
        SetStateAction<Record<string, Record<string, RunwareAudioToolMeta>>>
      >,
      setAssistantAudioMessageMeta: ((a) =>
        this.setMediaField(resolve(), 'assistantAudioMessageMeta', a)) as Dispatch<
        SetStateAction<Record<string, RunwareAudioToolMeta>>
      >,
    }
  }

  createKeyHandle(key: string): SessionAgentKeyHandle {
    const handle: SessionAgentKeyHandle = { key }
    this.keyHandles.add(handle)
    return handle
  }

  releaseKeyHandle(handle: SessionAgentKeyHandle): void {
    this.keyHandles.delete(handle)
  }

  /**
   * Move runtime from one key to another (draft → real session id).
   * Live handles are re-pointed; abort/run continue.
   * `from` aliases to `to` so React can still read via the previous runtimeKey.
   */
  rekey(from: string, to: string): void {
    if (!from || !to || from === to) return
    const fromKey = this.canonicalKey(from)
    if (fromKey === to) {
      this.aliases.set(from, to)
      return
    }
    const slot = this.slots.get(fromKey)
    if (slot) {
      this.slots.set(to, slot)
      this.slots.delete(fromKey)
    } else if (!this.slots.has(to)) {
      this.slots.set(to, createEmptySessionAgentSlot())
    }
    this.aliases.set(from, to)
    if (fromKey !== from) this.aliases.set(fromKey, to)
    for (const h of this.keyHandles) {
      if (h.key === from || h.key === fromKey) h.key = to
    }
    this.emit(to)
    this.emit(from)
    if (slot && isRealSessionRuntimeKey(to)) {
      this.messageSync?.(to, slot.messages)
    }
  }

  /**
   * Begin a new agent run on this key: bump runId, attach controller, mark busy.
   * `codingProjectPath` is frozen for the life of the run (cross-session isolation).
   */
  beginRun(
    key: string,
    meta?: { codingProjectPath?: string },
  ): { runId: number; controller: AbortController } {
    const k = this.canonicalKey(key)
    const prev = this.ensure(k)
    prev.abortController?.abort()
    const controller = new AbortController()
    const runId = prev.runId + 1
    const codingPath = (meta?.codingProjectPath || '').trim() || undefined
    this.slots.set(k, {
      ...prev,
      busy: true,
      error: null,
      toolPhase: null,
      toolActivities: [],
      toolResultBanner: null,
      abortController: controller,
      runId,
      codingProjectPath: codingPath,
      codingStopGraceUntil: undefined,
    })
    this.emit(k)
    return { runId, controller }
  }

  isRunActive(key: string, runId: number): boolean {
    const slot = this.slots.get(this.canonicalKey(key))
    if (!slot) return false
    return slot.runId === runId && !slot.abortController?.signal.aborted
  }

  endRun(key: string, runId: number): void {
    const k = this.canonicalKey(key)
    const prev = this.slots.get(k)
    if (!prev || prev.runId !== runId) return
    this.slots.set(k, {
      ...prev,
      busy: false,
      toolPhase: null,
      toolActivities: [],
      abortController: null,
      codingProjectPath: undefined,
      codingStopGraceUntil: undefined,
    })
    this.emit(k)
  }

  // ── Unread "run finished while you were away" flags ─────────────────────

  private completeUnread = new Set<string>()
  private unreadSnapshot: Record<string, boolean> = {}
  private unreadSnapshotSerialized = ''

  /** Mark a completed background run so the sidebar can flash until the user opens it. */
  markCompleteUnread(key: string): void {
    const k = this.canonicalKey(key)
    if (!isRealSessionRuntimeKey(k)) return
    if (this.completeUnread.has(k)) return
    this.completeUnread.add(k)
    this.emit(k)
  }

  clearCompleteUnread(key: string): void {
    const k = this.canonicalKey(key)
    if (!this.completeUnread.delete(k)) return
    this.emit(k)
  }

  isCompleteUnread(key: string): boolean {
    return this.completeUnread.has(this.canonicalKey(key))
  }

  unreadCompleteBySessionId(): Record<string, boolean> {
    const out: Record<string, boolean> = {}
    for (const id of this.completeUnread) out[id] = true
    const serialized = JSON.stringify(out)
    if (serialized === this.unreadSnapshotSerialized) return this.unreadSnapshot
    this.unreadSnapshot = out
    this.unreadSnapshotSerialized = serialized
    return out
  }

  /** Abort in-flight work for this key (Stop). Messages unchanged — caller may reopen plans. */
  stop(key: string): void {
    const k = this.canonicalKey(key)
    const prev = this.slots.get(k)
    if (!prev) return
    const runId = prev.runId + 1
    prev.abortController?.abort()
    const graceUntil = prev.codingProjectPath ? Date.now() + CODING_STOP_GRACE_MS : undefined
    this.slots.set(k, {
      ...prev,
      runId,
      busy: false,
      toolPhase: null,
      toolActivities: [],
      abortController: null,
      codingStopGraceUntil: graceUntil,
    })
    this.emit(k)
  }

  /**
   * If another busy run is coding against a different project, return an error message.
   * Same path is allowed (multi-chat on one repo); use codingSameProjectBusyAdvisory
   * for a non-blocking warning. `forKey` is excluded (restarting same chat).
   */
  codingProjectConflict(forKey: string, nextPath: string): string | null {
    const mine = this.canonicalKey(forKey)
    const next = normalizeCodingPathKey(nextPath)
    if (!next) return null
    for (const [key, slot] of this.slots) {
      if (!slot.busy) continue
      if (this.canonicalKey(key) === mine) continue
      const other = normalizeCodingPathKey(slot.codingProjectPath || '')
      if (!other) continue
      if (other !== next) {
        return (
          `Another chat is already coding in a different project (${slot.codingProjectPath}). ` +
          `Stop that agent first, or run both against the same folder.`
        )
      }
    }
    return null
  }

  /**
   * Non-blocking hint when another chat is (or very recently was) coding the same
   * project folder. Injected into the agent context — does not prevent the run.
   */
  codingSameProjectBusyAdvisory(forKey: string, nextPath: string): string | null {
    const mine = this.canonicalKey(forKey)
    const next = normalizeCodingPathKey(nextPath)
    if (!next) return null
    const now = Date.now()
    let peers = 0
    for (const [key, slot] of this.slots) {
      if (this.canonicalKey(key) === mine) continue
      const other = normalizeCodingPathKey(slot.codingProjectPath || '')
      if (!other || other !== next) continue
      const inGrace = (slot.codingStopGraceUntil ?? 0) > now
      if (!slot.busy && !inGrace) continue
      peers += 1
    }
    if (peers === 0) return null
    return (
      `Another chat is also using this coding project (${nextPath}). ` +
      `Coordinate disjoint files; run_coding_workers file locks apply only within one batch, not across chats. ` +
      `Prefer git_status / git_diff before overlapping edits.`
    )
  }

  /** Hydrate messages (and reset media) when opening a session with no live slot. */
  hydrateMessages(key: string, messages: UiMessage[]): void {
    const k = this.canonicalKey(key)
    const prev = this.slots.get(k)
    if (prev?.busy) {
      // Live run owns the slot — do not clobber.
      return
    }
    this.slots.set(k, {
      ...(prev ?? createEmptySessionAgentSlot()),
      messages,
      media: emptyMedia(),
      error: null,
      toolPhase: null,
      toolActivities: [],
      toolResultBanner: null,
      contextUsageInfo: null,
      contextWarnDismissed: false,
      contextCompressBusy: false,
      contextOverflowLatch: false,
      busy: false,
      abortController: null,
      // keep runId if somehow set
      runId: prev?.runId ?? 0,
    })
    this.emit(k)
  }

  resetMedia(key: string): void {
    const k = this.canonicalKey(key)
    const prev = this.ensure(k)
    this.slots.set(k, { ...prev, media: emptyMedia() })
    this.emit(k)
  }

  /**
   * Discard a slot: abort run, remove from map.
   * Use for new-draft reset or session delete.
   */
  discard(key: string): void {
    const k = this.canonicalKey(key)
    // If discarding draft while it aliases to a session, only clear the draft alias
    // when the requested key is the draft itself without killing the session run.
    if (key === DRAFT_RUNTIME_KEY && this.aliases.has(DRAFT_RUNTIME_KEY)) {
      this.aliases.delete(DRAFT_RUNTIME_KEY)
      // Fresh empty draft — do not abort the rekeyed session.
      this.slots.set(DRAFT_RUNTIME_KEY, createEmptySessionAgentSlot())
      this.emit(DRAFT_RUNTIME_KEY)
      return
    }
    const prev = this.slots.get(k)
    if (prev) {
      prev.abortController?.abort()
      this.slots.set(k, {
        ...createEmptySessionAgentSlot(),
        runId: prev.runId + 1,
      })
    } else {
      this.slots.set(k, createEmptySessionAgentSlot())
    }
    // Drop aliases targeting this key
    for (const [from, to] of [...this.aliases.entries()]) {
      if (from === k || to === k || from === key) this.aliases.delete(from)
    }
    if (isRealSessionRuntimeKey(k)) {
      this.completeUnread.delete(k)
      this.slots.delete(k)
    } else {
      this.slots.set(DRAFT_RUNTIME_KEY, createEmptySessionAgentSlot())
    }
    this.emit(k)
    this.emit(key)
  }

  /** Prepare a clean draft (New chat). Leaves background session runs alone. */
  resetDraft(): void {
    this.aliases.delete(DRAFT_RUNTIME_KEY)
    const prev = this.slots.get(DRAFT_RUNTIME_KEY)
    prev?.abortController?.abort()
    this.slots.set(DRAFT_RUNTIME_KEY, createEmptySessionAgentSlot())
    this.emit(DRAFT_RUNTIME_KEY)
  }

  isBusy(key: string): boolean {
    return Boolean(this.slots.get(this.canonicalKey(key))?.busy)
  }

  /** Total agent runs currently busy (all sessions + draft). */
  countBusyRuns(): number {
    let n = 0
    for (const slot of this.slots.values()) {
      if (slot.busy) n += 1
    }
    return n
  }

  /**
   * Whether a new run may start on `key` without exceeding the concurrency cap.
   * If `key` is already busy, re-send is allowed (same slot replaces itself).
   */
  canStartRun(key: string, maxConcurrent: number): boolean {
    const k = this.canonicalKey(key)
    if (this.isBusy(k)) return true
    return this.countBusyRuns() < maxConcurrent
  }

  listBusySessionIds(): string[] {
    const out: string[] = []
    for (const [key, slot] of this.slots) {
      if (slot.busy && isRealSessionRuntimeKey(key)) out.push(key)
    }
    return out
  }

  private busySnapshot: Record<string, boolean> = {}
  private busySnapshotSerialized = ''

  /** Snapshot of busy flags for sidebar (sessionId → busy). */
  busyBySessionId(): Record<string, boolean> {
    const out: Record<string, boolean> = {}
    for (const [key, slot] of this.slots) {
      if (isRealSessionRuntimeKey(key) && slot.busy) out[key] = true
    }
    const serialized = JSON.stringify(out)
    if (serialized === this.busySnapshotSerialized) return this.busySnapshot
    this.busySnapshot = out
    this.busySnapshotSerialized = serialized
    return out
  }
}

export const sessionAgentStore = new SessionAgentStore()

/** Subscribe the active runtime key for React render. */
export function useSessionAgentSlot(runtimeKey: string): SessionAgentSlot {
  return useSyncExternalStore(
    (onStoreChange) => sessionAgentStore.subscribe(runtimeKey, onStoreChange),
    () => sessionAgentStore.getSnapshot(runtimeKey),
    () => sessionAgentStore.getSnapshot(runtimeKey),
  )
}

/** Busy map subscription for sidebar badges. */
export function useBusySessionMap(): Record<string, boolean> {
  return useSyncExternalStore(
    (onStoreChange) => sessionAgentStore.subscribeGlobal(onStoreChange),
    () => sessionAgentStore.busyBySessionId(),
    () => sessionAgentStore.busyBySessionId(),
  )
}

/** Sessions whose background agent finished and the user has not opened yet. */
export function useUnreadCompleteSessionMap(): Record<string, boolean> {
  return useSyncExternalStore(
    (onStoreChange) => sessionAgentStore.subscribeGlobal(onStoreChange),
    () => sessionAgentStore.unreadCompleteBySessionId(),
    () => sessionAgentStore.unreadCompleteBySessionId(),
  )
}
