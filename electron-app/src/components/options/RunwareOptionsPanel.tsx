import {
  getRunwareProfileForModel,
  RUNWARE_CONFIGURED_MODELS,
  RUNWARE_GPT_IMAGE_2_MODEL_ID,
  RUNWARE_Z_IMAGE_TURBO_MODEL_ID,
  type AppSettings,
  type RunwareModelProfile,
} from '@/lib/settings'
import { isElectron, isWebStandalone } from '@/lib/platform'
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
}

const RUNWARE_FLUX_MODEL_ID = 'runware:400@6'

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function RunwareOptionsPanel({ settings, setSettings }: Props) {
  const [pickBusy, setPickBusy] = useState(false)
  const configuredModels = useMemo(() => RUNWARE_CONFIGURED_MODELS, [])
  const configuredModelIdSet = useMemo(
    () => new Set(configuredModels.map((m) => m.id)),
    [configuredModels],
  )
  const configuredLabelById = useMemo(() => {
    const out = new Map<string, string>()
    for (const m of configuredModels) out.set(m.id, m.label)
    return out
  }, [configuredModels])
  const selectedImageModel = configuredModelIdSet.has(settings.runwareImageModel)
    ? settings.runwareImageModel
    : RUNWARE_FLUX_MODEL_ID
  const selectedEditModel = configuredModelIdSet.has(settings.runwareEditModel)
    ? settings.runwareEditModel
    : RUNWARE_FLUX_MODEL_ID
  const activeImageProfile = getRunwareProfileForModel(settings, selectedImageModel)
  const activeEditProfile = getRunwareProfileForModel(settings, selectedEditModel)
  const isGptImage2Selected = selectedImageModel === RUNWARE_GPT_IMAGE_2_MODEL_ID
  const isGptImage2EditSelected = selectedEditModel === RUNWARE_GPT_IMAGE_2_MODEL_ID
  const isZImageTurboSelected = selectedImageModel === RUNWARE_Z_IMAGE_TURBO_MODEL_ID
  const isZImageTurboEditSelected = selectedEditModel === RUNWARE_Z_IMAGE_TURBO_MODEL_ID
  const imageMinSide = isGptImage2Selected ? 480 : isZImageTurboSelected ? 128 : 256
  const imageMaxSide = isGptImage2Selected ? 3840 : 2048
  const editMinSide = isGptImage2EditSelected ? 480 : isZImageTurboEditSelected ? 128 : 256
  const editMaxSide = isGptImage2EditSelected ? 3840 : 2048
  const sideStep = 16

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

  const updateProfile = (
    modelId: string,
    update: (current: RunwareModelProfile) => RunwareModelProfile,
  ) => {
    setSettings((s) => {
      const current = getRunwareProfileForModel(s, modelId)
      const next = update(current)
      const nextProfiles = {
        ...s.runwareModelProfiles,
        [modelId]: next,
      }
      return {
        ...s,
        runwareModelProfiles: nextProfiles,
        // Keep flat fields aligned with active image model profile for compatibility.
        ...(s.runwareImageModel === modelId
          ? {
              runwareWidth: next.width,
              runwareHeight: next.height,
              runwareSteps: next.steps,
              runwareCfgScale: next.cfgScale,
            }
          : {}),
      }
    })
  }

  return (
    <div className="grid gap-5 text-sm">
      <div className="border-b border-void-muted/30 pb-3">
        <p className="text-xs font-mono text-void-dim">
          <span className="text-neon-green mr-2">◌</span>
          Runware uses configured models only. Current profile:{' '}
          {configuredLabelById.get(selectedImageModel) ?? selectedImageModel}.
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
            Allows the LLM to call Runware tools <code className="text-neon-green">generate_image</code> and <code className="text-neon-green">edit_image_runware</code>.
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
        <label className="form-label mb-2">
          <span className="text-neon-cyan mr-2">◈</span> IMAGE_MODEL
        </label>
        <select
          className="form-select mb-3"
          value={selectedImageModel}
          onChange={(e) => {
            const v = e.target.value
            if (!configuredModelIdSet.has(v)) return
            setSettings((s) => ({ ...s, runwareImageModel: v }))
          }}
        >
          {configuredModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-void-dim mt-2">
          Used by <code className="text-neon-green">generate_image</code>.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="form-group">
          <label className="form-label">IMAGE_WIDTH</label>
          <input
            type="number"
            min={imageMinSide}
            max={imageMaxSide}
            step={sideStep}
            className="cyber-input"
            value={activeImageProfile.width}
            onChange={(e) =>
              updateProfile(selectedImageModel, (current) => ({
                ...current,
                width: clamp(Math.round(Number(e.target.value)) || 1024, imageMinSide, imageMaxSide),
              }))
            }
          />
        </div>
        <div className="form-group">
          <label className="form-label">IMAGE_HEIGHT</label>
          <input
            type="number"
            min={imageMinSide}
            max={imageMaxSide}
            step={sideStep}
            className="cyber-input"
            value={activeImageProfile.height}
            onChange={(e) =>
              updateProfile(selectedImageModel, (current) => ({
                ...current,
                height: clamp(Math.round(Number(e.target.value)) || 1024, imageMinSide, imageMaxSide),
              }))
            }
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {!isGptImage2Selected ? (
          <>
            <div className="form-group">
              <label className="form-label">IMAGE_STEPS</label>
              <input
                type="number"
                min={1}
                max={80}
                step={1}
                className="cyber-input"
                value={activeImageProfile.steps}
                onChange={(e) =>
                  updateProfile(selectedImageModel, (current) => ({
                    ...current,
                    steps: clamp(Math.round(Number(e.target.value)) || 4, 1, 80),
                  }))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">IMAGE_CFG_SCALE</label>
              <input
                type="number"
                min={0}
                max={30}
                step={0.1}
                className="cyber-input"
                value={activeImageProfile.cfgScale}
                onChange={(e) =>
                  updateProfile(selectedImageModel, (current) => ({
                    ...current,
                    cfgScale: clamp(Number(e.target.value) || 0, 0, 30),
                  }))
                }
              />
            </div>
          </>
        ) : (
          <div className="form-group sm:col-span-2">
            <label className="form-label">IMAGE_QUALITY</label>
            <select
              className="form-select"
              value={activeImageProfile.gptQuality || 'auto'}
              onChange={(e) =>
                updateProfile(selectedImageModel, (current) => ({
                  ...current,
                  gptQuality:
                    e.target.value === 'low' ||
                    e.target.value === 'medium' ||
                    e.target.value === 'high'
                      ? e.target.value
                      : 'auto',
                }))
              }
            >
              <option value="auto">auto</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </div>
        )}
      </div>
      {isGptImage2Selected && <p className="text-xs text-neon-yellow/80 -mt-2">GPT Image 2 uses size + quality.</p>}

      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-cyan mr-2">◈</span> EDIT_MODEL
        </label>
        <select
          className="form-select mb-3"
          value={selectedEditModel}
          onChange={(e) => {
            const v = e.target.value
            if (!configuredModelIdSet.has(v)) return
            setSettings((s) => ({ ...s, runwareEditModel: v }))
          }}
        >
          {configuredModels.map((model) => (
            <option key={`edit-${model.id}`} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-void-dim mt-2">
          Used by <code className="text-neon-green">edit_image_runware</code>.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="form-group">
          <label className="form-label">EDIT_WIDTH</label>
          <input
            type="number"
            min={editMinSide}
            max={editMaxSide}
            step={sideStep}
            className="cyber-input"
            value={activeEditProfile.width}
            onChange={(e) =>
              updateProfile(selectedEditModel, (current) => ({
                ...current,
                width: clamp(Math.round(Number(e.target.value)) || 1024, editMinSide, editMaxSide),
              }))
            }
          />
        </div>
        <div className="form-group">
          <label className="form-label">EDIT_HEIGHT</label>
          <input
            type="number"
            min={editMinSide}
            max={editMaxSide}
            step={sideStep}
            className="cyber-input"
            value={activeEditProfile.height}
            onChange={(e) =>
              updateProfile(selectedEditModel, (current) => ({
                ...current,
                height: clamp(Math.round(Number(e.target.value)) || 1024, editMinSide, editMaxSide),
              }))
            }
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {!isGptImage2EditSelected ? (
          <>
            <div className="form-group">
              <label className="form-label">EDIT_STEPS</label>
              <input
                type="number"
                min={1}
                max={80}
                step={1}
                className="cyber-input"
                value={activeEditProfile.steps}
                onChange={(e) =>
                  updateProfile(selectedEditModel, (current) => ({
                    ...current,
                    steps: clamp(Math.round(Number(e.target.value)) || 4, 1, 80),
                  }))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">EDIT_CFG_SCALE</label>
              <input
                type="number"
                min={0}
                max={30}
                step={0.1}
                className="cyber-input"
                value={activeEditProfile.cfgScale}
                onChange={(e) =>
                  updateProfile(selectedEditModel, (current) => ({
                    ...current,
                    cfgScale: clamp(Number(e.target.value) || 0, 0, 30),
                  }))
                }
              />
            </div>
          </>
        ) : (
          <div className="form-group sm:col-span-2">
            <label className="form-label">EDIT_QUALITY</label>
            <select
              className="form-select"
              value={activeEditProfile.gptQuality || 'auto'}
              onChange={(e) =>
                updateProfile(selectedEditModel, (current) => ({
                  ...current,
                  gptQuality:
                    e.target.value === 'low' ||
                    e.target.value === 'medium' ||
                    e.target.value === 'high'
                      ? e.target.value
                      : 'auto',
                }))
              }
            >
              <option value="auto">auto</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </div>
        )}
      </div>
      {isGptImage2EditSelected && (
        <p className="text-xs text-neon-yellow/80 -mt-2">
          GPT Image 2 edit uses size + quality + reference images.
        </p>
      )}

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
