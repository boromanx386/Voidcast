import type { AppSettings } from '@/lib/settings'
import type { StoredVoiceAnchor } from '@/lib/voiceAnchorStorage'
import { isElectron, isWebStandalone } from '@/lib/platform'
import {
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react'

const OMNIVOICE_VOICE_DESIGN_DOCS =
  'https://github.com/k2-fsa/OmniVoice/blob/master/docs/voice-design.md'

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

  const instructStale =
    voiceAnchor &&
    settings.voiceMode === 'design' &&
    voiceAnchor.sourceMode === 'design' &&
    (voiceAnchor.instructSnapshot ?? '') !== settings.voiceInstruct.trim()

  return (
    <div className="grid gap-4 text-sm">
      {/* Server URL */}
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
            Served from this host; TTS and tools use the same origin.
          </p>
        )}
      </div>

      {/* Refresh Button */}
      <button
        type="button"
        className="cyber-btn text-sm self-start"
        onClick={() => void refreshTts()}
      >
        <span className="mr-2">↻</span> CHECK_TTS_STATUS
      </button>

      {/* Clipboard TTS Info (Electron only) */}
      {isElectron() && (
        <div className="bg-void-black/50 border border-void-muted/30 p-3 rounded">
          <p className="text-xs font-mono text-void-text">
            <span className="text-neon-magenta font-semibold">CLIPBOARD_TTS:</span>{' '}
            Copy text anywhere → press{' '}
            <kbd className="mx-1 px-2 py-0.5 bg-void-mid border border-void-dim text-neon-cyan font-mono text-xs">
              CTRL+ALT+SHIFT+V
            </kbd>{' '}
            while Voidcast is running.
          </p>
        </div>
      )}

      {/* Voice Mode Selection */}
      <div className="bg-void-black/50 border border-neon-magenta/20 p-4">
        <p className="text-xs font-mono text-neon-magenta uppercase tracking-wider mb-3">
          <span className="mr-2">◉</span>VOICE_MODE
        </p>
        <div className="flex flex-col gap-2">
          {(
            [
              ['auto', 'Auto Voice', 'Model selects voice automatically.'],
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
      </div>

      {/* Voice Design Instruct */}
      {settings.voiceMode === 'design' && (
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

      {(settings.voiceMode === 'auto' || settings.voiceMode === 'design') && (
        <div className="bg-void-black/50 border border-neon-cyan/25 p-4">
          <p className="text-xs font-mono text-neon-cyan mb-2 uppercase tracking-wider">
            <span className="mr-2">◇</span>VOICE_ANCHOR
          </p>
          <p className="text-xs text-void-dim mb-3">
            Bake a short line once; long reads use it as a clone reference so every
            chunk keeps the same voice (auto/design are random per request otherwise).
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

      {/* Voice Clone Panel */}
      {settings.voiceMode === 'clone' && (
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
          type="number"
          step={0.5}
          min={0}
          placeholder="Auto (null)"
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
        <input
          type="number"
          step={20}
          min={80}
          max={2000}
          className="cyber-input"
          value={settings.ttsChunkMaxChars}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              ttsChunkMaxChars: Math.round(Number(e.target.value)) || 380,
            }))
          }
        />
        <p className="text-xs text-void-dim mt-1">
          Long responses split into chunks for streaming playback
        </p>
      </div>
    </div>
  )
}
