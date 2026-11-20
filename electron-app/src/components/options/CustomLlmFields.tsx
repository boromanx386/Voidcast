import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { NumericSettingInput } from '@/components/options/NumericSettingInput'
import { customLlmRoute, fetchCustomLlmModels } from '@/lib/cloudLlm'
import type { AppSettings, CustomLlmApiStyle } from '@/lib/settings'

const STYLE_OPTIONS: Array<{ value: CustomLlmApiStyle; label: string; path: string }> = [
  { value: 'chat-completions', label: 'OpenAI Chat Completions', path: '/chat/completions' },
  { value: 'responses', label: 'OpenAI Responses', path: '/responses' },
  { value: 'messages', label: 'Anthropic Messages', path: '/messages' },
]

const BASE_URL_EXAMPLES: Record<CustomLlmApiStyle, string> = {
  'chat-completions': 'https://api.openai.com/v1 · http://localhost:1234/v1',
  responses: 'https://api.openai.com/v1',
  messages: 'https://api.anthropic.com/v1',
}

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  /** Pin chips shown above the model field. */
  pinChips?: ReactNode
  /** Pin toggle for the current model. */
  pinButton?: ReactNode
}

/** Options → Agent fields for the Custom provider: endpoint, wire format, key, model, context. */
export function CustomLlmFields({ settings, setSettings, pinChips, pinButton }: Props) {
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const style = STYLE_OPTIONS.find((o) => o.value === settings.customApiStyle) ?? STYLE_OPTIONS[0]

  const loadModels = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const ids = await fetchCustomLlmModels({
        route: customLlmRoute(settings),
        apiKey: settings.customApiKey,
        ttsBaseUrl: settings.ttsBaseUrl,
      })
      setModels(ids)
      if (ids.length === 0) setLoadError('The endpoint listed no models. Type the model id below.')
    } catch (e) {
      setModels([])
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-purple mr-2">◇</span> CUSTOM_API_FORMAT
        </label>
        <select
          className="form-select"
          value={style.value}
          onChange={(e) =>
            setSettings((s) => ({ ...s, customApiStyle: e.target.value as CustomLlmApiStyle }))
          }
        >
          {STYLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({o.path})
            </option>
          ))}
        </select>
        <p className="text-xs text-void-dim mt-1">
          The wire format your endpoint speaks. Most local servers and gateways use Chat
          Completions; OpenAI&apos;s newest models may need Responses; Anthropic and
          Anthropic-compatible gateways use Messages.
        </p>
      </div>
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-purple mr-2">◇</span> CUSTOM_BASE_URL
        </label>
        <input
          className="cyber-input"
          value={settings.customBaseUrl}
          onChange={(e) => setSettings((s) => ({ ...s, customBaseUrl: e.target.value }))}
          placeholder={BASE_URL_EXAMPLES[style.value]}
        />
        <p className="text-xs text-void-dim mt-1">
          The API root, up to and including <code className="text-void-light/90">/v1</code> —
          Voidcast appends <code className="text-void-light/90">{style.path}</code>. Requests go
          through the built-in tools server, so servers without CORS work too.
        </p>
      </div>
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-purple mr-2">◇</span> CUSTOM_API_KEY
        </label>
        <input
          type="password"
          className="cyber-input"
          value={settings.customApiKey}
          onChange={(e) => setSettings((s) => ({ ...s, customApiKey: e.target.value }))}
          placeholder="Optional — leave empty for local servers"
          autoComplete="off"
        />
      </div>
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-cyan mr-2">◈</span> CUSTOM_MODEL
        </label>
        {pinChips}
        <div className="flex items-center gap-2">
          <input
            className="cyber-input flex-1"
            value={settings.customModel}
            onChange={(e) => setSettings((s) => ({ ...s, customModel: e.target.value }))}
            placeholder="Model id, e.g. gpt-5.6-sol or qwen3-32b"
            list="custom-llm-models"
          />
          {pinButton}
          <button
            type="button"
            className="cyber-btn text-xs disabled:opacity-40"
            onClick={() => void loadModels()}
            disabled={loading || !settings.customBaseUrl.trim()}
          >
            {loading ? 'Loading…' : 'Load models'}
          </button>
        </div>
        <datalist id="custom-llm-models">
          {models.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        {models.length > 0 && (
          <p className="text-xs text-void-dim mt-1">
            {models.length} models found — pick one from the field&apos;s suggestions.
          </p>
        )}
        {loadError && <p className="text-xs text-neon-red mt-1 break-words">{loadError}</p>}
      </div>
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-purple mr-2">◇</span> CUSTOM_CONTEXT_TOKENS
        </label>
        <NumericSettingInput
          min={2048}
          max={10_000_000}
          value={settings.customContextTokens}
          onCommit={(customContextTokens) => setSettings((s) => ({ ...s, customContextTokens }))}
        />
        <p className="text-xs text-void-dim mt-1">
          The model&apos;s context window. Voidcast cannot look it up for a custom endpoint, so the
          CTX meter and auto-compress use this number.
        </p>
      </div>
    </>
  )
}
