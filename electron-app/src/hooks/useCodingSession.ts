import { useCallback, useEffect, useRef, useState } from 'react'
import {
  emptyCodingContextMemo,
  emptyCodingFileCache,
  getCodingProjectPath,
  mergeCodingProjectPathIntoSettings,
  patchSessionCodingState,
  resolveMemoForSession,
  saveProjectCodingMemo,
  sessionCodingProjectPath,
  type CodingContextMemo,
  type CodingFileCache,
} from '@/lib/codingContextMemo'
import {
  appendCodingCommandEventToFeed,
  resetCodingTerminalFeedState,
  type CodingCommandOutputEvent,
} from '@/lib/codingCommandStream'
import {
  applyOutputToActiveProcess,
  removeActiveProcess,
  upsertActiveProcess,
  type ActiveCodingProcess,
} from '@/lib/codingActiveProcesses'
import {
  invokeKillCodingCommand,
  invokeListActiveCodingProcesses,
  subscribeCodingCommandOutput,
  subscribeCodingProcessUpdate,
} from '@/lib/codingTools'
import {
  normalizeCodingRevealPath,
  type CodingRevealRequest,
} from '@/lib/codingReveal'
import {
  normalizeImageVisionCache,
  type ImageVisionCache,
} from '@/lib/imageVisionCache'
import { isElectron } from '@/lib/platform'
import { DRAFT_RUNTIME_KEY } from '@/lib/sessionAgentStore'
import { loadSettings, type AppSettings } from '@/lib/settings'
import type { ChatSession } from '@/types/chat'
import type { TerminalLine } from '@/types/coding'

type OwnerFeed = {
  lines: TerminalLine[]
  seq: { n: number }
}

export type UseCodingSessionParams = {
  settings: AppSettings
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
  imageVisionCache: ImageVisionCache
  setImageVisionCache: React.Dispatch<React.SetStateAction<ImageVisionCache>>
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>
  /** Current chat runtime key — scopes terminal display to this owner. */
  viewRuntimeKey?: string
}

export type UseCodingSessionResult = {
  showCodingPanel: boolean
  setShowCodingPanel: React.Dispatch<React.SetStateAction<boolean>>
  codingTerminalFeed: TerminalLine[]
  setCodingTerminalFeed: React.Dispatch<React.SetStateAction<TerminalLine[]>>
  /** Bumps on session/new-chat boundaries so CodingPanel clears local terminal lines. */
  codingTerminalEpoch: number
  /** Clear this owner’s feed only; does not kill shells. */
  resetCodingTerminal: () => void
  /** Switch displayed terminal without killing background agents’ shells. */
  switchCodingTerminalOwner: (ownerKey: string) => void
  /** Move feed when draft runtime rekeys to a session id mid-run. */
  rekeyCodingTerminalOwner: (fromKey: string, toKey: string) => void
  /** Foreground command currently streaming in the viewed chat (for STOP). */
  activeCodingRunId: string | null
  stopCodingCommand: () => Promise<void>
  /** Live mirror of main-process active coding shell processes (for CTX hint). */
  activeCodingProcesses: ActiveCodingProcess[]
  codingFileTreeNonce: number
  setCodingFileTreeNonce: React.Dispatch<React.SetStateAction<number>>
  codingGitNonce: number
  setCodingGitNonce: React.Dispatch<React.SetStateAction<number>>
  /** Latest agent write/edit path to focus in CodingPanel (null until first reveal). */
  codingRevealRequest: CodingRevealRequest | null
  revealCodingFile: (path: string) => void
  codingContextMemo: CodingContextMemo
  setCodingContextMemo: React.Dispatch<React.SetStateAction<CodingContextMemo>>
  /** Always-current memo for same-tick handoffs (enter_plan_mode); prefer over closure state. */
  codingContextMemoRef: React.MutableRefObject<CodingContextMemo>
  codingFileCache: CodingFileCache
  setCodingFileCache: React.Dispatch<React.SetStateAction<CodingFileCache>>
  codingFileCacheRef: React.MutableRefObject<CodingFileCache>
  codingPanelAvailable: boolean
  syncCodingProjectPathToSettings: (path: string) => void
  applyCodingProjectPath: (path: string) => void
  restoreCodingContextForSession: (
    session: ChatSession,
    options?: { flushActiveSessionId?: string | null },
  ) => void
  codingProjectPathForMemoRef: React.MutableRefObject<string>
  viewRuntimeKey: string
}

