import type { AppSettings } from '@/lib/settings'
import type { Dispatch, SetStateAction } from 'react'

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
  return (
    <div className="grid gap-5 text-sm">
      {/* Ollama URL */}
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-purple mr-2">◇</span> OLLAMA_BASE_URL
        </label>
        <input
          className="cyber-input"
          value={settings.ollamaBaseUrl}
          onChange={(e) =>
            setSettings((s) => ({ ...s, ollamaBaseUrl: e.target.value }))
          }
        />
      </div>

      {/* Model Selection */}
      <div className="form-group">
        <div className="flex items-center justify-between mb-2">
          <label className="form-label mb-0">
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

        {/* Model Dropdown */}
        <select
          className="form-select mb-3"
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

        {/* Manual Model Input */}
        <input
          className="cyber-input"
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
      </div>

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

      {/* Context Window */}
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-green mr-2">⬡</span> CONTEXT_WINDOW
          <span className="ml-3 font-mono text-neon-cyan">
            {settings.llmNumCtx.toLocaleString()} tokens
          </span>
        </label>
        <input
          type="number"
          step={256}
          min={512}
          max={262144}
          className="cyber-input"
          value={settings.llmNumCtx}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              llmNumCtx: clamp(
                Math.round(Number(e.target.value)) || 8192,
                512,
                262144,
              ),
            }))
          }
        />
        <p className="text-xs text-void-dim mt-1">
          Model context window (Ollama options.num_ctx)
        </p>
      </div>

      {/* History Messages */}
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-yellow mr-2">◐</span> HISTORY_MESSAGES
          <span className="ml-3 font-mono text-neon-cyan">
            {settings.llmMaxHistoryMessages === 0
              ? 'FULL'
              : `${settings.llmMaxHistoryMessages} msgs`}
          </span>
        </label>
        <input
          type="number"
          step={1}
          min={0}
          max={500}
          className="cyber-input"
          value={settings.llmMaxHistoryMessages}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              llmMaxHistoryMessages: clamp(
                Math.round(Number(e.target.value)) || 0,
                0,
                500,
              ),
            }))
          }
        />
        <p className="text-xs text-void-dim mt-1">
          Last N messages sent · <span className="text-neon-cyan">0</span> = full history
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
          System message sent at start of each request
        </p>
      </div>

      {/* Model Info Panel */}
      <div className="bg-void-black/50 border border-neon-cyan/20 p-4">
        <p className="text-xs font-mono text-neon-cyan mb-3 uppercase tracking-wider">
          <span className="mr-2">◈</span>RECOMMENDED_MODELS
        </p>
        <ul className="text-xs font-mono text-void-dim space-y-1">
          <li className="flex items-center gap-2">
            <span className="text-neon-green">✓</span>
            Llama 3.1+ / Llama 3.2+ (tool support)
          </li>
          <li className="flex items-center gap-2">
            <span className="text-neon-green">✓</span>
            Qwen2.5+ (tool support)
          </li>
          <li className="flex items-center gap-2">
            <span className="text-neon-green">✓</span>
            Mistral-Nemo / Mistral-7B (with tools)
          </li>
          <li className="flex items-center gap-2 opacity-50">
            <span className="text-neon-red">✗</span>
            Models without tool support
          </li>
        </ul>
      </div>
    </div>
  )
}
