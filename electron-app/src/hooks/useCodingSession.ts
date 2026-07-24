import { useCallback, useEffect, useRef, useState } from 'react'
import {
  emptyCodingContextMemo,
  getCodingProjectPath,
  mergeCodingProjectPathIntoSettings,
  patchSessionCodingState,
  resolveMemoForSession,
  saveProjectCodingMemo,
  sessionCodingProjectPath,
  type CodingContextMemo,
} from '@/lib/codingContextMemo'
import {
  appendCodingCommandEventToFeed,
  resetCodingTerminalFeedState,
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
import { loadSettings, type AppSettings } from '@/lib/settings'
import type { ChatSession } from '@/types/chat'
import type { TerminalLine } from '@/types/coding'

export type UseCodingSessionParams = {
  settings: AppSettings
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>
  imageVisionCache: ImageVisionCache
  setImageVisionCache: React.Dispatch<React.SetStateAction<ImageVisionCache>>
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>
}

export type UseCodingSessionResult = {
  showCodingPanel: boolean
  setShowCodingPanel: React.Dispatch<React.SetStateAction<boolean>>
  codingTerminalFeed: TerminalLine[]
  setCodingTerminalFeed: React.Dispatch<React.SetStateAction<TerminalLine[]>>
  /** Bumps on session/new-chat boundaries so CodingPanel clears local terminal lines. */
  codingTerminalEpoch: number
  resetCodingTerminal: () => void
  /** Foreground command currently streaming (for STOP). */
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
  codingPanelAvailable: boolean
  syncCodingProjectPathToSettings: (path: string) => void
  applyCodingProjectPath: (path: string) => void
  restoreCodingContextForSession: (
    session: ChatSession,
    options?: { flushActiveSessionId?: string | null },
  ) => void
  codingProjectPathForMemoRef: React.MutableRefObject<string>
}

export function useCodingSession({
  settings,
  setSettings,
  imageVisionCache,
  setImageVisionCache,
  setSessions,
}: UseCodingSessionParams): UseCodingSessionResult {
  const [showCodingPanel, setShowCodingPanel] = useState(false)
  const [codingTerminalFeed, setCodingTerminalFeed] = useState<TerminalLine[]>([])
  const [codingTerminalEpoch, setCodingTerminalEpoch] = useState(0)
  const [activeCodingRunId, setActiveCodingRunId] = useState<string | null>(null)
  const [activeCodingProcesses, setActiveCodingProcesses] = useState<ActiveCodingProcess[]>([])
  const [codingFileTreeNonce, setCodingFileTreeNonce] = useState(0)
  const [codingGitNonce, setCodingGitNonce] = useState(0)
  const [codingRevealRequest, setCodingRevealRequest] = useState<CodingRevealRequest | null>(null)
  const [codingContextMemo, setCodingContextMemo] = useState<CodingContextMemo>(() =>
    emptyCodingContextMemo(getCodingProjectPath(loadSettings())),
  )
  const codingProjectPathForMemoRef = useRef(getCodingProjectPath(loadSettings()))
  const streamSeqRef = useRef({ n: 0 })
  const activeCodingRunIdRef = useRef<string | null>(null)
  activeCodingRunIdRef.current = activeCodingRunId
  const activeCodingProcessesRef = useRef(activeCodingProcesses)
  activeCodingProcessesRef.current = activeCodingProcesses

  const codingPanelAvailable = isElectron() && settings.toolsEnabled.coding

  const resetCodingTerminal = useCallback(() => {
    // Only stop a confirmed foreground run. Unknown/bg ids stay alive.
    const runId = activeCodingRunIdRef.current
    if (runId) {
      const proc = activeCodingProcessesRef.current.find((p) => p.runId === runId)
      if (proc?.kind === 'foreground') {
        void invokeKillCodingCommand(runId)
      }
    }
    setCodingTerminalFeed(resetCodingTerminalFeedState(streamSeqRef.current))
    setCodingTerminalEpoch((n) => n + 1)
    setActiveCodingRunId(null)
    setCodingRevealRequest(null)
    void invokeListActiveCodingProcesses().then((procs) => {
      setActiveCodingProcesses(procs)
    })
  }, [])

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
    return subscribeCodingCommandOutput((event) => {
      if (event.done) {
        setActiveCodingRunId((cur) => (cur === event.runId ? null : cur))
        setActiveCodingProcesses((prev) => removeActiveProcess(prev, event.runId))
      } else {
        setActiveCodingRunId(event.runId)
        if (event.text) {
          setActiveCodingProcesses((prev) =>
            applyOutputToActiveProcess(prev, event.runId, event.text!),
          )
        }
      }
      setCodingTerminalFeed((prev) => appendCodingCommandEventToFeed(prev, event, streamSeqRef.current))
    })
  }, [])

  useEffect(() => {
    if (!isElectron()) return
    let cancelled = false
    void invokeListActiveCodingProcesses().then((procs) => {
      if (!cancelled) setActiveCodingProcesses(procs)
    })
    const unsub = subscribeCodingProcessUpdate((event) => {
      if (event.action === 'upsert') {
        setActiveCodingProcesses((prev) => upsertActiveProcess(prev, event.process))
      } else {
        setActiveCodingProcesses((prev) => removeActiveProcess(prev, event.runId))
        setActiveCodingRunId((cur) => (cur === event.runId ? null : cur))
      }
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

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

      resetCodingTerminal()
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
      resetCodingTerminal,
    ],
  )

  return {
    showCodingPanel,
    setShowCodingPanel,
    codingTerminalFeed,
    setCodingTerminalFeed,
    codingTerminalEpoch,
    resetCodingTerminal,
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
    codingPanelAvailable,
    syncCodingProjectPathToSettings,
    applyCodingProjectPath,
    restoreCodingContextForSession,
    codingProjectPathForMemoRef,
  }
}
