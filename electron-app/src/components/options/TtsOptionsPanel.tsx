import type { AppSettings } from '@/lib/settings'
import {
  OPENROUTER_TTS_MODEL_DEFAULT,
  OPENROUTER_TTS_MODEL_PRESETS,
  openRouterTtsVoicesForModel,
  RUNWARE_TTS_MODEL_DEFAULT,
  RUNWARE_TTS_MODEL_PRESETS,
  RUNWARE_TTS_VOICE_LABELS,
  runwareTtsLanguagePlaceholder,
  runwareTtsSupportsLanguage,
  runwareTtsVoicesForModel,
} from '@/lib/settings'
import type { StoredVoiceAnchor } from '@/lib/voiceAnchorStorage'
import { NumericSettingInput } from '@/components/options/NumericSettingInput'
import { isElectron, isWebStandalone } from '@/lib/platform'
import { synthesizeSpeech } from '@/lib/tts'
import {
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react'

const OMNIVOICE_VOICE_DESIGN_DOCS =
  'https://github.com/k2-fsa/OmniVoice/blob/master/docs/voice-design.md'
const LOCAL_TTS_SETUP_DOCS =
  'https://github.com/boromanx386/Voidcast/blob/main/LOCAL_TTS_SETUP.md'

/** Hover/focus panel — matches OmniVoice docs/voice-design.md */
function VoiceDescriptInfo() {
  return (
    <div className="group relative inline-flex items-center align-middle">
      <button
        type="button"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-void-dim/80 text-[10px] font-mono font-bold text-void-dim transition-colors hover:border-neon-cyan/60 hover:text-neon-cyan focus:outline-none focus-visible:ring-1 focus-visible:ring-neon-cyan/70"
        aria-label="OmniVoice instruct: hover for gender, age, pitch, accent, dialect"
      >
        i
      </button>
      <div
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-[100] mt-0 hidden w-[min(92vw,22rem)] group-hover:pointer-events-auto group-hover:block group-focus-within:pointer-events-auto group-focus-within:block"
      >
        <div className="mt-1 max-h-[min(70vh,26rem)] overflow-y-auto rounded border border-neon-purple/35 bg-void-black p-3 text-left text-xs leading-snug text-void-text shadow-lg">
          <p className="font-mono text-neon-purple text-[11px] uppercase tracking-wide">
            OmniVoice instruct
          </p>
          <p className="mt-2 text-void-dim">
            Comma-separated traits; pick at most one value per category. You can mix
            English and Chinese — the model normalises it.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-void-text">
            <li>
              <span className="text-neon-cyan">Gender:</span> male, female (男, 女)
            </li>
            <li>
              <span className="text-neon-cyan">Age:</span> child, teenager, young adult,
              middle-aged, elderly
            </li>
            <li>
              <span className="text-neon-cyan">Pitch:</span> very low → very high pitch
              (极低音调 … 极高音调)
            </li>
            <li>
              <span className="text-neon-cyan">Style:</span> whisper
            </li>
            <li>
              <span className="text-neon-cyan">English accent</span> (English text only):
              american, british, australian, canadian, indian, chinese, korean, japanese,
              portuguese, russian
            </li>
            <li>
              <span className="text-neon-cyan">Chinese dialect</span> (Chinese text only):
              e.g. 四川话, 东北话, 河南话, 陕西话, …
            </li>
          </ul>
          <p className="mt-2 font-mono text-[11px] text-neon-green/90">
            female, young adult, high pitch, british accent
          </p>
          <p className="mt-1 text-void-dim">
            Omit traits you do not care about; matching is case-insensitive.
          </p>
          <a
            href={OMNIVOICE_VOICE_DESIGN_DOCS}
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto mt-2 inline-block text-neon-cyan underline decoration-neon-cyan/30 underline-offset-2 hover:decoration-neon-cyan"
          >
            Full attribute list (OmniVoice docs)
          </a>
        </div>
      </div>
    </div>
  )
}

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  refreshTts: () => void
  cloneRef: { blob: Blob; fileName: string } | null
  onPickCloneFile: (e: ChangeEvent<HTMLInputElement>) => void
  onClearClone: () => void
  voiceAnchor: StoredVoiceAnchor | null
  onBakeVoiceAnchor: () => Promise<void>
  onClearVoiceAnchor: () => Promise<void>
}


