import type { AppSettings, RunwareMusicModelProfile } from '@/lib/settings'
import {
  RUNWARE_ACE_STEP_V1_5_TURBO_MODEL_ID,
  RUNWARE_CONFIGURED_MUSIC_MODELS,
  getRunwareMusicProfileForModel,
  maxStepsForMusicModelId,
} from '@/lib/settings'
import { isElectron, isWebStandalone } from '@/lib/platform'
import { NumericSettingInput } from '@/components/options/NumericSettingInput'
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  /** When embedded in Media tab, hide the top intro (section header is above). */
  variant?: 'standalone' | 'embedded'
}

export function RunwareMusicOptionsPanel({
  settings,
  setSettings,
  variant = 'standalone',
}: Props) {
  const [pickBusy, setPickBusy] = useState(false)

  const browseAudioFolder = useCallback(async () => {
    const vc = isElectron() ? window.voidcast?.pickDirectory : undefined
    if (!vc) return
    setPickBusy(true)
    try {
      const r = await vc()
      if (r.ok && r.path) {
        setSettings((s) => ({ ...s, runwareMusicOutputDir: r.path }))
      }
    } finally {
      setPickBusy(false)
    }
  }, [setSettings])

  const activeModelId = settings.runwareMusicModel || RUNWARE_ACE_STEP_V1_5_TURBO_MODEL_ID
  const activeProfile = getRunwareMusicProfileForModel(settings, activeModelId)
  const activeLabel =
    RUNWARE_CONFIGURED_MUSIC_MODELS.find((m) => m.id === activeModelId)?.label ?? activeModelId
  const stepsMax = maxStepsForMusicModelId(activeModelId)

  const updateActiveProfile = useCallback(
    (patch: Partial<RunwareMusicModelProfile>) => {
      setSettings((s) => {
        const current = getRunwareMusicProfileForModel(s, activeModelId)
        const next: RunwareMusicModelProfile = { ...current, ...patch }
        return {
          ...s,
          runwareMusicModelProfiles: {
            ...s.runwareMusicModelProfiles,
            [activeModelId]: next,
          },
          runwareMusicOutputFormat: next.outputFormat,
          runwareMusicDurationSec: next.durationSec,
          runwareMusicSteps: next.steps,
          runwareMusicCfgScale: next.cfgScale,
          runwareMusicSeed: next.seed,
        }
      })
    },
    [setSettings, activeModelId],
  )

  return (
    <div className="grid gap-5 text-sm">
      {variant === 'standalone' ? (
        <div className="border-b border-void-muted/30 pb-3">
          <p className="text-xs font-mono text-void-dim">
            <span className="mr-2 text-neon-green">♫</span>
            Active model:{' '}
            <code className="text-neon-green">{activeLabel}</code>{' '}
            (<code className="text-void-light">{activeModelId}</code>). Uses Runware API key
            (General).
          </p>
        </div>
      ) : (
        <div className="rounded border border-neon-purple/25 bg-void-black/40 p-3">
          <p className="text-xs text-void-dim">
            <span className="font-mono text-neon-purple">Runware ACE-Step</span> models only. Active:{' '}
            <code className="text-neon-purple">{activeLabel}</code>{' '}
            (<code className="text-void-light">{activeModelId}</code>).
          </p>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">
          <span className="mr-2 text-neon-purple">▸</span>RUNWARE_ACE_MODEL
        </label>
        <select
          className="form-select"
          value={activeModelId}
          onChange={(e) => {
            const nextId = e.target.value
            setSettings((s) => {
              const profile = getRunwareMusicProfileForModel(s, nextId)
              return {
                ...s,
                runwareMusicModel: nextId,
                runwareMusicOutputFormat: profile.outputFormat,
                runwareMusicDurationSec: profile.durationSec,
                runwareMusicSteps: profile.steps,
                runwareMusicCfgScale: profile.cfgScale,
                runwareMusicSeed: profile.seed,
              }
            })
          }}
        >
          {RUNWARE_CONFIGURED_MUSIC_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-void-dim">
          ACE-Step v1.5 on Runware. Each variant keeps its own steps, CFG, duration, format, and seed.
        </p>
      </div>

      <label className="flex items-start gap-3 p-4 bg-void-black/50 border border-void-muted/30">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-neon-cyan"
          checked={settings.toolsEnabled.runwareMusic}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              toolsEnabled: { ...s.toolsEnabled, runwareMusic: e.target.checked },
            }))
          }
        />
        <span className="flex-1">
          <span className="font-mono text-sm text-void-light">
            <span className="mr-2 text-neon-purple">◈</span>
            ENABLE_MUSIC_TOOL
          </span>
          <span className="mt-1 block text-xs text-void-dim">
            Enables Runware ACE-Step tool{' '}
            <code className="text-neon-purple">generate_music_runware</code> for text-to-audio.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 p-4 bg-void-black/50 border border-void-muted/30">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-neon-cyan"
          checked={settings.runwareAutoSaveMusic}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              runwareAutoSaveMusic: e.target.checked,
            }))
          }
          disabled={isWebStandalone()}
        />
        <span className="flex-1">
          <span className="font-mono text-sm text-void-light">
            <span className="text-neon-green mr-2">⬇</span>
            AUTO_SAVE_GENERATED_MUSIC
          </span>
          <span className="mt-1 block text-xs text-void-dim">
            Automatically save generated music files to your selected folder (desktop app only).
          </span>
        </span>
      </label>

      {settings.runwareAutoSaveMusic && isElectron() && (
        <div className="form-group">
          <label className="form-label">
            <span className="mr-2 text-neon-green">▸</span>MUSIC_OUTPUT_DIR
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              spellCheck={false}
              className="cyber-input flex-1 min-w-[12rem]"
              placeholder="C:\\Users\\...\\Music\\Voidcast"
              value={settings.runwareMusicOutputDir}
              onChange={(e) =>
                setSettings((s) => ({ ...s, runwareMusicOutputDir: e.target.value }))
              }
            />
            <button
              type="button"
              disabled={pickBusy}
              className="cyber-btn text-xs"
              onClick={() => void browseAudioFolder()}
            >
              {pickBusy ? '...' : 'BROWSE'}
            </button>
          </div>
          <p className="text-xs text-void-dim mt-2">
            Required for auto-save. If empty, generated music is not auto-saved.
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="form-group">
          <label className="form-label">OUTPUT_FORMAT</label>
          <select
            className="form-select"
            value={activeProfile.outputFormat}
            onChange={(e) => {
              const v = e.target.value
              const next: 'MP3' | 'WAV' | 'FLAC' | 'OGG' =
                v === 'WAV' || v === 'FLAC' || v === 'OGG' ? v : 'MP3'
              updateActiveProfile({ outputFormat: next })
            }}
          >
            <option value="MP3">MP3</option>
            <option value="WAV">WAV</option>
            <option value="FLAC">FLAC</option>
            <option value="OGG">OGG</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">DURATION_SEC (6–300)</label>
          <NumericSettingInput
            integer={false}
            min={6}
            max={300}
            value={activeProfile.durationSec}
            onCommit={(durationSec) => updateActiveProfile({ durationSec })}
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">STEPS (1–{stepsMax})</label>
        <NumericSettingInput
          min={1}
          max={stepsMax}
          value={activeProfile.steps}
          onCommit={(steps) => updateActiveProfile({ steps })}
        />
      </div>

      <label className="flex items-start gap-3 p-4 bg-void-black/50 border border-void-muted/30">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-neon-cyan"
          checked={activeProfile.seed != null}
          onChange={(e) =>
            updateActiveProfile({
              seed: e.target.checked ? (activeProfile.seed ?? 1337) : null,
            })
          }
        />
        <span className="flex-1">
          <span className="font-mono text-sm text-void-light">
            <span className="text-neon-green mr-2">#</span>
            USE_FIXED_SEED
          </span>
          <span className="mt-1 block text-xs text-void-dim">
            Keep the same random seed for reproducible results.
          </span>
          {activeProfile.seed != null ? (
            <NumericSettingInput
              className="cyber-input mt-3"
              min={0}
              max={2147483647}
              value={activeProfile.seed ?? 0}
              onCommit={(seed) => updateActiveProfile({ seed })}
            />
          ) : null}
        </span>
      </label>

      <p className="text-xs text-void-dim -mt-2">
        Default vocal language <code className="text-neon-green">en</code>.
        Tool args can still provide optional fields like lyrics, bpm, key/scale, and language when needed.
      </p>
    </div>
  )
}
