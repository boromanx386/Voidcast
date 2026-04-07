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
import type { UiMessage } from '@/types/chat'

const APP_NAME = 'Voidcast'

type Screen = 'chat' | 'options'
type OptionsTab = 'llm' | 'tts' | 'tools'

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [screen, setScreen] = useState<Screen>('chat')
  const [optionsTab, setOptionsTab] = useState<OptionsTab>('llm')
  const [menuOpen, setMenuOpen] = useState(false)
  const [messages, setMessages] = useState<UiMessage[]>([])
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
  const listEndRef = useRef<HTMLDivElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

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

  const newChat = () => {
    abortRef.current?.abort()
    ttsAbortRef.current?.abort()
    setMessages([])
    setInput('')
    setError(null)
    setToolResultBanner(null)
    setMenuOpen(false)
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
      const chunks = splitIntoTtsChunks(msg.content, maxC)
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
      <div className='flex h-screen w-screen flex-col bg-zinc-950 text-zinc-100'>
        <header className='shrink-0 border-b border-zinc-800'>
          <div className='flex items-center gap-2 px-3 py-3'>
            <button
              type='button'
              className='rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm hover:bg-zinc-800'
              onClick={() => setScreen('chat')}
            >
              ← Back
            </button>
            <h1 className='text-lg font-semibold'>Settings</h1>
          </div>
          <div className='flex gap-0 border-t border-zinc-800 px-2'>
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
    <div className='flex h-screen w-screen flex-col bg-zinc-950 text-zinc-100'>
      <header className='flex shrink-0 items-center gap-3 border-b border-zinc-800 px-3 py-2.5'>
        <button
          type='button'
          aria-label='Menu'
          aria-expanded={menuOpen}
          className='flex h-10 w-10 shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800'
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className='h-0.5 w-5 rounded bg-zinc-200' />
          <span className='h-0.5 w-5 rounded bg-zinc-200' />
          <span className='h-0.5 w-5 rounded bg-zinc-200' />
        </button>
        <div className='min-w-0 flex-1'>
          <h1 className='truncate text-lg font-semibold tracking-tight'>
            {APP_NAME}
          </h1>
          <p className='truncate text-xs text-zinc-500'>
            {ttsOk === true && (
              <span className='text-emerald-400'>TTS ready</span>
            )}
            {ttsOk === false && (
              <span className='text-amber-400' title={ttsDetail}>
                TTS unavailable
              </span>
            )}
            {ttsOk == null && <span>Checking TTS…</span>}
          </p>
        </div>
        {canStop && (
          <button
            type='button'
            className='shrink-0 rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-950/80'
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
          <nav className='fixed left-0 top-0 z-50 flex h-full w-72 max-w-[85vw] flex-col border-r border-zinc-800 bg-zinc-950 shadow-xl'>
            <div className='border-b border-zinc-800 px-4 py-3'>
              <h2 className='text-sm font-semibold text-zinc-400'>Menu</h2>
            </div>
            <div className='flex flex-col p-2'>
              <button
                type='button'
                className='rounded-lg px-4 py-3 text-left text-sm hover:bg-zinc-900'
                onClick={newChat}
              >
                New chat
              </button>
              <button
                type='button'
                className='rounded-lg px-4 py-3 text-left text-sm hover:bg-zinc-900'
                onClick={() => openOptions('llm')}
              >
                Settings (LLM)
              </button>
              <button
                type='button'
                className='rounded-lg px-4 py-3 text-left text-sm hover:bg-zinc-900'
                onClick={() => openOptions('tts')}
              >
                Settings (TTS / clone)
              </button>
              <button
                type='button'
                className='rounded-lg px-4 py-3 text-left text-sm hover:bg-zinc-900'
                onClick={() => openOptions('tools')}
              >
                Settings (Tools)
              </button>
            </div>
          </nav>
        </>
      )}

      <main className='chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4'>
        <div className='mx-auto flex max-w-3xl flex-col gap-3'>
          {messages.length === 0 && (
            <p className='rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500'>
              Send a message — Ollama streams the reply. Menu:{' '}
              <strong className='text-zinc-300'>New chat</strong>,{' '}
              <strong className='text-zinc-300'>Settings</strong> — LLM, TTS, Tools,
              voice clone.
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'max-w-[85%] bg-indigo-600 text-white'
                    : 'max-w-[min(92%,36rem)] bg-zinc-800 text-zinc-100'
                }`}
              >
                {m.role === 'assistant' ? (
                  <ChatMarkdown content={m.content} className='break-words' />
                ) : (
                  <div className='whitespace-pre-wrap break-words'>{m.content}</div>
                )}
                {m.role === 'assistant' && m.content.trim().length > 0 && (
                  <div className='mt-2 flex flex-wrap gap-2 border-t border-zinc-700/50 pt-2'>
                    <button
                      type='button'
                      disabled={ttsOk === false || playingId === m.id}
                      className='rounded-lg bg-zinc-700 px-2 py-1 text-xs text-white hover:bg-zinc-600 disabled:opacity-40'
                      onClick={() => void onRead(m)}
                    >
                      {playingId === m.id ? '…' : 'Read aloud'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className='text-xs text-zinc-500'>
              {toolPhase === 'search'
                ? 'Searching the web…'
                : toolPhase === 'weather'
                  ? 'Checking weather…'
                  : toolPhase === 'scrape'
                    ? 'Fetching page…'
                    : toolPhase === 'pdf'
                      ? 'Saving PDF…'
                      : 'Assistant is typing…'}
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
        <div className='border-t border-red-900/50 bg-red-950/40 px-4 py-2 text-center text-sm text-red-200'>
          {error}
        </div>
      )}

      <footer className='shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-3'>
        <div className='mx-auto flex max-w-3xl gap-2'>
          <textarea
            className='min-h-[44px] flex-1 resize-y rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600'
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
          <div className='flex flex-col gap-2'>
            <button
              type='button'
              className='rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40'
              disabled={!canSend}
              onClick={() => void onSend()}
            >
              Send
            </button>
            <button
              type='button'
              className='rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm hover:bg-zinc-800 disabled:opacity-40'
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
