import type { AppSettings } from '@/lib/settings'
import { isElectron, isWebStandalone } from '@/lib/platform'
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
}

export function ToolsOptionsPanel({ settings, setSettings }: Props) {
  const [pickBusy, setPickBusy] = useState(false)

  const browsePdfFolder = useCallback(async () => {
    const vc = isElectron() ? window.voidcast?.pickDirectory : undefined
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

  const browseCodingFolder = useCallback(async () => {
    const vc = isElectron() ? window.voidcast?.pickCodingDirectory : undefined
    if (!vc) return
    setPickBusy(true)
    try {
      const r = await vc()
      if (r.ok && r.path) {
        setSettings((s) => ({
          ...s,
          coding: { ...s.coding, projectPath: r.path, enabled: true },
          codingProjectPath: r.path,
          toolsEnabled: { ...s.toolsEnabled, coding: true },
        }))
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
          Requires a tool-capable model (e.g. Qwen 3.5, Gemma 4, MiniMax 2.7 — check Ollama library tags).
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
            Fetch public pages via TTS <code className="text-neon-green">POST /tools/scrape</code> or
            Electron; strip HTML to text (~2MB). Blocks SSRF to local/private hosts.
          </>
        }
      />

      {/* Save PDF — desktop only */}
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
          disabled={isWebStandalone()}
          description={
            <>
              <code className="text-neon-purple">save_pdf</code> generates PDF with headings,
              bullet/numbered lists (with hanging indent), optional embedded chat images (PNG/JPEG),
              tables, and <code className="text-void-light">**bold**</code>.
              {isWebStandalone() && (
                <span className="block mt-1 text-neon-yellow/90">
                  Desktop (Electron) only — not available in the mobile web client.
                </span>
              )}
            </>
          }
          noBorder
        />

        {settings.toolsEnabled.pdf && isElectron() && (
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
            <code className="text-neon-yellow">POST /tools/weather</code> on TTS server or Electron →{' '}
            <code className="text-void-light">wttr.in</code>. Includes 3-day forecast when enabled.
          </>
        }
      />

      <div className="bg-void-black/50 border border-void-muted/30 p-4">
        <ToolToggle
          checked={settings.toolsEnabled.coding}
          onChange={(v) =>
            setSettings((s) => ({
              ...s,
              toolsEnabled: { ...s.toolsEnabled, coding: v },
              coding: { ...s.coding, enabled: v },
            }))
          }
          label="CODING_TOOLS"
          icon="⌘"
          iconColor="text-neon-cyan"
          disabled={isWebStandalone()}
          description={<>Enable LLM coding tools (`list_directory`, `read_file`, `write_file`, `search_files`, `execute_command`).</>}
          noBorder
        />
        {settings.toolsEnabled.coding && isElectron() && (
          <div className="mt-4 border-t border-void-muted/20 pt-4">
            <label className="form-label text-void-dim">
              <span className="mr-2">▸</span>CODING_PROJECT_DIR
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                spellCheck={false}
                className="cyber-input flex-1 min-w-[12rem]"
                placeholder="C:\project\folder"
                value={settings.coding.projectPath}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    coding: { ...s.coding, projectPath: e.target.value },
                    codingProjectPath: e.target.value,
                  }))
                }
              />
              <button type="button" disabled={pickBusy} className="cyber-btn text-xs" onClick={() => void browseCodingFolder()}>
                {pickBusy ? '...' : 'BROWSE'}
              </button>
            </div>
          </div>
        )}
      </div>
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
  disabled = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  icon: string
  iconColor: string
  description: React.ReactNode
  noBorder?: boolean
  disabled?: boolean
}) {
  return (
    <label
      className={`flex items-start gap-3 p-4 transition-all ${
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      } ${
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
        disabled={disabled}
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
