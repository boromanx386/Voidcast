import type { AppSettings } from '@/lib/settings'
import { isElectron, isWebStandalone } from '@/lib/platform'
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'

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
            Uses <code className="text-neon-cyan">POST /tools/search</code> on local server (ddgs).
            Falls back to DuckDuckGo API in Electron if server unavailable.
          </>
        }
      />

      {/* Enter Plan Mode */}
      <ToolToggle
        checked={settings.toolsEnabled.enterPlan}
        onChange={(v) =>
          setSettings((s) => ({
            ...s,
            toolsEnabled: { ...s.toolsEnabled, enterPlan: v },
          }))
        }
        label="ENTER_PLAN_MODE"
        icon="✎"
        iconColor="text-neon-purple"
        description={
          <>
            Lets the agent switch the conversation into{' '}
            <code className="text-neon-purple">Plan mode</code> when a task is complex/risky or you
            ask for a plan. Plan mode explores read-only and shows an editable plan card for
            approval before any changes are made.
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
            <code className="text-neon-red">search_youtube</code> via local server.
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
            <code className="text-orange-400">reddit_feed</code> via local server{' '}
            <code className="text-orange-400">POST /tools/reddit</code>. Read-only:
            subreddit feeds (hot/new/top/rising), search, and post + top comments via
            Reddit RSS (no Reddit developer app — Reddit no longer allows self-service API
            apps).
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
              <code className="text-neon-purple">POST /tools/pdf</code> on local server (ReportLab):
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
                  PDFs are saved on your PC (where Voidcast desktop and the local server run), not
                  on the phone. Set the folder in the desktop app:
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
                  Required for PDF export. Path is resolved on the PC running the local server.
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
            <code className="text-neon-yellow">POST /tools/weather</code> on local server or Electron →{' '}
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
              <code className="text-void-light">check_types</code>,{' '}
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

      {/* MCP Servers (desktop) */}
      {isElectron() && (
        <McpServersSection settings={settings} setSettings={setSettings} />
      )}
    </div>
  )
}

function McpServersSection({
  settings,
  setSettings,
}: {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
}) {
  const [status, setStatus] = useState<
    { id: string; state: 'running' | 'error' | 'stopped'; toolCount: number; error?: string }[]
  >([])
  const [configPath, setConfigPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const projectPath = (
    settings.coding.projectPath ||
    settings.codingProjectPath ||
    ''
  ).trim()

  const refreshStatus = useCallback(
    async (ensure: boolean) => {
      if (!window.voidcast?.mcpStatus) return
      const res = await window.voidcast.mcpStatus({
        projectPath: projectPath || undefined,
        ensure: ensure && settings.mcpEnabled,
      })
      setStatus(res.status ?? [])
      setConfigPath(res.configPath ?? '')
      if (!res.ok && res.error) setMessage(res.error)
    },
    [projectPath, settings.mcpEnabled],
  )

  useEffect(() => {
    if (!settings.mcpEnabled) {
      setStatus([])
      return
    }
    void refreshStatus(true)
  }, [settings.mcpEnabled, projectPath, refreshStatus])

  const onReload = useCallback(async () => {
    setBusy(true)
    setMessage(null)
    try {
      const { reloadMcpServers } = await import('@/lib/mcpTools')
      const res = await reloadMcpServers(projectPath || undefined)
      setStatus(res.status)
      if (!res.ok) {
        setMessage(res.error || 'MCP reload failed')
      } else {
        setMessage(
          res.status.length === 0
            ? 'No MCP servers in config. Edit ~/.voidcast/mcp.json then Reload.'
            : `Reloaded ${res.status.length} server(s), ${res.tools.length} tool(s).`,
        )
      }
      await refreshStatus(false)
    } finally {
      setBusy(false)
    }
  }, [projectPath, refreshStatus])

  const onOpenConfig = useCallback(async () => {
    setMessage(null)
    const res = await window.voidcast?.mcpOpenConfig?.()
    if (!res?.ok) {
      setMessage(res?.error || 'Could not open MCP config')
      return
    }
    setConfigPath(res.path)
    setMessage(`Opened ${res.path}`)
  }, [])

  return (
    <div
      className={`p-4 transition-all ${
        settings.mcpEnabled
          ? 'bg-neon-cyan/5 border border-neon-cyan/30'
          : 'bg-void-black/50 border border-void-muted/30'
      }`}
    >
      <ToolToggle
        checked={settings.mcpEnabled}
        onChange={(v) => {
          setSettings((s) => ({ ...s, mcpEnabled: v }))
          if (!v) {
            void import('@/lib/mcpTools').then(({ clearMcpToolsCache }) => clearMcpToolsCache())
            void window.voidcast?.mcpStopAll?.()
            setStatus([])
            setMessage(null)
          }
        }}
        label="MCP_SERVERS"
        icon="⬡"
        iconColor="text-neon-yellow"
        noBorder
        description={
          <>
            Connect MCP servers from{' '}
            <code className="text-void-light">~/.voidcast/mcp.json</code>
            {projectPath ? (
              <>
                {' '}
                (plus project <code className="text-void-light">.mcp.json</code>)
              </>
            ) : null}
            . Supports <code className="text-void-light">command</code> (stdio) and{' '}
            <code className="text-void-light">url</code> (HTTP/SSE). Tools appear as{' '}
            <code className="text-void-light">mcp__server__tool</code>. Blocked in Plan mode.
          </>
        }
      />
      {settings.mcpEnabled && (
        <div className="mt-4 border-t border-void-muted/20 pt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="cyber-btn text-xs"
              disabled={busy}
              onClick={() => void onReload()}
            >
              {busy ? '...' : 'RELOAD'}
            </button>
            <button
              type="button"
              className="cyber-btn text-xs"
              disabled={busy}
              onClick={() => void onOpenConfig()}
            >
              OPEN_CONFIG
            </button>
          </div>
          {configPath ? (
            <p className="text-xs font-mono text-void-dim break-all">Config: {configPath}</p>
          ) : null}
          {status.length === 0 ? (
            <p className="text-xs text-void-dim">
              No servers connected. Add entries under <code className="text-void-light">mcpServers</code>{' '}
              then Reload.
            </p>
          ) : (
            <ul className="space-y-1 text-xs font-mono">
              {status.map((s) => (
                <li key={s.id} className="text-void-light">
                  <span
                    className={
                      s.state === 'running'
                        ? 'text-neon-cyan'
                        : s.state === 'error'
                          ? 'text-neon-pink'
                          : 'text-void-dim'
                    }
                  >
                    [{s.state.toUpperCase()}]
                  </span>{' '}
                  {s.id}
                  {s.state === 'running' ? ` — ${s.toolCount} tool(s)` : null}
                  {s.error ? <span className="text-void-dim"> — {s.error}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {message ? <p className="text-xs text-void-dim">{message}</p> : null}
        </div>
      )}
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
