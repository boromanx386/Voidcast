import type { AppSettings } from '@/lib/settings'
import { isElectron, isWebStandalone } from '@/lib/platform'
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  /** Commits project path (browse / blur) and resets coding context memo when path changes. */
  onCodingProjectPathApplied?: (path: string) => void
  /** Resolved folder for save_pdf (local on desktop, or host path pushed from desktop on phone). */
  effectivePdfOutputDir?: string
}

export function ToolsOptionsPanel({
  settings,
  setSettings,
  onCodingProjectPathApplied,
  effectivePdfOutputDir = '',
}: Props) {
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
        if (onCodingProjectPathApplied) {
          onCodingProjectPathApplied(r.path)
        } else {
          setSettings((s) => ({
            ...s,
            coding: { ...s.coding, projectPath: r.path, enabled: true },
            codingProjectPath: r.path,
            toolsEnabled: { ...s.toolsEnabled, coding: true },
          }))
        }
      }
    } finally {
      setPickBusy(false)
    }
  }, [setSettings, onCodingProjectPathApplied])

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

      {/* Reddit */}
      <ToolToggle
        checked={settings.toolsEnabled.reddit}
        onChange={(v) =>
          setSettings((s) => ({
            ...s,
            toolsEnabled: { ...s.toolsEnabled, reddit: v },
          }))
        }
        label="REDDIT_FEED"
        icon="⬢"
        iconColor="text-orange-400"
        description={
          <>
            <code className="text-orange-400">reddit_feed</code> via TTS server{' '}
            <code className="text-orange-400">POST /tools/reddit</code>. Read-only:
            subreddit feeds (hot/new/top/rising), search, and post + top comments via
            public Reddit JSON endpoints. No API key required.
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

      {/* Save PDF — rendered by Python tools server (ReportLab) */}
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
              <code className="text-neon-purple">POST /tools/pdf</code> on TTS server (ReportLab):
              headings, bullet/numbered lists (with hanging indent), tables,{' '}
              <code className="text-void-light">**bold**</code>, and optional embedded chat
              images (PNG/JPEG). The file is written by the server into the configured folder.
            </>
          }
          noBorder
        />

        {settings.toolsEnabled.pdf && (
          <div className="mt-4 border-t border-void-muted/20 pt-4">
            <label className="form-label text-void-dim">
              <span className="mr-2">▸</span>PDF_OUTPUT_DIR
            </label>
            {isWebStandalone() ? (
              <>
                <p className="text-xs text-void-dim mt-1">
                  PDFs are saved on your PC (where Voidcast
                  desktop and the tools server run), not on the phone. Set the folder in the desktop app:
                  Options → Tools → Save as PDF → BROWSE. Keep the desktop app open so the path syncs here.
                </p>
                <input
                  type="text"
                  readOnly
                  spellCheck={false}
                  className="cyber-input flex-1 min-w-[12rem] mt-2 opacity-90"
                  placeholder="Not set on desktop yet"
                  value={effectivePdfOutputDir}
                />
              </>
            ) : (
              <>
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
                  {isElectron() && (
                    <button
                      type="button"
                      disabled={pickBusy}
                      className="cyber-btn text-xs"
                      onClick={() => void browsePdfFolder()}
                    >
                      {pickBusy ? '...' : 'BROWSE'}
                    </button>
                  )}
                </div>
                <p className="text-xs text-void-dim mt-2">
                  Required for PDF export. Path is resolved on the host running the tools server.
                </p>
              </>
            )}
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
          description={
            <>
              Enable LLM coding tools:{' '}
              <code className="text-void-light">
                list_directory
              </code>
              , <code className="text-void-light">read_file</code>,{' '}
              <code className="text-void-light">write_file</code>, <code className="text-void-light">edit_code</code>,{' '}
              <code className="text-void-light">search_files</code>, <code className="text-void-light">glob_files</code>,{' '}
              <code className="text-void-light">git_status</code>, <code className="text-void-light">git_diff</code>,{' '}
              <code className="text-void-light">git_log</code>, <code className="text-void-light">git_show</code>,{' '}
              <code className="text-void-light">execute_command</code>.
            </>
          }
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
                onBlur={(e) => onCodingProjectPathApplied?.(e.target.value)}
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
