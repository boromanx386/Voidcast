import type { AppSettings } from '@/lib/settings'
import type { ChangeEvent, Dispatch, SetStateAction } from 'react'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  refreshTts: () => void
  cloneRef: { blob: Blob; fileName: string } | null
  onPickCloneFile: (e: ChangeEvent<HTMLInputElement>) => void
  onClearClone: () => void
}

export function TtsOptionsPanel({
  settings,
  setSettings,
  refreshTts,
  cloneRef,
  onPickCloneFile,
  onClearClone,
}: Props) {
  return (
    <div className='grid gap-3 text-sm'>
      <label className='grid gap-1'>
        <span className='text-zinc-400'>Server URL</span>
        <input
          className='rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
          value={settings.ttsBaseUrl}
          onChange={(e) =>
            setSettings((s) => ({ ...s, ttsBaseUrl: e.target.value }))
          }
        />
      </label>
      <button
        type='button'
        className='rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left hover:bg-zinc-800'
        onClick={() => void refreshTts()}
      >
        Refresh TTS status
      </button>

      <div className='rounded-lg border border-zinc-800 bg-zinc-900/50 p-3'>
        <p className='mb-2 text-xs font-medium text-zinc-400'>
          Voice mode
        </p>
        <div className='flex flex-col gap-2'>
          {(
            [
              ['auto', 'Auto voice', 'No sample; model picks a voice.'],
              [
                'design',
                'Voice design',
                'Describe the voice (e.g. accent, gender).',
              ],
              ['clone', 'Voice clone', 'Clone from a short clip (WAV).'],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className='flex cursor-pointer items-start gap-2 rounded-md border border-zinc-800/80 px-2 py-2 hover:bg-zinc-900'
            >
              <input
                type='radio'
                name='voiceMode'
                className='mt-1'
                checked={settings.voiceMode === value}
                onChange={() =>
                  setSettings((s) => ({ ...s, voiceMode: value }))
                }
              />
              <span>
                <span className='font-medium text-zinc-200'>{label}</span>
                <span className='mt-0.5 block text-xs text-zinc-500'>
                  {hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {settings.voiceMode === 'design' && (
        <label className='grid gap-1'>
          <span className='text-zinc-400'>Voice design (instruct)</span>
          <input
            className='rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
            value={settings.voiceInstruct}
            onChange={(e) =>
              setSettings((s) => ({ ...s, voiceInstruct: e.target.value }))
            }
            placeholder='e.g. female, British accent'
          />
        </label>
      )}

      {settings.voiceMode === 'clone' && (
        <div className='rounded-lg border border-indigo-900/40 bg-indigo-950/20 p-3'>
          <p className='mb-2 text-xs text-zinc-400'>
            Reference clip (about 3–10 s, single utterance). File stays local
            (IndexedDB) until you remove it.
          </p>
          <div className='flex flex-wrap items-center gap-2'>
            <label className='cursor-pointer rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm hover:bg-zinc-800'>
              Choose audio…
              <input
                type='file'
                accept='audio/*,.wav,audio/wav'
                className='hidden'
                onChange={(e) => void onPickCloneFile(e)}
              />
            </label>
            {cloneRef && (
              <div className='flex min-w-0 flex-1 items-center gap-2 text-xs text-zinc-300'>
                <span className='truncate' title={cloneRef.fileName}>
                  {cloneRef.fileName}
                </span>
                <button
                  type='button'
                  className='shrink-0 text-amber-400 hover:underline'
                  onClick={() => void onClearClone()}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
          <label className='mt-3 grid gap-1'>
            <span className='text-zinc-400'>Reference transcript (optional)</span>
            <textarea
              rows={2}
              className='resize-y rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
              value={settings.cloneRefText}
              onChange={(e) =>
                setSettings((s) => ({ ...s, cloneRefText: e.target.value }))
              }
              placeholder='Exact words from the clip — if empty, the model may use Whisper (slower).'
            />
          </label>
        </div>
      )}
      <label className='grid gap-1'>
        <span className='text-zinc-400'>Speed (&gt;1 faster)</span>
        <input
          type='number'
          step={0.05}
          min={0.25}
          max={4}
          className='rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
          value={settings.ttsSpeed}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              ttsSpeed: Number(e.target.value) || 1,
            }))
          }
        />
      </label>
      <label className='grid gap-1'>
        <span className='text-zinc-400'>
          Diffusion steps (num_step) — 16 faster, 32 default
        </span>
        <input
          type='number'
          step={1}
          min={4}
          max={128}
          className='rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
          value={settings.ttsNumStep}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              ttsNumStep: Math.round(Number(e.target.value)) || 32,
            }))
          }
        />
      </label>
      <label className='grid gap-1'>
        <span className='text-zinc-400'>
          Duration (s, optional) — fixed length; empty = auto (single chunk
          only, not when text is split)
        </span>
        <input
          type='number'
          step={0.5}
          min={0}
          placeholder='e.g. 10'
          className='rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
          value={
            settings.ttsDurationSec == null
              ? ''
              : String(settings.ttsDurationSec)
          }
          onChange={(e) => {
            const t = e.target.value.trim()
            setSettings((s) => ({
              ...s,
              ttsDurationSec:
                t === ''
                  ? null
                  : (() => {
                      const n = Number(t)
                      if (!Number.isFinite(n) || n <= 0) return null
                      return n
                    })(),
            }))
          }}
        />
      </label>
      <label className='flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-3'>
        <input
          type='checkbox'
          className='mt-1 h-4 w-4 rounded border-zinc-600'
          checked={settings.autoVoice}
          onChange={(e) =>
            setSettings((s) => ({ ...s, autoVoice: e.target.checked }))
          }
        />
        <span>
          <span className='font-medium text-zinc-200'>Auto voice</span>
          <span className='mt-1 block text-xs text-zinc-500'>
            After the assistant reply finishes, play audio automatically.
          </span>
        </span>
      </label>
      <label className='grid gap-1'>
        <span className='text-zinc-400'>Long replies: characters per chunk</span>
        <input
          type='number'
          step={20}
          min={80}
          max={2000}
          className='rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100'
          value={settings.ttsChunkMaxChars}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              ttsChunkMaxChars: Math.round(Number(e.target.value)) || 380,
            }))
          }
        />
        <span className='text-xs text-zinc-500'>
          The first chunk is synthesized before the full text; the next is
          requested while the previous plays (faster time-to-first-audio). Stop
          aborts TTS too.
        </span>
      </label>
    </div>
  )
}
