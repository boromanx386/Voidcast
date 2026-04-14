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
  TOOLS_YOUTUBE_HINT,
  TOOLS_WEATHER_HINT,
  TOOLS_SCRAPE_HINT,
  TOOLS_PDF_HINT,
  TOOLS_TRUTH_HINT,
} from '@/lib/chatMessages'
import { runOllamaChatWithTools } from '@/lib/ollamaAgent'
import { anyToolEnabled } from '@/lib/toolDefinitions'
import { streamOllamaChat, fetchOllamaModels } from '@/lib/ollama'
import { estimateContextUsage, type ContextUsageInfo } from '@/lib/contextUsage'
import { compressConversationContext } from '@/lib/contextCompress'
import { bakeVoiceSample, checkTtsHealth, synthesizeSpeech } from '@/lib/tts'
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
  clearVoiceAnchor,
  loadVoiceAnchor,
  saveVoiceAnchor,
  type StoredVoiceAnchor,
} from '@/lib/voiceAnchorStorage'
import {
  deleteSessionById,
  loadChatSessions,
  saveChatSessions,
  upsertSession,
} from '@/lib/chatSessionsStorage'
import type { ChatSession, UiMessage } from '@/types/chat'

const APP_NAME = 'VOIDCAST'

type Screen = 'chat' | 'options'
type OptionsTab = 'llm' | 'tts' | 'tools'

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function deriveSessionTitle(messages: UiMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')?.content.trim()
  if (!firstUser) return 'UNTITLED_SESSION'
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

// CRT Overlay Component
function CrtOverlay() {
  return (
    <div className="crt-overlay" aria-hidden="true" />
  )
}

// Ambient Particles Component
function AmbientParticles() {
  return (
    <div className="ambient-particles" aria-hidden="true">
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="particle"
          style={{
            left: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 10}s`,
            animationDuration: `${10 + Math.random() * 10}s`,
          }}
        />
      ))}
    </div>
  )
}

// Glitch Text Component
function GlitchText({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`glitch-text ${className}`} data-text={children}>
      {children}
    </span>
  )
}

// Tool Phase Indicator Component
function ToolIndicator({ phase }: { phase: string | null }) {
  if (!phase) return null
  
  const config: Record<string, { icon: string; label: string; className: string }> = {
    search: { icon: '⌕', label: 'SEARCHING_NET', className: 'search' },
    youtube: { icon: '▶', label: 'YOUTUBE_PROC', className: 'youtube' },
    weather: { icon: '◐', label: 'WEATHER_API', className: 'weather' },
    scrape: { icon: '⬡', label: 'SCRAPING', className: 'scrape' },
    pdf: { icon: '⬡', label: 'PDF_EXPORT', className: 'pdf' },
  }
  
  const tool = config[phase] || { icon: '◈', label: phase.toUpperCase(), className: '' }
  
  return (
    <div className={`tool-indicator ${tool.className}`}>
      <span className="opacity-70">{tool.icon}</span>
      <span>{tool.label}</span>
      <span className="ml-2 animate-pulse">_</span>
    </div>
  )
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [screen, setScreen] = useState<Screen>('chat')
  const [optionsTab, setOptionsTab] = useState<OptionsTab>('llm')
  const [menuOpen, setMenuOpen] = useState(false)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [hiddenContextSummary, setHiddenContextSummary] = useState('')
  const [contextUsageInfo, setContextUsageInfo] = useState<ContextUsageInfo | null>(null)
  const [contextWarnDismissed, setContextWarnDismissed] = useState(false)
  const [contextCompressBusy, setContextCompressBusy] = useState(false)
  const [sessionDirty, setSessionDirty] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState({ today: false, older: false })
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
  const [toolPhase, setToolPhase] = useState<'search' | 'youtube' | 'weather' | 'scrape' | 'pdf' | null>(null)
  const [toolResultBanner, setToolResultBanner] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [cloneRef, setCloneRef] = useState<{ blob: Blob; fileName: string } | null>(null)
  const [voiceAnchor, setVoiceAnchor] = useState<StoredVoiceAnchor | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const ttsAbortRef = useRef<AbortController | null>(null)
  const onReadRef = useRef<(msg: UiMessage) => Promise<void>>(async () => {})
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Save settings on change
  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  // Load sessions from storage
  useEffect(() => {
    const state = loadChatSessions()
    setSessions(state.sessions)
    setActiveSessionId(state.activeSessionId)
    const active = state.activeSessionId
      ? state.sessions.find((s) => s.id === state.activeSessionId)
      : null
    setMessages(active?.messages ?? [])
    setHiddenContextSummary(active?.hiddenContextSummary ?? '')
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
    setSessionDirty(false)
    setSessionsHydrated(true)
  }, [])

  // Persist sessions
  useEffect(() => {
    if (!sessionsHydrated) return
    saveChatSessions({ sessions, activeSessionId })
  }, [sessions, activeSessionId, sessionsHydrated])

  // TTS health check
  const refreshTts = useCallback(async () => {
    console.log('[VOIDCAST] Checking TTS at:', settings.ttsBaseUrl)
    try {
      const h = await checkTtsHealth(settings.ttsBaseUrl)
      console.log('[VOIDCAST] TTS health result:', h)
      setTtsOk(h.ok)
      setTtsDetail(h.detail)
    } catch (e) {
      console.error('[VOIDCAST] TTS health check failed:', e)
      setTtsOk(false)
      setTtsDetail(e instanceof Error ? e.message : String(e))
    }
  }, [settings.ttsBaseUrl])

  useEffect(() => {
    void refreshTts()
    const t = window.setInterval(() => void refreshTts(), 15000)
    return () => window.clearInterval(t)
  }, [refreshTts])

  // Load Ollama models
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

  useEffect(() => { void loadModels() }, [loadModels])

  useEffect(() => {
    void loadCloneRef().then((r) => { if (r) setCloneRef(r) })
  }, [])

  useEffect(() => {
    void loadVoiceAnchor().then((r) => { if (r) setVoiceAnchor(r) })
  }, [])

  useEffect(() => {
    if (screen === 'options' && optionsTab === 'llm') void loadModels()
  }, [screen, optionsTab, loadModels])

  // Auto-scroll to bottom
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (menuOpen) setMenuOpen(false)
        else if (screen === 'options') setScreen('chat')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen, screen])

  // Cleanup audio URL
  useEffect(() => {
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }
  }, [audioUrl])

  const canSend = useMemo(() => input.trim().length > 0 && !busy, [input, busy])
  const canStop = busy || playingId !== null
  const canSaveSession = messages.length > 0 && !busy
  const todaySessions = useMemo(() => sessions.filter((s) => isToday(s.updatedAt)), [sessions])
  const olderSessions = useMemo(() => sessions.filter((s) => !isToday(s.updatedAt)), [sessions])

  // === Session Actions ===
  const newChat = () => {
    abortRef.current?.abort()
    ttsAbortRef.current?.abort()
    setMessages([])
    setHiddenContextSummary('')
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
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
    setHiddenContextSummary(session.hiddenContextSummary ?? '')
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
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
    const existing = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null
    const next: ChatSession = {
      id: existing?.id ?? uid(),
      title: existing?.title || deriveSessionTitle(messages),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messages,
      hiddenContextSummary: hiddenContextSummary.trim() || undefined,
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
      setHiddenContextSummary(next?.hiddenContextSummary ?? '')
    } else {
      setMessages([])
      setHiddenContextSummary('')
    }
    setContextUsageInfo(null)
    setContextWarnDismissed(false)
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
      s.id === sessionId ? { ...s, title: nextTitle, updatedAt: Date.now() } : s
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

  // Context summarization
  const summarizeContextNow = useCallback(async () => {
    if (busy || contextCompressBusy) return
    const turns = messages
      .map((m) => ({ role: m.role, content: m.content }))
      .filter((t): t is { role: 'user' | 'assistant'; content: string } =>
        (t.role === 'user' || t.role === 'assistant') && t.content.trim().length > 0
      )
    if (turns.length === 0) return

    setContextCompressBusy(true)
    setError(null)
    try {
      const compressed = await compressConversationContext({
        baseUrl: settings.ollamaBaseUrl,
        model: settings.ollamaModel,
        turns,
        existingSummary: hiddenContextSummary,
        modelOptions: { temperature: settings.llmTemperature, num_ctx: settings.llmNumCtx },
      })
      const nextSummary = compressed.trim()
      if (!nextSummary) return
      setHiddenContextSummary(nextSummary)
      setContextWarnDismissed(true)
      if (activeSessionId) {
        setSessions((prev) => {
          const updated = prev.map((s) =>
            s.id === activeSessionId ? { ...s, hiddenContextSummary: nextSummary, updatedAt: Date.now() } : s
          )
          saveChatSessions({ sessions: updated, activeSessionId })
          return updated
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setContextCompressBusy(false)
    }
  }, [activeSessionId, busy, contextCompressBusy, hiddenContextSummary, messages, settings])

  // === Send Message ===
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
    if (settings.toolsEnabled.youtube) toolsHintParts.push(TOOLS_YOUTUBE_HINT)
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
        hiddenContextSummary: hiddenContextSummary.trim() || undefined,
        toolsSystemHint: useTools && toolsHintParts.length > 0 ? toolsHintParts.join('\n\n') : undefined,
      }
    )

    const ac = new AbortController()
    abortRef.current = ac
    let replyText = ''
    let usage: { prompt_eval_count?: number; eval_count?: number } | undefined

    try {
      if (useTools) {
        const out = await runOllamaChatWithTools({
          baseUrl: settings.ollamaBaseUrl,
          model: settings.ollamaModel,
          initialMessages: history,
          modelOptions: { temperature: settings.llmTemperature, num_ctx: settings.llmNumCtx },
          toolsEnabled: settings.toolsEnabled,
          ttsBaseUrl: settings.ttsBaseUrl,
          pdfOutputDir: settings.pdfOutputDir,
          signal: ac.signal,
          onDelta: (full) => setMessages((prev) => prev.map((m) => m.id === asstId ? { ...m, content: full } : m)),
          onToolPhase: (phase) => setToolPhase(phase as typeof toolPhase),
          onToolResult: ({ name, result }) => { if (name === 'save_pdf') setToolResultBanner(result) },
        })
        replyText = out.content
        usage = out.usage
      } else {
        const out = await streamOllamaChat({
          baseUrl: settings.ollamaBaseUrl,
          model: settings.ollamaModel,
          messages: history,
          modelOptions: { temperature: settings.llmTemperature, num_ctx: settings.llmNumCtx },
          signal: ac.signal,
          onDelta: (full) => setMessages((prev) => prev.map((m) => m.id === asstId ? { ...m, content: full } : m)),
        })
        replyText = out.content
        usage = out.usage
      }

      const usageInfo = estimateContextUsage(usage, settings.llmNumCtx)
      setContextUsageInfo(usageInfo)
      if (usageInfo?.shouldWarn) setContextWarnDismissed(false)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setMessages((prev) => prev.map((m) => m.id === asstId && !m.content.trim() ? { ...m, content: `(ERR: ${msg})` } : m))
    } finally {
      setToolPhase(null)
      setBusy(false)
      abortRef.current = null
    }

    if (replyText.trim() && settings.autoVoice && ttsOk !== false) {
      void onRead({ id: asstId, role: 'assistant', content: replyText })
    }
  }

  const onStop = () => {
    abortRef.current?.abort()
    ttsAbortRef.current?.abort()
  }

  // === Audio Playback ===
  const playBlobUrl = (url: string, signal: AbortSignal): Promise<void> => {
    return new Promise((resolve, reject) => {
      const el = audioRef.current
      if (!el) { resolve(); return }
      const cleanup = () => signal.removeEventListener('abort', onAbort)
      const onAbort = () => { el.pause(); el.removeAttribute('src'); cleanup(); resolve() }
      if (signal.aborted) { resolve(); return }
      signal.addEventListener('abort', onAbort)
      el.onended = () => { cleanup(); resolve() }
      el.onerror = () => { cleanup(); reject(new Error('Audio playback failed')) }
      el.src = url
      void el.play().catch((e) => { cleanup(); reject(e) })
    })
  }

  // === TTS Read ===
  const onRead = async (msg: UiMessage) => {
    if (msg.role !== 'assistant' || !msg.content.trim()) return
    const spoken = sanitizeForTts(msg.content)
    if (!spoken) return
    if (settings.voiceMode === 'clone' && (!cloneRef?.blob || cloneRef.blob.size === 0)) {
      setError('VOICE_CLONE: Load reference audio in Settings → TTS')
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

      const maxC = Math.min(2000, Math.max(80, Math.round(settings.ttsChunkMaxChars) || 380))
      const chunks = splitIntoTtsChunks(spoken, maxC)
      const multi = chunks.length > 1
      const durationForChunk = multi ? null : settings.ttsDurationSec

      const synth = (text: string) => synthesizeSpeech({
        ttsBaseUrl: settings.ttsBaseUrl,
        text,
        voiceMode: settings.voiceMode,
        instruct: settings.voiceInstruct || undefined,
        speed: settings.ttsSpeed,
        numStep: settings.ttsNumStep,
        durationSec: durationForChunk,
        cloneRef: cloneRef ?? null,
        cloneRefText: settings.cloneRefText || null,
        voiceAnchor: voiceAnchor ?? null,
        signal,
      })

      let pending = synth(chunks[0])
      for (let i = 0; i < chunks.length; i++) {
        let blob: Blob
        try { blob = await pending }
        catch (e) { if ((e as Error).name === 'AbortError' || signal.aborted) break; throw e }
        if (signal.aborted) break
        if (i + 1 < chunks.length) pending = synth(chunks[i + 1])
        const url = URL.createObjectURL(blob)
        setAudioUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url })
        try { await playBlobUrl(url, signal) }
        catch (e) { if (signal.aborted) break; throw e }
        if (signal.aborted) break
      }
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      ttsAbortRef.current = null
      setPlayingId(null)
    }
  }

  onReadRef.current = onRead

  // IPC clipboard TTS listener
  useEffect(() => {
    const ipc = window.ipcRenderer
    if (!ipc) return
    const listener = (_e: unknown, text: unknown) => {
      const t = String(text ?? '').trim()
      if (!t) return
      void onReadRef.current({ id: '_clipboard-tts', role: 'assistant', content: t })
    }
    ipc.on('voidcast:read-clipboard-tts', listener)
    return () => { void ipc.off('voidcast:read-clipboard-tts', listener) }
  }, [])

  // Voice clone file picker
  const onPickCloneFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const data = { blob: f, fileName: f.name }
    setCloneRef(data)
    try { await saveCloneRef(data) }
    catch { setError('Failed to save reference sample (IndexedDB)') }
  }

  const onClearClone = async () => {
    setCloneRef(null)
    try { await clearCloneRef() }
    catch { /* ignore */ }
  }

  const onBakeVoiceAnchor = async () => {
    const mode = settings.voiceMode
    if (mode !== 'auto' && mode !== 'design') return
    const phrase = settings.voiceBakePhrase.trim()
    if (!phrase) {
      setError('VOICE_ANCHOR: Enter a short bake phrase first')
      return
    }
    setError(null)
    try {
      const blob = await bakeVoiceSample({
        ttsBaseUrl: settings.ttsBaseUrl,
        sourceMode: mode,
        text: phrase,
        instruct: settings.voiceInstruct || undefined,
        speed: settings.ttsSpeed,
        numStep: settings.ttsNumStep,
        durationSec: null,
      })
      const data: StoredVoiceAnchor = {
        blob,
        refText: phrase,
        sourceMode: mode,
        instructSnapshot: mode === 'design' ? settings.voiceInstruct.trim() : undefined,
      }
      await saveVoiceAnchor(data)
      setVoiceAnchor(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onClearVoiceAnchor = async () => {
    setVoiceAnchor(null)
    try { await clearVoiceAnchor() }
    catch { /* ignore */ }
  }

  // === OPTIONS SCREEN ===
  if (screen === 'options') {
    return (
      <div className="voidcast-app grid-bg">
        <CrtOverlay />
        <AmbientParticles />
        
        {/* Header */}
        <header className="voidcast-header">
          <button
            type="button"
            onClick={() => setScreen('chat')}
            className="cyber-btn text-sm"
          >
            ← RETURN
          </button>
          
          <GlitchText className="voidcast-logo text-2xl">
            SETTINGS
          </GlitchText>
          
          <div className="w-24" /> {/* Spacer */}
        </header>

        {/* Tabs */}
        <div className="flex border-b border-void-muted/30 bg-void-dark/50">
          {(['llm', 'tts', 'tools'] as OptionsTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setOptionsTab(tab)}
              className={`option-tab flex-1 ${optionsTab === tab ? 'active' : ''}`}
            >
              {tab === 'llm' && '◇ LLM'}
              {tab === 'tts' && '◉ TTS'}
              {tab === 'tools' && '⬡ TOOLS'}
            </button>
          ))}
        </div>

        {/* Content */}
        <main className="options-panel flex-1 overflow-y-auto">
          <div className="cyber-panel p-6 max-w-2xl mx-auto">
            <div className="corner-tl" />
            <div className="corner-tr" />
            <div className="corner-bl" />
            <div className="corner-br" />
            
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
                voiceAnchor={voiceAnchor}
                onBakeVoiceAnchor={onBakeVoiceAnchor}
                onClearVoiceAnchor={onClearVoiceAnchor}
              />
            ) : (
              <ToolsOptionsPanel settings={settings} setSettings={setSettings} />
            )}
          </div>
        </main>

        <audio ref={audioRef} className="hidden" />
      </div>
    )
  }

  // === MAIN CHAT SCREEN ===
  return (
    <div className="voidcast-app grid-bg">
      <CrtOverlay />
      <AmbientParticles />

      {/* Header */}
      <header className="voidcast-header">
        {/* Menu Button */}
        <button
          type="button"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="group relative w-10 h-10 flex items-center justify-center
            bg-void-mid border border-void-dim/50 hover:border-neon-cyan/50
            transition-all duration-300 hover:shadow-[0_0_15px_rgba(0,245,255,0.3)]"
          style={{ clipPath: 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)' }}
        >
          <span className="flex flex-col gap-1.5">
            <span className="w-5 h-0.5 bg-void-light group-hover:bg-neon-cyan transition-colors" />
            <span className="w-5 h-0.5 bg-void-light group-hover:bg-neon-cyan transition-colors" />
            <span className="w-5 h-0.5 bg-void-light group-hover:bg-neon-cyan transition-colors" />
          </span>
        </button>

        {/* Logo */}
        <div className="flex items-center gap-4">
          <GlitchText className="voidcast-logo">
            {APP_NAME}
          </GlitchText>
          <div className="hidden sm:block w-px h-6 bg-gradient-to-b from-neon-cyan/50 via-neon-magenta/50 to-transparent" />
          <div className="hidden sm:flex items-center gap-3 text-xs font-mono text-void-dim">
            <span>v2.2.0</span>
          </div>
        </div>

        {/* Status & Actions */}
        <div className="flex items-center gap-3">
          {/* TTS Status */}
          <div className="flex items-center gap-2">
            {ttsOk === true && (
              <span className="cyber-badge success">
                <span className="status-dot online" />
                TTS_ONLINE
              </span>
            )}
            {ttsOk === false && (
              <span className="cyber-badge danger" title={ttsDetail}>
                <span className="status-dot offline" />
                TTS_DOWN
              </span>
            )}
            {ttsOk == null && (
              <span className="cyber-badge">
                <span className="status-dot busy" />
                CHECKING...
              </span>
            )}
          </div>

          {/* Save Button */}
          {canSaveSession && (
            <button
              type="button"
              onClick={saveOrUpdateSession}
              className="cyber-btn text-xs"
            >
              {activeSessionId ? 'UPDATE' : 'SAVE'}
            </button>
          )}

          {/* Stop Button */}
          {canStop && (
            <button
              type="button"
              onClick={onStop}
              className="cyber-btn cyber-btn-danger text-xs"
            >
              ABORT
            </button>
          )}
        </div>
      </header>

      {/* Sidebar Menu */}
      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-void-black/80 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
          <nav 
            className="fixed left-0 top-0 z-50 flex h-full w-72 max-w-[85vw] flex-col 
              bg-void-dark/95 border-r border-neon-cyan/20 shadow-[4px_0_30px_rgba(0,245,255,0.1)]
              backdrop-blur-xl"
          >
            {/* Menu Header */}
            <div className="px-4 py-4 border-b border-void-muted/30">
              <div className="flex items-center gap-3">
                <span className="text-neon-cyan font-mono text-lg">⌘</span>
                <span className="font-display text-sm tracking-widest text-void-light uppercase">NAVIGATION</span>
              </div>
            </div>

            {/* Menu Items */}
            <div className="flex flex-col gap-1 p-2">
              <button
                type="button"
                onClick={newChat}
                className="flex items-center gap-3 rounded px-4 py-3 text-left
                  text-void-light hover:text-neon-cyan hover:bg-neon-cyan/5
                  border border-transparent hover:border-neon-cyan/20 transition-all"
              >
                <span className="text-neon-green">+</span>
                <span className="font-mono text-sm">NEW_SESSION</span>
              </button>
              
              <div className="h-px bg-void-muted/30 my-2" />
              
              <button
                type="button"
                onClick={() => openOptions('llm')}
                className="flex items-center gap-3 rounded px-4 py-3 text-left
                  text-void-light hover:text-neon-cyan hover:bg-neon-cyan/5 transition-all"
              >
                <span className="text-neon-purple">◇</span>
                <span className="font-mono text-sm">LLM_CONFIG</span>
              </button>
              
              <button
                type="button"
                onClick={() => openOptions('tts')}
                className="flex items-center gap-3 rounded px-4 py-3 text-left
                  text-void-light hover:text-neon-cyan hover:bg-neon-cyan/5 transition-all"
              >
                <span className="text-neon-magenta">◉</span>
                <span className="font-mono text-sm">TTS_SETTINGS</span>
              </button>
              
              <button
                type="button"
                onClick={() => openOptions('tools')}
                className="flex items-center gap-3 rounded px-4 py-3 text-left
                  text-void-light hover:text-neon-cyan hover:bg-neon-cyan/5 transition-all"
              >
                <span className="text-neon-yellow">⬡</span>
                <span className="font-mono text-sm">TOOLS_CONFIG</span>
              </button>
            </div>

            {/* Sessions List */}
            <div className="flex-1 border-t border-void-muted/30 overflow-y-auto p-2">
              <div className="px-2 py-2 text-xs font-mono text-void-dim uppercase tracking-wider">
                SAVED_SESSIONS
              </div>
              
              {/* Today */}
              <button
                type="button"
                onClick={() => setSidebarCollapsed((p) => ({ ...p, today: !p.today }))}
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-mono text-void-dim hover:text-void-light"
              >
                <span>TODAY [{todaySessions.length}]</span>
                <span>{sidebarCollapsed.today ? '▶' : '▼'}</span>
              </button>
              
              {!sidebarCollapsed.today && (
                <div className="space-y-1 mt-1">
                  {todaySessions.length === 0 && (
                    <div className="px-3 py-2 text-xs font-mono text-void-dim/50">NO_SESSIONS</div>
                  )}
                  {todaySessions.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      isActive={s.id === activeSessionId}
                      isRenaming={renamingSessionId === s.id}
                      isPendingDelete={pendingDeleteId === s.id}
                      renameValue={renameValue}
                      onOpen={() => openSession(s)}
                      onStartRename={() => startRenameSession(s)}
                      onRenameChange={(v) => setRenameValue(v)}
                      onCommitRename={() => commitRenameSession(s.id)}
                      onCancelRename={cancelRenameSession}
                      onStartDelete={() => setPendingDeleteId(s.id)}
                      onConfirmDelete={() => deleteSession(s.id)}
                      onCancelDelete={() => setPendingDeleteId(null)}
                    />
                  ))}
                </div>
              )}

              {/* Older */}
              <button
                type="button"
                onClick={() => setSidebarCollapsed((p) => ({ ...p, older: !p.older }))}
                className="flex w-full items-center justify-between px-3 py-2 mt-2 text-xs font-mono text-void-dim hover:text-void-light"
              >
                <span>ARCHIVE [{olderSessions.length}]</span>
                <span>{sidebarCollapsed.older ? '▶' : '▼'}</span>
              </button>
              
              {!sidebarCollapsed.older && (
                <div className="space-y-1 mt-1">
                  {olderSessions.length === 0 && (
                    <div className="px-3 py-2 text-xs font-mono text-void-dim/50">NO_ARCHIVE</div>
                  )}
                  {olderSessions.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      isActive={s.id === activeSessionId}
                      isRenaming={renamingSessionId === s.id}
                      isPendingDelete={pendingDeleteId === s.id}
                      renameValue={renameValue}
                      onOpen={() => openSession(s)}
                      onStartRename={() => startRenameSession(s)}
                      onRenameChange={(v) => setRenameValue(v)}
                      onCommitRename={() => commitRenameSession(s.id)}
                      onCancelRename={cancelRenameSession}
                      onStartDelete={() => setPendingDeleteId(s.id)}
                      onConfirmDelete={() => deleteSession(s.id)}
                      onCancelDelete={() => setPendingDeleteId(null)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-void-muted/30">
              <div className="text-xs font-mono text-void-dim/50 text-center">
                VOIDCAST_NEXUS // BUILD_2.2.0
              </div>
            </div>
          </nav>
        </>
      )}

      {/* Chat Messages */}
      <main className="voidcast-messages flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl flex flex-col gap-4">
          {/* Empty State */}
          {messages.length === 0 && (
            <div className="relative overflow-hidden rounded-lg border border-neon-cyan/20 bg-void-dark/80 p-8 text-center animate-fade-in-up">
              <div className="corner-tl" />
              <div className="corner-tr" />
              <div className="corner-bl" />
              <div className="corner-br" />
              
              {/* Decorative glow */}
              <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-neon-cyan/10 blur-3xl" aria-hidden />
              <div className="absolute -left-20 -bottom-20 h-48 w-48 rounded-full bg-neon-magenta/10 blur-3xl" aria-hidden />
              
              <div className="relative">
                <GlitchText className="font-display text-3xl tracking-widest neon-text-cyan mb-4">
                  VOIDCAST
                </GlitchText>
                
                <p className="text-void-text text-sm mb-6 font-mono animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
                  NEURAL INTERFACE READY. AWAITING INPUT.
                  <span className="animate-cursor-blink ml-1">_</span>
                </p>
                
                <div className="flex flex-col gap-2 text-left max-w-sm mx-auto stagger-children">
                  <div className="flex items-center gap-3 px-3 py-2 bg-void-black/50 rounded border border-void-muted/30">
                    <span className="text-neon-cyan font-mono">↵</span>
                    <span className="text-void-light text-sm font-mono">
                      ENTER <span className="text-void-dim">send</span> · SHIFT+ENTER <span className="text-void-dim">newline</span>
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-3 px-3 py-2 bg-void-black/50 rounded border border-void-muted/30">
                    <span className="text-neon-magenta font-mono">⌘</span>
                    <span className="text-void-light text-sm font-mono">
                      CTRL+ALT+SHIFT+V <span className="text-void-dim">clipboard TTS</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((m, index) => (
            <div 
              key={m.id} 
              className={`message-container ${m.role === 'user' ? 'user' : 'assistant'} animate-message-in`}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className={`message-bubble ${m.role === 'user' ? 'message-user' : 'message-assistant'}`}>
                {/* Role indicator */}
                <div className="message-meta">
                  <span className={`message-role ${m.role === 'user' ? 'text-neon-purple' : 'text-neon-cyan'}`}>
                    {m.role === 'user' ? 'USER' : 'VOIDCAST_AI'}
                  </span>
                </div>
                
                {/* Content */}
                {m.role === 'assistant' ? (
                  <ChatMarkdown content={m.content} />
                ) : (
                  <div className="text-void-white whitespace-pre-wrap break-words">
                    {m.content}
                  </div>
                )}
                
                {/* Actions for assistant */}
                {m.role === 'assistant' && m.content.trim().length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-void-muted/30 pt-3">
                    <button
                      type="button"
                      disabled={ttsOk === false || playingId === m.id}
                      onClick={() => void onRead(m)}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                        border border-neon-cyan/30 text-neon-cyan
                        hover:bg-neon-cyan/10 hover:border-neon-cyan/50
                        disabled:opacity-40 disabled:cursor-not-allowed
                        transition-all"
                    >
                      <span className={playingId === m.id ? 'animate-pulse' : ''}>
                        {playingId === m.id ? '◼' : '▶'}
                      </span>
                      {playingId === m.id ? 'SYNTHESIZING...' : 'SPEAK'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Busy Indicator */}
          {busy && (
            <div className="flex items-center gap-3 px-4 py-3 bg-void-dark/80 border border-void-muted/30 rounded">
              <div className="typing-dots">
                <span />
                <span />
                <span />
              </div>
              <span className="text-void-text text-sm font-mono">
                {toolPhase ? (
                  <ToolIndicator phase={toolPhase} />
                ) : (
                  'PROCESSING...'
                )}
              </span>
            </div>
          )}

          <div ref={listEndRef} />
        </div>
      </main>

      {/* Tool Result Banner */}
      {toolResultBanner && (
        <div className="tool-result-banner mx-4 my-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-mono text-neon-green/70 uppercase tracking-wider">
                PDF_EXPORT_RESULT
              </div>
              <div className="mt-1 whitespace-pre-wrap break-all text-xs font-mono">
                {toolResultBanner}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setToolResultBanner(null)}
              className="text-neon-green/50 hover:text-neon-green px-2 py-1 text-xs font-mono"
            >
              DISMISS
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="error-banner mx-4 my-2 flex items-center gap-3">
          <span className="text-neon-red">⚠</span>
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* Context Warning */}
      {contextUsageInfo?.shouldWarn && !contextWarnDismissed && (
        <div className="border-t border-neon-yellow/30 bg-neon-yellow/5 px-4 py-3 mx-4 my-2 rounded">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-mono text-neon-yellow">
              <span className="opacity-70">CONTEXT_WARNING:</span>
              {' '}TOKEN_USAGE {Math.round(contextUsageInfo.ratio * 100)}%
              ({contextUsageInfo.usedTokens}/{contextUsageInfo.maxTokens})
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || contextCompressBusy}
                onClick={() => void summarizeContextNow()}
                className="cyber-btn text-xs"
              >
                {contextCompressBusy ? 'COMPRESSING...' : 'COMPRESS'}
              </button>
              <button
                type="button"
                onClick={() => setContextWarnDismissed(true)}
                className="px-3 py-1 text-xs font-mono text-void-dim hover:text-void-light"
              >
                IGNORE
              </button>
            </div>
          </div>
          {/* Context bar */}
          <div className="context-bar mt-2">
            <div
              className={`context-fill ${contextUsageInfo.ratio > 0.9 ? 'danger' : contextUsageInfo.ratio > 0.7 ? 'warning' : ''}`}
              style={{ width: `${Math.min(100, contextUsageInfo.ratio * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Input Area */}
      <footer className="voidcast-input-area">
        <div className="mx-auto max-w-3xl">
          <div className="input-wrapper">
            <textarea
              className="voidcast-textarea"
              rows={2}
              placeholder="TRANSMIT_MESSAGE..."
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
            
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void onSend()}
              className="send-btn"
              aria-label="Send message"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          </div>
          
          {/* Input hints */}
          <div className="mt-2 flex items-center justify-between text-xs font-mono text-void-dim">
            <span>SHIFT+ENTER for newline</span>
            <span className="flex items-center gap-2">
              <span className="text-neon-cyan/50">{ollamaModels.length > 0 ? `${ollamaModels.length} MODELS` : 'NO_MODELS'}</span>
              {sessionDirty && <span className="text-neon-yellow/70 animate-pulse">UNSAVED</span>}
            </span>
          </div>
        </div>
      </footer>

      {/* System Status */}
      <div className="system-status">
        <div className="status-item">
          <span className={`dot ${ttsOk === true ? 'online' : ttsOk === false ? 'offline' : 'busy'}`} />
          <span>TTS: {ttsOk === true ? 'READY' : ttsOk === false ? 'OFFLINE' : 'CHECKING'}</span>
        </div>
        <div className="font-mono text-void-dim/50">
          VOIDCAST_NEXUS // {new Date().toLocaleTimeString('en-US', { hour12: false })}
        </div>
      </div>

      <audio ref={audioRef} className="hidden" />
    </div>
  )
}

// Session Item Sub-Component
function SessionItem({
  session,
  isActive,
  isRenaming,
  isPendingDelete,
  renameValue,
  onOpen,
  onStartRename,
  onRenameChange,
  onCommitRename,
  onCancelRename,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  session: ChatSession
  isActive: boolean
  isRenaming: boolean
  isPendingDelete: boolean
  renameValue: string
  onOpen: () => void
  onStartRename: () => void
  onRenameChange: (v: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onStartDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}) {
  return (
    <div className={`session-item ${isActive ? 'active' : ''}`}>
      {isRenaming ? (
        <div className="space-y-2">
          <input
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename()
              else if (e.key === 'Escape') onCancelRename()
            }}
            className="w-full px-2 py-1 bg-void-black border border-void-dim text-void-light text-xs font-mono"
            autoFocus
          />
          <div className="flex gap-1">
            <button onClick={onCommitRename} className="px-2 py-0.5 text-xs bg-neon-green/20 text-neon-green border border-neon-green/30">
              SAVE
            </button>
            <button onClick={onCancelRename} className="px-2 py-0.5 text-xs text-void-dim border border-void-dim/30">
              CXL
            </button>
          </div>
        </div>
      ) : isPendingDelete ? (
        <div className="space-y-1">
          <div className="text-xs text-neon-red font-mono">CONFIRM_DELETE?</div>
          <div className="flex gap-1">
            <button onClick={onConfirmDelete} className="px-2 py-0.5 text-xs bg-neon-red/20 text-neon-red border border-neon-red/30">
              YES
            </button>
            <button onClick={onCancelDelete} className="px-2 py-0.5 text-xs text-void-dim border border-void-dim/30">
              NO
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="w-full text-left" onClick={onOpen}>
            <div className="text-xs text-void-light truncate font-mono">{session.title}</div>
            <div className="text-[10px] text-void-dim mt-0.5">
              {new Date(session.updatedAt).toLocaleDateString()} {new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </button>
          <div className="flex gap-1 mt-1">
            <button onClick={onStartRename} className="px-1.5 py-0.5 text-[10px] text-void-dim hover:text-neon-cyan border border-transparent hover:border-void-dim/30">
              REN
            </button>
            <button onClick={onStartDelete} className="px-1.5 py-0.5 text-[10px] text-void-dim hover:text-neon-red border border-transparent hover:border-void-dim/30">
              DEL
            </button>
          </div>
        </>
      )}
    </div>
  )
}
