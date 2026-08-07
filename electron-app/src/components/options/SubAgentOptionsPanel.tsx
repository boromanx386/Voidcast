import type { AppSettings, SubAgentConfig, LlmProvider } from '@/lib/settings'
import { withSubAgentOpenRouterProvider } from '@/lib/settings'
import {
  DEEPSEEK_LLM_PRESET_MODELS,
  NVIDIA_LLM_PRESET_MODELS,
  OPENAI_LLM_PRESET_MODELS,
  OPENCODE_GO_LLM_PRESET_MODELS,
  OPENROUTER_LLM_PRESET_MODELS,
  type CloudLlmPreset,
  type SubAgentProviderId,
} from '@/lib/cloudLlmPresets'
import {
  parsePinnedId,
  pinnedIdLabel,
  pinsForProvider,
  toScopedPinnedId,
  unwrapPinnedModelId,
} from '@/lib/pinnedModels'
import { useCallback, type Dispatch, type SetStateAction } from 'react'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  loadModels: () => void
  modelsLoading: boolean
  ollamaModels: string[]
  modelsError: string | null
}

type EndpointRole = 'vision' | 'coding'

function patchSubAgent(
  setSettings: Dispatch<SetStateAction<AppSettings>>,
  patch: Partial<SubAgentConfig>,
) {
  setSettings((s) => ({ ...s, subAgent: { ...s.subAgent, ...patch } }))
}

function parseProvider(value: string): SubAgentProviderId {
  if (value === 'openrouter') return 'openrouter'
  if (value === 'deepseek') return 'deepseek'
  if (value === 'openai') return 'openai'
  if (value === 'nvidia') return 'nvidia'
  if (value === 'opencode-go') return 'opencode-go'
  return 'ollama'
}

/** LlmProvider and SubAgentProviderId share the same string union for pin scope. */
function asLlmProvider(p: SubAgentProviderId): LlmProvider {
  return p
}

