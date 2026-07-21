import type { AppSettings } from '@/lib/settings'
import { SUB_AGENT_DEFAULT_CONTEXT_TOKENS } from '@/lib/settings'
import { DEEPSEEK_LLM_PRESET_MODELS, OPENROUTER_LLM_PRESET_MODELS } from '@/lib/cloudLlmPresets'
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

// ── All known models merged into one list ────────────────────────────────

type ModelEntry = { id: string; label: string; group: string; provider: 'ollama' | 'openrouter' | 'deepseek' }

function buildUnifiedModelList(ollamaModels: string[]): ModelEntry[] {
  const entries: ModelEntry[] = []

  // Ollama (local) — fetched dynamically
  for (const name of ollamaModels) {
    entries.push({ id: name, label: name, group: 'Ollama (local)', provider: 'ollama' })
  }

  // OpenRouter presets
  for (const m of OPENROUTER_LLM_PRESET_MODELS) {
    entries.push({ id: m.id, label: m.label, group: 'OpenRouter', provider: 'openrouter' })
  }

  // DeepSeek presets
  for (const m of DEEPSEEK_LLM_PRESET_MODELS) {
    entries.push({ id: m.id, label: m.label, group: 'DeepSeek', provider: 'deepseek' })
  }

  return entries
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
  const allModels = buildUnifiedModelList(ollamaModels)
  const currentInList = allModels.some((m) => m.id === sub.model)
  const subActive = sub.enabled || sub.memoryEnabled || sub.codingEnabled

  return (
    <div className="grid gap-5 text-sm">
      {/* Vision toggle */}
      <div className="form-group">
        <label className="form-label flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="cyber-checkbox"
            checked={sub.enabled}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                subAgent: { ...s.subAgent, enabled: e.target.checked },
              }))
            }
          />
          <span className="text-neon-cyan">⬡ ENABLE_VISION_SUB_AGENT</span>
        </label>
        <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
          When enabled, image_recall delegates vision analysis to this model.
          The main agent receives text descriptions instead of raw image bytes.
        </p>
      </div>

      {/* Long memory toggle */}
      <div className="form-group">
        <label className="form-label flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="cyber-checkbox"
            checked={sub.memoryEnabled}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                subAgent: { ...s.subAgent, memoryEnabled: e.target.checked },
              }))
            }
          />
          <span className="text-neon-cyan">⬡ USE_FOR_LONG_MEMORY</span>
        </label>
        <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
          When enabled, Extract long memory (chat header) uses the sub-agent model below
          instead of the main LLM. Vision and memory can be toggled independently.
        </p>
      </div>

      {/* Coding toggle */}
      <div className="form-group">
        <label className="form-label flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="cyber-checkbox"
            checked={sub.codingEnabled}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                subAgent: { ...s.subAgent, codingEnabled: e.target.checked },
              }))
            }
          />
          <span className="text-neon-cyan">⬡ ENABLE_CODING_SUB_AGENT</span>
        </label>
        <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
          Coding context management: trim noisy tool output (commands, search, type
          checks), clear stale tool results from old rounds, and expose the read-only
          coding_explore tool (runs on this sub-agent model — prefer text-capable).
        </p>
      </div>

      {(sub.enabled || sub.codingEnabled) && (
        <div className="form-group">
          <label className="form-label flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="cyber-checkbox"
              checked={sub.showAnalysisWindow !== false}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  subAgent: { ...s.subAgent, showAnalysisWindow: e.target.checked },
                }))
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
        <>
          <div className="form-group">
            <div className="flex items-center justify-between mb-2">
              <label className="form-label mb-0">
                <span className="text-neon-cyan mr-2">◈</span> SUB_AGENT_MODEL
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
              value={currentInList ? sub.model : sub.model ? `__custom__${sub.model}` : ''}
              disabled={modelsLoading}
              onChange={(e) => {
                const v = e.target.value
                if (!v || v.startsWith('__custom__')) return
                const entry = allModels.find((m) => m.id === v)
                setSettings((s) => ({
                  ...s,
                  subAgent: {
                    ...s.subAgent,
                    model: v,
                    provider: entry?.provider ?? 'ollama',
                  },
                }))
              }}
            >
              {modelsLoading && <option value="">Loading models...</option>}
              {!modelsLoading && allModels.length === 0 && (
                <option value="">No models available</option>
              )}
              {(() => {
                const groups = new Map<string, ModelEntry[]>()
                for (const m of allModels) {
                  const list = groups.get(m.group) || []
                  list.push(m)
                  groups.set(m.group, list)
                }
                const elements: JSX.Element[] = []
                for (const [group, models] of groups) {
                  elements.push(
                    <optgroup key={group} label={`── ${group} ──`}>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </optgroup>,
                  )
                }
                return elements
              })()}
              {sub.model && !currentInList && (
                <option value={`__custom__${sub.model}`}>
                  {sub.model} (manual)
                </option>
              )}
            </select>

            <input
              className="cyber-input"
              placeholder="Or type model name manually..."
              value={currentInList ? '' : sub.model}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  subAgent: {
                    ...s.subAgent,
                    model: e.target.value,
                    // Clear explicit provider so auto-detect can re-resolve
                    provider: undefined,
                  },
                }))
              }
            />
            <p className="text-xs text-void-dim mt-2 font-mono leading-relaxed">
              Ollama models (including namespaced ones like user/model:tag) use Options → LLM
              Ollama base URL regardless of main LLM provider. OpenRouter presets use Options →
              LLM OpenRouter base URL and API key. image_recall with purpose=edit always bypasses
              the sub-agent.
            </p>
          </div>

          {/* Context window & output tokens */}
          <div className="form-group">
            <div className="grid grid-cols-2 gap-4">
              {/* Context window — Ollama only */}
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
                  onCommit={(contextTokens) =>
                    setSettings((s) => ({
                      ...s,
                      subAgent: { ...s.subAgent, contextTokens },
                    }))
                  }
                />
                <p className="text-xs text-void-dim mt-1">Ollama num_ctx (OpenRouter ignores)</p>
              </div>
              {/* Max output */}
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
                  onCommit={(outputTokens) =>
                    setSettings((s) => ({
                      ...s,
                      subAgent: { ...s.subAgent, outputTokens },
                    }))
                  }
                />
                <p className="text-xs text-void-dim mt-1">Max generated tokens per call</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
