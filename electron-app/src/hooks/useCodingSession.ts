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
import { invokeKillCodingCommand, subscribeCodingCommandOutput } from '@/lib/codingTools'
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
  codingFileTreeNonce: number
  setCodingFileTreeNonce: React.Dispatch<React.SetStateAction<number>>
  codingGitNonce: number
  setCodingGitNonce: React.Dispatch<React.SetStateAction<number>>
  /** Latest agent read/write/edit path to focus in CodingPanel (null until first reveal). */
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

  const codingPanelAvailable = isElectron() && settings.toolsEnabled.coding

  const resetCodingTerminal = useCallback(() => {
    const runId = activeCodingRunIdRef.current
    if (runId) void invokeKillCodingCommand(runId)
    setCodingTerminalFeed(resetCodingTerminalFeedState(streamSeqRef.current))
    setCodingTerminalEpoch((n) => n + 1)
    setActiveCodingRunId(null)
    setCodingRevealRequest(null)
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
      setShowCodingPanel(true)
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
      } else {
        setActiveCodingRunId(event.runId)
      }
      setCodingTerminalFeed((prev) => appendCodingCommandEventToFeed(prev, event, streamSeqRef.current))
    })
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
      const fallbackPath = getCodingProjectPath(settings)
      const path = sessionCodingProjectPath(session, fallbackPath)
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
