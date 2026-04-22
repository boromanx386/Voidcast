import type { AppSettings } from '@/lib/settings'
import { isElectron, isWebStandalone } from '@/lib/platform'
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function RunwareMusicOptionsPanel({ settings, setSettings }: Props) {
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

  return (
    <div className="grid gap-5 text-sm">
      <div className="border-b border-void-muted/30 pb-3">
        <p className="text-xs font-mono text-void-dim">
          <span className="text-neon-green mr-2">♫</span>
          Fixed model:{' '}
          <code className="text-neon-green">ACE-Step v1.5 Turbo</code>{' '}
          (<code className="text-void-light">runware:ace-step@v1.5-turbo</code>).
          Uses shared Runware API URL/key from the Runware image tab.
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
            <span className="text-neon-green mr-2">◈</span>
            ENABLE_RUNWARE_MUSIC_TOOL
          </span>
          <span className="mt-1 block text-xs text-void-dim">
            Enables <code className="text-neon-green">generate_music_runware</code> for text-to-audio generation.
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
            <span className="text-neon-green mr-2">▸</span>RUNWARE_MUSIC_OUTPUT_DIR
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
            value={settings.runwareMusicOutputFormat}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                runwareMusicOutputFormat:
                  e.target.value === 'WAV' ||
                  e.target.value === 'FLAC' ||
                  e.target.value === 'OGG'
                    ? e.target.value
                    : 'MP3',
              }))
            }
          >
            <option value="MP3">MP3</option>
            <option value="WAV">WAV</option>
            <option value="FLAC">FLAC</option>
            <option value="OGG">OGG</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">DURATION_SEC</label>
          <input
            type="number"
            min={6}
            max={300}
            step={0.1}
            className="cyber-input"
            value={settings.runwareMusicDurationSec}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                runwareMusicDurationSec: clamp(Number(e.target.value) || 60, 6, 300),
              }))
            }
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="form-group">
          <label className="form-label">STEPS</label>
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            className="cyber-input"
            value={settings.runwareMusicSteps}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                runwareMusicSteps: clamp(Math.round(Number(e.target.value)) || 10, 1, 20),
              }))
            }
          />
        </div>
        <div className="form-group">
          <label className="form-label">CFG_SCALE</label>
          <input
            type="number"
            min={1}
            max={30}
            step={0.01}
            className="cyber-input"
            value={settings.runwareMusicCfgScale}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                runwareMusicCfgScale: clamp(Number(e.target.value) || 10, 1, 30),
              }))
            }
          />
        </div>
      </div>

      <label className="flex items-start gap-3 p-4 bg-void-black/50 border border-void-muted/30">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-neon-cyan"
          checked={settings.runwareMusicSeed != null}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              runwareMusicSeed: e.target.checked ? (s.runwareMusicSeed ?? 1337) : null,
            }))
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
          {settings.runwareMusicSeed != null ? (
            <input
              type="number"
              min={0}
              max={2147483647}
              step={1}
              className="cyber-input mt-3"
              value={settings.runwareMusicSeed}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  runwareMusicSeed: clamp(Math.round(Number(e.target.value)) || 0, 0, 2147483647),
                }))
              }
            />
          ) : null}
        </span>
      </label>

      <p className="text-xs text-void-dim -mt-2">
        Docs defaults in use: guidance type <code className="text-neon-green">apg</code>, vocal language <code className="text-neon-green">en</code>.
        Tool args can still provide optional fields like lyrics, bpm, key/scale, and language when needed.
      </p>
    </div>
  )
}
