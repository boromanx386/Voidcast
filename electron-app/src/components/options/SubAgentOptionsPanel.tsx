import type { AppSettings } from '@/lib/settings'
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

const OPENROUTER_PRESET_MODELS: Array<{ id: string; label: string }> = [
  { id: 'openrouter/free', label: 'Auto Free Router (openrouter/free)' },
  { id: 'qwen/qwen3-coder', label: 'Qwen3 Coder' },
  { id: 'qwen/qwen3-coder-next', label: 'Qwen3 Coder Next' },
  { id: 'qwen/qwen3-coder:free', label: 'Qwen3 Coder (Free)' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { id: 'google/gemma-4-31b-it', label: 'Google Gemma 4 31B IT' },
  { id: 'google/gemma-4-31b-it:free', label: 'Google Gemma 4 31B IT (Free)' },
  { id: 'z-ai/glm-4.7-flash', label: 'Z.AI GLM 4.7 Flash' },
  { id: 'minimax/minimax-m2.7', label: 'MiniMax M2.7' },
  { id: 'minimax/minimax-m2.5:free', label: 'MiniMax M2.5 (Free)' },
  { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'NVIDIA Nemotron 3 Super 120B A12B' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'NVIDIA Nemotron 3 Super 120B A12B (Free)' },
  { id: 'inclusionai/ring-2.6-1t:free', label: 'Inclusion Ring 2.6 1T (Free)' },
  { id: 'baidu/cobuddy:free', label: 'Baidu CoBuddy (Free)' },
  { id: 'openrouter/owl-alpha', label: 'OpenRouter Owl Alpha' },
  { id: 'poolside/laguna-m.1:free', label: 'Poolside Laguna M.1 (Free)' },
]

type ModelEntry = { id: string; label: string; group: string }

function buildUnifiedModelList(ollamaModels: string[]): ModelEntry[] {
  const entries: ModelEntry[] = []

  // Ollama (local) — fetched dynamically
  for (const name of ollamaModels) {
    entries.push({ id: name, label: name, group: 'Ollama (local)' })
  }

  // OpenRouter presets
  for (const m of OPENROUTER_PRESET_MODELS) {
    entries.push({ id: m.id, label: m.label, group: 'OpenRouter' })
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

  return (
    <div className="grid gap-5 text-sm">
      {/* Enable toggle */}
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
          <span className="text-neon-cyan">⬡ ENABLE_SUB_AGENT</span>
        </label>
        <p className="text-xs text-void-dim mt-1 font-mono leading-relaxed">
          When enabled, image_recall delegates vision analysis to this model.
          The main agent receives text descriptions instead of raw image bytes.
        </p>
      </div>

      {sub.enabled && (
        <>
          {/* Model dropdown — Ollama + OpenRouter presets. Provider auto-detected. */}
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
                setSettings((s) => ({
                  ...s,
                  subAgent: { ...s.subAgent, model: v },
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
                  subAgent: { ...s.subAgent, model: e.target.value },
                }))
              }
            />
            <p className="text-xs text-void-dim mt-2 font-mono leading-relaxed">
              Ollama models (e.g. llava:13b) use your Ollama URL. OpenRouter presets use
              Options → LLM OpenRouter base URL and API key. image_recall with purpose=edit
              always bypasses the sub-agent.
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
                    {sub.contextTokens ?? 8192}
                  </span>
                </label>
                <NumericSettingInput
                  min={512}
                  max={131072}
                  value={sub.contextTokens ?? 8192}
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