export function TtsOptionsPanel({
  settings,
  setSettings,
  refreshTts,
  cloneRef,
  onPickCloneFile,
  onClearClone,
  voiceAnchor,
  onBakeVoiceAnchor,
  onClearVoiceAnchor,
}: Props) {
  const [bakeBusy, setBakeBusy] = useState(false)
  const [playBusy, setPlayBusy] = useState(false)

  const playBakePhrase = async () => {
    if (!settings.voiceBakePhrase.trim() || playBusy) return
    setPlayBusy(true)
    try {
      const web = isWebStandalone()
      const voiceMode = web ? 'design' : settings.voiceMode
      const blob = await synthesizeSpeech({
        ttsBaseUrl: settings.ttsBaseUrl,
        ttsProvider: settings.ttsProvider,
        openrouterApiKey: settings.openrouterApiKey,
        openrouterTtsModel: settings.openrouterTtsModel,
        openrouterTtsVoice: settings.openrouterTtsVoice,
        runwareApiBaseUrl: settings.runwareApiBaseUrl,
        runwareApiKey: settings.runwareApiKey,
        runwareTtsModel: settings.runwareTtsModel,
        runwareXaiVoice: settings.runwareXaiVoice,
        runwareXaiLanguage: settings.runwareXaiLanguage,
        runwarePositivePrompt: settings.runwareXaiPositivePrompt || undefined,
        runwareTtsSpeed: settings.runwareTtsSpeed,
        text: settings.voiceBakePhrase,
        voiceMode,
        instruct: voiceMode === 'design' ? settings.voiceInstruct : undefined,
        voiceAnchor: voiceAnchor,
        ...(web ? { cloneRef: null, cloneRefText: null } : {}),
      })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => {
        URL.revokeObjectURL(url)
        setPlayBusy(false)
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        setPlayBusy(false)
      }
      await audio.play()
    } catch {
      setPlayBusy(false)
    }
  }

  const instructStale =
    voiceAnchor &&
    settings.voiceMode === 'design' &&
    voiceAnchor.sourceMode === 'design' &&
    (voiceAnchor.instructSnapshot ?? '') !== settings.voiceInstruct.trim()

  return (
    <div className="grid gap-4 text-sm">
      <div className="rounded border border-neon-green/25 bg-neon-green/[0.04] p-4 space-y-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-mono text-neon-green uppercase tracking-wider">
            <span>◉</span>
            <span>Speech To Text</span>
          </p>
          <p className="mt-1 text-xs text-void-dim">
            Microphone input for the composer. This section only affects speech-to-text.
          </p>
        </div>
        {isWebStandalone() ? (
          <p className="rounded border border-void-muted/30 bg-void-black/30 px-3 py-2 text-xs text-void-dim">
            Voice input (STT) is not available in the phone/browser build. Use the desktop app if you
            need microphone transcription.
          </p>
        ) : (
          <>
            <div className="form-group">
              <label className="form-label">
                <span className="text-neon-green">◉</span> STT_PROVIDER
              </label>
              <select
                className="form-select"
                value={settings.sttProvider}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    sttProvider:
                      e.target.value === 'openrouter' ? 'openrouter' : 'none',
                  }))
                }
              >
                <option value="none">Disabled</option>
                <option value="openrouter">OpenRouter Whisper</option>
              </select>
            </div>

            {settings.sttProvider === 'openrouter' && (
              <div className="bg-void-black/50 border border-neon-green/25 p-4 rounded">
                <p className="text-xs text-void-dim">
                  Uses <span className="font-mono text-neon-green">OPENROUTER_API_KEY</span> from
                  General settings. Click the microphone button in the composer to record and transcribe.
                </p>
                <div className="form-group mt-3">
                  <label className="form-label">OPENROUTER_STT_MODEL</label>
                  <input
                    className="cyber-input"
                    value={settings.openrouterSttModel}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, openrouterSttModel: e.target.value }))
                    }
                    placeholder="openai/whisper-large-v3-turbo"
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="rounded border border-neon-cyan/25 bg-neon-cyan/[0.03] p-4 space-y-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-mono text-neon-cyan uppercase tracking-wider">
            <span>◈</span>
            <span>Text To Speech</span>
          </p>
          <p className="mt-1 text-xs text-void-dim">
            Speech output settings, providers, and voice controls for reading responses aloud.
          </p>
        </div>

        {isElectron() && (
          <div className="rounded border border-neon-cyan/20 bg-void-black/40 px-3 py-2">
            <p className="text-xs font-mono text-neon-cyan uppercase tracking-wider">
              <span className="mr-2">⌘</span>TTS_SHORTCUT
            </p>
            <p className="mt-1 text-xs text-void-dim">
              Global shortcut: <code className="text-neon-cyan">Ctrl+Alt+Shift+V</code>. Reads current
              clipboard text with the active TTS settings while Voidcast is running.
            </p>
          </div>
        )}

        <div className="form-group">
        <label className="form-label">
          <span className="text-neon-cyan">◈</span> TTS_PROVIDER
        </label>
        <select
          className="form-select"
          value={settings.ttsProvider}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              ttsProvider:
                e.target.value === 'runware-xai'
                  ? 'runware-xai'
                  : e.target.value === 'openrouter-tts'
                    ? 'openrouter-tts'
                    : 'local',
            }))
          }
        >
          <option value="local">Local OmniVoice (`/tts`)</option>
          <option value="runware-xai">Runware cloud TTS</option>
          <option value="openrouter-tts">OpenRouter cloud TTS</option>
        </select>
        </div>

      {settings.ttsProvider === 'runware-xai' && (
        <div className="bg-void-black/50 border border-neon-yellow/25 p-4 rounded">
          <p className="text-xs text-void-dim">
            {isWebStandalone() ? (
              <>
                Runware TTS via server proxy (key from desktop General). Default model{' '}
                <span className="font-mono text-void-light">{RUNWARE_TTS_MODEL_DEFAULT}</span>.
                Local clone/anchor options are ignored.
              </>
            ) : (
              <>
                Uses <span className="font-mono text-neon-yellow">RUNWARE_API_KEY</span> from
                General settings. Local TTS URL/clone/anchor options are ignored in this mode.
              </>
            )}
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <div className="form-group">
              <label className="form-label">RUNWARE_TTS_MODEL</label>
              <select
                className="form-select"
                value={
                  RUNWARE_TTS_MODEL_PRESETS.some((m) => m.id === settings.runwareTtsModel)
                    ? settings.runwareTtsModel
                    : '__custom__'
                }
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '__custom__') {
                    setSettings((s) => ({ ...s, runwareTtsModel: '', runwareXaiVoice: '' }))
                    return
                  }
                  setSettings((s) => ({
                    ...s,
                    runwareTtsModel: v,
                    runwareXaiVoice: '',
                  }))
                }}
              >
                {RUNWARE_TTS_MODEL_PRESETS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <option value="__custom__">Custom model id…</option>
              </select>
              {!RUNWARE_TTS_MODEL_PRESETS.some((m) => m.id === settings.runwareTtsModel) && (
                <input
                  className="cyber-input mt-2"
                  value={settings.runwareTtsModel}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, runwareTtsModel: e.target.value }))
                  }
                  placeholder={RUNWARE_TTS_MODEL_DEFAULT}
                />
              )}
            </div>
            <div className="form-group">
              <label className="form-label">RUNWARE_TTS_VOICE (optional)</label>
              <select
                className="form-select"
                value={
                  runwareTtsVoicesForModel(settings.runwareTtsModel).includes(
                    settings.runwareXaiVoice,
                  )
                    ? settings.runwareXaiVoice
                    : ''
                }
                onChange={(e) =>
                  setSettings((s) => ({ ...s, runwareXaiVoice: e.target.value }))
                }
              >
                <option value="">(model default)</option>
                {runwareTtsVoicesForModel(settings.runwareTtsModel).map((v) => (
                  <option key={v} value={v}>
                    {RUNWARE_TTS_VOICE_LABELS[v] || v}
                  </option>
                ))}
              </select>
            </div>
            {runwareTtsSupportsLanguage(settings.runwareTtsModel) && (
              <div className="form-group sm:col-span-2">
                <label className="form-label">RUNWARE_TTS_LANGUAGE (optional)</label>
                <input
                  className="cyber-input"
                  value={settings.runwareXaiLanguage}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, runwareXaiLanguage: e.target.value }))
                  }
                  placeholder={runwareTtsLanguagePlaceholder(settings.runwareTtsModel)}
                />
              </div>
            )}
            {/* Qwen CustomVoice / VoiceDesign extras */}
            {(settings.runwareTtsModel.includes('customvoice') || settings.runwareTtsModel.includes('voicedesign')) && (
              <div className="form-group sm:col-span-2">
                <label className="form-label">
                  <span className="text-neon-purple">◈</span> POSITIVE PROMPT (style/emotion)
                </label>
                <textarea
                  className="cyber-input resize-y"
                  rows={2}
                  value={settings.runwareXaiPositivePrompt}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, runwareXaiPositivePrompt: e.target.value }))
                  }
                  placeholder="e.g. happy, energetic, professional (leave empty for default)"
                />
              </div>
            )}
            {settings.runwareTtsModel.includes('qwen') && (
              <div className="form-group sm:col-span-2">
                <label className="form-label">
                  <span className="text-neon-cyan">◈</span> SPEED
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0.25}
                    max={4}
                    step={0.05}
                    value={settings.runwareTtsSpeed}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, runwareTtsSpeed: parseFloat(e.target.value) }))
                    }
                    className="flex-1 accent-neon-cyan"
                  />
                  <input
                    type="number"
                    min={0.25}
                    max={4}
                    step={0.05}
                    value={settings.runwareTtsSpeed}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, runwareTtsSpeed: parseFloat(e.target.value) || 1.0 }))
                    }
                    className="w-16 cyber-input text-right accent-neon-cyan"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {settings.ttsProvider === 'openrouter-tts' && (
        <div className="bg-void-black/50 border border-neon-cyan/25 p-4 rounded">
          <p className="text-xs text-void-dim">
            {isWebStandalone() ? (
              <>
                OpenRouter TTS via server proxy (key from desktop General). Default model{' '}
                <span className="font-mono text-void-light">{OPENROUTER_TTS_MODEL_DEFAULT}</span>.
              </>
            ) : (
              <>
                Uses <span className="font-mono text-neon-cyan">OPENROUTER_API_KEY</span> from
                General settings to call OpenRouter TTS (
                <span className="font-mono">{OPENROUTER_TTS_MODEL_DEFAULT}</span> by default).
                OpenAI GPT-4o Mini TTS was removed from OpenRouter; saved settings migrate
                automatically.
              </>
            )}
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <div className="form-group">
              <label className="form-label">OPENROUTER_TTS_MODEL</label>
              <select
                className="form-select"
                value={
                  OPENROUTER_TTS_MODEL_PRESETS.some((m) => m.id === settings.openrouterTtsModel)
                    ? settings.openrouterTtsModel
                    : '__custom__'
                }
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '__custom__') {
                    setSettings((s) => ({ ...s, openrouterTtsModel: '', openrouterTtsVoice: '' }))
                    return
                  }
                  setSettings((s) => ({
                    ...s,
                    openrouterTtsModel: v,
                    openrouterTtsVoice: '',
                  }))
                }}
              >
                {OPENROUTER_TTS_MODEL_PRESETS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <option value="__custom__">Custom model id…</option>
              </select>
              {!OPENROUTER_TTS_MODEL_PRESETS.some((m) => m.id === settings.openrouterTtsModel) && (
                <input
                  className="cyber-input mt-2"
                  value={settings.openrouterTtsModel}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, openrouterTtsModel: e.target.value }))
                  }
                  placeholder={OPENROUTER_TTS_MODEL_DEFAULT}
                />
              )}
            </div>
            <div className="form-group">
              <label className="form-label">OPENROUTER_TTS_VOICE (optional)</label>
              <select
                className="form-select"
                value={
                  openRouterTtsVoicesForModel(settings.openrouterTtsModel).includes(
                    settings.openrouterTtsVoice,
                  )
                    ? settings.openrouterTtsVoice
                    : ''
                }
                onChange={(e) =>
                  setSettings((s) => ({ ...s, openrouterTtsVoice: e.target.value }))
                }
              >
                <option value="">(model default)</option>
                {openRouterTtsVoicesForModel(settings.openrouterTtsModel).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Server URL */}
      {settings.ttsProvider === 'local' && (
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-cyan">◈</span> TTS_SERVER_URL
        </label>
        <input
          className={`cyber-input ${isWebStandalone() ? 'opacity-90' : ''}`}
          readOnly={isWebStandalone()}
          value={settings.ttsBaseUrl}
          onChange={(e) =>
            setSettings((s) => ({ ...s, ttsBaseUrl: e.target.value }))
          }
        />
        {isWebStandalone() && (
          <p className="text-xs text-void-dim mt-1 font-mono">
            Served from this host; voice and tools use the same local server.
          </p>
        )}
        {!isWebStandalone() && (
          <div className="text-xs text-void-dim mt-1 leading-snug">
            <p>
              Local TTS is distributed as a separate installer. Keep this URL pointed to your
              external Local TTS server instance.
            </p>
            <p className="mt-1 font-mono">
              Required API: GET /health and POST /tts (default: http://127.0.0.1:8765)
            </p>
            <a
              href={LOCAL_TTS_SETUP_DOCS}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-1 text-neon-cyan underline decoration-neon-cyan/30 underline-offset-2 hover:decoration-neon-cyan"
            >
              Open Local TTS setup guide
            </a>
          </div>
        )}
      </div>
      )}

        {/* Refresh Button */}
        <button
          type="button"
          className="cyber-btn text-sm self-start"
          onClick={() => void refreshTts()}
        >
          <span className="mr-2">↻</span> CHECK_TTS_STATUS
        </button>

      {/* Voice Mode Selection */}
      {settings.ttsProvider === 'local' && (
      <div className="bg-void-black/50 border border-neon-magenta/20 p-4">
        <p className="text-xs font-mono text-neon-magenta uppercase tracking-wider mb-3">
          <span className="mr-2">◉</span>VOICE_MODE
        </p>
        {isWebStandalone() ? (
          <div className="rounded border border-void-muted/30 bg-void-mid/20 px-3 py-2 text-xs text-void-dim leading-snug">
            <span className="font-mono text-neon-cyan">Voice Design</span> only in this
            browser build (instruct + optional anchor baked here).{' '}
            <span className="text-void-text">
              Voice Clone with a WAV file stays on the desktop app — there is no shared
              reference audio from the PC.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(
              [
                ['design', 'Voice Design', 'Describe voice characteristics.'],
                ['clone', 'Voice Clone', 'Clone from reference audio clip.'],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={`flex cursor-pointer items-start gap-3 px-3 py-2 border transition-all ${
                  settings.voiceMode === value
                    ? 'border-neon-cyan/50 bg-neon-cyan/5 text-neon-cyan'
                    : 'border-void-muted/30 text-void-text hover:border-void-dim hover:bg-void-mid/30'
                }`}
              >
                <input
                  type="radio"
                  name="voiceMode"
                  className="mt-1 accent-neon-cyan"
                  checked={settings.voiceMode === value}
                  onChange={() => setSettings((s) => ({ ...s, voiceMode: value }))}
                />
                <span>
                  <span className="font-mono text-sm">{label}</span>
                  <span className="mt-0.5 block text-xs opacity-70">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Voice Design Instruct */}
      {settings.ttsProvider === 'local' && settings.voiceMode === 'design' && (
        <div className="form-group">
          <label className="form-label flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="text-neon-purple">◇</span>
              <span>VOICE_DESCRIPT</span>
            </span>
            <VoiceDescriptInfo />
          </label>
          <input
            className="cyber-input"
            value={settings.voiceInstruct}
            onChange={(e) =>
              setSettings((s) => ({ ...s, voiceInstruct: e.target.value }))
            }
            placeholder="e.g. female, British accent, calm"
          />
        </div>
      )}

      {settings.ttsProvider === 'local' && (settings.voiceMode === 'design') && (
        <div className="bg-void-black/50 border border-neon-cyan/25 p-4">
          <p className="text-xs font-mono text-neon-cyan mb-2 uppercase tracking-wider">
            <span className="mr-2">◇</span>VOICE_ANCHOR
          </p>
          <p className="text-xs text-void-dim mb-3">
            Bake a short line once; long reads use it as a clone reference so every
            chunk keeps the same voice (design is random per request otherwise).
          </p>
          <div className="form-group">
            <label className="form-label text-void-dim">BAKE_PHRASE</label>
            <input
              className="cyber-input"
              value={settings.voiceBakePhrase}
              onChange={(e) =>
                setSettings((s) => ({ ...s, voiceBakePhrase: e.target.value }))
              }
              placeholder="Short line matching your language"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              className="cyber-btn text-xs"
              disabled={bakeBusy}
              onClick={() => {
                setBakeBusy(true)
                void onBakeVoiceAnchor().finally(() => setBakeBusy(false))
              }}
            >
              {bakeBusy ? 'BAKING…' : 'BAKE_LOCK_VOICE'}
            </button>
            <button
              type="button"
              className="cyber-btn text-xs"
              disabled={playBusy || !settings.voiceBakePhrase.trim()}
              onClick={() => void playBakePhrase()}
            >
              {playBusy ? 'PLAYING…' : '▶ PLAY'}
            </button>
            {voiceAnchor && (
              <button
                type="button"
                className="text-xs text-neon-red hover:underline font-mono"
                onClick={() => void onClearVoiceAnchor()}
              >
                CLEAR_ANCHOR
              </button>
            )}
          </div>
          {voiceAnchor ? (
            <p className="text-xs font-mono text-neon-green mt-2">
              Locked — ref: “{voiceAnchor.refText.slice(0, 48)}
              {voiceAnchor.refText.length > 48 ? '…' : ''}”
            </p>
          ) : (
            <p className="text-xs text-void-dim mt-2">No anchor — per-chunk variation</p>
          )}
          {instructStale ? (
            <p className="text-xs text-neon-yellow mt-2">
              Voice description changed since bake — bake again to match the new
              instruct.
            </p>
          ) : null}
        </div>
      )}

      {/* Voice Clone Panel (desktop / Electron only) */}
      {!isWebStandalone() &&
        settings.ttsProvider === 'local' &&
        settings.voiceMode === 'clone' && (
        <div className="bg-void-black/50 border border-neon-purple/30 p-4">
          <p className="text-xs font-mono text-neon-purple mb-3">
            <span className="mr-2">⬡</span>REFERENCE_CLONE
          </p>
          <p className="text-xs text-void-dim mb-3">
            Upload 3-10s WAV clip. Stored locally in IndexedDB.
          </p>
          
          <div className="flex flex-wrap items-center gap-2">
            <label className="cyber-btn text-xs cursor-pointer">
              SELECT_AUDIO
              <input
                type="file"
                accept="audio/*,.wav,audio/wav"
                className="hidden"
                onChange={(e) => void onPickCloneFile(e)}
              />
            </label>
            
            {cloneRef && (
              <div className="flex items-center gap-2 text-xs font-mono text-neon-green">
                <span className="text-neon-green">✓</span>
                <span className="truncate max-w-[150px]" title={cloneRef.fileName}>
                  {cloneRef.fileName}
                </span>
                <button
                  type="button"
                  className="text-neon-red hover:underline"
                  onClick={() => void onClearClone()}
                >
                  REMOVE
                </button>
              </div>
            )}
          </div>

          {/* Clone waveform visualization */}
          {cloneRef && (
            <div className="clone-waveform mt-4">
              {Array.from({ length: 15 }).map((_, i) => (
                <span
                  key={i}
                  style={{
                    animationDelay: `${i * 50}ms`,
                    height: `${20 + Math.random() * 60}%`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Reference Transcript */}
          <div className="form-group mt-4">
            <label className="form-label text-void-dim">
              REF_TRANSCRIPT (optional)
            </label>
            <textarea
              rows={2}
              className="cyber-input text-sm resize-none"
              value={settings.cloneRefText}
              onChange={(e) =>
                setSettings((s) => ({ ...s, cloneRefText: e.target.value }))
              }
              placeholder="Text from the clip — improves accuracy"
            />
          </div>
        </div>
      )}

      {/* Speed / Steps / Duration — only the local OmniVoice server honors these. */}
      {settings.ttsProvider === 'local' && (
        <>
          {/* Speed Control */}
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-green">▶</span> SPEED_MULTIPLIER
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0.25}
                max={4}
                step={0.05}
                className="form-slider flex-1"
                value={settings.ttsSpeed}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    ttsSpeed: Number(e.target.value) || 1,
                  }))
                }
              />
              <span className="w-16 text-right font-mono text-neon-cyan">
                {settings.ttsSpeed.toFixed(2)}x
              </span>
            </div>
          </div>

          {/* Diffusion Steps */}
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-yellow">⬡</span> DIFFUSION_STEPS
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={4}
                max={128}
                step={1}
                className="form-slider flex-1"
                value={settings.ttsNumStep}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    ttsNumStep: Math.round(Number(e.target.value)) || 32,
                  }))
                }
              />
              <span className="w-16 text-right font-mono text-neon-cyan">
                {settings.ttsNumStep}
              </span>
            </div>
            <p className="text-xs text-void-dim mt-1">
              Lower = faster | Default = 32 | Higher = quality
            </p>
          </div>

          {/* Duration Override */}
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-red">◐</span> DURATION_OVERRIDE (seconds)
            </label>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="done"
              placeholder="Auto (empty)"
              className="cyber-input"
              value={
                settings.ttsDurationSec == null
                  ? ''
                  : String(settings.ttsDurationSec)
              }
              onChange={(e) => {
                const t = e.target.value.trim()
                setSettings((s) => ({
                  ...s,
                  ttsDurationSec:
                    t === ''
                      ? null
                      : (() => {
                          const n = Number(t)
                          if (!Number.isFinite(n) || n <= 0) return null
                          return n
                        })(),
                }))
              }}
            />
            <p className="text-xs text-void-dim mt-1">
              Fixed output length (single chunk only)
            </p>
          </div>
        </>
      )}

      {/* Auto Voice Toggle */}
      <label className="flex items-start gap-3 p-3 border border-void-muted/30 bg-void-black/50">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-neon-cyan"
          checked={settings.autoVoice}
          onChange={(e) =>
            setSettings((s) => ({ ...s, autoVoice: e.target.checked }))
          }
        />
        <span>
          <span className="font-mono text-sm text-neon-green">AUTO_VOICE</span>
          <span className="mt-1 block text-xs text-void-dim">
            Play TTS automatically after assistant reply completes
          </span>
        </span>
      </label>

        {/* Chunk Size */}
        <div className="form-group">
          <label className="form-label">
            <span className="text-neon-cyan">⬡</span> CHUNK_SIZE (chars)
          </label>
          <NumericSettingInput
            min={80}
            max={2000}
            value={settings.ttsChunkMaxChars}
            onCommit={(ttsChunkMaxChars) =>
              setSettings((s) => ({ ...s, ttsChunkMaxChars }))
            }
          />
          <p className="text-xs text-void-dim mt-1">
            Long responses split into chunks for streaming playback
          </p>
        </div>
      </div>
    </div>
  )
}
