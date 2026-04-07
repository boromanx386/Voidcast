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
    <div className='grid gap-3 text-sm'>
      <label className='grid gap-1'>
        <span className='text-zinc-400'>Ollama URL</span>
        <input
          className='rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
          value={settings.ollamaBaseUrl}
          onChange={(e) =>
            setSettings((s) => ({ ...s, ollamaBaseUrl: e.target.value }))
          }
        />
      </label>
      <label className='grid gap-1'>
        <span className='text-zinc-400'>Model (GET /api/tags)</span>
        <div className='flex flex-wrap gap-2'>
          <button
            type='button'
            className='shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50'
            disabled={modelsLoading}
            onClick={() => void loadModels()}
          >
            {modelsLoading ? '…' : 'Refresh'}
          </button>
          <select
            className='min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
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
            {modelsLoading && <option value=''>Loading…</option>}
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
          <input
            className='min-w-[8rem] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
            placeholder='Manual model name'
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
        {modelsError && (
          <span className='text-xs text-amber-400'>{modelsError}</span>
        )}
        {!modelsError && ollamaModels.length > 0 && (
          <span className='text-xs text-zinc-500'>
            {ollamaModels.length} local models
          </span>
        )}
      </label>

      <label className='grid gap-1'>
        <span className='text-zinc-400'>Temperature</span>
        <input
          type='number'
          step={0.05}
          min={0}
          max={2}
          className='rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
          value={settings.llmTemperature}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              llmTemperature: clamp(Number(e.target.value) || 0, 0, 2),
            }))
          }
        />
        <span className='text-xs text-zinc-500'>
          Higher = more creative; lower = more consistent (0–2).
        </span>
      </label>

      <label className='grid gap-1'>
        <span className='text-zinc-400'>Context (num_ctx, tokens)</span>
        <input
          type='number'
          step={256}
          min={512}
          max={262144}
          className='rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
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
        <span className='text-xs text-zinc-500'>
          Model context window size (Ollama{' '}
          <code className='text-zinc-400'>options.num_ctx</code>).
        </span>
      </label>

      <label className='grid gap-1'>
        <span className='text-zinc-400'>History in request (messages)</span>
        <input
          type='number'
          step={1}
          min={0}
          max={500}
          className='rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
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
        <span className='text-xs text-zinc-500'>
          Last N user/assistant messages;{' '}
          <span className='font-medium text-zinc-400'>0</span> = send full
          history (up to the context limit).
        </span>
      </label>

      <label className='grid gap-1'>
        <span className='text-zinc-400'>System prompt</span>
        <textarea
          rows={5}
          className='resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
          value={settings.llmSystemPrompt}
          onChange={(e) =>
            setSettings((s) => ({ ...s, llmSystemPrompt: e.target.value }))
          }
          placeholder='e.g. Answer concisely. Do not invent facts.'
        />
        <span className='text-xs text-zinc-500'>
          Sent as a <code className='text-zinc-400'>system</code> message at
          the start of each request.
        </span>
      </label>
    </div>
  )
}
