import type { AppSettings } from '@/lib/settings'
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
}

export function ToolsOptionsPanel({ settings, setSettings }: Props) {
  const [pickBusy, setPickBusy] = useState(false)

  const browsePdfFolder = useCallback(async () => {
    const vc = window.voidcast?.pickDirectory
    if (!vc) return
    setPickBusy(true)
    try {
      const r = await vc()
      if (r.ok && r.path) {
        setSettings((s) => ({ ...s, pdfOutputDir: r.path }))
      }
    } finally {
      setPickBusy(false)
    }
  }, [setSettings])
  return (
    <div className='grid gap-4 text-sm'>
      <p className='text-xs text-zinc-500'>
        Enable tools the model can call during chat. Use a{' '}
        <span className='text-zinc-400'>tool-capable</span> model (e.g. Llama 3.1+,
        Qwen2.5+, Mistral with tools) for reliable results.
      </p>

      <label className='flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-3'>
        <input
          type='checkbox'
          className='mt-1 h-4 w-4 rounded border-zinc-600'
          checked={settings.toolsEnabled.webSearch}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              toolsEnabled: {
                ...s.toolsEnabled,
                webSearch: e.target.checked,
              },
            }))
          }
        />
        <span>
          <span className='font-medium text-zinc-200'>Web search</span>
          <span className='mt-1 block text-xs text-zinc-500'>
            Uses the local TTS server <code className='text-zinc-400'>POST /tools/search</code>{' '}
            (DuckDuckGo via <code className='text-zinc-400'>duckduckgo-search</code>) when it
            is running; otherwise falls back to a lighter DuckDuckGo API in the
            desktop app.
          </span>
        </span>
      </label>

      <label className='flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-3'>
        <input
          type='checkbox'
          className='mt-1 h-4 w-4 rounded border-zinc-600'
          checked={settings.toolsEnabled.scrape}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              toolsEnabled: {
                ...s.toolsEnabled,
                scrape: e.target.checked,
              },
            }))
          }
        />
        <span>
          <span className='font-medium text-zinc-200'>Scrape URL</span>
          <span className='mt-1 block text-xs text-zinc-500'>
            Loads a public page in the desktop app, strips HTML to plain text (up to ~2&nbsp;MB
            download). Local and private hosts are blocked (SSRF protection).
          </span>
        </span>
      </label>

      <div className='rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-3'>
        <label className='flex cursor-pointer items-start gap-3'>
          <input
            type='checkbox'
            className='mt-1 h-4 w-4 shrink-0 rounded border-zinc-600'
            checked={settings.toolsEnabled.pdf}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                toolsEnabled: {
                  ...s.toolsEnabled,
                  pdf: e.target.checked,
                },
              }))
            }
          />
          <span>
            <span className='font-medium text-zinc-200'>Save as PDF</span>
            <span className='mt-1 block text-xs text-zinc-500'>
              Model calls <code className='text-zinc-400'>save_pdf</code> to write a text PDF
              (Noto Sans, Latin + Cyrillic) into the folder below — no popup.
            </span>
          </span>
        </label>
        {settings.toolsEnabled.pdf && (
          <div className='mt-3 border-t border-zinc-800 pt-3 pl-7'>
            <div className='text-xs font-medium text-zinc-400'>PDF output folder</div>
            <div className='mt-2 flex flex-wrap gap-2'>
              <input
                type='text'
                spellCheck={false}
                className='min-w-[12rem] flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600'
                placeholder='C:\\Users\\…\\Documents\\VoidcastPDF'
                value={settings.pdfOutputDir}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, pdfOutputDir: e.target.value }))
                }
              />
              <button
                type='button'
                disabled={pickBusy}
                className='shrink-0 rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50'
                onClick={() => void browsePdfFolder()}
              >
                {pickBusy ? '…' : 'Browse…'}
              </button>
            </div>
            <p className='mt-2 text-xs text-zinc-500'>
              Required for <code className='text-zinc-400'>save_pdf</code>. You can paste a path
              or use Browse (Electron only).
            </p>
          </div>
        )}
      </div>

      <label className='flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-3'>
        <input
          type='checkbox'
          className='mt-1 h-4 w-4 rounded border-zinc-600'
          checked={settings.toolsEnabled.weather}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              toolsEnabled: {
                ...s.toolsEnabled,
                weather: e.target.checked,
              },
            }))
          }
        />
        <span>
          <span className='font-medium text-zinc-200'>Weather</span>
          <span className='mt-1 block text-xs text-zinc-500'>
            Fetches current conditions (and optional 3-day outlook) from{' '}
            <code className='text-zinc-400'>wttr.in</code> via the desktop app. Requires
            network access from Electron.
          </span>
        </span>
      </label>
    </div>
  )
}
