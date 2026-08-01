import type { AppSettings } from '@/lib/settings'
import { withOpenRouterModel, withOpenRouterProviderOnly } from '@/lib/settings'
import { DEEPSEEK_LLM_PRESET_MODELS, NVIDIA_LLM_PRESET_MODELS, OPENAI_LLM_PRESET_MODELS, OPENCODE_GO_LLM_PRESET_MODELS, OPENROUTER_LLM_PRESET_MODELS } from '@/lib/cloudLlmPresets'
import { NumericSettingInput } from '@/components/options/NumericSettingInput'
import { isWebStandalone } from '@/lib/platform'
import { pinnedIdLabel, pinsForProvider, toScopedPinnedId } from '@/lib/pinnedModels'
import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { CloudLlmPreset } from '@/lib/cloudLlmPresets'

function pinnedChips(
  pinnedModels: string[],
  presets: CloudLlmPreset[],
  currentModelId: string,
  onToggle: (id: string) => void,
) {
  if (pinnedModels.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {pinnedModels.map((id) => {
        const preset = presets.find((p) => p.id === id)
        const label = preset?.label ?? pinnedIdLabel(id)
        const isCurrent = id === currentModelId
        return (
          <span
            key={id}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs transition-colors ${
              isCurrent
                ? 'border-neon-cyan/60 bg-neon-cyan/10 text-neon-cyan'
                : 'border-void-muted/40 bg-void-muted/20 text-void-dim hover:border-void-dim'
            }`}
          >
            <span className="max-w-[160px] truncate">{label}</span>
            <button
              type="button"
              className="ml-0.5 leading-none text-void-dim transition-colors hover:text-neon-red"
              title={`Unpin ${label}`}
              onClick={() => onToggle(id)}
            >
              ×
            </button>
          </span>
        )
      })}
    </div>
  )
}

function PinToggleButton({
  pinned,
  onToggle,
}: {
  pinned: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`shrink-0 rounded border px-2 py-1.5 font-mono text-[10px] tracking-wide transition-colors ${
        pinned
          ? 'border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan'
          : 'border-void-muted/40 text-void-dim hover:border-void-dim hover:text-void-text'
      }`}
      title={pinned ? 'Unpin this model' : 'Pin this model'}
      onClick={onToggle}
    >
      {pinned ? 'PINNED' : 'PIN'}
    </button>
  )
}

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  loadModels: () => void
  modelsLoading: boolean
  ollamaModels: string[]
  modelsError: string | null
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function LlmOptionsPanel({
  settings,
  setSettings,
  loadModels,
  modelsLoading,
  ollamaModels,
  modelsError,
}: Props) {
  const pinned = settings.pinnedModels ?? []

  const handleTogglePin = useCallback(
    (modelId: string) => {
      setSettings((prev) => {
        const prevList = prev.pinnedModels ?? []
        const alreadyPinned = prevList.includes(modelId)
        return {
          ...prev,
          pinnedModels: alreadyPinned
            ? prevList.filter((id) => id !== modelId)
            : [...prevList, modelId],
        }
      })
    },
    [setSettings],
  )

  return (
    <div className="grid gap-5 text-sm">
      {/* Ollama URL */}
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-cyan mr-2">◎</span> LLM_PROVIDER
        </label>
        <select
          className="form-select"
          value={settings.llmProvider}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              llmProvider:
                e.target.value === 'openrouter'
                  ? 'openrouter'
                  : e.target.value === 'nvidia'
                    ? 'nvidia'
                    : e.target.value === 'deepseek'
                      ? 'deepseek'
                      : e.target.value === 'openai'
                        ? 'openai'
                        : e.target.value === 'opencode-go'
                          ? 'opencode-go'
                          : 'ollama',
            }))
          }
        >
          <option value="ollama">Ollama (local)</option>
          <option value="openrouter">OpenRouter (cloud)</option>
          <option value="nvidia">NVIDIA (cloud)</option>
          <option value="deepseek">DeepSeek (cloud)</option>
          <option value="openai">OpenAI (cloud)</option>
          <option value="opencode-go">OpenCode Go (cloud)</option>
        </select>
      </div>

      {/* Ollama URL */}
      {settings.llmProvider === 'ollama' && <div className="form-group">
        <label className="form-label">
          <span className="text-neon-purple mr-2">◇</span> OLLAMA_BASE_URL
        </label>
        <input
          className={`cyber-input ${isWebStandalone() ? 'opacity-90' : ''}`}
          readOnly={isWebStandalone()}
          value={settings.ollamaBaseUrl}
          onChange={(e) =>
            setSettings((s) => ({ ...s, ollamaBaseUrl: e.target.value }))
          }
        />
        {isWebStandalone() && (
          <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
            Proxied through the local server at <code className="text-neon-purple">/api/ollama/*</code> to the
            desktop&apos;s Ollama. Same LAN as the phone browser.
          </p>
        )}
      </div>}

      {/* Model Selection */}
      {settings.llmProvider === 'ollama' && <div className="form-group">
        <div className="flex items-center justify-between mb-2">
          <label
            className="form-label mb-0 cursor-help"
            title="Suggested on Ollama: Qwen 3.5, Gemma 4, MiniMax 2.7 (exact tag names vary — use REFRESH and your library)."
          >
            <span className="text-neon-cyan mr-2">◈</span> MODEL_SELECTION
          </label>
          <button
            type="button"
            className="cyber-btn text-xs py-1.5"
            disabled={modelsLoading}
            onClick={() => void loadModels()}
          >
            {modelsLoading ? (
              <span className="flex items-center gap-2">
                <span className="cyber-spinner w-3 h-3" />
                SCANNING
              </span>
            ) : (
              '↻ REFRESH'
            )}
          </button>
        </div>

        {/* Status Badge */}
        {!modelsError && ollamaModels.length > 0 && (
          <div className="cyber-badge success mb-3 inline-flex">
            <span className="status-dot online mr-2" />
            {ollamaModels.length} MODELS_DETECTED
          </div>
        )}

        {modelsError && (
          <div className="cyber-badge danger mb-3 inline-flex">
            <span className="mr-2">⚠</span>
            CONNECTION_FAILED
          </div>
        )}

        {/* Pinned chips for Ollama */}
        {pinnedChips(
          pinsForProvider(pinned, 'ollama'),
          pinsForProvider(pinned, 'ollama').map((id) => ({
            id,
            label: pinnedIdLabel(id),
          })),
          toScopedPinnedId('ollama', settings.ollamaModel),
          handleTogglePin,
        )}

        {/* Model Dropdown */}
        <div className="flex items-center gap-2">
        <select
          className="form-select flex-1"
          value={
            ollamaModels.includes(settings.ollamaModel)
              ? settings.ollamaModel
              : settings.ollamaModel
                ? `__custom__${settings.ollamaModel}`
                : ''
          }
          disabled={modelsLoading}
          onChange={(e) => {
            const v = e.target.value
            if (!v || v.startsWith('__custom__')) return
            setSettings((s) => ({ ...s, ollamaModel: v }))
          }}
        >
          {modelsLoading && <option value="">Loading models...</option>}
          {!modelsLoading && ollamaModels.length === 0 && (
            <option value="">No models found</option>
          )}
          {ollamaModels.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {settings.ollamaModel &&
            !ollamaModels.includes(settings.ollamaModel) && (
              <option value={`__custom__${settings.ollamaModel}`}>
                {settings.ollamaModel} (manual)
              </option>
            )}
        </select>
        <PinToggleButton
          pinned={pinned.includes(toScopedPinnedId('ollama', settings.ollamaModel))}
          onToggle={() => handleTogglePin(toScopedPinnedId('ollama', settings.ollamaModel))}
        />
        </div>

        {/* Manual Model Input */}
        <input
          className="cyber-input mt-2"
          placeholder="Enter model name manually..."
          value={
            ollamaModels.includes(settings.ollamaModel)
              ? ''
              : settings.ollamaModel
          }
          onChange={(e) =>
            setSettings((s) => ({ ...s, ollamaModel: e.target.value }))
          }
        />
      </div>}

      {settings.llmProvider === 'openrouter' && (
        <>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-purple mr-2">◇</span> OPENROUTER_BASE_URL
            </label>
            <input
              className={`cyber-input ${isWebStandalone() ? 'opacity-90' : ''}`}
              readOnly={isWebStandalone()}
              value={settings.openrouterBaseUrl}
              onChange={(e) =>
                setSettings((s) => ({ ...s, openrouterBaseUrl: e.target.value }))
              }
              placeholder="https://openrouter.ai/api/v1"
            />
            {isWebStandalone() && (
              <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
                Proxied through the local server at{' '}
                <code className="text-neon-purple">/api/openrouter/*</code> using keys from the
                desktop app.
              </p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-cyan mr-2">◈</span> OPENROUTER_MODEL
            </label>
            {pinnedChips(
              pinsForProvider(pinned, 'openrouter'),
              OPENROUTER_LLM_PRESET_MODELS.map((m) => ({
                id: toScopedPinnedId('openrouter', m.id),
                label: m.label,
              })),
              toScopedPinnedId('openrouter', settings.openrouterModel),
              handleTogglePin,
            )}
            <div className="flex items-center gap-2">
            <select
              className="form-select flex-1"
              value={
                OPENROUTER_LLM_PRESET_MODELS.some((m) => m.id === settings.openrouterModel)
                  ? settings.openrouterModel
                  : settings.openrouterModel
                    ? `__custom__${settings.openrouterModel}`
                    : ''
              }
              onChange={(e) => {
                const v = e.target.value
                if (!v || v.startsWith('__custom__')) return
                setSettings((s) => ({ ...s, ...withOpenRouterModel(s, v) }))
              }}
            >
              {OPENROUTER_LLM_PRESET_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {settings.openrouterModel &&
                !OPENROUTER_LLM_PRESET_MODELS.some((m) => m.id === settings.openrouterModel) && (
                  <option value={`__custom__${settings.openrouterModel}`}>
                    {settings.openrouterModel} (manual)
                  </option>
                )}
            </select>
            <PinToggleButton
              pinned={pinned.includes(toScopedPinnedId('openrouter', settings.openrouterModel))}
              onToggle={() =>
                handleTogglePin(toScopedPinnedId('openrouter', settings.openrouterModel))
              }
            />
            </div>
            <input
              className="cyber-input mt-2"
              value={settings.openrouterModel}
              onChange={(e) => {
                const nextModel = e.target.value
                setSettings((s) => {
                  const key = nextModel.trim()
                  const map = s.openrouterProviderByModel || {}
                  // Restore remembered provider when the typed id matches a saved model;
                  // otherwise keep the field as-is while typing a new/custom id.
                  if (key && Object.prototype.hasOwnProperty.call(map, key)) {
                    return {
                      ...s,
                      openrouterModel: nextModel,
                      openrouterProviderOnly: (map[key] || '').trim(),
                    }
                  }
                  return { ...s, openrouterModel: nextModel }
                })
              }}
              placeholder="openrouter/free"
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-yellow mr-2">⊘</span> OPENROUTER_PROVIDER (optional)
            </label>
            <input
              className="cyber-input"
              value={settings.openrouterProviderOnly}
              onChange={(e) =>
                setSettings((s) => ({ ...s, ...withOpenRouterProviderOnly(s, e.target.value) }))
              }
              placeholder="anthropic"
            />
            <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
              Force routing to one OpenRouter provider slug for the selected model (e.g.{' '}
              <code className="text-void-light/90">anthropic</code>,{' '}
              <code className="text-void-light/90">openai</code>,{' '}
              <code className="text-void-light/90">deepinfra</code>). Remembered per model —
              switching models restores that model's provider. Leave empty for default load
              balancing. No fallbacks when set.
            </p>
          </div>
        </>
      )}

      {settings.llmProvider === 'nvidia' && (
        <>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-purple mr-2">◇</span> NVIDIA_BASE_URL
            </label>
            <input
              className={`cyber-input ${isWebStandalone() ? 'opacity-90' : ''}`}
              readOnly={isWebStandalone()}
              value={settings.nvidiaBaseUrl}
              onChange={(e) =>
                setSettings((s) => ({ ...s, nvidiaBaseUrl: e.target.value }))
              }
              placeholder="https://integrate.api.nvidia.com/v1"
            />
            {isWebStandalone() && (
              <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
                Proxied through the local server at{' '}
                <code className="text-neon-purple">/api/nvidia/*</code> using keys from the desktop
                app.
              </p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-cyan mr-2">◈</span> NVIDIA_MODEL
            </label>
            {pinnedChips(
              pinsForProvider(pinned, 'nvidia'),
              NVIDIA_LLM_PRESET_MODELS.map((m) => ({
                id: toScopedPinnedId('nvidia', m.id),
                label: m.label,
              })),
              toScopedPinnedId('nvidia', settings.nvidiaModel),
              handleTogglePin,
            )}
            <div className="flex items-center gap-2">
            <select
              className="form-select flex-1"
              value={
                NVIDIA_LLM_PRESET_MODELS.some((m) => m.id === settings.nvidiaModel)
                  ? settings.nvidiaModel
                  : settings.nvidiaModel
                    ? `__custom__${settings.nvidiaModel}`
                    : ''
              }
              onChange={(e) => {
                const v = e.target.value
                if (!v || v.startsWith('__custom__')) return
                setSettings((s) => ({ ...s, nvidiaModel: v }))
              }}
            >
              {NVIDIA_LLM_PRESET_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {settings.nvidiaModel &&
                !NVIDIA_LLM_PRESET_MODELS.some((m) => m.id === settings.nvidiaModel) && (
                  <option value={`__custom__${settings.nvidiaModel}`}>
                    {settings.nvidiaModel} (manual)
                  </option>
                )}
            </select>
            <PinToggleButton
              pinned={pinned.includes(toScopedPinnedId('nvidia', settings.nvidiaModel))}
              onToggle={() => handleTogglePin(toScopedPinnedId('nvidia', settings.nvidiaModel))}
            />
            </div>
            <input
              className="cyber-input mt-2"
              value={settings.nvidiaModel}
              onChange={(e) =>
                setSettings((s) => ({ ...s, nvidiaModel: e.target.value }))
              }
              placeholder="nvidia/nemotron-3-super-120b-a12b"
            />
          </div>
        </>
      )}

      {settings.llmProvider === 'deepseek' && (
        <>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-purple mr-2">◇</span> DEEPSEEK_BASE_URL
            </label>
            <input
              className={`cyber-input ${isWebStandalone() ? 'opacity-90' : ''}`}
              readOnly={isWebStandalone()}
              value={settings.deepseekBaseUrl}
              onChange={(e) =>
                setSettings((s) => ({ ...s, deepseekBaseUrl: e.target.value }))
              }
              placeholder="https://api.deepseek.com"
            />
            {isWebStandalone() && (
              <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
                Proxied through the local server at{' '}
                <code className="text-neon-purple">/api/deepseek/*</code> using keys from the desktop
                app.
              </p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-cyan mr-2">◈</span> DEEPSEEK_MODEL
            </label>
            {pinnedChips(
              pinsForProvider(pinned, 'deepseek'),
              DEEPSEEK_LLM_PRESET_MODELS.map((m) => ({
                id: toScopedPinnedId('deepseek', m.id),
                label: m.label,
              })),
              toScopedPinnedId('deepseek', settings.deepseekModel),
              handleTogglePin,
            )}
            <div className="flex items-center gap-2">
            <select
              className="form-select flex-1"
              value={
                DEEPSEEK_LLM_PRESET_MODELS.some((m) => m.id === settings.deepseekModel)
                  ? settings.deepseekModel
                  : settings.deepseekModel
                    ? `__custom__${settings.deepseekModel}`
                    : ''
              }
              onChange={(e) => {
                const v = e.target.value
                if (!v || v.startsWith('__custom__')) return
                setSettings((s) => ({ ...s, deepseekModel: v }))
              }}
            >
              {DEEPSEEK_LLM_PRESET_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {settings.deepseekModel &&
                !DEEPSEEK_LLM_PRESET_MODELS.some((m) => m.id === settings.deepseekModel) && (
                  <option value={`__custom__${settings.deepseekModel}`}>
                    {settings.deepseekModel} (manual)
                  </option>
                )}
            </select>
            <PinToggleButton
              pinned={pinned.includes(toScopedPinnedId('deepseek', settings.deepseekModel))}
              onToggle={() =>
                handleTogglePin(toScopedPinnedId('deepseek', settings.deepseekModel))
              }
            />
            </div>
            <input
              className="cyber-input mt-2"
              value={settings.deepseekModel}
              onChange={(e) =>
                setSettings((s) => ({ ...s, deepseekModel: e.target.value }))
              }
              placeholder="deepseek-v4-pro"
            />
          </div>
        </>
      )}

      {settings.llmProvider === 'openai' && (
        <>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-purple mr-2">◇</span> OPENAI_BASE_URL
            </label>
            <input
              className={`cyber-input ${isWebStandalone() ? 'opacity-90' : ''}`}
              readOnly={isWebStandalone()}
              value={settings.openaiBaseUrl}
              onChange={(e) =>
                setSettings((s) => ({ ...s, openaiBaseUrl: e.target.value }))
              }
              placeholder="https://api.openai.com/v1"
            />
            {isWebStandalone() && (
              <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
                Proxied through the local server at{' '}
                <code className="text-neon-purple">/api/openai/*</code> using keys from the desktop
                app.
              </p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-cyan mr-2">◈</span> OPENAI_MODEL
            </label>
            {pinnedChips(
              pinsForProvider(pinned, 'openai'),
              OPENAI_LLM_PRESET_MODELS.map((m) => ({
                id: toScopedPinnedId('openai', m.id),
                label: m.label,
              })),
              toScopedPinnedId('openai', settings.openaiModel),
              handleTogglePin,
            )}
            <div className="flex items-center gap-2">
            <select
              className="form-select flex-1"
              value={
                OPENAI_LLM_PRESET_MODELS.some((m) => m.id === settings.openaiModel)
                  ? settings.openaiModel
                  : settings.openaiModel
                    ? `__custom__${settings.openaiModel}`
                    : ''
              }
              onChange={(e) => {
                const v = e.target.value
                if (!v || v.startsWith('__custom__')) return
                setSettings((s) => ({ ...s, openaiModel: v }))
              }}
            >
              {OPENAI_LLM_PRESET_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {settings.openaiModel &&
                !OPENAI_LLM_PRESET_MODELS.some((m) => m.id === settings.openaiModel) && (
                  <option value={`__custom__${settings.openaiModel}`}>
                    {settings.openaiModel} (manual)
                  </option>
                )}
            </select>
            <PinToggleButton
              pinned={pinned.includes(toScopedPinnedId('openai', settings.openaiModel))}
              onToggle={() =>
                handleTogglePin(toScopedPinnedId('openai', settings.openaiModel))
              }
            />
            </div>
            <input
              className="cyber-input mt-2"
              value={settings.openaiModel}
              onChange={(e) =>
                setSettings((s) => ({ ...s, openaiModel: e.target.value }))
              }
              placeholder="gpt-5.6-sol"
            />
          </div>
        </>
      )}

      {settings.llmProvider === 'opencode-go' && (
        <>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-purple mr-2">◇</span> OPENCODE_GO_BASE_URL
            </label>
            <input
              type="text"
              className="cyber-input"
              value={settings.opencodeGoBaseUrl}
              onChange={(e) =>
                setSettings((s) => ({ ...s, opencodeGoBaseUrl: e.target.value }))
              }
              placeholder="https://opencode.ai/zen/go/v1"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-void-dim font-mono">
              Upstream has no CORS — requests go through your local TTS server proxy
              (<code className="text-void-light/90">/api/opencode-go</code>). Keep the local server
              running. OpenAI-compatible models only (not MiniMax/Qwen).
            </p>
          </div>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-cyan mr-2">◈</span> OPENCODE_GO_MODEL
            </label>
            {pinnedChips(
              pinsForProvider(pinned, 'opencode-go'),
              OPENCODE_GO_LLM_PRESET_MODELS.map((m) => ({
                id: toScopedPinnedId('opencode-go', m.id),
                label: m.label,
              })),
              toScopedPinnedId('opencode-go', settings.opencodeGoModel),
              handleTogglePin,
            )}
            <div className="flex items-center gap-2">
            <select
              className="form-select flex-1"
              value={
                OPENCODE_GO_LLM_PRESET_MODELS.some((m) => m.id === settings.opencodeGoModel)
                  ? settings.opencodeGoModel
                  : settings.opencodeGoModel
                    ? `__custom__${settings.opencodeGoModel}`
                    : OPENCODE_GO_LLM_PRESET_MODELS[0]?.id
              }
              onChange={(e) => {
                const raw = e.target.value
                const v = raw.startsWith('__custom__') ? raw.slice('__custom__'.length) : raw
                if (raw === '__custom__') return
                setSettings((s) => ({ ...s, opencodeGoModel: v }))
              }}
            >
              {OPENCODE_GO_LLM_PRESET_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {settings.opencodeGoModel &&
                !OPENCODE_GO_LLM_PRESET_MODELS.some((m) => m.id === settings.opencodeGoModel) && (
                  <option value={`__custom__${settings.opencodeGoModel}`}>
                    {settings.opencodeGoModel} (manual)
                  </option>
                )}
            </select>
            <PinToggleButton
              pinned={pinned.includes(toScopedPinnedId('opencode-go', settings.opencodeGoModel))}
              onToggle={() =>
                handleTogglePin(toScopedPinnedId('opencode-go', settings.opencodeGoModel))
              }
            />
            </div>
            <input
              className="cyber-input mt-2"
              value={settings.opencodeGoModel}
              onChange={(e) =>
                setSettings((s) => ({ ...s, opencodeGoModel: e.target.value }))
              }
              placeholder="deepseek-v4-pro"
            />
          </div>
        </>
      )}

      {/* Temperature */}
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-magenta mr-2">◉</span> TEMPERATURE
          <span className="ml-3 font-mono text-neon-cyan">
            {settings.llmTemperature.toFixed(2)}
          </span>
        </label>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            className="form-slider flex-1"
            value={settings.llmTemperature}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                llmTemperature: clamp(Number(e.target.value) || 0, 0, 2),
              }))
            }
          />
          <div className="flex flex-col text-xs text-void-dim">
            <span>Precise</span>
            <span>Creative</span>
          </div>
        </div>
        <p className="text-xs text-void-dim mt-1">
          Higher = creative/random · Lower = deterministic/focused (0-2)
        </p>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="llm-think-level">
          <span className="text-neon-purple mr-2">◇</span> THINKING_LEVEL
        </label>
        <select
          id="llm-think-level"
          className="form-input font-mono"
          value={settings.llmThinkLevel}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              llmThinkLevel: e.target.value as typeof s.llmThinkLevel,
            }))
          }
        >
          <option value="off">OFF — think: false</option>
          <option value="low">LOW — GPT-OSS / levels</option>
          <option value="medium">MEDIUM</option>
          <option value="high">HIGH</option>
          <option value="on">ON — think: true</option>
        </select>
        <p className="text-xs text-void-dim mt-1">
          Thinking models default to reasoning unless <code className="text-neon-purple/90">think: false</code> is sent.
          Qwen/DeepSeek use ON/OFF; GPT-OSS uses low/medium/high. DeepSeek maps to reasoning_effort when enabled.
        </p>
      </div>

      {/* Context Window — Ollama only (cloud providers use model-native limits) */}
      {settings.llmProvider === 'ollama' && (
        <div className="form-group">
          <label className="form-label">
            <span className="text-neon-green mr-2">⬡</span> CONTEXT_WINDOW
            <span className="ml-3 font-mono text-neon-cyan">
              {settings.llmNumCtx.toLocaleString()} tokens
            </span>
          </label>
          <NumericSettingInput
            min={512}
            max={262144}
            value={settings.llmNumCtx}
            onCommit={(llmNumCtx) => setSettings((s) => ({ ...s, llmNumCtx }))}
          />
          <p className="text-xs text-void-dim mt-1">
            Sent to Ollama as <code className="text-void-light">options.num_ctx</code>. Cloud
            providers (OpenRouter / DeepSeek / NVIDIA / OpenCode Go) ignore this — CTX meter uses each
            model&apos;s native window.
          </p>
        </div>
      )}

      <div className="form-group">
        <label className="flex items-center gap-2 text-sm font-mono text-void-light cursor-pointer">
          <input
            type="checkbox"
            className="accent-neon-cyan"
            checked={settings.contextAutoCompress}
            onChange={(e) =>
              setSettings((s) => ({ ...s, contextAutoCompress: e.target.checked }))
            }
          />
          <span className="text-neon-yellow mr-1">◐</span>
          AUTO_COMPRESS at 90% context usage
        </label>
        <p className="text-xs text-void-dim mt-1">
          Summarizes older turns into hidden memory; chat UI stays full. Manual COMPRESS still works when off.
        </p>
      </div>

      {/* System Prompt */}
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-red mr-2">⚠</span> SYSTEM_PROMPT
        </label>
        <textarea
          rows={5}
          className="cyber-input resize-y"
          value={settings.llmSystemPrompt}
          onChange={(e) =>
            setSettings((s) => ({ ...s, llmSystemPrompt: e.target.value }))
          }
          placeholder="e.g. Answer concisely. Do not invent facts."
        />
        <p className="text-xs text-void-dim mt-1">
          System message sent at start of each request. This is the{' '}
          <span className="text-void-light/90">Default</span> preset — chats set to Code, Creative
          or Teacher (header dropdown) use their own prompt.
        </p>
      </div>

      {/* Model Info Panel */}
      <div className="bg-void-black/50 border border-neon-cyan/20 p-4">
        <p className="text-xs font-mono text-neon-cyan mb-3 uppercase tracking-wider">
          <span className="mr-2">◈</span>
          {settings.llmProvider === 'openrouter'
            ? 'OPENROUTER_NOTES'
            : settings.llmProvider === 'nvidia'
              ? 'NVIDIA_NOTES'
              : settings.llmProvider === 'deepseek'
                ? 'DEEPSEEK_NOTES'
                : settings.llmProvider === 'openai'
                  ? 'OPENAI_NOTES'
                  : settings.llmProvider === 'opencode-go'
                    ? 'OPENCODE_GO_NOTES'
                    : 'RECOMMENDED_MODELS'}
        </p>
        {settings.llmProvider === 'ollama' && <ul className="text-xs font-mono text-void-dim space-y-1">
          <li className="flex items-center gap-2">
            <span className="text-neon-green">✓</span>
            Qwen 3.5 (e.g. <code className="text-void-light/90">qwen3</code> family — add{' '}
            <code className="text-void-light/90">-vl</code> for vision)
          </li>
          <li className="flex items-center gap-2">
            <span className="text-neon-green">✓</span>
            Gemma 4 (multimodal / tools-capable tags on Ollama)
          </li>
          <li className="flex items-center gap-2">
            <span className="text-neon-green">✓</span>
            MiniMax 2.7 (when available in your Ollama library)
          </li>
          <li className="flex items-center gap-2 opacity-50">
            <span className="text-neon-red">✗</span>
            Old or tiny models without tool / multimodal support
          </li>
        </ul>}
        {settings.llmProvider === 'openrouter' && (
          <ul className="text-xs font-mono text-void-dim space-y-1">
            <li className="flex items-center gap-2">
              <span className="text-neon-green">✓</span>
              Use full model IDs, e.g. <code className="text-void-light/90">openai/gpt-4o-mini</code>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-neon-green">✓</span>
              {isWebStandalone()
                ? 'API key stays on desktop; requests use the local server proxy'
                : 'Keep API key in General options on this desktop'}
            </li>
            <li className="flex items-center gap-2 opacity-70">
              <span className="text-neon-yellow">!</span>
              Tool-calling support depends on selected upstream model/provider.
            </li>
            <li className="flex items-center gap-2 opacity-70">
              <span className="text-neon-yellow">!</span>
              Optional <code className="text-void-light/90">OPENROUTER_PROVIDER</code> locks routing
              to one provider slug per model (no fallbacks); switching models restores the saved
              provider.
            </li>
          </ul>
        )}
        {settings.llmProvider === 'nvidia' && (
          <ul className="text-xs font-mono text-void-dim space-y-1">
            <li className="flex items-center gap-2">
              <span className="text-neon-green">✓</span>
              Use OpenAI-compatible endpoint at <code className="text-void-light/90">/chat/completions</code>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-neon-green">✓</span>
              Keep NVIDIA API key in General options
            </li>
            <li className="flex items-center gap-2 opacity-70">
              <span className="text-neon-yellow">!</span>
              Some upstream providers may require reasoning replay in multi-turn chats.
            </li>
          </ul>
        )}
        {settings.llmProvider === 'deepseek' && (
          <ul className="text-xs font-mono text-void-dim space-y-1">
            <li className="flex items-center gap-2">
              <span className="text-neon-green">✓</span>
              Direct API — no OpenRouter free-tier limits; billed from your DeepSeek balance
            </li>
            <li className="flex items-center gap-2">
              <span className="text-neon-green">✓</span>
              Models: <code className="text-void-light/90">deepseek-v4-pro</code>,{' '}
              <code className="text-void-light/90">deepseek-v4-flash</code>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-neon-green">✓</span>
              API key in General options; THINKING_LEVEL maps to DeepSeek reasoning mode
            </li>
          </ul>
        )}
        {settings.llmProvider === 'openai' && (
          <ul className="text-xs font-mono text-void-dim space-y-1">
            <li className="flex items-center gap-2">
              <span className="text-neon-green">✓</span>
              Native Chat Completions at <code className="text-void-light/90">api.openai.com/v1</code>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-neon-green">✓</span>
              Use bare model ids (e.g. <code className="text-void-light/90">gpt-5.6-sol</code>), not{' '}
              <code className="text-void-light/90">openai/…</code> OpenRouter routes
            </li>
            <li className="flex items-center gap-2">
              <span className="text-neon-green">✓</span>
              API key in General options
            </li>
          </ul>
        )}
        {settings.llmProvider === 'opencode-go' && (
          <ul className="text-xs font-mono text-void-dim space-y-1">
            <li className="flex items-center gap-2">
              <span className="text-neon-green">✓</span>
              Proxied via local TTS server (upstream blocks browser CORS)
            </li>
            <li className="flex items-center gap-2">
              <span className="text-neon-green">✓</span>
              Get a key at{' '}
              <a
                href="https://opencode.ai/auth"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neon-cyan underline decoration-neon-cyan/35"
              >
                opencode.ai/auth
              </a>
            </li>
            <li className="flex items-center gap-2 opacity-70">
              <span className="text-neon-yellow">!</span>
              Restart the local TTS server after updating, then retry
            </li>
            <li className="flex items-center gap-2 opacity-70">
              <span className="text-neon-yellow">!</span>
              MiniMax / Qwen on Go use Anthropic Messages — not supported yet
            </li>
          </ul>
        )}
      </div>
    </div>
  )
}
