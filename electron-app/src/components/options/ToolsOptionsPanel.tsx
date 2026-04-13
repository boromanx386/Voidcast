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
    <div className="grid gap-4 text-sm">
      {/* Header */}
      <div className="border-b border-void-muted/30 pb-3">
        <p className="text-xs font-mono text-void-dim">
          <span className="text-neon-yellow mr-2">⬡</span>
          Enable tools for the model to use during conversation.
          Requires a tool-capable model (Llama 3.1+, Qwen2.5+, Mistral).
        </p>
      </div>

      {/* Web Search */}
      <ToolToggle
        checked={settings.toolsEnabled.webSearch}
        onChange={(v) =>
          setSettings((s) => ({
            ...s,
            toolsEnabled: { ...s.toolsEnabled, webSearch: v },
          }))
        }
        label="WEB_SEARCH"
        icon="⌕"
        iconColor="text-neon-cyan"
        description={
          <>
            Uses <code className="text-neon-cyan">POST /tools/search</code> on TTS server (ddgs).
            Falls back to DuckDuckGo API in Electron if server unavailable.
          </>
        }
      />

      {/* YouTube */}
      <ToolToggle
        checked={settings.toolsEnabled.youtube}
        onChange={(v) =>
          setSettings((s) => ({
            ...s,
            toolsEnabled: { ...s.toolsEnabled, youtube: v },
          }))
        }
        label="YOUTUBE"
        icon="▶"
        iconColor="text-neon-red"
        description={
          <>
            <code className="text-neon-red">search_youtube</code> via TTS server.
            Requires <code className="text-void-light">yt-dlp</code> and{' '}
            <code className="text-void-light">youtube-transcript-api</code>.
          </>
        }
      />

      {/* Scrape URL */}
      <ToolToggle
        checked={settings.toolsEnabled.scrape}
        onChange={(v) =>
          setSettings((s) => ({
            ...s,
            toolsEnabled: { ...s.toolsEnabled, scrape: v },
          }))
        }
        label="SCRAPE_URL"
        icon="⬡"
        iconColor="text-neon-green"
        description={
          <>
            Fetch public pages in Electron, strip HTML to text (~2MB limit).
            Blocks SSRF to local/private hosts.
          </>
        }
      />

      {/* Save PDF */}
      <div className="bg-void-black/50 border border-void-muted/30 p-4">
        <ToolToggle
          checked={settings.toolsEnabled.pdf}
          onChange={(v) =>
            setSettings((s) => ({
              ...s,
              toolsEnabled: { ...s.toolsEnabled, pdf: v },
            }))
          }
          label="SAVE_PDF"
          icon="◈"
          iconColor="text-neon-purple"
          description={
            <>
              <code className="text-neon-purple">save_pdf</code> generates PDF with headings,
              lists, tables, and <code className="text-void-light">**bold**</code>.
            </>
          }
          noBorder
        />

        {settings.toolsEnabled.pdf && (
          <div className="mt-4 border-t border-void-muted/20 pt-4">
            <label className="form-label text-void-dim">
              <span className="mr-2">▸</span>PDF_OUTPUT_DIR
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                spellCheck={false}
                className="cyber-input flex-1 min-w-[12rem]"
                placeholder="C:\Users\...\Documents\VoidcastPDF"
                value={settings.pdfOutputDir}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, pdfOutputDir: e.target.value }))
                }
              />
              <button
                type="button"
                disabled={pickBusy}
                className="cyber-btn text-xs"
                onClick={() => void browsePdfFolder()}
              >
                {pickBusy ? '...' : 'BROWSE'}
              </button>
            </div>
            <p className="text-xs text-void-dim mt-2">
              Required for PDF export. Accepts path or browse dialog.
            </p>
          </div>
        )}
      </div>

      {/* Weather */}
      <ToolToggle
        checked={settings.toolsEnabled.weather}
        onChange={(v) =>
          setSettings((s) => ({
            ...s,
            toolsEnabled: { ...s.toolsEnabled, weather: v },
          }))
        }
        label="WEATHER"
        icon="◐"
        iconColor="text-neon-yellow"
        description={
          <>
            Fetches from <code className="text-neon-yellow">wttr.in</code> via Electron.
            Includes 3-day forecast when enabled.
          </>
        }
      />
    </div>
  )
}

// Tool Toggle Sub-Component
function ToolToggle({
  checked,
  onChange,
  label,
  icon,
  iconColor,
  description,
  noBorder = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  icon: string
  iconColor: string
  description: React.ReactNode
  noBorder?: boolean
}) {
  return (
    <label
      className={`flex items-start gap-3 p-4 transition-all cursor-pointer ${
        noBorder
          ? ''
          : checked
            ? 'bg-neon-cyan/5 border border-neon-cyan/30'
            : 'bg-void-black/50 border border-void-muted/30 hover:border-void-dim/50'
      }`}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-neon-cyan"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex-1">
        <span className={`font-mono text-sm ${checked ? 'text-neon-cyan' : 'text-void-light'}`}>
          <span className={`${iconColor} mr-2`}>{icon}</span>
          {label}
          {checked && <span className="ml-2 text-xs opacity-70">[ACTIVE]</span>}
        </span>
        <span className="mt-1 block text-xs text-void-dim">{description}</span>
      </span>
    </label>
  )
}
