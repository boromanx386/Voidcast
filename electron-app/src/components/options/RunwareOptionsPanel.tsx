import type { AppSettings } from '@/lib/settings'
import { isElectron, isWebStandalone } from '@/lib/platform'
import { fetchRunwareImageModelOptions, type RunwareModelOption } from '@/lib/runware'
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
}

const RUNWARE_IMAGE_MODEL_PRESETS = [
  'runware:101@1',
  'runware:29@1',
  'runware:27@1',
  'runware:28@1',
]

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function RunwareOptionsPanel({ settings, setSettings }: Props) {
  const [pickBusy, setPickBusy] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsInfo, setModelsInfo] = useState<string | null>(null)
  const [liveModels, setLiveModels] = useState<RunwareModelOption[]>([])
  const [presetOptions] = useState<RunwareModelOption[]>(
    RUNWARE_IMAGE_MODEL_PRESETS.map((id) => ({ id, label: id })),
  )

  const availableModels = useMemo(() => {
    const byId = new Map<string, RunwareModelOption>()
    for (const p of presetOptions) byId.set(p.id, p)
    for (const l of liveModels) byId.set(l.id, l)
    return Array.from(byId.values())
  }, [presetOptions, liveModels])

  const selectedModel = availableModels.some((m) => m.id === settings.runwareImageModel)
    ? settings.runwareImageModel
    : `__custom__${settings.runwareImageModel}`

  const browseImageFolder = useCallback(async () => {
    const vc = isElectron() ? window.voidcast?.pickDirectory : undefined
    if (!vc) return
    setPickBusy(true)
    try {
      const r = await vc()
      if (r.ok && r.path) {
        setSettings((s) => ({ ...s, runwareImageOutputDir: r.path }))
      }
    } finally {
      setPickBusy(false)
    }
  }, [setSettings])

  const refreshModels = async () => {
    setModelsInfo(null)
    setModelsError(null)
    setModelsLoading(true)
    try {
      const list = await fetchRunwareImageModelOptions({
        apiBaseUrl: settings.runwareApiBaseUrl,
        apiKey: settings.runwareApiKey,
        proxyBaseUrl: settings.ttsBaseUrl,
        search: 'image',
        limit: 100,
      })
      setLiveModels(list)
      if (list.length === 0) {
        setModelsInfo('No live models found for current search. Preset models are still available.')
      }
    } catch (e) {
      setLiveModels([])
      setModelsError(e instanceof Error ? e.message : String(e))
    } finally {
      setModelsLoading(false)
    }
  }

  return (
    <div className="grid gap-5 text-sm">
      <div className="border-b border-void-muted/30 pb-3">
        <p className="text-xs font-mono text-void-dim">
          <span className="text-neon-green mr-2">◌</span>
          Runware koristi se samo za generisanje slika. Ollama ostaje glavni LLM.
        </p>
      </div>

      <label className="flex items-start gap-3 p-4 bg-void-black/50 border border-void-muted/30">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-neon-cyan"
          checked={settings.toolsEnabled.runwareImage}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              toolsEnabled: { ...s.toolsEnabled, runwareImage: e.target.checked },
            }))
          }
        />
        <span className="flex-1">
          <span className="font-mono text-sm text-void-light">
            <span className="text-neon-green mr-2">◈</span>
            ENABLE_RUNWARE_IMAGE_TOOL
          </span>
          <span className="mt-1 block text-xs text-void-dim">
            Omogućava LLM-u tool poziv <code className="text-neon-green">generate_image</code>.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 p-4 bg-void-black/50 border border-void-muted/30">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-neon-cyan"
          checked={settings.runwareAutoSaveImages}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              runwareAutoSaveImages: e.target.checked,
            }))
          }
          disabled={isWebStandalone()}
        />
        <span className="flex-1">
          <span className="font-mono text-sm text-void-light">
            <span className="text-neon-green mr-2">⬇</span>
            AUTO_SAVE_GENERATED_IMAGES
          </span>
          <span className="mt-1 block text-xs text-void-dim">
            Automatically save every generated image to your selected folder (desktop app only).
          </span>
        </span>
      </label>

      {settings.runwareAutoSaveImages && isElectron() && (
        <div className="form-group">
          <label className="form-label">
            <span className="text-neon-green mr-2">▸</span>RUNWARE_IMAGE_OUTPUT_DIR
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              spellCheck={false}
              className="cyber-input flex-1 min-w-[12rem]"
              placeholder="C:\\Users\\...\\Pictures\\Voidcast"
              value={settings.runwareImageOutputDir}
              onChange={(e) =>
                setSettings((s) => ({ ...s, runwareImageOutputDir: e.target.value }))
              }
            />
            <button
              type="button"
              disabled={pickBusy}
              className="cyber-btn text-xs"
              onClick={() => void browseImageFolder()}
            >
              {pickBusy ? '...' : 'BROWSE'}
            </button>
          </div>
          <p className="text-xs text-void-dim mt-2">
            Required for auto-save. If empty, images are not auto-saved.
          </p>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-purple mr-2">◇</span> RUNWARE_API_BASE_URL
        </label>
        <input
          className="cyber-input"
          value={settings.runwareApiBaseUrl}
          onChange={(e) =>
            setSettings((s) => ({ ...s, runwareApiBaseUrl: e.target.value }))
          }
          placeholder="https://api.runware.ai/v1"
        />
      </div>

      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-yellow mr-2">⚿</span> RUNWARE_API_KEY
        </label>
        <input
          type="password"
          className="cyber-input"
          value={settings.runwareApiKey}
          onChange={(e) =>
            setSettings((s) => ({ ...s, runwareApiKey: e.target.value }))
          }
          placeholder="rw_..."
          autoComplete="off"
        />
        <p className="text-xs text-neon-yellow/80 mt-1">
          V1: ključ se čuva lokalno u browser/electron storage.
        </p>
      </div>

      <div className="form-group">
        <div className="flex items-center justify-between mb-2">
          <label className="form-label mb-0">
            <span className="text-neon-cyan mr-2">◈</span> IMAGE_MODEL
          </label>
          <button
            type="button"
            className="cyber-btn text-xs py-1.5"
            onClick={() => void refreshModels()}
            disabled={modelsLoading}
          >
            {modelsLoading ? 'SCANNING...' : '↻ REFRESH'}
          </button>
        </div>
        {modelsError && (
          <div className="cyber-badge danger mb-3 inline-flex">
            <span className="mr-2">⚠</span>
            {modelsError}
          </div>
        )}
        {!modelsError && modelsInfo && (
          <div className="cyber-badge mb-3 inline-flex">
            <span className="mr-2">i</span>
            {modelsInfo}
          </div>
        )}
        {!modelsError && liveModels.length > 0 && (
          <div className="cyber-badge success mb-3 inline-flex">
            <span className="status-dot online mr-2" />
            {liveModels.length} RUNWARE_MODELS_LOADED
          </div>
        )}
        <select
          className="form-select mb-3"
          value={selectedModel}
          onChange={(e) => {
            const v = e.target.value
            if (!v || v.startsWith('__custom__')) return
            setSettings((s) => ({ ...s, runwareImageModel: v }))
          }}
        >
          {availableModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
          {settings.runwareImageModel &&
            !availableModels.some((m) => m.id === settings.runwareImageModel) && (
              <option value={`__custom__${settings.runwareImageModel}`}>
                {settings.runwareImageModel} (manual)
              </option>
            )}
        </select>
        <input
          className="cyber-input"
          placeholder="Manual model ID..."
          value={
            availableModels.some((m) => m.id === settings.runwareImageModel)
              ? ''
              : settings.runwareImageModel
          }
          onChange={(e) =>
            setSettings((s) => ({ ...s, runwareImageModel: e.target.value }))
          }
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="form-group">
          <label className="form-label">WIDTH</label>
          <input
            type="number"
            min={256}
            max={2048}
            step={64}
            className="cyber-input"
            value={settings.runwareWidth}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                runwareWidth: clamp(Math.round(Number(e.target.value)) || 1024, 256, 2048),
              }))
            }
          />
        </div>
        <div className="form-group">
          <label className="form-label">HEIGHT</label>
          <input
            type="number"
            min={256}
            max={2048}
            step={64}
            className="cyber-input"
            value={settings.runwareHeight}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                runwareHeight: clamp(Math.round(Number(e.target.value)) || 1024, 256, 2048),
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
            max={80}
            step={1}
            className="cyber-input"
            value={settings.runwareSteps}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                runwareSteps: clamp(Math.round(Number(e.target.value)) || 30, 1, 80),
              }))
            }
          />
        </div>
        <div className="form-group">
          <label className="form-label">CFG_SCALE</label>
          <input
            type="number"
            min={0}
            max={30}
            step={0.1}
            className="cyber-input"
            value={settings.runwareCfgScale}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                runwareCfgScale: clamp(Number(e.target.value) || 0, 0, 30),
              }))
            }
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">NEGATIVE_PROMPT (optional)</label>
        <textarea
          rows={3}
          className="cyber-input resize-y"
          value={settings.runwareNegativePrompt}
          onChange={(e) =>
            setSettings((s) => ({ ...s, runwareNegativePrompt: e.target.value }))
          }
          placeholder="blurry, low quality, artifacts..."
        />
      </div>
    </div>
  )
}
