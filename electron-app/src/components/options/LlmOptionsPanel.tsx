import type { AppSettings } from '@/lib/settings'
import { isWebStandalone } from '@/lib/platform'
import type { Dispatch, SetStateAction } from 'react'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  loadModels: () => void
  modelsLoading: boolean
  ollamaModels: string[]
  modelsError: string | null
}

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
  { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'NVIDIA Nemotron 3 Super 120B A12B' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'NVIDIA Nemotron 3 Super 120B A12B (Free)' },
]

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
          <span className="text-neon-cyan mr-2">◎</span> LLM_PROVIDER
        </label>
        <select
          className="form-select"
          value={settings.llmProvider}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              llmProvider: e.target.value === 'openrouter' ? 'openrouter' : 'ollama',
            }))
          }
        >
          <option value="ollama">Ollama (local)</option>
          <option value="openrouter">OpenRouter (cloud)</option>
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
            Proxied through the TTS host at <code className="text-neon-purple">/api/ollama/*</code> to the
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
      </div>}

      {settings.llmProvider === 'openrouter' && (
        <>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-purple mr-2">◇</span> OPENROUTER_BASE_URL
            </label>
            <input
              className="cyber-input"
              value={settings.openrouterBaseUrl}
              onChange={(e) =>
                setSettings((s) => ({ ...s, openrouterBaseUrl: e.target.value }))
              }
              placeholder="https://openrouter.ai/api/v1"
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-cyan mr-2">◈</span> OPENROUTER_MODEL
            </label>
            <select
              className="form-select mb-3"
              value={
                OPENROUTER_PRESET_MODELS.some((m) => m.id === settings.openrouterModel)
                  ? settings.openrouterModel
                  : settings.openrouterModel
                    ? `__custom__${settings.openrouterModel}`
                    : ''
              }
              onChange={(e) => {
                const v = e.target.value
                if (!v || v.startsWith('__custom__')) return
                setSettings((s) => ({ ...s, openrouterModel: v }))
              }}
            >
              {OPENROUTER_PRESET_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {settings.openrouterModel &&
                !OPENROUTER_PRESET_MODELS.some((m) => m.id === settings.openrouterModel) && (
                  <option value={`__custom__${settings.openrouterModel}`}>
                    {settings.openrouterModel} (manual)
                  </option>
                )}
            </select>
            <input
              className="cyber-input"
              value={settings.openrouterModel}
              onChange={(e) =>
                setSettings((s) => ({ ...s, openrouterModel: e.target.value }))
              }
              placeholder="openrouter/free"
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

      <div className="form-group">
        <label className="form-label flex items-center justify-between gap-3">
          <span>
            <span className="text-neon-cyan mr-2">◎</span> NEW_CHATS_USE_LONG_MEMORY
          </span>
          <input
            type="checkbox"
            checked={settings.longMemoryDefaultEnabled}
            onChange={(e) =>
              setSettings((s) => ({ ...s, longMemoryDefaultEnabled: e.target.checked }))
            }
          />
        </label>
        <p className="text-xs text-void-dim mt-1">
          New chats inherit this as their default for long-term memory retrieval.
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
          <span className="mr-2">◈</span>{settings.llmProvider === 'openrouter' ? 'OPENROUTER_NOTES' : 'RECOMMENDED_MODELS'}
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
              Keep API key local on this device (stored in browser localStorage)
            </li>
            <li className="flex items-center gap-2 opacity-70">
              <span className="text-neon-yellow">!</span>
              Tool-calling support depends on selected upstream model/provider.
            </li>
          </ul>
        )}
      </div>
    </div>
  )
}
