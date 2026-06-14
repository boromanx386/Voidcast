import type { AppSettings } from '@/lib/settings'
import { DEEPSEEK_LLM_PRESET_MODELS, NVIDIA_LLM_PRESET_MODELS, OPENROUTER_LLM_PRESET_MODELS } from '@/lib/cloudLlmPresets'
import { NumericSettingInput } from '@/components/options/NumericSettingInput'
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
              llmProvider:
                e.target.value === 'openrouter'
                  ? 'openrouter'
                  : e.target.value === 'nvidia'
                    ? 'nvidia'
                    : e.target.value === 'deepseek'
                      ? 'deepseek'
                      : 'ollama',
            }))
          }
        >
          <option value="ollama">Ollama (local)</option>
          <option value="openrouter">OpenRouter (cloud)</option>
          <option value="nvidia">NVIDIA (cloud)</option>
          <option value="deepseek">DeepSeek (cloud)</option>
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
                Proxied through the TTS host at{' '}
                <code className="text-neon-purple">/api/openrouter/*</code> using keys from the
                desktop app.
              </p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-cyan mr-2">◈</span> OPENROUTER_MODEL
            </label>
            <select
              className="form-select mb-3"
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
                setSettings((s) => ({ ...s, openrouterModel: v }))
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
                Proxied through the TTS host at{' '}
                <code className="text-neon-purple">/api/nvidia/*</code> using keys from the desktop
                app.
              </p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-cyan mr-2">◈</span> NVIDIA_MODEL
            </label>
            <select
              className="form-select mb-3"
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
            <input
              className="cyber-input"
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
                Proxied through the TTS host at{' '}
                <code className="text-neon-purple">/api/deepseek/*</code> using keys from the desktop
                app.
              </p>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">
              <span className="text-neon-cyan mr-2">◈</span> DEEPSEEK_MODEL
            </label>
            <select
              className="form-select mb-3"
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
            <input
              className="cyber-input"
              value={settings.deepseekModel}
              onChange={(e) =>
                setSettings((s) => ({ ...s, deepseekModel: e.target.value }))
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

      {/* Context Window */}
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
          Model context window (Ollama options.num_ctx)
        </p>
      </div>

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
          System message sent at start of each request
        </p>
      </div>

      {/* Model Info Panel */}
      <div className="bg-void-black/50 border border-neon-cyan/20 p-4">
        <p className="text-xs font-mono text-neon-cyan mb-3 uppercase tracking-wider">
          <span className="mr-2">◈</span>{settings.llmProvider === 'openrouter' ? 'OPENROUTER_NOTES' : settings.llmProvider === 'nvidia' ? 'NVIDIA_NOTES' : settings.llmProvider === 'deepseek' ? 'DEEPSEEK_NOTES' : 'RECOMMENDED_MODELS'}
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
                ? 'API key stays on desktop; requests use the TTS server proxy'
                : 'Keep API key on this desktop (forwarded to TTS server for LAN web)'}
            </li>
            <li className="flex items-center gap-2 opacity-70">
              <span className="text-neon-yellow">!</span>
              Tool-calling support depends on selected upstream model/provider.
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
      </div>
    </div>
  )
}
