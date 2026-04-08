import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import './App.css'
import { ChatMarkdown } from '@/components/ChatMarkdown'
import { LlmOptionsPanel } from '@/components/options/LlmOptionsPanel'
import { ToolsOptionsPanel } from '@/components/options/ToolsOptionsPanel'
import { TtsOptionsPanel } from '@/components/options/TtsOptionsPanel'
import {
  buildOllamaMessages,
  TOOLS_WEB_SEARCH_HINT,
  TOOLS_WEATHER_HINT,
  TOOLS_SCRAPE_HINT,
  TOOLS_PDF_HINT,
  TOOLS_TRUTH_HINT,
} from '@/lib/chatMessages'
import { runOllamaChatWithTools } from '@/lib/ollamaAgent'
import { anyToolEnabled } from '@/lib/toolDefinitions'
import { streamOllamaChat, fetchOllamaModels } from '@/lib/ollama'
import { checkTtsHealth, synthesizeSpeech } from '@/lib/tts'
import { splitIntoTtsChunks } from '@/lib/textChunks'
import {
  loadSettings,
  saveSettings,
  type AppSettings,
} from '@/lib/settings'
import {
  clearCloneRef,
  loadCloneRef,
  saveCloneRef,
} from '@/lib/cloneRefStorage'
import {
  deleteSessionById,
  loadChatSessions,
  saveChatSessions,
  upsertSession,
} from '@/lib/chatSessionsStorage'
import type { ChatSession, UiMessage } from '@/types/chat'

const APP_NAME = 'Voidcast'

type Screen = 'chat' | 'options'
type OptionsTab = 'llm' | 'tts' | 'tools'

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function deriveSessionTitle(messages: UiMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')?.content.trim()
  if (!firstUser) return 'Untitled'
  const single = firstUser.replace(/\s+/g, ' ')
  return single.length > 60 ? `${single.slice(0, 60)}…` : single
}

function isToday(ts: number): boolean {
  const d = new Date(ts)
  const n = new Date()
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  )
}

