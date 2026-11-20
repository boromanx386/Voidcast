import { useState } from 'react'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'
import { cloudLlmProviderLabel } from '@/lib/cloudLlm'
import { CLOUD_KEY_FIELD, CLOUD_KEY_URL, type ChatSetupNeed } from '@/lib/chatSetup'

type Props = {
  need: Exclude<ChatSetupNeed, { kind: 'ready' }>
  app: Pick<
    VoidcastApp,
    | 'settings'
    | 'setSettings'
    | 'ollamaModels'
    | 'modelsLoading'
    | 'modelsError'
    | 'loadModels'
    | 'openOptions'
  >
}

/**
 * Replaces the empty-chat greeting while no model can answer yet, so a first message
 * never ends in a bare network error.
 */
export function ChatSetupCard({ need, app }: Props) {
  const { settings, setSettings, ollamaModels, modelsLoading, loadModels, openOptions } = app
  const keyProvider = need.kind === 'cloud-key' ? need.provider : 'openrouter'
  const keyLabel = cloudLlmProviderLabel(keyProvider)
  const [key, setKey] = useState('')
  const [ollamaPick, setOllamaPick] = useState('')
  const ollamaUrl = settings.ollamaBaseUrl

  const saveKey = () => {
    const value = key.trim()
    if (!value) return
    setSettings((s) => ({ ...s, llmProvider: keyProvider, [CLOUD_KEY_FIELD[keyProvider]]: value }))
  }

  const useOllama = () => {
    if (!ollamaPick) return
    setSettings((s) => ({ ...s, llmProvider: 'ollama', ollamaModel: ollamaPick }))
  }

  const headline =
    need.kind === 'cloud-key'
      ? `${keyLabel} is selected but has no API key yet.`
      : need.kind === 'ollama-unreachable'
        ? `Ollama is selected but not running at ${ollamaUrl}.`
        : need.kind === 'ollama-no-models'
          ? 'Ollama is running but has no models installed.'
          : 'Ollama is selected but no model is chosen.'

  return (
    <section
      className="rounded-lg border border-void-muted/50 bg-void-mid/70 p-6 text-left animate-fade-in-up"
      aria-label="Connect a model"
    >
      <h2 className="mb-1 text-base font-semibold text-void-light">Connect a model to start</h2>
      <p className="mb-5 text-sm text-void-text">{headline}</p>

      <div className="mb-5">
        <label className="mb-1 block text-sm text-void-light" htmlFor="setup-api-key">
          {keyLabel} API key
          {keyProvider === 'openrouter' && (
            <span className="ml-2 text-xs text-void-text">
              recommended — one key for 300+ models, free ones included
            </span>
          )}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="setup-api-key"
            type="password"
            className="cyber-input flex-1 min-w-[12rem]"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveKey()
            }}
            placeholder={keyProvider === 'openrouter' ? 'sk-or-v1-...' : 'Paste your key'}
            autoComplete="off"
          />
          <button
            type="button"
            className="cyber-btn text-xs disabled:opacity-40"
            onClick={saveKey}
            disabled={!key.trim()}
          >
            Save key
          </button>
        </div>
        <a
          href={CLOUD_KEY_URL[keyProvider]}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-neon-cyan underline decoration-neon-cyan/35 underline-offset-2 hover:decoration-neon-cyan"
        >
          Get your {keyLabel} key
        </a>
      </div>

      <div className="mb-5 border-t border-void-muted/40 pt-4">
        <p className="mb-2 text-sm text-void-light">Or use Ollama on this machine</p>
        {modelsLoading ? (
          <p className="text-xs text-void-text">Checking for Ollama at {ollamaUrl}…</p>
        ) : app.modelsError ? (
          <OllamaHint onRetry={() => void loadModels()}>
            Ollama is not running at {ollamaUrl}. Install it from{' '}
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neon-cyan underline decoration-neon-cyan/35 underline-offset-2"
            >
              ollama.com
            </a>
            , download a model with <code>ollama pull &lt;model&gt;</code>, then check again.
          </OllamaHint>
        ) : ollamaModels.length === 0 ? (
          <OllamaHint onRetry={() => void loadModels()}>
            Ollama is running but has no models. Download one with{' '}
            <code>ollama pull &lt;model&gt;</code>, then check again.
          </OllamaHint>
        ) : (
          <div className="flex flex-wrap gap-2">
            <select
              className="form-select flex-1 min-w-[12rem]"
              value={ollamaPick}
              onChange={(e) => setOllamaPick(e.target.value)}
              aria-label="Installed Ollama models"
            >
              <option value="">Choose an installed model…</option>
              {ollamaModels.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="cyber-btn text-xs disabled:opacity-40"
              onClick={useOllama}
              disabled={!ollamaPick}
            >
              Use Ollama
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className="text-xs text-neon-cyan underline decoration-neon-cyan/35 underline-offset-2 hover:decoration-neon-cyan"
        onClick={() => openOptions('general')}
      >
        Other providers (OpenAI, DeepSeek, NVIDIA, OpenCode Go) are in Options → General
      </button>
    </section>
  )
}

function OllamaHint({ children, onRetry }: { children: React.ReactNode; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="flex-1 min-w-[12rem] text-xs text-void-text">{children}</p>
      <button type="button" className="cyber-btn text-xs" onClick={onRetry}>
        Check again
      </button>
    </div>
  )
}
