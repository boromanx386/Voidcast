import type { AppSettings, SubAgentConfig } from '@/lib/settings'
import { SUB_AGENT_DEFAULT_CONTEXT_TOKENS, withSubAgentOpenRouterProvider } from '@/lib/settings'
import {
  DEEPSEEK_LLM_PRESET_MODELS,
  OPENAI_LLM_PRESET_MODELS,
  OPENROUTER_LLM_PRESET_MODELS,
  type SubAgentProviderId,
} from '@/lib/cloudLlmPresets'
import { NumericSettingInput } from '@/components/options/NumericSettingInput'
import type { Dispatch, SetStateAction } from 'react'

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
  const presets =
    provider === 'openrouter'
      ? OPENROUTER_LLM_PRESET_MODELS
      : provider === 'deepseek'
        ? DEEPSEEK_LLM_PRESET_MODELS
        : provider === 'openai'
          ? OPENAI_LLM_PRESET_MODELS
          : null
  const ollamaInList = ollamaModels.includes(model)
  const presetInList = Boolean(presets?.some((m) => m.id === model))
  const inList = provider === 'ollama' ? ollamaInList : presetInList

  const setProvider = (next: SubAgentProviderId) => {
    if (role === 'vision') patchSubAgent(setSettings, { provider: next })
    else patchSubAgent(setSettings, { codingProvider: next })
  }

  const rememberedProvider = (modelId: string) =>
    ((settings.openrouterProviderByModel || {})[modelId] || '').trim()

  const setModel = (next: string, nextProvider?: SubAgentProviderId) => {
    const resolvedProvider = nextProvider ?? provider
    if (role === 'vision') {
      patchSubAgent(setSettings, {
        model: next,
        ...(nextProvider ? { provider: nextProvider } : {}),
        ...(resolvedProvider === 'openrouter'
          ? { openrouterProviderOnly: rememberedProvider(next.trim()) }
          : {}),
      })
    } else {
      patchSubAgent(setSettings, {
        codingModel: next,
        ...(nextProvider ? { codingProvider: nextProvider } : {}),
        ...(resolvedProvider === 'openrouter'
          ? { codingOpenrouterProviderOnly: rememberedProvider(next.trim()) }
          : {}),
      })
    }
  }

  return (
    <div className="grid gap-4 rounded border border-void-border/60 p-3">
      <div className="form-group mb-0">
        <label className="form-label">
          <span className="text-neon-cyan mr-2">◎</span> {label}_PROVIDER
        </label>
        <select
          className="form-select"
          value={provider}
          onChange={(e) =>
            setProvider(
              e.target.value === 'openrouter'
                ? 'openrouter'
                : e.target.value === 'deepseek'
                  ? 'deepseek'
                  : e.target.value === 'openai'
                    ? 'openai'
                    : 'ollama',
            )
          }
        >
          <option value="ollama">Ollama (local)</option>
          <option value="openrouter">OpenRouter (cloud)</option>
          <option value="deepseek">DeepSeek (cloud)</option>
          <option value="openai">OpenAI (cloud)</option>
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

          <select
            className="form-select mb-3"
            value={inList ? model : model ? `__custom__${model}` : ''}
            disabled={modelsLoading}
            onChange={(e) => {
              const v = e.target.value
              if (!v || v.startsWith('__custom__')) return
              setModel(v, 'ollama')
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
            {model && !inList && (
              <option value={`__custom__${model}`}>{model} (manual)</option>
            )}
          </select>

          <input
            className="cyber-input"
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
            <select
              className="form-select mb-3"
              value={inList ? model : model ? `__custom__${model}` : ''}
              onChange={(e) => {
                const v = e.target.value
                if (!v || v.startsWith('__custom__')) return
                setModel(v, 'openrouter')
              }}
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
            <input
              className="cyber-input"
              placeholder="Or type OpenRouter model id..."
              value={inList ? '' : model}
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
              Uses Options → LLM OpenRouter base URL and API key.
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

      {provider === 'deepseek' && (
        <div className="form-group mb-0">
          <label className="form-label">
            <span className="text-neon-cyan mr-2">◈</span> {label}_MODEL
          </label>
          <select
            className="form-select mb-3"
            value={inList ? model : model ? `__custom__${model}` : ''}
            onChange={(e) => {
              const v = e.target.value
              if (!v || v.startsWith('__custom__')) return
              setModel(v, 'deepseek')
            }}
          >
            {DEEPSEEK_LLM_PRESET_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {model && !inList && (
              <option value={`__custom__${model}`}>{model} (manual)</option>
            )}
          </select>
          <input
            className="cyber-input"
            placeholder="Or type DeepSeek model id..."
            value={inList ? '' : model}
            onChange={(e) => setModel(e.target.value, 'deepseek')}
          />
          <p className="text-xs text-void-dim mt-2 font-mono leading-relaxed">
            Uses Options → LLM DeepSeek base URL and API key.
          </p>
        </div>
      )}

      {provider === 'openai' && (
        <div className="form-group mb-0">
          <label className="form-label">
            <span className="text-neon-cyan mr-2">◈</span> {label}_MODEL
          </label>
          <select
            className="form-select mb-3"
            value={inList ? model : model ? `__custom__${model}` : ''}
            onChange={(e) => {
              const v = e.target.value
              if (!v || v.startsWith('__custom__')) return
              setModel(v, 'openai')
            }}
          >
            {OPENAI_LLM_PRESET_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {model && !inList && (
              <option value={`__custom__${model}`}>{model} (manual)</option>
            )}
          </select>
          <input
            className="cyber-input"
            placeholder="Or type OpenAI model id..."
            value={inList ? '' : model}
            onChange={(e) => setModel(e.target.value, 'openai')}
          />
          <p className="text-xs text-void-dim mt-2 font-mono leading-relaxed">
            Uses Options → LLM OpenAI base URL and API key.
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
  const subActive = visionActive || codingActive
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
          Coding context management: trim noisy tool output, clear stale tool results from
          old rounds, and expose read-only coding_explore (runs on the coding model below —
          prefer text-capable, not vision-only).
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

      {subActive && (
        <div className="form-group">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">
                <span className="text-neon-cyan mr-2">◈</span> CONTEXT_TOKENS
                <span className="ml-3 font-mono text-neon-cyan">
                  {sub.contextTokens ?? SUB_AGENT_DEFAULT_CONTEXT_TOKENS}
                </span>
              </label>
              <NumericSettingInput
                min={512}
                max={131072}
                value={sub.contextTokens ?? SUB_AGENT_DEFAULT_CONTEXT_TOKENS}
                onCommit={(contextTokens) => patchSubAgent(setSettings, { contextTokens })}
              />
              <p className="text-xs text-void-dim mt-1">Ollama num_ctx (cloud providers ignore)</p>
            </div>
            <div>
              <label className="form-label">
                <span className="text-neon-cyan mr-2">◈</span> OUTPUT_TOKENS
                <span className="ml-3 font-mono text-neon-cyan">
                  {sub.outputTokens ?? 1024}
                </span>
              </label>
              <NumericSettingInput
                min={50}
                max={4096}
                value={sub.outputTokens ?? 1024}
                onCommit={(outputTokens) => patchSubAgent(setSettings, { outputTokens })}
              />
              <p className="text-xs text-void-dim mt-1">Max generated tokens per call (shared)</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
