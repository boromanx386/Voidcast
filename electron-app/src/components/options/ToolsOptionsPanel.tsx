import type { AppSettings } from '@/lib/settings'
import {
  AGENT_MAX_TOOL_ROUNDS_DEFAULT,
  AGENT_MAX_TOOL_ROUNDS_MAX,
  AGENT_MAX_TOOL_ROUNDS_MIN,
  clampAgentMaxToolRounds,
} from '@/lib/settings'
import { NumericSettingInput } from '@/components/options/NumericSettingInput'
import { isElectron, isWebStandalone } from '@/lib/platform'
import {
  addTrustedMcpProjectPath,
  isMcpProjectTrusted,
  type McpProjectServerPreview,
} from '@/lib/mcpProjectTrust'
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

      <div className="bg-void-black/50 border border-void-muted/30 p-4">
        <label className="mb-1 block text-xs font-mono text-void-dim">
          <span className="mr-2 text-neon-cyan">▸</span>MAX_TOOL_ROUNDS
        </label>
        <p className="mb-2 text-xs text-void-dim">
          Max agent↔tool loop rounds per reply (default {AGENT_MAX_TOOL_ROUNDS_DEFAULT}). Near the end the
          model is nudged to wrap up; after the limit it must finish with a text answer (no more tools).
        </p>
        <NumericSettingInput
          className="cyber-input w-28"
          value={settings.agentMaxToolRounds}
          min={AGENT_MAX_TOOL_ROUNDS_MIN}
          max={AGENT_MAX_TOOL_ROUNDS_MAX}
          onCommit={(n) =>
            setSettings((s) => ({ ...s, agentMaxToolRounds: clampAgentMaxToolRounds(n) }))
          }
        />
        <p className="mt-1 text-[10px] font-mono text-void-dim">
          {AGENT_MAX_TOOL_ROUNDS_MIN}–{AGENT_MAX_TOOL_ROUNDS_MAX}
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
              <code className="text-void-light">find_symbols</code>,{' '}
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
    {
      id: string
      state: 'running' | 'error' | 'stopped' | 'disabled'
      toolCount: number
      error?: string
      oauthEnabled?: boolean
      authState?: 'none' | 'authenticated' | 'needs_sign_in'
    }[]
  >([])
  const [configPath, setConfigPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [pendingProjectTrust, setPendingProjectTrust] = useState(false)
  const [projectPreviewServers, setProjectPreviewServers] = useState<McpProjectServerPreview[]>([])

  const projectPath = (
    settings.coding.projectPath ||
    settings.codingProjectPath ||
    ''
  ).trim()

  const enabledServers = settings.mcpServerEnabled
  const trustedProjectPaths = settings.mcpTrustedProjectPaths

  const mcpOpts = useCallback(
    () => ({
      projectPath: projectPath || undefined,
      enabledServers,
      trustedProjectPaths,
    }),
    [projectPath, enabledServers, trustedProjectPaths],
  )

  const loadProjectPreview = useCallback(async () => {
    if (!projectPath) {
      setProjectPreviewServers([])
      return
    }
    const { getMcpProjectConfigPreview } = await import('@/lib/mcpTools')
    const preview = await getMcpProjectConfigPreview(projectPath)
    setProjectPreviewServers(preview.servers)
  }, [projectPath])

  const refreshStatus = useCallback(
    async (ensure: boolean) => {
      if (!window.voidcast?.mcpStatus) return
      const res = await window.voidcast.mcpStatus({
        ...mcpOpts(),
        ensure: ensure && settings.mcpEnabled,
      })
      setStatus(res.status ?? [])
      setConfigPath(res.configPath ?? '')
      const pending = Boolean(res.pendingProjectTrust)
      setPendingProjectTrust(pending)
      if (pending) {
        await loadProjectPreview()
      } else {
        setProjectPreviewServers([])
      }
      if (!res.ok && res.error) setMessage(res.error)
    },
    [settings.mcpEnabled, mcpOpts, loadProjectPreview],
  )

  useEffect(() => {
    if (!settings.mcpEnabled) {
      setStatus([])
      return
    }
    void refreshStatus(true)
  }, [settings.mcpEnabled, projectPath, enabledServers, refreshStatus])

  const onReload = useCallback(async () => {
    setBusy(true)
    setMessage(null)
    try {
      const { reloadMcpServers } = await import('@/lib/mcpTools')
      const res = await reloadMcpServers(mcpOpts())
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
  }, [mcpOpts, refreshStatus])

  const onTrustProject = useCallback(async () => {
    if (!projectPath) return
    const nextTrusted = addTrustedMcpProjectPath(trustedProjectPaths, projectPath)
    setSettings((s) => ({ ...s, mcpTrustedProjectPaths: nextTrusted }))
    setBusy(true)
    setMessage(null)
    try {
      const { reloadMcpServers, clearMcpToolsCache } = await import('@/lib/mcpTools')
      clearMcpToolsCache()
      const res = await reloadMcpServers({
        projectPath,
        enabledServers,
        trustedProjectPaths: nextTrusted,
      })
      setStatus(res.status)
      setPendingProjectTrust(false)
      setProjectPreviewServers([])
      setMessage(
        res.ok
          ? `Trusted project MCP config. Loaded ${res.tools.length} tool(s).`
          : res.error || 'Reload failed after trust',
      )
    } finally {
      setBusy(false)
    }
  }, [projectPath, trustedProjectPaths, enabledServers, setSettings])

  const onToggleServer = useCallback(
    async (serverId: string, enabled: boolean) => {
      const nextMap = { ...settings.mcpServerEnabled, [serverId]: enabled }
      setSettings((s) => ({ ...s, mcpServerEnabled: nextMap }))
      setBusy(true)
      setMessage(null)
      try {
        const { reloadMcpServers, clearMcpToolsCache } = await import('@/lib/mcpTools')
        clearMcpToolsCache()
        const res = await reloadMcpServers({
          projectPath: projectPath || undefined,
          enabledServers: nextMap,
          trustedProjectPaths,
        })
        setStatus(res.status)
        setMessage(
          enabled
            ? `Enabled ${serverId}`
            : `Disabled ${serverId} (stays in mcp.json, tools hidden)`,
        )
      } finally {
        setBusy(false)
      }
    },
    [projectPath, setSettings, settings.mcpServerEnabled, trustedProjectPaths],
  )

  const onOAuthSignIn = useCallback(
    async (serverId: string) => {
      setBusy(true)
      setMessage(null)
      try {
        const { signInMcpOAuthServer } = await import('@/lib/mcpTools')
        const res = await signInMcpOAuthServer(serverId, mcpOpts())
        setStatus(res.status)
        setMessage(
          res.ok
            ? `Opened OAuth sign-in for ${serverId}. Complete login in your browser.`
            : res.error || `OAuth sign-in failed for ${serverId}`,
        )
      } finally {
        setBusy(false)
      }
    },
    [mcpOpts],
  )

  const onOAuthSignOut = useCallback(
    async (serverId: string) => {
      setBusy(true)
      setMessage(null)
      try {
        const { signOutMcpOAuthServer } = await import('@/lib/mcpTools')
        const res = await signOutMcpOAuthServer(serverId, mcpOpts())
        setStatus(res.status)
        setMessage(res.ok ? `Signed out of ${serverId}.` : res.error || 'OAuth sign-out failed')
      } finally {
        setBusy(false)
      }
    },
    [mcpOpts],
  )

  const onOpenConfig = useCallback(async () => {
    setMessage(null)
    const res = await window.voidcast?.mcpOpenConfig?.()
    if (!res?.ok) {
      setMessage(res?.error || 'Could not open MCP config')
      return
    }
    setConfigPath(res.path)
    setMessage('Opened MCP config file')
  }, [])

  const configLabel = configPath
    ? configPath.replace(/\\/g, '/').replace(/^.*\/\.voidcast\//, '~/.voidcast/')
    : ''

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
            . Toggle each server below. Remote servers can use{' '}
            <code className="text-void-light">"oauth": true</code> for browser sign-in. Tools appear as{' '}
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
          {configLabel ? (
            <p className="text-xs font-mono text-void-dim break-all">Config: {configLabel}</p>
          ) : null}
          {pendingProjectTrust && projectPath ? (
            <div className="rounded border border-neon-yellow/40 bg-neon-yellow/5 px-3 py-3 space-y-2">
              <p className="text-xs text-neon-yellow font-mono">
                Untrusted project <code className="text-void-light">.mcp.json</code> — review servers
                before enabling.
              </p>
              {projectPreviewServers.length > 0 ? (
                <ul className="space-y-1 text-xs font-mono text-void-dim">
                  {projectPreviewServers.map((s) => (
                    <li key={s.id}>
                      <span className="text-void-light">{s.id}</span>
                      <span className="ml-2">[{s.transport}]</span>
                      <span className="ml-2 break-all">{s.summary}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-void-dim">Loading project MCP preview…</p>
              )}
              <button
                type="button"
                className="cyber-btn text-xs"
                disabled={busy || isMcpProjectTrusted(projectPath, trustedProjectPaths)}
                onClick={() => void onTrustProject()}
              >
                TRUST_PROJECT_MCP
              </button>
            </div>
          ) : null}
          {status.length === 0 ? (
            <p className="text-xs text-void-dim">
              No servers in config. Add entries under <code className="text-void-light">mcpServers</code>{' '}
              then Reload.
            </p>
          ) : (
            <ul className="space-y-2">
              {status.map((s) => {
                const enabled = enabledServers[s.id] !== false
                return (
                  <li
                    key={s.id}
                    className="flex items-start gap-3 rounded border border-void-muted/20 bg-void-black/40 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-neon-cyan"
                      checked={enabled}
                      disabled={busy}
                      onChange={(e) => void onToggleServer(s.id, e.target.checked)}
                      aria-label={`Enable MCP server ${s.id}`}
                    />
                    <span className="min-w-0 flex-1 font-mono text-xs">
                      <span className={enabled ? 'text-void-light' : 'text-void-dim'}>{s.id}</span>
                      <span className="ml-2 text-void-dim">
                        [
                        {s.state === 'running'
                          ? 'RUNNING'
                          : s.state === 'error'
                            ? 'ERROR'
                            : s.state === 'disabled'
                              ? 'OFF'
                              : 'STOPPED'}
                        ]
                        {s.oauthEnabled ? (
                          <span className="ml-2 text-neon-yellow">
                            OAuth:
                            {s.authState === 'authenticated'
                              ? 'SIGNED_IN'
                              : s.authState === 'needs_sign_in'
                                ? 'SIGN_IN_REQUIRED'
                                : 'OFF'}
                          </span>
                        ) : null}
                        {s.state === 'running' ? ` ${s.toolCount} tool(s)` : ''}
                      </span>
                      {s.error ? (
                        <span className="mt-1 block text-void-dim break-words">{s.error}</span>
                      ) : null}
                      {s.oauthEnabled && enabled ? (
                        <span className="mt-2 flex flex-wrap gap-2">
                          {s.authState !== 'authenticated' ? (
                            <button
                              type="button"
                              className="cyber-btn text-[10px] px-2 py-1"
                              disabled={busy}
                              onClick={() => void onOAuthSignIn(s.id)}
                            >
                              SIGN_IN
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="cyber-btn text-[10px] px-2 py-1"
                            disabled={busy}
                            onClick={() => void onOAuthSignOut(s.id)}
                          >
                            SIGN_OUT
                          </button>
                        </span>
                      ) : null}
                    </span>
                  </li>
                )
              })}
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