function resolveActionLines(
  prev: TerminalLine[],
  action: React.SetStateAction<TerminalLine[]>,
): TerminalLine[] {
  return typeof action === 'function' ? action(prev) : action
}

export function useCodingSession({
  settings,
  setSettings,
  imageVisionCache,
  setImageVisionCache,
  setSessions,
  viewRuntimeKey = DRAFT_RUNTIME_KEY,
}: UseCodingSessionParams): UseCodingSessionResult {
  const [showCodingPanel, setShowCodingPanel] = useState(false)
  const [codingTerminalFeed, setCodingTerminalFeedState] = useState<TerminalLine[]>([])
  const [codingTerminalEpoch, setCodingTerminalEpoch] = useState(0)
  const [activeCodingRunId, setActiveCodingRunId] = useState<string | null>(null)
  const [activeCodingProcesses, setActiveCodingProcesses] = useState<ActiveCodingProcess[]>([])
  const [codingFileTreeNonce, setCodingFileTreeNonce] = useState(0)
  const [codingGitNonce, setCodingGitNonce] = useState(0)
  const [codingRevealRequest, setCodingRevealRequest] = useState<CodingRevealRequest | null>(null)
  const [codingContextMemo, setCodingContextMemoState] = useState<CodingContextMemo>(() =>
    emptyCodingContextMemo(getCodingProjectPath(loadSettings())),
  )
  const codingContextMemoRef = useRef(codingContextMemo)
  codingContextMemoRef.current = codingContextMemo
  /** Sync ref inside the updater so enter_plan_mode handoff sees digests before React re-renders. */
  const setCodingContextMemo: React.Dispatch<React.SetStateAction<CodingContextMemo>> =
    useCallback((action) => {
      const prev = codingContextMemoRef.current
      const next = typeof action === 'function' ? action(prev) : action
      codingContextMemoRef.current = next
      setCodingContextMemoState(next)
    }, [])
  const [codingFileCache, setCodingFileCache] = useState<CodingFileCache>(() =>
    emptyCodingFileCache(),
  )
  const codingFileCacheRef = useRef(codingFileCache)
  codingFileCacheRef.current = codingFileCache
  const codingProjectPathForMemoRef = useRef(getCodingProjectPath(loadSettings()))

  const feedsByOwnerRef = useRef(new Map<string, OwnerFeed>())
  /** draft → session after rekey so in-flight shell IPC still lands on the live feed. */
  const ownerAliasRef = useRef(new Map<string, string>())
  const viewKeyRef = useRef(viewRuntimeKey)
  viewKeyRef.current = viewRuntimeKey

  const resolveOwnerKey = useCallback((raw?: string): string => {
    let key = (raw || '').trim() || DRAFT_RUNTIME_KEY
    const seen = new Set<string>()
    while (ownerAliasRef.current.has(key) && !seen.has(key)) {
      seen.add(key)
      key = ownerAliasRef.current.get(key)!
    }
    return key
  }, [])

  const activeCodingRunIdRef = useRef<string | null>(null)
  activeCodingRunIdRef.current = activeCodingRunId
  const activeCodingProcessesRef = useRef(activeCodingProcesses)
  activeCodingProcessesRef.current = activeCodingProcesses

  const ensureFeed = useCallback((ownerKey: string): OwnerFeed => {
    const key = ownerKey.trim() || DRAFT_RUNTIME_KEY
    let feed = feedsByOwnerRef.current.get(key)
    if (!feed) {
      feed = { lines: [], seq: { n: 0 } }
      feedsByOwnerRef.current.set(key, feed)
    }
    return feed
  }, [])

  const setCodingTerminalFeed: React.Dispatch<React.SetStateAction<TerminalLine[]>> = useCallback(
    (action) => {
      const key = viewKeyRef.current
      const feed = ensureFeed(key)
      const next = resolveActionLines(feed.lines, action)
      feed.lines = next
      setCodingTerminalFeedState(next)
    },
    [ensureFeed],
  )

  const switchCodingTerminalOwner = useCallback(
    (ownerKey: string) => {
      const key = ownerKey.trim() || DRAFT_RUNTIME_KEY
      viewKeyRef.current = key
      const feed = ensureFeed(key)
      setCodingTerminalFeedState(feed.lines)
      // Rebind STOP to a foreground run owned by this view, if any.
      const fg = activeCodingProcessesRef.current.find(
        (p) => p.kind === 'foreground' && (p.ownerId || DRAFT_RUNTIME_KEY) === key,
      )
      setActiveCodingRunId(fg?.runId ?? null)
      setCodingRevealRequest(null)
      setCodingTerminalEpoch((n) => n + 1)
    },
    [ensureFeed],
  )

  const rekeyCodingTerminalOwner = useCallback(
    (fromKey: string, toKey: string) => {
      const from = fromKey.trim() || DRAFT_RUNTIME_KEY
      const to = toKey.trim()
      if (!to || from === to) return
      ownerAliasRef.current.set(from, to)
      const source = feedsByOwnerRef.current.get(from)
      if (source) {
        const dest = ensureFeed(to)
        // Prefer non-empty source; merge conservatively if dest already has lines.
        dest.lines = source.lines.length > 0 ? source.lines : dest.lines
        dest.seq.n = Math.max(dest.seq.n, source.seq.n)
        feedsByOwnerRef.current.delete(from)
      }
      if (viewKeyRef.current === from) {
        viewKeyRef.current = to
        setCodingTerminalFeedState(ensureFeed(to).lines)
      }
    },
    [ensureFeed],
  )

  // Keep view-bound terminal in sync when router changes active chat.
  useEffect(() => {
    const key = viewRuntimeKey.trim() || DRAFT_RUNTIME_KEY
    if (viewKeyRef.current === key) {
      // Still refresh display in case feed was updated while we tracked the same key.
      setCodingTerminalFeedState(ensureFeed(key).lines)
      return
    }
    switchCodingTerminalOwner(key)
  }, [viewRuntimeKey, ensureFeed, switchCodingTerminalOwner])

  const codingPanelAvailable = isElectron() && settings.toolsEnabled.coding

  const resetCodingTerminal = useCallback(() => {
    const owner = viewKeyRef.current
    // Do NOT kill shells here — concurrent agents may own background/fg processes on another chat.
    // STOP is explicit via stopCodingCommand / agent stop_process.
    const feed = ensureFeed(owner)
    feed.lines = resetCodingTerminalFeedState(feed.seq)
    setCodingTerminalFeedState(feed.lines)
    setCodingTerminalEpoch((n) => n + 1)
    setActiveCodingRunId(null)
    setCodingRevealRequest(null)
  }, [ensureFeed])

  const stopCodingCommand = useCallback(async () => {
    const runId = activeCodingRunIdRef.current
    if (!runId) return
    await invokeKillCodingCommand(runId)
  }, [])

  const revealCodingFile = useCallback(
    (path: string) => {
      if (!codingPanelAvailable) return
      const normalized = normalizeCodingRevealPath(path)
      if (!normalized) return
      // Queue preview focus only — do not force-open a collapsed coding panel.
      setCodingRevealRequest((prev) => ({
        path: normalized,
        nonce: (prev?.nonce ?? 0) + 1,
      }))
    },
    [codingPanelAvailable],
  )

  useEffect(() => {
    if (!codingPanelAvailable) setShowCodingPanel(false)
  }, [codingPanelAvailable])

  useEffect(() => {
    if (!isElectron()) return
    return subscribeCodingCommandOutput((event: CodingCommandOutputEvent) => {
      const owner = resolveOwnerKey(event.ownerId)
      const feed = ensureFeed(owner)
      feed.lines = appendCodingCommandEventToFeed(feed.lines, event, feed.seq)

      const viewing = owner === viewKeyRef.current
      if (viewing) {
        setCodingTerminalFeedState(feed.lines)
      }

      if (event.done) {
        setActiveCodingRunId((cur) =>
          viewing && cur === event.runId ? null : cur,
        )
        setActiveCodingProcesses((prev) => removeActiveProcess(prev, event.runId))
      } else if (viewing) {
        setActiveCodingRunId(event.runId)
        if (event.text) {
          setActiveCodingProcesses((prev) =>
            applyOutputToActiveProcess(prev, event.runId, event.text!, {
              ownerId: owner,
              projectPath: event.projectPath,
            }),
          )
        }
      } else if (event.text) {
        setActiveCodingProcesses((prev) =>
          applyOutputToActiveProcess(prev, event.runId, event.text!, {
            ownerId: owner,
            projectPath: event.projectPath,
          }),
        )
      }
    })
  }, [ensureFeed, resolveOwnerKey])

  useEffect(() => {
    if (!isElectron()) return
    let cancelled = false
    void invokeListActiveCodingProcesses().then((procs) => {
      if (!cancelled) setActiveCodingProcesses(procs)
    })
    const unsub = subscribeCodingProcessUpdate((event) => {
      if (event.action === 'upsert') {
        const owner = resolveOwnerKey(event.process.ownerId)
        const process = { ...event.process, ownerId: owner }
        setActiveCodingProcesses((prev) => upsertActiveProcess(prev, process))
        if (process.kind === 'foreground' && owner === viewKeyRef.current) {
          setActiveCodingRunId(process.runId)
        }
      } else {
        setActiveCodingProcesses((prev) => removeActiveProcess(prev, event.runId))
        setActiveCodingRunId((cur) => (cur === event.runId ? null : cur))
      }
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [resolveOwnerKey])

  useEffect(() => {
    const projectPath = getCodingProjectPath(settings)
    if (!projectPath) return
    const t = window.setTimeout(() => {
      saveProjectCodingMemo(projectPath, codingContextMemo)
    }, 400)
    return () => window.clearTimeout(t)
  }, [codingContextMemo, settings.coding.projectPath, settings.codingProjectPath])

  const syncCodingProjectPathToSettings = useCallback((path: string) => {
    const trimmed = path.trim()
    codingProjectPathForMemoRef.current = trimmed
    setSettings((s) => mergeCodingProjectPathIntoSettings(s, trimmed))
  }, [setSettings])

  const applyCodingProjectPath = useCallback((path: string) => {
    const trimmed = path.trim()
    if (codingProjectPathForMemoRef.current !== trimmed) {
      codingProjectPathForMemoRef.current = trimmed
      setCodingContextMemo(emptyCodingContextMemo(trimmed))
    }
    setSettings((s) => mergeCodingProjectPathIntoSettings(s, trimmed))
  }, [setSettings])

  const restoreCodingContextForSession = useCallback(
    (session: ChatSession, options?: { flushActiveSessionId?: string | null }) => {
      // Session-bound path only (empty = General). Do not inherit settings fallback.
      const path = sessionCodingProjectPath(session)
      const memo = resolveMemoForSession(session, path)

      const flushId = options?.flushActiveSessionId
      if (flushId) {
        setSessions((prev) => {
          const patched = patchSessionCodingState(
            prev,
            flushId,
            getCodingProjectPath(settings),
            codingContextMemo,
          )
          const idx = patched.findIndex((s) => s.id === flushId)
          if (idx < 0) return patched
          const cur = patched[idx]!
          const nextVisionCache = normalizeImageVisionCache(imageVisionCache)
          if (
            JSON.stringify(cur.imageVisionCache ?? null) === JSON.stringify(nextVisionCache)
          ) {
            return patched
          }
          const next = [...patched]
          next[idx] = { ...cur, updatedAt: Date.now(), imageVisionCache: nextVisionCache }
          return next
        })
      }

      // Swap terminal view only — never kill shells belonging to other chats.
      switchCodingTerminalOwner(session.id)
      syncCodingProjectPathToSettings(path)
      setCodingContextMemo(memo)
      setImageVisionCache(normalizeImageVisionCache(session.imageVisionCache))
    },
    [
      settings,
      codingContextMemo,
      imageVisionCache,
      syncCodingProjectPathToSettings,
      setImageVisionCache,
      setSessions,
      switchCodingTerminalOwner,
    ],
  )

  return {
    showCodingPanel,
    setShowCodingPanel,
    codingTerminalFeed,
    setCodingTerminalFeed,
    codingTerminalEpoch,
    resetCodingTerminal,
    switchCodingTerminalOwner,
    rekeyCodingTerminalOwner,
    activeCodingRunId,
    stopCodingCommand,
    activeCodingProcesses,
    codingFileTreeNonce,
    setCodingFileTreeNonce,
    codingGitNonce,
    setCodingGitNonce,
    codingRevealRequest,
    revealCodingFile,
    codingContextMemo,
    setCodingContextMemo,
    codingContextMemoRef,
    codingFileCache,
    setCodingFileCache,
    codingFileCacheRef,
    codingPanelAvailable,
    syncCodingProjectPathToSettings,
    applyCodingProjectPath,
    restoreCodingContextForSession,
    codingProjectPathForMemoRef,
    viewRuntimeKey,
  }
}