function pinnedChips(
  pinnedModels: string[],
  presets: Array<{ id: string; label: string }>,
  currentScopedId: string,
  onToggle: (id: string) => void,
) {
  if (pinnedModels.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {pinnedModels.map((id) => {
        const modelId = parsePinnedId(id)?.modelId ?? id
        const preset =
          presets.find((p) => p.id === id) ||
          presets.find((p) => p.id === modelId) ||
          presets.find((p) => parsePinnedId(p.id)?.modelId === modelId)
        const label = preset?.label ?? pinnedIdLabel(id)
        const isCurrent = id === currentScopedId
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

function SubAgentEndpointPicker({
  role,
  label,
  provider,
  model,
  openrouterProviderOnly,
  settings,
  setSettings,
  loadModels,
  modelsLoading,
  ollamaModels,
  modelsError,
}: {
  role: EndpointRole
  label: string
  provider: SubAgentProviderId
  model: string
  openrouterProviderOnly: string
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  loadModels: () => void
  modelsLoading: boolean
  ollamaModels: string[]
  modelsError: string | null
}) {
  const pinned = settings.pinnedModels ?? []
  const llmProv = asLlmProvider(provider)

  const presets: CloudLlmPreset[] | null =
    provider === 'openrouter'
      ? OPENROUTER_LLM_PRESET_MODELS
      : provider === 'deepseek'
        ? DEEPSEEK_LLM_PRESET_MODELS
        : provider === 'openai'
          ? OPENAI_LLM_PRESET_MODELS
          : provider === 'nvidia'
            ? NVIDIA_LLM_PRESET_MODELS
            : provider === 'opencode-go'
              ? OPENCODE_GO_LLM_PRESET_MODELS
              : null

  const ollamaInList = ollamaModels.includes(model)
  const presetInList = Boolean(presets?.some((m) => m.id === model))
  const inList = provider === 'ollama' ? ollamaInList : presetInList

  const handleTogglePin = useCallback(
    (pinnedId: string) => {
      setSettings((prev) => {
        const prevList = prev.pinnedModels ?? []
        const alreadyPinned = prevList.includes(pinnedId)
        return {
          ...prev,
          pinnedModels: alreadyPinned
            ? prevList.filter((id) => id !== pinnedId)
            : [...prevList, pinnedId],
        }
      })
    },
    [setSettings],
  )

  const setProvider = (next: SubAgentProviderId) => {
    if (role === 'vision') patchSubAgent(setSettings, { provider: next })
    else patchSubAgent(setSettings, { codingProvider: next })
  }

  const rememberedProvider = (modelId: string) =>
    ((settings.openrouterProviderByModel || {})[modelId] || '').trim()

  const setModel = (next: string, nextProvider?: SubAgentProviderId) => {
    const resolvedProvider = nextProvider ?? provider
    const clean = unwrapPinnedModelId(asLlmProvider(resolvedProvider), next)
    if (role === 'vision') {
      patchSubAgent(setSettings, {
        model: clean,
        ...(nextProvider ? { provider: nextProvider } : {}),
        ...(resolvedProvider === 'openrouter'
          ? { openrouterProviderOnly: rememberedProvider(clean.trim()) }
          : {}),
      })
    } else {
      patchSubAgent(setSettings, {
        codingModel: clean,
        ...(nextProvider ? { codingProvider: nextProvider } : {}),
        ...(resolvedProvider === 'openrouter'
          ? { codingOpenrouterProviderOnly: rememberedProvider(clean.trim()) }
          : {}),
      })
    }
  }

  const selectPreset = (v: string, nextProvider: SubAgentProviderId) => {
    if (!v || v.startsWith('__custom__')) return
    setModel(v, nextProvider)
  }

  const scopedPinId = model.trim()
    ? toScopedPinnedId(llmProv, model)
    : ''

  const cloudManualPlaceholder =
    provider === 'openrouter'
      ? 'openrouter/free'
      : provider === 'deepseek'
        ? 'deepseek-v4-pro'
        : provider === 'openai'
          ? 'gpt-5.6-sol'
          : provider === 'nvidia'
            ? 'nvidia/nemotron-3-super-120b-a12b'
            : provider === 'opencode-go'
              ? 'deepseek-v4-pro'
              : 'model id…'

  return (
    <div className="grid gap-4 rounded border border-void-border/60 p-3">
      <div className="form-group mb-0">
        <label className="form-label">
          <span className="text-neon-cyan mr-2">◎</span> {label}_PROVIDER
        </label>
        <select
          className="form-select"
          value={provider}
          onChange={(e) => setProvider(parseProvider(e.target.value))}
        >
          <option value="ollama">Ollama (local)</option>
          <option value="openrouter">OpenRouter (cloud)</option>
          <option value="nvidia">NVIDIA (cloud)</option>
          <option value="deepseek">DeepSeek (cloud)</option>
          <option value="openai">OpenAI (cloud)</option>
          <option value="opencode-go">OpenCode Go (cloud)</option>
        </select>
      </div>

      {provider === 'ollama' && (
        <div className="form-group mb-0">
          <div className="flex items-center justify-between mb-2">
            <label className="form-label mb-0">
              <span className="text-neon-cyan mr-2">◈</span> {label}_MODEL
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

          {!modelsError && ollamaModels.length > 0 && (
            <div className="cyber-badge success mb-3 inline-flex">
              <span className="status-dot online mr-2" />
              {ollamaModels.length} OLLAMA_MODELS
            </div>
          )}
          {modelsError && (
            <div className="cyber-badge danger mb-3 inline-flex">
              <span className="mr-2">⚠</span>
              OLLAMA_OFFLINE
            </div>
          )}

          {pinnedChips(
            pinsForProvider(pinned, 'ollama'),
            ollamaModels.map((name) => ({ id: name, label: name })),
            scopedPinId,
            handleTogglePin,
          )}

          <div className="flex items-center gap-2">
            <select
              className="form-select mb-0 flex-1"
              value={inList ? model : model ? `__custom__${model}` : ''}
              disabled={modelsLoading}
              onChange={(e) => selectPreset(e.target.value, 'ollama')}
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
              {model && !inList && (
                <option value={`__custom__${model}`}>{model} (manual)</option>
              )}
            </select>
            <PinToggleButton
              pinned={Boolean(scopedPinId && pinned.includes(scopedPinId))}
              onToggle={() => {
                if (scopedPinId) handleTogglePin(scopedPinId)
              }}
            />
          </div>

          <input
            className="cyber-input mt-2"
            placeholder="Enter model name manually..."
            value={inList ? '' : model}
            onChange={(e) => setModel(e.target.value, 'ollama')}
          />
        </div>
      )}

      {provider === 'openrouter' && (
        <>
          <div className="form-group mb-0">
            <label className="form-label">
              <span className="text-neon-cyan mr-2">◈</span> {label}_MODEL
            </label>
            {pinnedChips(
              pinsForProvider(pinned, 'openrouter'),
              OPENROUTER_LLM_PRESET_MODELS,
              scopedPinId,
              handleTogglePin,
            )}
            <div className="flex items-center gap-2">
              <select
                className="form-select mb-0 flex-1"
                value={inList ? model : model ? `__custom__${model}` : ''}
                onChange={(e) => selectPreset(e.target.value, 'openrouter')}
              >
                {OPENROUTER_LLM_PRESET_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                {model && !inList && (
                  <option value={`__custom__${model}`}>{model} (manual)</option>
                )}
              </select>
              <PinToggleButton
                pinned={Boolean(scopedPinId && pinned.includes(scopedPinId))}
                onToggle={() => {
                  if (scopedPinId) handleTogglePin(scopedPinId)
                }}
              />
            </div>
            <input
              className="cyber-input mt-2"
              placeholder={cloudManualPlaceholder}
              value={model}
              onChange={(e) => {
                const nextModel = e.target.value
                const key = nextModel.trim()
                const map = settings.openrouterProviderByModel || {}
                if (role === 'vision') {
                  if (key && Object.prototype.hasOwnProperty.call(map, key)) {
                    patchSubAgent(setSettings, {
                      model: nextModel,
                      provider: 'openrouter',
                      openrouterProviderOnly: (map[key] || '').trim(),
                    })
                  } else {
                    patchSubAgent(setSettings, {
                      model: nextModel,
                      provider: 'openrouter',
                    })
                  }
                } else if (key && Object.prototype.hasOwnProperty.call(map, key)) {
                  patchSubAgent(setSettings, {
                    codingModel: nextModel,
                    codingProvider: 'openrouter',
                    codingOpenrouterProviderOnly: (map[key] || '').trim(),
                  })
                } else {
                  patchSubAgent(setSettings, {
                    codingModel: nextModel,
                    codingProvider: 'openrouter',
                  })
                }
              }}
            />
            <p className="text-xs text-void-dim mt-2 font-mono leading-relaxed">
              Uses Options → LLM OpenRouter base URL and API key. Same curated presets as
              the main model picker.
            </p>
          </div>
          <div className="form-group mb-0">
            <label className="form-label">
              <span className="text-neon-yellow mr-2">⊘</span> {label}_OPENROUTER_PROVIDER
              (optional)
            </label>
            <input
              className="cyber-input"
              value={openrouterProviderOnly}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  ...withSubAgentOpenRouterProvider(s, role, e.target.value),
                }))
              }
              placeholder="anthropic"
            />
            <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
              Force routing to one OpenRouter provider slug (e.g.{' '}
              <code className="text-void-light/90">anthropic</code>,{' '}
              <code className="text-void-light/90">openai</code>). Remembered per model —
              shared with LLM tab. Leave empty for default load balancing.
            </p>
          </div>
        </>
      )}

      {(provider === 'deepseek' ||
        provider === 'openai' ||
        provider === 'nvidia' ||
        provider === 'opencode-go') &&
        presets && (
          <div className="form-group mb-0">
            <label className="form-label">
              <span className="text-neon-cyan mr-2">◈</span> {label}_MODEL
            </label>
            {pinnedChips(
              pinsForProvider(pinned, llmProv),
              presets,
              scopedPinId,
              handleTogglePin,
            )}
            <div className="flex items-center gap-2">
              <select
                className="form-select mb-0 flex-1"
                value={inList ? model : model ? `__custom__${model}` : ''}
                onChange={(e) => selectPreset(e.target.value, provider)}
              >
                {presets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                {model && !inList && (
                  <option value={`__custom__${model}`}>{model} (manual)</option>
                )}
              </select>
              <PinToggleButton
                pinned={Boolean(scopedPinId && pinned.includes(scopedPinId))}
                onToggle={() => {
                  if (scopedPinId) handleTogglePin(scopedPinId)
                }}
              />
            </div>
            <input
              className="cyber-input mt-2"
              placeholder={cloudManualPlaceholder}
              value={model}
              onChange={(e) => setModel(e.target.value, provider)}
            />
            <p className="text-xs text-void-dim mt-2 font-mono leading-relaxed">
              {provider === 'deepseek' &&
                'Uses Options → LLM DeepSeek base URL and API key.'}
              {provider === 'openai' &&
                'Uses Options → LLM OpenAI base URL and API key.'}
              {provider === 'nvidia' &&
                'Uses Options → LLM NVIDIA base URL and API key.'}
              {provider === 'opencode-go' &&
                'Uses Options → LLM OpenCode Go key (local reverse proxy).'}
            </p>
          </div>
        )}
    </div>
  )
}

export function SubAgentOptionsPanel({
  settings,
  setSettings,
  loadModels,
  modelsLoading,
  ollamaModels,
  modelsError,
}: Props) {
  const sub = settings.subAgent
  const visionActive = sub.enabled
  const codingActive = sub.codingEnabled
  const visionProvider = (sub.provider ?? 'ollama') as SubAgentProviderId
  const codingProvider = (sub.codingProvider ?? sub.provider ?? 'ollama') as SubAgentProviderId

  return (
    <div className="grid gap-5 text-sm">
      {/* Vision toggle */}
      <div className="form-group">
        <label className="form-label flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="cyber-checkbox"
            checked={sub.enabled}
            onChange={(e) => patchSubAgent(setSettings, { enabled: e.target.checked })}
          />
          <span className="text-neon-cyan">⬡ ENABLE_VISION_SUB_AGENT</span>
        </label>
        <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
          When enabled, image_recall delegates vision analysis to the vision model below.
          The main agent receives text descriptions instead of raw image bytes.
        </p>
      </div>

      {visionActive && (
        <SubAgentEndpointPicker
          role="vision"
          label="VISION"
          provider={visionProvider}
          model={sub.model}
          openrouterProviderOnly={sub.openrouterProviderOnly ?? ''}
          settings={settings}
          setSettings={setSettings}
          loadModels={loadModels}
          modelsLoading={modelsLoading}
          ollamaModels={ollamaModels}
          modelsError={modelsError}
        />
      )}

      {/* Coding toggle */}
      <div className="form-group">
        <label className="form-label flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="cyber-checkbox"
            checked={sub.codingEnabled}
            onChange={(e) => patchSubAgent(setSettings, { codingEnabled: e.target.checked })}
          />
          <span className="text-neon-cyan">⬡ ENABLE_CODING_SUB_AGENT</span>
        </label>
        <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
          Coding context management, coding_explore, and Team-mode workers (run_coding_workers)
          — all run on the coding model below (prefer text-capable, not vision-only). Same
          provider list and pins as the main LLM picker.
        </p>
      </div>

      {codingActive && (
        <SubAgentEndpointPicker
          role="coding"
          label="CODING"
          provider={codingProvider}
          model={sub.codingModel || sub.model}
          openrouterProviderOnly={sub.codingOpenrouterProviderOnly ?? ''}
          settings={settings}
          setSettings={setSettings}
          loadModels={loadModels}
          modelsLoading={modelsLoading}
          ollamaModels={ollamaModels}
          modelsError={modelsError}
        />
      )}

      {(sub.enabled || sub.codingEnabled) && (
        <div className="form-group">
          <label className="form-label flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="cyber-checkbox"
              checked={sub.showAnalysisWindow !== false}
              onChange={(e) =>
                patchSubAgent(setSettings, { showAnalysisWindow: e.target.checked })
              }
            />
            <span className="text-neon-cyan">⬡ SHOW_ANALYSIS_WINDOW</span>
          </label>
          <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
            Floating panel on the right while vision or coding sub-agent runs
            (progress and digests). Off = same behavior, no on-screen panel.
          </p>
        </div>
      )}
    </div>
  )
}