function sanitizeForTts(input: string): string {
  return input
    .replace(/[*_`#~]+/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [screen, setScreen] = useState<Screen>('chat')
  const [optionsTab, setOptionsTab] = useState<OptionsTab>('llm')
  const [menuOpen, setMenuOpen] = useState(false)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionDirty, setSessionDirty] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState({
    today: false,
    older: false,
  })
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [sessionsHydrated, setSessionsHydrated] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ttsOk, setTtsOk] = useState<boolean | null>(null)
  const [ttsDetail, setTtsDetail] = useState<string | undefined>(undefined)
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [toolPhase, setToolPhase] = useState<
    'search' | 'weather' | 'scrape' | 'pdf' | null
  >(null)
  /** Actual save_pdf tool result (path or error); model text alone can be wrong */
  const [toolResultBanner, setToolResultBanner] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  /** Voice clone: reference audio (IndexedDB + memory) */
  const [cloneRef, setCloneRef] = useState<{
    blob: Blob
    fileName: string
  } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** Aborts TTS synthesis / playback (chunked) */
  const ttsAbortRef = useRef<AbortController | null>(null)
  const onReadRef = useRef<(msg: UiMessage) => Promise<void>>(async () => {})
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    const state = loadChatSessions()
    setSessions(state.sessions)
    setActiveSessionId(state.activeSessionId)
    const active = state.activeSessionId
      ? state.sessions.find((s) => s.id === state.activeSessionId)
      : null
    setMessages(active?.messages ?? [])
    setSessionDirty(false)
    setSessionsHydrated(true)
  }, [])

  useEffect(() => {
    if (!sessionsHydrated) return
    saveChatSessions({ sessions, activeSessionId })
  }, [sessions, activeSessionId, sessionsHydrated])

  const refreshTts = useCallback(async () => {
    const h = await checkTtsHealth(settings.ttsBaseUrl)
    setTtsOk(h.ok)
    setTtsDetail(h.detail)
  }, [settings.ttsBaseUrl])

  useEffect(() => {
    void refreshTts()
    const t = window.setInterval(() => void refreshTts(), 15000)
    return () => window.clearInterval(t)
  }, [refreshTts])

  const loadModels = useCallback(async () => {
    setModelsError(null)
    setModelsLoading(true)
    try {
      const names = await fetchOllamaModels(settings.ollamaBaseUrl)
      setOllamaModels(names)
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : String(e))
      setOllamaModels([])
    } finally {
      setModelsLoading(false)
    }
  }, [settings.ollamaBaseUrl])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  useEffect(() => {
    void loadCloneRef().then((r) => {
      if (r) setCloneRef(r)
    })
  }, [])

  useEffect(() => {
    if (screen === 'options' && optionsTab === 'llm') void loadModels()
  }, [screen, optionsTab, loadModels])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    if (!menuOpen && screen !== 'options') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (menuOpen) {
        setMenuOpen(false)
        return
      }
      if (screen === 'options') {
        setScreen('chat')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen, screen])

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      abortRef.current?.abort()
    }
  }, [audioUrl])

  const canSend = useMemo(
    () => input.trim().length > 0 && !busy,
    [input, busy],
  )

  const canStop = busy || playingId !== null
  const canSaveSession = messages.length > 0 && !busy
  const todaySessions = useMemo(
    () => sessions.filter((s) => isToday(s.updatedAt)),
    [sessions],
  )
  const olderSessions = useMemo(
    () => sessions.filter((s) => !isToday(s.updatedAt)),
    [sessions],
  )

  const newChat = () => {
    abortRef.current?.abort()
    ttsAbortRef.current?.abort()
    setMessages([])
    setActiveSessionId(null)
    setSessionDirty(false)
    setPendingDeleteId(null)
    setRenamingSessionId(null)
    setRenameValue('')
    setInput('')
    setError(null)
    setToolResultBanner(null)
    setMenuOpen(false)
  }

  const openSession = (session: ChatSession) => {
    abortRef.current?.abort()
    ttsAbortRef.current?.abort()
    setMessages(session.messages)
    setActiveSessionId(session.id)
    setSessionDirty(false)
    setToolResultBanner(null)
    setPendingDeleteId(null)
    setRenamingSessionId(null)
    setRenameValue('')
    setMenuOpen(false)
  }

  const saveOrUpdateSession = () => {
    if (messages.length === 0) return
    const now = Date.now()
    const existing = activeSessionId
      ? sessions.find((s) => s.id === activeSessionId)
      : null
    const next: ChatSession = {
      id: existing?.id ?? uid(),
      title: existing?.title || deriveSessionTitle(messages),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messages,
    }
    const nextState = upsertSession({ sessions, activeSessionId }, next)
    setSessions(nextState.sessions)
    setActiveSessionId(nextState.activeSessionId)
    saveChatSessions(nextState)
    setSessionDirty(false)
  }

  const deleteSession = (sessionId: string) => {
    const state = deleteSessionById({ sessions, activeSessionId }, sessionId)
    setSessions(state.sessions)
    setActiveSessionId(state.activeSessionId)
    if (state.activeSessionId) {
      const next = state.sessions.find((s) => s.id === state.activeSessionId)
      setMessages(next?.messages ?? [])
    } else {
      setMessages([])
    }
    saveChatSessions(state)
    setSessionDirty(false)
    setPendingDeleteId(null)
    if (renamingSessionId === sessionId) {
      setRenamingSessionId(null)
      setRenameValue('')
    }
  }

  const startRenameSession = (session: ChatSession) => {
    setPendingDeleteId(null)
    setRenamingSessionId(session.id)
    setRenameValue(session.title)
  }

  const cancelRenameSession = () => {
    setRenamingSessionId(null)
    setRenameValue('')
  }

  const commitRenameSession = (sessionId: string) => {
    const nextTitle = renameValue.trim().replace(/\s+/g, ' ')
    if (!nextTitle) return
    const updated = sessions.map((s) =>
      s.id === sessionId
        ? { ...s, title: nextTitle, updatedAt: Date.now() }
        : s,
    )
    setSessions(updated)
    saveChatSessions({ sessions: updated, activeSessionId })
    setRenamingSessionId(null)
    setRenameValue('')
  }

  const openOptions = (tab: OptionsTab = 'llm') => {
    setOptionsTab(tab)
    setScreen('options')
    setMenuOpen(false)
  }

  const onSend = async () => {
    const text = input.trim()
    if (!text || busy) return
    setError(null)
    setInput('')
    const userMsg: UiMessage = { id: uid(), role: 'user', content: text }
    const asstId = uid()
    const asstMsg: UiMessage = { id: asstId, role: 'assistant', content: '' }
    setMessages((m) => [...m, userMsg, asstMsg])
    setSessionDirty(true)
    setBusy(true)
    setToolPhase(null)
    setToolResultBanner(null)

    const useTools = anyToolEnabled(settings.toolsEnabled)
    const toolsHintParts: string[] = []
    if (settings.toolsEnabled.webSearch) toolsHintParts.push(TOOLS_WEB_SEARCH_HINT)
    if (settings.toolsEnabled.weather) toolsHintParts.push(TOOLS_WEATHER_HINT)
    if (settings.toolsEnabled.scrape) toolsHintParts.push(TOOLS_SCRAPE_HINT)
    if (settings.toolsEnabled.pdf) toolsHintParts.push(TOOLS_PDF_HINT)
    if (useTools) toolsHintParts.push(TOOLS_TRUTH_HINT)
    const history = buildOllamaMessages(
      messages.map((x) => ({ role: x.role, content: x.content })),
      text,
      {
        systemPrompt: settings.llmSystemPrompt,
        maxHistoryMessages: settings.llmMaxHistoryMessages,
        toolsSystemHint:
          useTools && toolsHintParts.length > 0
            ? toolsHintParts.join('\n\n')
            : undefined,
      },
    )

    const ac = new AbortController()
    abortRef.current = ac
    let replyText = ''
    try {
      if (useTools) {
        replyText = await runOllamaChatWithTools({
          baseUrl: settings.ollamaBaseUrl,
          model: settings.ollamaModel,
          initialMessages: history,
          modelOptions: {
            temperature: settings.llmTemperature,
            num_ctx: settings.llmNumCtx,
          },
          toolsEnabled: settings.toolsEnabled,
          ttsBaseUrl: settings.ttsBaseUrl,
          pdfOutputDir: settings.pdfOutputDir,
          signal: ac.signal,
          onDelta: (full) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === asstId ? { ...m, content: full } : m)),
            )
          },
          onToolPhase: (phase) => {
            if (phase === 'search') setToolPhase('search')
            else if (phase === 'weather') setToolPhase('weather')
            else if (phase === 'scrape') setToolPhase('scrape')
            else if (phase === 'pdf') setToolPhase('pdf')
            else setToolPhase(null)
          },
          onToolResult: ({ name, result }) => {
            if (name === 'save_pdf') setToolResultBanner(result)
          },
        })
      } else {
        replyText = await streamOllamaChat({
          baseUrl: settings.ollamaBaseUrl,
          model: settings.ollamaModel,
          messages: history,
          modelOptions: {
            temperature: settings.llmTemperature,
            num_ctx: settings.llmNumCtx,
          },
          signal: ac.signal,
          onDelta: (full) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === asstId ? { ...m, content: full } : m)),
            )
          },
        })
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === asstId && !m.content.trim()
            ? { ...m, content: `(Error: ${msg})` }
            : m,
        ),
      )
    } finally {
      setToolPhase(null)
      setBusy(false)
      abortRef.current = null
    }

    if (
      replyText.trim() &&
      settings.autoVoice &&
      ttsOk !== false
    ) {
      void onRead({
        id: asstId,
        role: 'assistant',
        content: replyText,
      })
    }
  }

  const onStop = () => {
    abortRef.current?.abort()
    ttsAbortRef.current?.abort()
  }

  const playBlobUrl = (
    url: string,
    signal: AbortSignal,
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const el = audioRef.current
      if (!el) {
        resolve()
        return
      }
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        el.pause()
        el.removeAttribute('src')
        cleanup()
        resolve()
      }
      if (signal.aborted) {
        resolve()
        return
      }
      signal.addEventListener('abort', onAbort)
      el.onended = () => {
        cleanup()
        resolve()
      }
      el.onerror = () => {
        cleanup()
        reject(new Error('Audio playback failed'))
      }
      el.src = url
      void el.play().catch((e) => {
        cleanup()
        reject(e)
      })
    })
  }

  const onRead = async (msg: UiMessage) => {
    if (msg.role !== 'assistant' || !msg.content.trim()) return
    const spoken = sanitizeForTts(msg.content)
    if (!spoken) return
    if (
      settings.voiceMode === 'clone' &&
      (!cloneRef?.blob || cloneRef.blob.size === 0)
    ) {
      setError(
        'Voice clone: in Options → TTS load a reference clip (WAV, ~3–10 s).',
      )
      return
    }
    ttsAbortRef.current?.abort()
    const ac = new AbortController()
    ttsAbortRef.current = ac
    const signal = ac.signal

    setError(null)
    setPlayingId(msg.id)
    try {
      if (audioUrl) URL.revokeObjectURL(audioUrl)

      const maxC = Math.min(
        2000,
        Math.max(80, Math.round(settings.ttsChunkMaxChars) || 380),
      )
      const chunks = splitIntoTtsChunks(spoken, maxC)
      const multi = chunks.length > 1
      const durationForChunk = multi ? null : settings.ttsDurationSec

      const synth = (text: string) =>
        synthesizeSpeech({
          ttsBaseUrl: settings.ttsBaseUrl,
          text,
          voiceMode: settings.voiceMode,
          instruct: settings.voiceInstruct || undefined,
          speed: settings.ttsSpeed,
          numStep: settings.ttsNumStep,
          durationSec: durationForChunk,
          cloneRef: cloneRef ?? null,
          cloneRefText: settings.cloneRefText || null,
          signal,
        })

      let pending = synth(chunks[0])
      for (let i = 0; i < chunks.length; i++) {
        let blob: Blob
        try {
          blob = await pending
        } catch (e) {
          if ((e as Error).name === 'AbortError' || signal.aborted) break
          throw e
        }
        if (signal.aborted) break
        if (i + 1 < chunks.length) {
          pending = synth(chunks[i + 1])
        }
        const url = URL.createObjectURL(blob)
        setAudioUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return url
        })
        try {
          await playBlobUrl(url, signal)
        } catch (e) {
          if (signal.aborted) break
          throw e
        }
        if (signal.aborted) break
      }
    } catch (e) {
      if (!signal.aborted) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      ttsAbortRef.current = null
      setPlayingId(null)
    }
  }

  onReadRef.current = onRead

  useEffect(() => {
    const ipc = window.ipcRenderer
    if (!ipc) return
    const listener = (_e: unknown, text: unknown) => {
      const t = String(text ?? '').trim()
      if (!t) return
      void onReadRef.current({
        id: '_clipboard-tts',
        role: 'assistant',
        content: t,
      })
    }
    ipc.on('voidcast:read-clipboard-tts', listener)
    return () => {
      void ipc.off('voidcast:read-clipboard-tts', listener)
    }
  }, [])

  const onPickCloneFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const data = { blob: f, fileName: f.name }
    setCloneRef(data)
    try {
      await saveCloneRef(data)
    } catch {
      setError('Could not save reference sample (IndexedDB).')
    }
  }

  const onClearClone = async () => {
    setCloneRef(null)
    try {
      await clearCloneRef()
    } catch {
      /* ignore */
    }
  }

  if (screen === 'options') {
    return (
      <div className='voidcast-app-shell flex h-screen w-screen flex-col text-zinc-100'>
        <header className='shrink-0 border-b border-white/5 bg-zinc-950/70 backdrop-blur-md'>
          <div className='flex items-center gap-2 px-3 py-3'>
            <button
              type='button'
              className='rounded-xl border border-zinc-700/80 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-200 shadow-sm transition hover:border-zinc-600 hover:bg-zinc-800'
              onClick={() => setScreen('chat')}
            >
              ← Back
            </button>
            <h1 className='text-lg font-semibold tracking-tight text-zinc-50'>
              Settings
            </h1>
          </div>
          <div className='flex gap-0 border-t border-zinc-800/80 px-2'>
            <button
              type='button'
              className={`min-w-0 flex-1 rounded-t-lg px-3 py-3 text-sm font-medium ${
                optionsTab === 'llm'
                  ? 'border-b-2 border-indigo-500 bg-zinc-900/80 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-300'
              }`}
              onClick={() => setOptionsTab('llm')}
            >
              LLM
            </button>
            <button
              type='button'
              className={`min-w-0 flex-1 rounded-t-lg px-3 py-3 text-sm font-medium ${
                optionsTab === 'tts'
                  ? 'border-b-2 border-indigo-500 bg-zinc-900/80 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-300'
              }`}
              onClick={() => setOptionsTab('tts')}
            >
              TTS
            </button>
            <button
              type='button'
              className={`min-w-0 flex-1 rounded-t-lg px-3 py-3 text-sm font-medium ${
                optionsTab === 'tools'
                  ? 'border-b-2 border-indigo-500 bg-zinc-900/80 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-300'
              }`}
              onClick={() => setOptionsTab('tools')}
            >
              Tools
            </button>
          </div>
        </header>
        <main className='min-h-0 flex-1 overflow-y-auto px-4 py-4'>
          <div className='mx-auto max-w-lg'>
            {optionsTab === 'llm' ? (
              <LlmOptionsPanel
                settings={settings}
                setSettings={setSettings}
                loadModels={loadModels}
                modelsLoading={modelsLoading}
                ollamaModels={ollamaModels}
                modelsError={modelsError}
              />
            ) : optionsTab === 'tts' ? (
              <TtsOptionsPanel
                settings={settings}
                setSettings={setSettings}
                refreshTts={refreshTts}
                cloneRef={cloneRef}
                onPickCloneFile={onPickCloneFile}
                onClearClone={onClearClone}
              />
            ) : (
              <ToolsOptionsPanel settings={settings} setSettings={setSettings} />
            )}
          </div>
        </main>
        <audio ref={audioRef} className='hidden' />
      </div>
    )
  }

  return (
    <div className='voidcast-app-shell flex h-screen w-screen flex-col text-zinc-100'>
      <header className='flex shrink-0 items-center gap-3 border-b border-white/5 bg-zinc-950/75 px-3 py-2.5 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)] backdrop-blur-md'>
        <button
          type='button'
          aria-label='Menu'
          aria-expanded={menuOpen}
          className='flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-zinc-700/80 bg-zinc-900/90 shadow-sm transition hover:border-zinc-600 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500/60'
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className='h-0.5 w-5 rounded-full bg-zinc-200' />
          <span className='h-0.5 w-5 rounded-full bg-zinc-200' />
          <span className='h-0.5 w-5 rounded-full bg-zinc-200' />
        </button>
        <div className='flex min-w-0 flex-1 items-center gap-2.5'>
          <div
            className='flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-indigo-600 to-indigo-900 shadow-lg shadow-indigo-950/50 ring-1 ring-white/15'
            aria-hidden
          >
            <svg
              className='h-5 w-5 text-white/95'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
            >
              <path d='M12 3c-1.2 0-2 1-2 2v14c0 1 .8 2 2 2s2-1 2-2V5c0-1-.8-2-2-2z' />
              <path d='M19 10v4a7 7 0 01-14 0v-4' />
            </svg>
          </div>
          <div className='min-w-0'>
            <h1 className='truncate bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-lg font-semibold tracking-tight text-transparent'>
              {APP_NAME}
            </h1>
            <p className='flex flex-wrap items-center gap-x-2 gap-y-0.5 truncate text-xs text-zinc-500'>
              {ttsOk === true && (
                <span className='inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400 ring-1 ring-emerald-500/20'>
                  <span className='h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' />
                  TTS ready
                </span>
              )}
              {ttsOk === false && (
                <span
                  className='inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400 ring-1 ring-amber-500/25'
                  title={ttsDetail}
                >
                  TTS unavailable
                </span>
              )}
              {ttsOk == null && (
                <span className='text-zinc-500'>Checking TTS…</span>
              )}
              {sessionDirty && (
                <span className='text-amber-400/90'>Unsaved changes</span>
              )}
            </p>
          </div>
        </div>
        {canSaveSession && (
          <button
            type='button'
            className='shrink-0 rounded-xl border border-zinc-700/80 bg-zinc-900/90 px-3 py-2 text-xs font-medium text-zinc-200 shadow-sm transition hover:border-zinc-600 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500/50'
            onClick={saveOrUpdateSession}
          >
            {activeSessionId ? 'Update chat' : 'Save chat'}
          </button>
        )}
        {canStop && (
          <button
            type='button'
            className='shrink-0 rounded-xl border border-red-500/35 bg-red-950/55 px-3 py-2 text-sm font-medium text-red-100 shadow-sm shadow-red-950/40 transition hover:bg-red-950/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500/50'
            onClick={onStop}
          >
            Stop
          </button>
        )}
      </header>

      {menuOpen && (
        <>
          <button
            type='button'
            aria-label='Close menu'
            className='fixed inset-0 z-40 bg-black/55'
            onClick={() => setMenuOpen(false)}
          />
          <nav className='fixed left-0 top-0 z-50 flex h-full w-72 max-w-[85vw] flex-col border-r border-white/5 bg-zinc-950/95 shadow-2xl shadow-black/60 backdrop-blur-xl'>
            <div className='border-b border-white/5 px-4 py-3'>
              <h2 className='text-xs font-semibold uppercase tracking-wider text-zinc-500'>
                Menu
              </h2>
            </div>
            <div className='flex flex-col gap-0.5 p-2'>
              <button
                type='button'
                className='rounded-xl px-4 py-3 text-left text-sm text-zinc-200 transition hover:bg-white/5'
                onClick={newChat}
              >
                New chat
              </button>
              <button
                type='button'
                className='rounded-xl px-4 py-3 text-left text-sm text-zinc-200 transition hover:bg-white/5'
                onClick={() => openOptions('llm')}
              >
                Settings (LLM)
              </button>
              <button
                type='button'
                className='rounded-xl px-4 py-3 text-left text-sm text-zinc-200 transition hover:bg-white/5'
                onClick={() => openOptions('tts')}
              >
                Settings (TTS / clone)
              </button>
              <button
                type='button'
                className='rounded-xl px-4 py-3 text-left text-sm text-zinc-200 transition hover:bg-white/5'
                onClick={() => openOptions('tools')}
              >
                Settings (Tools)
              </button>
            </div>
            <div className='min-h-0 flex-1 border-t border-white/5 p-2'>
              <div className='mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-zinc-500'>
                Saved chats
              </div>
              <div className='space-y-2 overflow-y-auto pr-1'>
                <div>
                  <button
                    type='button'
                    className='flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-900'
                    onClick={() =>
                      setSidebarCollapsed((p) => ({ ...p, today: !p.today }))
                    }
                  >
                    <span>Today ({todaySessions.length})</span>
                    <span>{sidebarCollapsed.today ? '+' : '-'}</span>
                  </button>
                  {!sidebarCollapsed.today && (
                    <div className='mt-1 space-y-1'>
                      {todaySessions.length === 0 && (
                        <div className='px-2 py-1 text-xs text-zinc-600'>No chats</div>
                      )}
                      {todaySessions.map((s) => (
                        <div
                          key={s.id}
                          className={`rounded-md border px-2 py-1.5 ${
                            s.id === activeSessionId
                              ? 'border-indigo-600/70 bg-indigo-950/30'
                              : 'border-zinc-800 bg-zinc-900/50'
                          }`}
                        >
                          {renamingSessionId === s.id ? (
                            <div className='space-y-1'>
                              <input
                                type='text'
                                className='w-full rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-100'
                                value={renameValue}
                                maxLength={100}
                                autoFocus
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    commitRenameSession(s.id)
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault()
                                    cancelRenameSession()
                                  }
                                }}
                              />
                              <div className='mt-0.5 text-[11px] text-zinc-500'>
                                {new Date(s.updatedAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </div>
                            </div>
                          ) : (
                            <button
                              type='button'
                              className='w-full text-left'
                              onClick={() => openSession(s)}
                            >
                              <div className='truncate text-xs text-zinc-200'>{s.title}</div>
                              <div className='mt-0.5 text-[11px] text-zinc-500'>
                                {new Date(s.updatedAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </div>
                            </button>
                          )}
                          <div className='mt-1 flex justify-end'>
                            {renamingSessionId === s.id ? (
                              <div className='flex gap-1'>
                                <button
                                  type='button'
                                  className='rounded bg-emerald-900/70 px-1.5 py-0.5 text-[10px]'
                                  onClick={() => commitRenameSession(s.id)}
                                >
                                  Save
                                </button>
                                <button
                                  type='button'
                                  className='rounded border border-zinc-700 px-1.5 py-0.5 text-[10px]'
                                  onClick={cancelRenameSession}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : pendingDeleteId === s.id ? (
                              <div className='flex gap-1'>
                                <button
                                  type='button'
                                  className='rounded bg-red-900/70 px-1.5 py-0.5 text-[10px]'
                                  onClick={() => deleteSession(s.id)}
                                >
                                  Confirm
                                </button>
                                <button
                                  type='button'
                                  className='rounded border border-zinc-700 px-1.5 py-0.5 text-[10px]'
                                  onClick={() => setPendingDeleteId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className='flex gap-1'>
                                <button
                                  type='button'
                                  className='rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200'
                                  onClick={() => startRenameSession(s)}
                                >
                                  Rename
                                </button>
                                <button
                                  type='button'
                                  className='rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-red-300'
                                  onClick={() => setPendingDeleteId(s.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <button
                    type='button'
                    className='flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-900'
                    onClick={() =>
                      setSidebarCollapsed((p) => ({ ...p, older: !p.older }))
                    }
                  >
                    <span>Older ({olderSessions.length})</span>
                    <span>{sidebarCollapsed.older ? '+' : '-'}</span>
                  </button>
                  {!sidebarCollapsed.older && (
                    <div className='mt-1 space-y-1'>
                      {olderSessions.length === 0 && (
                        <div className='px-2 py-1 text-xs text-zinc-600'>No chats</div>
                      )}
                      {olderSessions.map((s) => (
                        <div
                          key={s.id}
                          className={`rounded-md border px-2 py-1.5 ${
                            s.id === activeSessionId
                              ? 'border-indigo-600/70 bg-indigo-950/30'
                              : 'border-zinc-800 bg-zinc-900/50'
                          }`}
                        >
                          {renamingSessionId === s.id ? (
                            <div className='space-y-1'>
                              <input
                                type='text'
                                className='w-full rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-100'
                                value={renameValue}
                                maxLength={100}
                                autoFocus
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    commitRenameSession(s.id)
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault()
                                    cancelRenameSession()
                                  }
                                }}
                              />
                              <div className='mt-0.5 text-[11px] text-zinc-500'>
                                {new Date(s.updatedAt).toLocaleDateString()}
                              </div>
                            </div>
                          ) : (
                            <button
                              type='button'
                              className='w-full text-left'
                              onClick={() => openSession(s)}
                            >
                              <div className='truncate text-xs text-zinc-200'>{s.title}</div>
                              <div className='mt-0.5 text-[11px] text-zinc-500'>
                                {new Date(s.updatedAt).toLocaleDateString()}
                              </div>
                            </button>
                          )}
                          <div className='mt-1 flex justify-end'>
                            {renamingSessionId === s.id ? (
                              <div className='flex gap-1'>
                                <button
                                  type='button'
                                  className='rounded bg-emerald-900/70 px-1.5 py-0.5 text-[10px]'
                                  onClick={() => commitRenameSession(s.id)}
                                >
                                  Save
                                </button>
                                <button
                                  type='button'
                                  className='rounded border border-zinc-700 px-1.5 py-0.5 text-[10px]'
                                  onClick={cancelRenameSession}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : pendingDeleteId === s.id ? (
                              <div className='flex gap-1'>
                                <button
                                  type='button'
                                  className='rounded bg-red-900/70 px-1.5 py-0.5 text-[10px]'
                                  onClick={() => deleteSession(s.id)}
                                >
                                  Confirm
                                </button>
                                <button
                                  type='button'
                                  className='rounded border border-zinc-700 px-1.5 py-0.5 text-[10px]'
                                  onClick={() => setPendingDeleteId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className='flex gap-1'>
                                <button
                                  type='button'
                                  className='rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200'
                                  onClick={() => startRenameSession(s)}
                                >
                                  Rename
                                </button>
                                <button
                                  type='button'
                                  className='rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-red-300'
                                  onClick={() => setPendingDeleteId(s.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </nav>
        </>
      )}

      <main className='chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5'>
        <div className='mx-auto flex max-w-3xl flex-col gap-4'>
          {messages.length === 0 && (
            <div className='relative overflow-hidden rounded-2xl border border-indigo-500/20 bg-gradient-to-b from-zinc-900/90 to-zinc-950/80 p-8 shadow-2xl shadow-indigo-950/20 ring-1 ring-white/5'>
              <div
                className='pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-indigo-500/15 blur-3xl'
                aria-hidden
              />
              <div className='relative text-center'>
                <p className='text-xs font-semibold uppercase tracking-[0.2em] text-indigo-400/90'>
                  Voidcast
                </p>
                <h2 className='mt-2 text-xl font-semibold tracking-tight text-zinc-50'>
                  Start a conversation
                </h2>
                <p className='mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400'>
                  Messages stream from Ollama. Open the menu for{' '}
                  <span className='text-zinc-300'>New chat</span>,{' '}
                  <span className='text-zinc-300'>Settings</span> — LLM, TTS, tools,
                  and voice clone.
                </p>
                <ul className='mx-auto mt-6 max-w-sm space-y-2 text-left text-sm text-zinc-500'>
                  <li className='flex gap-3 rounded-lg bg-zinc-900/60 px-3 py-2 ring-1 ring-zinc-800/80'>
                    <span className='font-mono text-indigo-400/90'>↵</span>
                    <span>
                      <span className='text-zinc-300'>Enter</span> to send ·{' '}
                      <span className='text-zinc-300'>Shift+Enter</span> for new line
                    </span>
                  </li>
                  <li className='flex gap-3 rounded-lg bg-zinc-900/60 px-3 py-2 ring-1 ring-zinc-800/80'>
                    <span className='text-indigo-400/90'>◇</span>
                    <span>
                      TTS shortcut: copy text elsewhere, then{' '}
                      <kbd className='rounded border border-zinc-600 bg-zinc-950 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300'>
                        Ctrl+Alt+Shift+V
                      </kbd>
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`rounded-2xl px-4 py-3 ${
                  m.role === 'user'
                    ? 'max-w-[85%] bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-xl shadow-indigo-950/40 ring-1 ring-white/15'
                    : 'max-w-[min(92%,36rem)] border border-zinc-800/90 bg-zinc-900/85 text-zinc-100 shadow-2xl shadow-black/35 ring-1 ring-zinc-700/35 backdrop-blur-sm'
                }`}
              >
                {m.role === 'assistant' ? (
                  <ChatMarkdown content={m.content} />
                ) : (
                  <div className='text-[15px] leading-relaxed whitespace-pre-wrap break-words'>
                    {m.content}
                  </div>
                )}
                {m.role === 'assistant' && m.content.trim().length > 0 && (
                  <div className='mt-3 flex flex-wrap gap-2 border-t border-zinc-700/40 pt-3'>
                    <button
                      type='button'
                      disabled={ttsOk === false || playingId === m.id}
                      className='inline-flex items-center gap-2 rounded-xl border border-indigo-500/35 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-200 shadow-sm transition hover:border-indigo-400/45 hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-40'
                      onClick={() => void onRead(m)}
                    >
                      <svg
                        className='h-3.5 w-3.5 shrink-0 opacity-90'
                        viewBox='0 0 24 24'
                        fill='currentColor'
                        aria-hidden
                      >
                        <path d='M8.25 5.25v13.5c0 .62.72.96 1.2.56l7.5-6.75a.75.75 0 000-1.12l-7.5-6.75a.75.75 0 00-1.2.56z' />
                      </svg>
                      {playingId === m.id ? 'Playing…' : 'Read aloud'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className='flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-400 ring-1 ring-zinc-800/60'>
              <div className='flex gap-1' aria-hidden>
                <span className='voidcast-typing-dot h-2 w-2 rounded-full bg-indigo-400/90' />
                <span className='voidcast-typing-dot h-2 w-2 rounded-full bg-indigo-400/90' />
                <span className='voidcast-typing-dot h-2 w-2 rounded-full bg-indigo-400/90' />
              </div>
              <span>
                {toolPhase === 'search'
                  ? 'Searching the web…'
                  : toolPhase === 'weather'
                    ? 'Checking weather…'
                    : toolPhase === 'scrape'
                      ? 'Fetching page…'
                      : toolPhase === 'pdf'
                        ? 'Saving PDF…'
                        : 'Assistant is typing…'}
              </span>
            </div>
          )}
          <div ref={listEndRef} />
        </div>
      </main>

      {toolResultBanner && (
        <div
          className={`shrink-0 border-t px-4 py-2 text-sm ${
            toolResultBanner.startsWith('PDF saved')
              ? 'border-emerald-900/50 bg-emerald-950/50 text-emerald-100'
              : 'border-amber-900/50 bg-amber-950/40 text-amber-100'
          }`}
        >
          <div className='mx-auto flex max-w-3xl items-start justify-between gap-3'>
            <div>
              <div className='text-xs font-medium uppercase tracking-wide text-zinc-400'>
                save_pdf (actual result)
              </div>
              <div className='mt-1 whitespace-pre-wrap break-all font-mono text-xs leading-relaxed'>
                {toolResultBanner}
              </div>
            </div>
            <button
              type='button'
              className='shrink-0 rounded-lg border border-zinc-600 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800'
              onClick={() => setToolResultBanner(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className='border-t border-red-500/25 bg-red-950/50 px-4 py-3 text-center text-sm text-red-100 shadow-[inset_0_1px_0_0_rgba(248,113,113,0.12)]'>
          {error}
        </div>
      )}

      <footer className='shrink-0 border-t border-white/5 bg-zinc-950/90 px-4 py-4 shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.45)] backdrop-blur-md'>
        <div className='mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-end'>
          <textarea
            className='min-h-[52px] flex-1 resize-y rounded-2xl border border-zinc-700/80 bg-zinc-900/90 px-4 py-3 text-sm leading-relaxed text-zinc-100 shadow-inner shadow-black/20 placeholder:text-zinc-600 transition focus:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/25'
            rows={2}
            placeholder='Message…'
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void onSend()
              }
            }}
          />
          <div className='flex shrink-0 flex-row gap-2 sm:flex-col sm:justify-end'>
            <button
              type='button'
              className='flex-1 rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 transition hover:from-indigo-500 hover:to-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400/60 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none'
              disabled={!canSend}
              onClick={() => void onSend()}
            >
              Send
            </button>
            <button
              type='button'
              className='flex-1 rounded-2xl border border-zinc-700/90 bg-zinc-900/90 px-5 py-3 text-sm font-medium text-zinc-200 shadow-sm transition hover:border-zinc-600 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500/40 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none'
              disabled={!canStop}
              onClick={onStop}
            >
              Stop
            </button>
          </div>
        </div>
      </footer>

      <audio ref={audioRef} className='hidden' />
    </div>
  )
}
