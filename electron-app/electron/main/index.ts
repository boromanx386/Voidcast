import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  shell,
  Tray,
  nativeImage,
  nativeTheme,
  type NativeImage,
  type OpenDialogOptions,
  type WebContents,
} from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { ChunkThrottle } from '../../src/lib/chunkThrottle'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { rgPath as bundledRgPath } from '@vscode/ripgrep'
import { update } from './update'
import { scrapePublicUrlToText } from './scrape'
import {
  formatMcpToolName,
  getGlobalMcpConfigPath,
  isMcpProjectTrustedResolved,
  loadProjectMcpConfig,
  mcpManager,
  normalizeMcpProjectPathResolved,
  parseMcpToolName,
  projectHasMcpConfigFile,
  readPersistedMcpResult,
} from './mcpManager'
import { buildMcpProjectServerPreviews } from '../../src/lib/mcpProjectTrust'
import {
  CODING_RIPGREP_EXCLUDE_GLOBS,
  filterCodingSearchMatches,
  isCodingGeneratedArtifactPath,
  shouldSkipCodingProjectDir,
} from '../../src/lib/codingProjectSkip'
import {
  CODING_SEARCH_CONTEXT_LINES,
  CODING_SEARCH_INTERNAL_MAX,
  CODING_SEARCH_LINE_TEXT_MAX,
  CODING_SEARCH_MAX_BLOCKS,
  CODING_SEARCH_MAX_PER_FILE,
  countMatchesByFile,
  mergeMatchRanges,
  rankSearchMatches,
  type CodingSearchBlock,
  type CodingSearchBlockLine,
  type CodingSearchProcessedResult,
  type CodingSearchRawMatch,
  type ScoredSearchMatch,
} from '../../src/lib/codingSearch'
import {
  filterTscDiagnostics,
  formatTypecheckReport,
  normalizeTypecheckPath,
  parseTscDiagnostics,
} from '../../src/lib/codingTypecheck'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
let tray: Tray | null = null
/** True when user chose Quit (vs close-to-tray). */
let isQuitting = false
let toolsServerProcess: ChildProcessWithoutNullStreams | null = null

import {
  mergeActiveProcessOutputLines,
  type ActiveCodingProcess,
  type ActiveCodingProcessKind,
} from '../../src/lib/codingActiveProcesses'

/** Foreground + background `execute_command` runs — keyed by runId for STOP / CTX hint. */
type ActiveCodingProcessEntry = ActiveCodingProcess & { killed: boolean }

const activeCodingProcesses = new Map<string, ActiveCodingProcessEntry>()
let toolsServerStarting = false

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function toPublicProcess(entry: ActiveCodingProcessEntry): ActiveCodingProcess {
  return {
    runId: entry.runId,
    pid: entry.pid,
    command: entry.command,
    kind: entry.kind,
    startedAt: entry.startedAt,
    lastLines: [...entry.lastLines],
  }
}

function pruneDeadCodingProcesses(): void {
  for (const [runId, entry] of activeCodingProcesses) {
    if (entry.killed) continue
    if (entry.pid > 0 && !isPidAlive(entry.pid)) {
      activeCodingProcesses.delete(runId)
    }
  }
}

function listActiveCodingProcesses(): ActiveCodingProcess[] {
  pruneDeadCodingProcesses()
  return [...activeCodingProcesses.values()].map(toPublicProcess)
}

function sendCodingProcessUpdate(
  sender: WebContents,
  payload:
    | { action: 'upsert'; process: ActiveCodingProcess }
    | { action: 'remove'; runId: string },
): void {
  try {
    sender.send('voidcast:coding-process-update', payload)
  } catch {
    // window may be gone
  }
}

function registerCodingProcess(
  sender: WebContents,
  params: {
    runId: string
    pid: number
    command: string
    kind: ActiveCodingProcessKind
  },
): ActiveCodingProcessEntry {
  const entry: ActiveCodingProcessEntry = {
    runId: params.runId,
    pid: params.pid,
    command: params.command,
    kind: params.kind,
    startedAt: Date.now(),
    lastLines: [],
    killed: false,
  }
  activeCodingProcesses.set(params.runId, entry)
  sendCodingProcessUpdate(sender, { action: 'upsert', process: toPublicProcess(entry) })
  return entry
}

function appendCodingProcessOutput(runId: string, text: string): void {
  const entry = activeCodingProcesses.get(runId)
  if (!entry || !text) return
  entry.lastLines = mergeActiveProcessOutputLines(entry.lastLines, text)
}

function unregisterCodingProcess(sender: WebContents, runId: string): void {
  if (!activeCodingProcesses.delete(runId)) return
  sendCodingProcessUpdate(sender, { action: 'remove', runId })
}
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'logo_app_nobg.png')
  : path.join(process.env.APP_ROOT, '..', 'logo_app_nobg.png')

function createZoomedTrayIcon(iconPath: string): NativeImage | null {
  const src = nativeImage.createFromPath(iconPath)
  if (src.isEmpty()) return null

  const { width, height } = src.getSize()
  if (width <= 0 || height <= 0) return null

  // Crop to center so the symbol occupies more of the tray icon.
  const cropWidth = Math.max(1, Math.floor(width * 0.5))
  const cropHeight = Math.max(1, Math.floor(height * 0.5))
  const x = Math.max(0, Math.floor((width - cropWidth) / 2))
  const y = Math.max(0, Math.floor((height - cropHeight) / 2))

  return src
    .crop({ x, y, width: cropWidth, height: cropHeight })
    .resize({ width: 18, height: 18 })
}

function createZoomedWindowIcon(iconPath: string): NativeImage | null {
  const src = nativeImage.createFromPath(iconPath)
  if (src.isEmpty()) return null

  const { width, height } = src.getSize()
  if (width <= 0 || height <= 0) return null

  // Stronger crop than tray so Windows taskbar/app icon appears visually larger.
  const cropWidth = Math.max(1, Math.floor(width * 0.55))
  const cropHeight = Math.max(1, Math.floor(height * 0.55))
  const x = Math.max(0, Math.floor((width - cropWidth) / 2))
  const y = Math.max(0, Math.floor((height - cropHeight) / 2))

  return src
    .crop({ x, y, width: cropWidth, height: cropHeight })
    .resize({ width: 256, height: 256 })
}

function getToolsServerDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tts-server')
    : path.join(process.env.APP_ROOT, '..', 'tts-server')
}

function getBundledToolsExePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tools', 'voidcast-tools-server.exe')
    : path.join(process.env.APP_ROOT, '..', 'tts-server', 'dist', 'voidcast-tools-server.exe')
}

/** Bind on all interfaces so LAN phones can reach the web UI and API proxy (override via VOIDCAST_TOOLS_HOST). */
const TOOLS_SERVER_HOST = process.env.VOIDCAST_TOOLS_HOST?.trim() || '0.0.0.0'
const TOOLS_SERVER_PORT = process.env.VOIDCAST_TOOLS_PORT?.trim() || '8765'

/** Matches default `--color-void-black` in `index.css` (rgb 10 10 15). */
const WIN_CHROME_BACKGROUND = '#0a0a0f'
const TOOLS_SERVER_HEALTH_URL = `http://127.0.0.1:${TOOLS_SERVER_PORT}`

type CapturedCommandResult =
  | { ok: true; stdout: string; stderr: string; code: number }
  | { ok: false; error: string }

function captureSpawnCommand(params: {
  command: string
  args: string[]
  cwd?: string
  timeoutMs: number
  timeoutLabel?: string
  notFoundMessage?: string
  trimOutput?: boolean
}): Promise<CapturedCommandResult> {
  const {
    command,
    args,
    cwd,
    timeoutMs,
    timeoutLabel = command,
    notFoundMessage,
    trimOutput = true,
  } = params
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      resolve({ ok: false, error: `${timeoutLabel} timed out after ${Math.round(timeoutMs / 1000)}s.` })
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const code = (err as NodeJS.ErrnoException).code
      resolve({
        ok: false,
        error:
          notFoundMessage && (code === 'ENOENT' || err.message.includes('ENOENT'))
            ? notFoundMessage
            : err.message,
      })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: true,
        stdout: trimOutput ? stdout.trimEnd() : stdout,
        stderr: trimOutput ? stderr.trimEnd() : stderr,
        code: code ?? 0,
      })
    })
  })
}

function runCommandCapture(
  command: string,
  args: string[],
  timeoutMs = 10_000,
): Promise<CapturedCommandResult> {
  return captureSpawnCommand({ command, args, timeoutMs, trimOutput: false })
}

async function killProcessTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return
  if (process.platform === 'win32') {
    await runCommandCapture('taskkill', ['/PID', String(pid), '/T', '/F'], 15_000)
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // ignore kill errors
  }
}

function killProcessTreeSync(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true })
    } catch {
      // ignore kill errors
    }
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // ignore kill errors
  }
}

async function killTrackedToolsServer(): Promise<void> {
  const pid = toolsServerProcess?.pid
  if (typeof pid === 'number' && pid > 0) {
    await killProcessTree(pid)
  } else if (toolsServerProcess && !toolsServerProcess.killed) {
    try {
      toolsServerProcess.kill()
    } catch {
      // ignore kill errors
    }
  }
  toolsServerProcess = null
}

function killTrackedToolsServerSync(): void {
  const pid = toolsServerProcess?.pid
  if (typeof pid === 'number' && pid > 0) {
    killProcessTreeSync(pid)
  } else if (toolsServerProcess && !toolsServerProcess.killed) {
    try {
      toolsServerProcess.kill()
    } catch {
      // ignore kill errors
    }
  }
  toolsServerProcess = null
}

async function isToolsServerHealthy(baseUrl = TOOLS_SERVER_HEALTH_URL): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`)
    return res.ok
  } catch {
    return false
  }
}

function startToolsServerWithCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        OMNIVOICE_ENABLE_TTS: '0',
        VOIDCAST_TOOLS_HOST: TOOLS_SERVER_HOST,
        VOIDCAST_TOOLS_PORT: TOOLS_SERVER_PORT,
        VOIDCAST_WEB_UI_DIR: path.join(cwd, 'web-ui'),
      },
      windowsHide: true,
    })
    toolsServerProcess = child
    let settled = false
    let stderrText = ''

    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      if (text.trim()) console.log(`[tools-server] ${text.trim()}`)
    })
    child.stderr.on('data', (chunk) => {
      const text = String(chunk)
      stderrText += text
      if (text.trim()) console.warn(`[tools-server] ${text.trim()}`)
    })

    const settle = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }

    child.once('error', () => {
      if (toolsServerProcess === child) toolsServerProcess = null
      settle(false)
    })

    child.once('exit', () => {
      if (toolsServerProcess === child) toolsServerProcess = null
      if (!settled && /No module named|ModuleNotFoundError/i.test(stderrText)) {
        settle(false)
        return
      }
      settle(false)
    })

    // If process stays alive a bit, treat startup as successful candidate.
    setTimeout(() => {
      settle(!child.killed && child.exitCode === null)
    }, 1200)
  })
}

async function ensureToolsServerRunning(): Promise<void> {
  if (toolsServerStarting) return
  toolsServerStarting = true
  try {
    if (await isToolsServerHealthy()) {
      return
    }
    const cwd = getToolsServerDir()
    const bundledExe = getBundledToolsExePath()
    const args = [
      '-m',
      'uvicorn',
      'tools_main:app',
      '--host',
      TOOLS_SERVER_HOST,
      '--port',
      TOOLS_SERVER_PORT,
      '--app-dir',
      cwd,
    ]
    const candidates: Array<{ command: string; args: string[] }> = []
    candidates.push({ command: bundledExe, args: [] })
    if (!app.isPackaged) {
      const devPython = path.join(process.env.APP_ROOT, '..', '.venv', 'Scripts', 'python.exe')
      candidates.push({ command: devPython, args })
      candidates.push({ command: 'py', args: ['-3', ...args] })
      candidates.push({ command: 'python', args })
    }

    for (const candidate of candidates) {
      const ok = await startToolsServerWithCommand(candidate.command, candidate.args, cwd)
      if (!ok) continue
      for (let i = 0; i < 12; i++) {
        if (await isToolsServerHealthy()) {
          console.log(
            `[tools-server] Ready on http://${TOOLS_SERVER_HOST}:${TOOLS_SERVER_PORT} (phone: http://<this-PC-LAN-IP>:${TOOLS_SERVER_PORT})`,
          )
          return
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      await killTrackedToolsServer()
    }
    console.warn(
      app.isPackaged
        ? '[tools-server] Bundled tools server failed to start. Packaged app will not fall back to system Python.'
        : '[tools-server] Auto-start failed. Build may be missing bundled tools executable.',
    )
  } finally {
    toolsServerStarting = false
  }
}

// Create tray icon
function createTray() {
  // Try app icon first, fallback to a simple icon.
  const iconPath = appIconPath

  try {
    const zoomedIcon = createZoomedTrayIcon(iconPath)
    if (zoomedIcon) {
      tray = new Tray(zoomedIcon)
    } else {
      tray = new Tray(createDefaultIcon())
    }
  } catch {
    tray = new Tray(createDefaultIcon())
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Voidcast',
      click: () => {
        if (win) {
          win.show()
          win.focus()
        }
      },
    },
    {
      label: 'New Chat',
      click: () => {
        if (win) {
          win.show()
          win.focus()
          win.webContents.send('voidcast:new-chat')
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  
  tray.setToolTip('Voidcast')
  tray.setContextMenu(contextMenu)
  
  // Double-click to show window
  tray.on('double-click', () => {
    if (win) {
      win.show()
      win.focus()
    }
  })
}

// Create a simple default icon (cyan triangle)
function createDefaultIcon(): NativeImage {
  // Create a 16x16 PNG icon
  const size = 16
  const canvas = Buffer.alloc(size * size * 4)
  
  // Fill with transparent and draw a cyan triangle
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      
      // Calculate if pixel is inside triangle
      const cx = size / 2
      const cy = size / 2
      const margin = 2
      const height = size - margin * 2
      
      // Triangle: top center to bottom left and bottom right
      const topY = margin
      const bottomY = size - margin
      const leftX = margin
      const rightX = size - margin
      
      // Check if inside triangle
      const relY = (y - topY) / (bottomY - topY)
      if (relY < 0 || relY > 1) {
        canvas[idx] = 0     // R
        canvas[idx + 1] = 0 // G
        canvas[idx + 2] = 0 // B
        canvas[idx + 3] = 0 // A (transparent)
        continue
      }
      
      const halfWidth = (leftX + (rightX - leftX) * relY) / 2
      const leftEdge = cx - halfWidth
      const rightEdge = cx + halfWidth
      
      if (x >= leftEdge && x <= rightEdge) {
        // Cyan color #00f5ff
        canvas[idx] = 0       // R
        canvas[idx + 1] = 245 // G
        canvas[idx + 2] = 255 // B
        canvas[idx + 3] = 255 // A
      } else {
        canvas[idx] = 0
        canvas[idx + 1] = 0
        canvas[idx + 2] = 0
        canvas[idx + 3] = 0
      }
    }
  }
  
  return nativeImage.createFromBuffer(canvas, {
    width: size,
    height: size,
  })
}

async function createWindow() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }

  // Windows 10/11: dark caption/title bar even when the OS theme is light.
  if (process.platform === 'win32') {
    nativeTheme.themeSource = 'dark'
  }

  const windowIcon = process.platform === 'win32'
    ? (createZoomedWindowIcon(appIconPath) ?? appIconPath)
    : appIconPath

  win = new BrowserWindow({
    title: '',
    autoHideMenuBar: true,
    icon: windowIcon,
    show: false, // Start hidden until ready
    ...(process.platform === 'win32'
      ? {
          backgroundColor: WIN_CHROME_BACKGROUND,
          titleBarStyle: 'hidden',
        }
      : {}),
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,

      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) { // #298
    win.loadURL(VITE_DEV_SERVER_URL)
    // Open devTool if the app is not packaged
    win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

  // Show window when ready
  win.once('ready-to-show', () => {
    win?.show()
  })

  const emitMaximized = () => {
    win?.webContents.send('voidcast:window-maximized-changed', win.isMaximized())
  }
  win.on('maximize', emitMaximized)
  win.on('unmaximize', emitMaximized)

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Context menu for copy/paste/select-all
  win.webContents.on('context-menu', (_event, params) => {
    const menu = Menu.buildFromTemplate([
      ...(params.isEditable
        ? [
            { label: 'Undo', role: 'undo' as const },
            { label: 'Redo', role: 'redo' as const },
            { type: 'separator' as const },
            { label: 'Cut', role: 'cut' as const },
            { label: 'Copy', role: 'copy' as const },
            { label: 'Paste', role: 'paste' as const },
            { label: 'Delete', role: 'delete' as const },
            { type: 'separator' as const },
            { label: 'Select All', role: 'selectAll' as const },
          ]
        : [
            { label: 'Copy', role: 'copy' as const },
            ...(params.linkURL
              ? [
                  {
                    label: 'Open Link',
                    click: () => shell.openExternal(params.linkURL),
                  },
                ]
              : []),
            { type: 'separator' as const },
            { label: 'Select All', role: 'selectAll' as const },
          ]),
    ])
    menu.popup()
  })

  // Minimize to tray instead of closing
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win?.hide()
    }
  })

  // Auto update
  update(win)

  // Register clipboard TTS shortcut
  const readClipboardTtsShortcut = 'CommandOrControl+Alt+Shift+V'
  win.webContents.once('did-finish-load', () => {
    const ok = globalShortcut.register(readClipboardTtsShortcut, () => {
      if (!win) return
      const text = clipboard.readText().trim()
      if (!text) return
      // TTS can run in the tray: do not show/focus the window
      win.webContents.send('voidcast:read-clipboard-tts', text)
    })
    if (!ok) {
      console.warn(
        `Voidcast: could not register global shortcut ${readClipboardTtsShortcut}`,
      )
    }
  })
}

app.on('will-quit', () => {
  stopCodingProjectWatch()
  for (const entry of activeCodingProcesses.values()) {
    entry.killed = true
    killProcessTreeSync(entry.pid)
  }
  activeCodingProcesses.clear()
  killTrackedToolsServerSync()
  void mcpManager.stopAll()
  globalShortcut.unregisterAll()
})

app.whenReady().then(() => {
  void ensureToolsServerRunning()
  createWindow()
  createTray()
})

app.on('window-all-closed', () => {
  // On macOS, don't quit when all windows closed (menu bar app style)
  if (process.platform !== 'darwin') {
    // Don't quit, stay in tray
  }
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// Handle before-quit to set isQuitting flag
app.on('before-quit', () => {
  isQuitting = true
  void mcpManager.stopAll()
})

ipcMain.handle(
  'voidcast:web-search',
  async (_evt, query: string) => {
    try {
      const q = String(query ?? '').trim()
      if (!q) return { ok: false, text: 'Empty query' }
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`
      const res = await fetch(url)
      if (!res.ok) return { ok: false, text: `HTTP ${res.status}` }
      const data = (await res.json()) as {
        AbstractText?: string
        AbstractURL?: string
        Answer?: string
        RelatedTopics?: { Text?: string }[]
      }
      const parts: string[] = []
      if (data.Answer) parts.push(data.Answer)
      if (data.AbstractText) parts.push(data.AbstractText)
      if (data.AbstractURL) parts.push(`Source: ${data.AbstractURL}`)
      const topics = (data.RelatedTopics ?? [])
        .slice(0, 5)
        .map((t) => t.Text)
        .filter(Boolean) as string[]
      if (topics.length) parts.push(`Related: ${topics.join('; ')}`)
      if (parts.length === 0) {
        return {
          ok: true,
          text: 'No instant results from DuckDuckGo. Try rephrasing the query.',
        }
      }
      return { ok: true, text: parts.join('\n\n') }
    } catch (e) {
      return {
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

type WttrJson = {
  current_condition?: Array<{
    temp_C?: string
    humidity?: string
    windspeedKmph?: string
    weatherDesc?: Array<{ value?: string }>
  }>
  weather?: Array<{
    date?: string
    maxtempC?: string
    mintempC?: string
    hourly?: Array<{ weatherDesc?: Array<{ value?: string }> }>
  }>
}

function formatWttrText(data: WttrJson, city: string, forecast: boolean): string {
  const curr = data.current_condition?.[0]
  if (!curr) return 'No weather data returned for this location.'
  const desc = curr.weatherDesc?.[0]?.value ?? ''
  let res = `Weather for ${city}: ${curr.temp_C ?? '?'}°C, ${desc}\n`
  res += `Humidity: ${curr.humidity ?? '?'}%, Wind: ${curr.windspeedKmph ?? '?'} km/h`
  if (forecast && data.weather && data.weather.length > 0) {
    res += '\n\nForecast (3 days):'
    for (const day of data.weather.slice(0, 3)) {
      const d = day.date ?? '?'
      const mx = day.maxtempC ?? '?'
      const mn = day.mintempC ?? '?'
      const hourlyDesc = day.hourly?.[0]?.weatherDesc?.[0]?.value ?? ''
      res += `\n- ${d}: ${mx}°C / ${mn}°C — ${hourlyDesc}`
    }
  }
  return res
}

ipcMain.handle(
  'voidcast:scrape-url',
  async (_evt, payload: { url?: string; max_chars?: number }) => {
    const url = String(payload?.url ?? '').trim()
    return scrapePublicUrlToText(url, payload?.max_chars)
  },
)

function sanitizeBaseName(input: string): string {
  const clean = input
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return clean || 'runware-image'
}

function extFromContentType(contentType: string): string {
  const ct = contentType.toLowerCase()
  if (ct.includes('image/png')) return '.png'
  if (ct.includes('image/webp')) return '.webp'
  if (ct.includes('image/gif')) return '.gif'
  if (ct.includes('image/jpeg') || ct.includes('image/jpg')) return '.jpg'
  return '.jpg'
}

function extFromAudioContentType(contentType: string): string {
  const ct = contentType.toLowerCase()
  if (ct.includes('audio/mpeg') || ct.includes('audio/mp3')) return '.mp3'
  if (ct.includes('audio/wav') || ct.includes('audio/wave') || ct.includes('audio/x-wav')) return '.wav'
  if (ct.includes('audio/flac')) return '.flac'
  if (ct.includes('audio/ogg')) return '.ogg'
  return '.mp3'
}

async function nextAvailablePath(outputDir: string, baseName: string, ext: string): Promise<string> {
  for (let i = 0; i < 500; i++) {
    const suffix = i === 0 ? '' : `-${i + 1}`
    const candidate = path.join(outputDir, `${baseName}${suffix}${ext}`)
    try {
      await stat(candidate)
      continue
    } catch {
      return candidate
    }
  }
  return path.join(outputDir, `${baseName}-${Date.now()}${ext}`)
}

ipcMain.handle(
  'voidcast:save-image-from-url',
  async (
    _evt,
    payload: {
      imageUrl?: string
      outputDir?: string
      filename?: string
    },
  ) => {
    try {
      const imageUrl = String(payload?.imageUrl ?? '').trim()
      const outputDir =
        String(payload?.outputDir ?? '').trim() ||
        path.join(app.getPath('userData'), 'generated-images')
      if (!imageUrl) return { ok: false, text: 'Missing imageUrl' }
      await mkdir(outputDir, { recursive: true })

      let bytes: Buffer
      let contentType = 'image/png'
      if (imageUrl.startsWith('data:image/')) {
        const commaIdx = imageUrl.indexOf(',')
        if (commaIdx < 0) return { ok: false, text: 'Invalid data URL for image' }
        const header = imageUrl.slice(0, commaIdx)
        const encoded = imageUrl.slice(commaIdx + 1)
        const mimeMatch = /^data:(image\/[a-zA-Z0-9.+-]+)/.exec(header)
        if (mimeMatch?.[1]) contentType = mimeMatch[1]
        bytes = Buffer.from(encoded, 'base64')
        if (!bytes.length) return { ok: false, text: 'Empty image data URL' }
      } else {
        const res = await fetch(imageUrl)
        if (!res.ok) {
          return { ok: false, text: `Image download failed: HTTP ${res.status}` }
        }
        const ab = await res.arrayBuffer()
        bytes = Buffer.from(ab)
        contentType = res.headers.get('content-type') || 'image/jpeg'
      }

      const urlName = (() => {
        if (imageUrl.startsWith('data:')) return ''
        try {
          const p = new URL(imageUrl).pathname
          return path.basename(p) || ''
        } catch {
          return ''
        }
      })()
      const inputBase = String(payload?.filename ?? '').trim()
      const fallbackBase = `voidcast-image-${new Date().toISOString().replace(/[:.]/g, '-')}`
      const chosenBase = sanitizeBaseName(
        inputBase || path.basename(urlName, path.extname(urlName)) || fallbackBase,
      )
      const ext = path.extname(urlName) || extFromContentType(contentType)
      const outPath = await nextAvailablePath(outputDir, chosenBase, ext)

      await writeFile(outPath, bytes)
      return { ok: true, text: `Saved image: ${outPath}` }
    } catch (e) {
      return { ok: false, text: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:save-audio-from-url',
  async (
    _evt,
    payload: {
      audioUrl?: string
      outputDir?: string
      filename?: string
    },
  ) => {
    try {
      const audioUrl = String(payload?.audioUrl ?? '').trim()
      const outputDir = String(payload?.outputDir ?? '').trim()
      if (!audioUrl) return { ok: false, text: 'Missing audioUrl' }
      if (!outputDir) return { ok: false, text: 'Missing outputDir' }
      await mkdir(outputDir, { recursive: true })

      const res = await fetch(audioUrl)
      if (!res.ok) {
        return { ok: false, text: `Audio download failed: HTTP ${res.status}` }
      }
      const ab = await res.arrayBuffer()
      const contentType = res.headers.get('content-type') || 'audio/mpeg'

      const urlName = (() => {
        try {
          const p = new URL(audioUrl).pathname
          return path.basename(p) || ''
        } catch {
          return ''
        }
      })()
      const inputBase = String(payload?.filename ?? '').trim()
      const fallbackBase = `runware-audio-${new Date().toISOString().replace(/[:.]/g, '-')}`
      const chosenBase = sanitizeBaseName(
        inputBase || path.basename(urlName, path.extname(urlName)) || fallbackBase,
      )
      const ext = path.extname(urlName) || extFromAudioContentType(contentType)
      const outPath = await nextAvailablePath(outputDir, chosenBase, ext)

      await writeFile(outPath, Buffer.from(ab))
      return { ok: true, text: `Saved audio: ${outPath}` }
    } catch (e) {
      return { ok: false, text: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:runware-proxy',
  async (
    _evt,
    payload: {
      api_base_url?: string
      api_key?: string
      tasks?: unknown[]
    },
  ) => {
    try {
      const base = String(payload?.api_base_url ?? '').trim().replace(/\/+$/, '')
      const key = String(payload?.api_key ?? '').trim()
      const tasks = Array.isArray(payload?.tasks) ? payload.tasks : []
      if (!base) return { ok: false, detail: 'api_base_url is required' }
      if (!base.startsWith('https://')) {
        return { ok: false, detail: 'Runware base URL must use https://' }
      }
      if (!key) return { ok: false, detail: 'api_key is required' }
      if (tasks.length === 0) return { ok: false, detail: 'tasks must not be empty' }

      const res = await fetch(base, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(tasks),
      })
      const data = (await res.json().catch(() => ({}))) as {
        errors?: Array<{ message?: string }>
        message?: string
        error?: string
      }
      if (!res.ok) {
        const detail =
          data?.errors?.[0]?.message ||
          data?.message ||
          data?.error ||
          `Runware HTTP ${res.status}`
        return { ok: false, detail }
      }
      return { ok: true, data }
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

ipcMain.handle(
  'voidcast:llm-chat-proxy',
  async (
    _evt,
    payload: {
      api_base_url?: string
      api_key?: string
      body?: unknown
    },
  ) => {
    try {
      const base = String(payload?.api_base_url ?? '').trim().replace(/\/+$/, '')
      const key = String(payload?.api_key ?? '').trim()
      if (!base) return { ok: false, detail: 'api_base_url is required' }
      if (!base.startsWith('https://')) {
        return { ok: false, detail: 'LLM base URL must use https://' }
      }
      if (!key) return { ok: false, detail: 'api_key is required' }
      const reqBody = payload?.body ?? {}
      const requestUrl = `${base}/chat/completions`
      const res = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(reqBody),
      })
      const raw = await res.text().catch(() => '')
      let data = {} as {
        error?: { message?: string } | string
        message?: string
      }
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {}
      } catch {
        data = {}
      }
      if (!res.ok) {
        const model =
          reqBody && typeof reqBody === 'object' && 'model' in reqBody
            ? String((reqBody as { model?: unknown }).model ?? '')
            : ''
        const detail =
          (typeof data.error === 'string' ? data.error : data.error?.message) ||
          data.message ||
          raw ||
          `LLM HTTP ${res.status}`
        const modelSuffix = model ? ` [model=${model}]` : ''
        const urlSuffix = ` [url=${requestUrl}]`
        const normalizedDetail =
          detail.startsWith('LLM HTTP ') || detail.startsWith('HTTP ')
            ? detail
            : `HTTP ${res.status}: ${detail}`
        return { ok: false, detail: `${normalizedDetail}${modelSuffix}${urlSuffix}`, status: res.status }
      }
      return { ok: true, data, status: res.status }
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

ipcMain.handle('voidcast:pick-directory', async () => {
  const opts: OpenDialogOptions = {
    title: 'Choose folder for PDFs',
    properties: ['openDirectory'],
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false as const }
  }
  return { ok: true as const, path: result.filePaths[0] }
})

function resolveInsideProject(projectPath: string, inputPath: string): string {
  const root = path.resolve(projectPath)
  const requested = inputPath.trim() ? inputPath.trim() : '.'
  const abs = path.resolve(root, requested)
  const rel = path.relative(root, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes project root.')
  }
  return abs
}

/** Skip heavy / generated dirs when walking project trees for search & glob. */
function shouldSkipCodingWalkDir(name: string): boolean {
  return shouldSkipCodingProjectDir(name)
}
const CODING_SOURCE_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'md',
  'mdx',
  'txt',
  'py',
  'java',
  'cs',
  'css',
  'scss',
  'html',
  'htm',
  'yml',
  'yaml',
  'rs',
  'go',
  'vue',
  'svelte',
  'kt',
  'kts',
  'toml',
  'sh',
  'bash',
] as const

const CODING_SOURCE_FILE_RE = new RegExp(`\\.(${CODING_SOURCE_EXTENSIONS.join('|')})$`, 'i')

const CODING_READ_SOFT_CHAR_LIMIT = 220_000

const MAX_GIT_OUTPUT_CHARS = 450_000
const GIT_COMMAND_TIMEOUT_MS = 25_000

function truncateGitOutput(text: string): string {
  if (text.length <= MAX_GIT_OUTPUT_CHARS) return text
  return `${text.slice(0, MAX_GIT_OUTPUT_CHARS)}\n\n… [output truncated to ${MAX_GIT_OUTPUT_CHARS} characters]`
}

function runGitCapture(
  cwd: string,
  args: string[],
  timeoutMs = GIT_COMMAND_TIMEOUT_MS,
): Promise<CapturedCommandResult> {
  return captureSpawnCommand({
    command: 'git',
    args,
    cwd,
    timeoutMs,
    timeoutLabel: 'Git command',
    notFoundMessage: 'Git executable not found on PATH.',
  })
}

const RIPGREP_TIMEOUT_MS = 90_000
const CODING_BINARY_SCAN_BYTES = 65_536

let cachedRipgrepCommand: string | undefined

/** Bundled @vscode/ripgrep → optional VOIDCAST_RG_PATH → system `rg` on PATH. */
function resolveRipgrepCommand(): string {
  if (cachedRipgrepCommand) return cachedRipgrepCommand

  const envPath = process.env.VOIDCAST_RG_PATH?.trim()
  if (envPath && existsSync(envPath)) {
    cachedRipgrepCommand = envPath
    return envPath
  }

  if (bundledRgPath && existsSync(bundledRgPath)) {
    cachedRipgrepCommand = bundledRgPath
    return bundledRgPath
  }

  cachedRipgrepCommand = 'rg'
  return 'rg'
}

const RIPGREP_EXCLUDE_GLOBS = CODING_RIPGREP_EXCLUDE_GLOBS

function runRipgrepCapture(
  cwd: string,
  args: string[],
  timeoutMs = RIPGREP_TIMEOUT_MS,
): Promise<CapturedCommandResult> {
  return captureSpawnCommand({
    command: resolveRipgrepCommand(),
    args,
    cwd,
    timeoutMs,
    timeoutLabel: 'ripgrep',
    notFoundMessage: 'ENOENT',
  })
}

/**
 * @returns `null` if ripgrep is missing or failed; empty array = no matches.
 */
async function searchProjectWithRipgrep(
  searchRoot: string,
  query: string,
  maxMatches: number,
): Promise<CodingSearchRawMatch[] | null> {
  // Align with searchProjectFilesWalk: do not use ignore files (.gitignore, .ignore, …), and
  // include hidden paths. Walk only skips named dirs (shouldSkipCodingWalkDir) + globs below.
  const args: string[] = ['--json', '-i', '-F', '--no-ignore', '--hidden', query]
  for (const ext of CODING_SOURCE_EXTENSIONS) {
    args.push('-g', `*.${ext}`)
  }
  for (const g of RIPGREP_EXCLUDE_GLOBS) {
    args.push('--glob', g)
  }
  args.push('.')
  const r = await runRipgrepCapture(searchRoot, args)
  if (!r.ok) {
    if (r.error === 'ENOENT') return null
    return null
  }
  if (r.code !== 0 && r.code !== 1) return null
  const matches: CodingSearchRawMatch[] = []
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line.trim() || matches.length >= maxMatches) break
    let msg: { type?: string; data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number } }
    try {
      msg = JSON.parse(line) as typeof msg
    } catch {
      continue
    }
    if (msg.type !== 'match' || !msg.data) continue
    const rel = (msg.data.path?.text ?? '').replace(/\\/g, '/')
    const lineNum = msg.data.line_number ?? 0
    const lineText = (msg.data.lines?.text ?? '').split(/\r?\n/)[0] ?? ''
    matches.push({
      path: rel,
      line: lineNum,
      text: lineText.trim().slice(0, CODING_SEARCH_LINE_TEXT_MAX),
    })
  }
  return matches
}

async function searchProjectFilesWalk(
  projectRoot: string,
  searchRoot: string,
  query: string,
  maxMatches: number,
): Promise<CodingSearchRawMatch[]> {
  const q = query.toLowerCase()
  const results: CodingSearchRawMatch[] = []
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (results.length >= maxMatches) return
      if (entry.isDirectory()) {
        if (shouldSkipCodingWalkDir(entry.name)) continue
        await visit(path.join(dir, entry.name))
        continue
      }
      const full = path.join(dir, entry.name)
      const rel = path.relative(projectRoot, full).replace(/\\/g, '/')
      if (!CODING_SOURCE_FILE_RE.test(rel)) continue
      const content = await readFile(full, 'utf8').catch(() => '')
      if (!content) continue
      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= maxMatches) return
        if (lines[i].toLowerCase().includes(q)) {
          results.push({
            path: rel,
            line: i + 1,
            text: lines[i].trim().slice(0, CODING_SEARCH_LINE_TEXT_MAX),
          })
        }
      }
    }
  }
  await visit(searchRoot)
  return results
}

async function buildSearchBlocks(
  projectRoot: string,
  ranked: ScoredSearchMatch[],
  contextLines: number,
): Promise<CodingSearchBlock[]> {
  const rangesByFile = mergeMatchRanges(ranked, contextLines)
  const blocks: CodingSearchBlock[] = []

  for (const [relPath, ranges] of rangesByFile) {
    let absFile: string
    try {
      absFile = resolveInsideProject(projectRoot, relPath)
    } catch {
      continue
    }
    const content = await readFile(absFile, 'utf8').catch(() => '')
    if (!content) continue
    const fileLines = content.split(/\r?\n/)

    for (const range of ranges) {
      const lines: CodingSearchBlockLine[] = []
      const end = Math.min(range.end, fileLines.length)
      for (let ln = range.start; ln <= end; ln++) {
        const raw = fileLines[ln - 1] ?? ''
        lines.push({
          line: ln,
          text: raw.trimEnd().slice(0, CODING_SEARCH_LINE_TEXT_MAX),
          isMatch: range.matchLines.has(ln),
        })
      }
      if (lines.length > 0) {
        blocks.push({
          path: relPath,
          startLine: range.start,
          endLine: end,
          lines,
        })
      }
    }
  }

  blocks.sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine)
  return blocks
}

async function processCodingSearch(
  projectPath: string,
  searchRoot: string,
  query: string,
  recentFiles: string[] = [],
): Promise<CodingSearchProcessedResult> {
  let raw = await searchProjectWithRipgrep(searchRoot, query, CODING_SEARCH_INTERNAL_MAX)
  if (raw === null) {
    raw = await searchProjectFilesWalk(projectPath, searchRoot, query, CODING_SEARCH_INTERNAL_MAX)
  }
  raw = filterCodingSearchMatches(raw)

  const fileMatchCounts = countMatchesByFile(raw)
  const ranked = rankSearchMatches(raw, query, {
    recentFiles,
    maxPerFile: CODING_SEARCH_MAX_PER_FILE,
    maxBlocks: CODING_SEARCH_MAX_BLOCKS,
  })
  const blocks = await buildSearchBlocks(projectPath, ranked, CODING_SEARCH_CONTEXT_LINES)

  return {
    query,
    totalRawMatches: raw.length,
    totalFiles: fileMatchCounts.size,
    truncatedCollection: raw.length >= CODING_SEARCH_INTERNAL_MAX,
    fileMatchCounts: Object.fromEntries(fileMatchCounts),
    blocks,
  }
}

function fileLooksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, CODING_BINARY_SCAN_BYTES)
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

ipcMain.handle('voidcast:coding-pick-directory', async () => {
  const opts: OpenDialogOptions = {
    title: 'Choose coding project folder',
    properties: ['openDirectory'],
  }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths?.[0]) return { ok: false as const }
  return { ok: true as const, path: result.filePaths[0] }
})

/** Live disk watch → renderer refreshes file tree / git colors when Explorer (etc.) mutates the project. */
let codingProjectWatcher: FSWatcher | null = null
let codingWatchProjectRoot = ''
let codingFsChangeTimer: ReturnType<typeof setTimeout> | null = null
const CODING_FS_CHANGE_DEBOUNCE_MS = 350

function stopCodingProjectWatch(): void {
  if (codingFsChangeTimer) {
    clearTimeout(codingFsChangeTimer)
    codingFsChangeTimer = null
  }
  if (codingProjectWatcher) {
    try {
      codingProjectWatcher.close()
    } catch {
      /* already closed */
    }
    codingProjectWatcher = null
  }
  codingWatchProjectRoot = ''
}

function emitCodingFsChange(): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send('voidcast:coding-fs-change')
}

function scheduleCodingFsChange(): void {
  if (codingFsChangeTimer) clearTimeout(codingFsChangeTimer)
  codingFsChangeTimer = setTimeout(() => {
    codingFsChangeTimer = null
    emitCodingFsChange()
  }, CODING_FS_CHANGE_DEBOUNCE_MS)
}

function shouldIgnoreCodingWatchPath(relPath: string | null | undefined): boolean {
  if (!relPath) return false
  const normalized = relPath.replace(/\\/g, '/')
  // Ignore noise under heavy/generated folders; still notify for other project paths.
  return isCodingGeneratedArtifactPath(normalized)
}

function startCodingProjectWatch(projectPath: string): { ok: true } | { ok: false; error: string } {
  const root = path.resolve(projectPath.trim())
  if (!root || !existsSync(root)) {
    stopCodingProjectWatch()
    return { ok: false as const, error: 'Coding project path does not exist.' }
  }
  if (codingWatchProjectRoot === root && codingProjectWatcher) {
    return { ok: true as const }
  }
  stopCodingProjectWatch()
  try {
    codingProjectWatcher = watch(root, { recursive: true }, (_eventType, filename) => {
      if (shouldIgnoreCodingWatchPath(filename?.toString())) return
      scheduleCodingFsChange()
    })
    codingProjectWatcher.on('error', () => {
      // Broken watcher (deleted project root, etc.) — tear down; renderer may re-subscribe.
      stopCodingProjectWatch()
    })
    codingWatchProjectRoot = root
    return { ok: true as const }
  } catch (e) {
    stopCodingProjectWatch()
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

ipcMain.handle(
  'voidcast:coding-watch-project',
  async (_evt, payload: { projectPath?: string | null }) => {
    const projectPath = String(payload?.projectPath ?? '').trim()
    if (!projectPath) {
      stopCodingProjectWatch()
      return { ok: true as const }
    }
    return startCodingProjectWatch(projectPath)
  },
)

ipcMain.handle(
  'voidcast:coding-list-directory',
  async (_evt, payload: { projectPath?: string; path?: string }) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim()
      if (!projectPath) return { ok: false as const, error: 'Missing coding project path.' }
      const absDir = resolveInsideProject(projectPath, String(payload?.path ?? ''))
      const entries = await readdir(absDir, { withFileTypes: true })
      const mapped = await Promise.all(
        entries
          .filter((e) => !e.name.startsWith('.git'))
          .map(async (entry) => {
            const fullPath = path.join(absDir, entry.name)
            const st = await stat(fullPath).catch(() => null)
            return {
              name: entry.name,
              path: path.relative(projectPath, fullPath).replace(/\\/g, '/'),
              type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
              size: entry.isDirectory() ? undefined : st?.size,
            }
          }),
      )
      mapped.sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1,
      )
      return { ok: true as const, entries: mapped }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:coding-read-file',
  async (
    _evt,
    payload: {
      projectPath?: string
      path?: string
      startLine?: number
      endLine?: number
      maxChars?: number
      allowLargeRead?: boolean
    },
  ) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim()
      const filePath = String(payload?.path ?? '').trim()
      if (!projectPath || !filePath) {
        return { ok: false as const, error: 'Missing projectPath or path.' }
      }
      const absFile = resolveInsideProject(projectPath, filePath)
      const buf = await readFile(absFile)
      if (fileLooksBinary(buf)) {
        return {
          ok: false as const,
          error:
            'File appears to be binary (e.g. contains null bytes in the first portion scanned); text read skipped.',
        }
      }
      const content = buf.toString('utf8')
      const allowLarge = payload?.allowLargeRead === true
      const startLine =
        typeof payload?.startLine === 'number' && Number.isFinite(payload.startLine)
          ? Math.max(1, Math.floor(payload.startLine))
          : undefined
      const endLine =
        typeof payload?.endLine === 'number' && Number.isFinite(payload.endLine)
          ? Math.max(1, Math.floor(payload.endLine))
          : undefined
      const maxChars =
        typeof payload?.maxChars === 'number' && Number.isFinite(payload.maxChars)
          ? Math.min(500_000, Math.max(1, Math.floor(payload.maxChars)))
          : undefined

      const hasPartial =
        startLine !== undefined || endLine !== undefined || maxChars !== undefined

      if (!allowLarge && !hasPartial && content.length > CODING_READ_SOFT_CHAR_LIMIT) {
        return {
          ok: false as const,
          error: `File is too large to read at once (${content.length} chars; soft limit ${CODING_READ_SOFT_CHAR_LIMIT}). Use start_line/end_line (1-based) or max_chars, or read a smaller range.`,
        }
      }

      let out = content
      let lineRangeNote = ''

      if (startLine !== undefined || endLine !== undefined) {
        const lines = content.split(/\r?\n/)
        const total = lines.length
        const from = startLine !== undefined ? startLine - 1 : 0
        let to =
          endLine !== undefined ? endLine - 1 : startLine !== undefined ? startLine - 1 + 399 : total - 1
        if (endLine === undefined && startLine !== undefined) {
          to = Math.min(startLine - 1 + 399, total - 1)
        }
        const safeFrom = Math.max(0, Math.min(from, total > 0 ? total - 1 : 0))
        const safeTo = Math.max(safeFrom, Math.min(to, total > 0 ? total - 1 : 0))
        const slice = lines.slice(safeFrom, safeTo + 1)
        const numbered = slice.map((line, i) => {
          const n = safeFrom + i + 1
          return `${n}| ${line}`
        })
        out = numbered.join('\n')
        lineRangeNote = `\n(lines ${safeFrom + 1}-${safeTo + 1} of ${total})`
      }

      if (maxChars !== undefined && out.length > maxChars) {
        out = `${out.slice(0, maxChars)}\n\n… [truncated to ${maxChars} characters]${lineRangeNote}`
      } else if (lineRangeNote && !out.endsWith(lineRangeNote.trim())) {
        out = `${out}${lineRangeNote}`
      }

      const lineEndings = content.includes('\r\n') ? ('crlf' as const) : ('lf' as const)
      return { ok: true as const, content: out, lineEndings }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:coding-write-file',
  async (_evt, payload: { projectPath?: string; path?: string; content?: string }) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim()
      const filePath = String(payload?.path ?? '').trim()
      if (!projectPath || !filePath) {
        return { ok: false as const, error: 'Missing projectPath or path.' }
      }
      const absFile = resolveInsideProject(projectPath, filePath)
      const content = String(payload?.content ?? '')
      await mkdir(path.dirname(absFile), { recursive: true })
      await writeFile(absFile, content, 'utf8')
      return { ok: true as const, path: filePath.replace(/\\/g, '/') }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:coding-search-files',
  async (
    _evt,
    payload: { projectPath?: string; query?: string; pathPrefix?: string; recentFiles?: string[] },
  ) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim()
      const query = String(payload?.query ?? '').trim()
      if (!projectPath || !query) {
        return { ok: false as const, error: 'Missing projectPath or query.' }
      }
      const root = path.resolve(projectPath)
      const prefix = String(payload?.pathPrefix ?? '').trim()
      const searchRoot = prefix ? resolveInsideProject(projectPath, prefix) : root
      const recentFiles = Array.isArray(payload?.recentFiles)
        ? payload.recentFiles.filter((x): x is string => typeof x === 'string')
        : []
      const result = await processCodingSearch(projectPath, searchRoot, query, recentFiles)
      return { ok: true as const, result }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:coding-glob-files',
  async (
    _evt,
    payload: {
      projectPath?: string
      pathPrefix?: string
      extensions?: string[]
      maxResults?: number
    },
  ) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim()
      if (!projectPath) return { ok: false as const, error: 'Missing projectPath.' }
      const root = path.resolve(projectPath)
      const prefix = String(payload?.pathPrefix ?? '').trim()
      const walkRoot = prefix ? resolveInsideProject(projectPath, prefix) : root
      const rawExt = Array.isArray(payload?.extensions) ? payload.extensions : []
      const extensions = rawExt
        .map((e) => String(e).trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean)
      const useExt = extensions.length > 0 ? extensions : [...CODING_SOURCE_EXTENSIONS]
      const maxRaw = Number(payload?.maxResults)
      const maxResults = Number.isFinite(maxRaw)
        ? Math.min(500, Math.max(1, Math.floor(maxRaw)))
        : 150

      const paths: string[] = []
      const visit = async (dir: string): Promise<void> => {
        if (paths.length >= maxResults) return
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (paths.length >= maxResults) return
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (shouldSkipCodingWalkDir(entry.name)) continue
            await visit(full)
            continue
          }
          const rel = path.relative(root, full).replace(/\\/g, '/')
          const dot = rel.lastIndexOf('.')
          const ext = dot >= 0 ? rel.slice(dot + 1).toLowerCase() : ''
          if (!useExt.includes(ext)) continue
          paths.push(rel)
        }
      }
      await visit(walkRoot)
      return { ok: true as const, paths }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:coding-git',
  async (
    _evt,
    payload: {
      projectPath?: string
      mode?:
        | 'status'
        | 'diff'
        | 'log'
        | 'show'
        | 'stage'
        | 'unstage'
        | 'commit'
        | 'discard'
        | 'discardAll'
      path?: string
      staged?: boolean
      /** When committing: stage all changes first (`git add -A`), like VS Code Commit All. */
      commitAll?: boolean
      commitMessage?: string
      logMaxCount?: number
      logPath?: string
      showRef?: string
      showPath?: string
    },
  ) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim()
      if (!projectPath) return { ok: false as const, error: 'Missing projectPath.' }
      const root = path.resolve(projectPath)
      const modeRaw = payload?.mode
      const mode:
        | 'status'
        | 'diff'
        | 'log'
        | 'show'
        | 'stage'
        | 'unstage'
        | 'commit'
        | 'discard'
        | 'discardAll' =
        modeRaw === 'diff' ||
        modeRaw === 'log' ||
        modeRaw === 'show' ||
        modeRaw === 'stage' ||
        modeRaw === 'unstage' ||
        modeRaw === 'commit' ||
        modeRaw === 'discard' ||
        modeRaw === 'discardAll'
          ? modeRaw
          : 'status'

      const inside = await runGitCapture(root, ['rev-parse', '--is-inside-work-tree'])
      if (!inside.ok) return { ok: false as const, error: inside.error }
      if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
        const hint = inside.stderr?.trim() || 'Not a git repository.'
        return {
          ok: false as const,
          error: /not a git repository/i.test(hint) ? 'Not a git repository.' : hint,
        }
      }

      if (mode === 'commit') {
        const message = String(payload?.commitMessage ?? '').trim()
        if (!message) return { ok: false as const, error: 'Commit message is empty.' }
        if (message.length > 4000) {
          return { ok: false as const, error: 'Commit message too long (max 4000 chars).' }
        }
        const commitAll = payload?.commitAll === true
        if (commitAll) {
          const add = await runGitCapture(root, ['-c', 'core.quotepath=false', 'add', '-A'])
          if (!add.ok) return { ok: false as const, error: add.error }
          if (add.code !== 0) {
            return {
              ok: false as const,
              error:
                add.stderr.trim() ||
                add.stdout.trim() ||
                `git add -A failed (exit ${add.code}).`,
            }
          }
        }
        const r = await runGitCapture(root, [
          '-c',
          'core.quotepath=false',
          'commit',
          '-m',
          message,
        ])
        if (!r.ok) return { ok: false as const, error: r.error }
        if (r.code !== 0) {
          return {
            ok: false as const,
            error: r.stderr.trim() || r.stdout.trim() || `git commit failed (exit ${r.code}).`,
          }
        }
        const combined = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
        return { ok: true as const, text: truncateGitOutput(combined || 'Committed.') }
      }

      if (mode === 'discardAll') {
        // Restore tracked staged + worktree to HEAD, then remove untracked files/dirs.
        const restore = await runGitCapture(root, [
          '-c',
          'core.quotepath=false',
          'restore',
          '--source=HEAD',
          '--staged',
          '--worktree',
          '.',
        ])
        if (!restore.ok) return { ok: false as const, error: restore.error }
        // restore may fail on empty index edge cases; still try clean
        const clean = await runGitCapture(root, [
          '-c',
          'core.quotepath=false',
          'clean',
          '-fd',
        ])
        if (!clean.ok) return { ok: false as const, error: clean.error }
        if (clean.code !== 0) {
          return {
            ok: false as const,
            error:
              clean.stderr.trim() ||
              clean.stdout.trim() ||
              `git clean failed (exit ${clean.code}).`,
          }
        }
        // If restore failed but clean ok, surface restore error when non-zero
        if (restore.code !== 0) {
          const hint = restore.stderr.trim() || restore.stdout.trim()
          // Empty tree / nothing to restore is fine
          if (hint && !/did not match|pathspec|No such file/i.test(hint)) {
            return {
              ok: false as const,
              error: hint || `git restore failed (exit ${restore.code}).`,
            }
          }
        }
        const combined = [restore.stdout, restore.stderr, clean.stdout, clean.stderr]
          .filter(Boolean)
          .join('\n')
          .trim()
        return {
          ok: true as const,
          text: truncateGitOutput(combined || 'Discarded all changes.'),
        }
      }

      if (mode === 'stage' || mode === 'unstage' || mode === 'discard') {
        const rel = String(payload?.path ?? '').trim()
        if (!rel) {
          return {
            ok: false as const,
            error: `Missing path for git ${mode}.`,
          }
        }
        const abs = resolveInsideProject(projectPath, rel)
        const relGit = path.relative(root, abs).replace(/\\/g, '/')
        const args =
          mode === 'stage'
            ? ['-c', 'core.quotepath=false', 'add', '--', relGit]
            : mode === 'unstage'
              ? ['-c', 'core.quotepath=false', 'restore', '--staged', '--', relGit]
              : ['-c', 'core.quotepath=false', 'restore', '--', relGit]
        const r = await runGitCapture(root, args)
        if (!r.ok) return { ok: false as const, error: r.error }
        if (r.code !== 0) {
          return {
            ok: false as const,
            error:
              r.stderr.trim() ||
              r.stdout.trim() ||
              `git ${mode} failed (exit ${r.code}).`,
          }
        }
        const combined = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
        const doneLabel =
          mode === 'stage' ? 'staged' : mode === 'unstage' ? 'unstaged' : 'discarded'
        return {
          ok: true as const,
          text: truncateGitOutput(combined || `${doneLabel} ${relGit}`),
        }
      }

      if (mode === 'status') {
        const r = await runGitCapture(root, [
          '-c',
          'core.quotepath=false',
          'status',
          '--short',
          '--branch',
          '--untracked-files=all',
        ])
        if (!r.ok) return { ok: false as const, error: r.error }
        if (r.code !== 0) {
          return {
            ok: false as const,
            error: r.stderr.trim() || `git status failed (exit ${r.code}).`,
          }
        }
        const combined = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
        return {
          ok: true as const,
          text: truncateGitOutput(combined || '(no status output)'),
        }
      }

      if (mode === 'log') {
        const nRaw = Number(payload?.logMaxCount)
        const n = Number.isFinite(nRaw) ? Math.min(100, Math.max(1, Math.floor(nRaw))) : 25
        const rel = String(payload?.logPath ?? '').trim()
        const args = [
          '-c',
          'core.quotepath=false',
          'log',
          '--no-color',
          '-n',
          String(n),
          '--oneline',
          '--decorate',
        ]
        if (rel) {
          const abs = resolveInsideProject(projectPath, rel)
          const relGit = path.relative(root, abs).replace(/\\/g, '/')
          args.push('--', relGit)
        }
        const r = await runGitCapture(root, args)
        if (!r.ok) return { ok: false as const, error: r.error }
        if (r.code !== 0) {
          return {
            ok: false as const,
            error: r.stderr.trim() || `git log failed (exit ${r.code}).`,
          }
        }
        const combined = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
        return { ok: true as const, text: truncateGitOutput(combined || '(no commits)') }
      }

      if (mode === 'show') {
        const ref = String(payload?.showRef ?? 'HEAD').trim() || 'HEAD'
        const rel = String(payload?.showPath ?? '').trim()
        const args = ['-c', 'core.quotepath=false', 'show', '--no-color']
        if (rel) {
          const abs = resolveInsideProject(projectPath, rel)
          const relGit = path.relative(root, abs).replace(/\\/g, '/')
          args.push(ref, '--', relGit)
        } else {
          args.push(ref)
        }
        const r = await runGitCapture(root, args)
        if (!r.ok) return { ok: false as const, error: r.error }
        if (r.code !== 0) {
          return {
            ok: false as const,
            error: r.stderr.trim() || `git show failed (exit ${r.code}).`,
          }
        }
        let out = r.stdout
        if (r.stderr) out = [out, r.stderr].filter(Boolean).join('\n')
        return { ok: true as const, text: truncateGitOutput(out.trim() || '(no output)') }
      }

      const staged = payload?.staged === true
      const rel = String(payload?.path ?? '').trim()
      const args: string[] = staged ? ['diff', '--cached', '--no-color'] : ['diff', '--no-color']
      if (rel) {
        const abs = resolveInsideProject(projectPath, rel)
        const relGit = path.relative(root, abs).replace(/\\/g, '/')
        args.push('--', relGit)
      }
      const r = await runGitCapture(root, args)
      if (!r.ok) return { ok: false as const, error: r.error }
      if (r.code !== 0) {
        return {
          ok: false as const,
          error: r.stderr.trim() || `git diff failed (exit ${r.code}).`,
        }
      }
      let out = r.stdout
      if (r.stderr) out = [out, r.stderr].filter(Boolean).join('\n')
      const trimmed = out.trim()
      return {
        ok: true as const,
        text: truncateGitOutput(trimmed ? trimmed : '(no diff)'),
      }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

const TYPECHECK_COMMAND_TIMEOUT_MS = 120_000

function resolveTscCommand(cwd: string): { command: string; args: string[] } | null {
  const tscJs = path.join(cwd, 'node_modules', 'typescript', 'bin', 'tsc')
  if (existsSync(tscJs)) {
    return { command: process.execPath, args: [tscJs, '--noEmit', '--pretty', 'false'] }
  }
  const localBin = path.join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc')
  if (existsSync(localBin)) {
    return { command: localBin, args: ['--noEmit', '--pretty', 'false'] }
  }
  return null
}

function typecheckRootLabel(projectRoot: string, checkCwd: string): string {
  const rel = path.relative(projectRoot, checkCwd)
  if (!rel || rel === '.') return 'project root'
  return normalizeTypecheckPath(rel)
}

ipcMain.handle(
  'voidcast:coding-check-types',
  async (
    _evt,
    payload: { projectPath?: string; pathPrefix?: string; paths?: string[] },
  ) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim()
      if (!projectPath) return { ok: false as const, error: 'Missing projectPath.' }
      const root = path.resolve(projectPath)
      const pathPrefix = String(payload?.pathPrefix ?? '').trim()
      let checkCwd: string
      try {
        checkCwd = pathPrefix ? resolveInsideProject(root, pathPrefix) : root
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : 'Invalid path_prefix.',
        }
      }
      const tsconfigPath = path.join(checkCwd, 'tsconfig.json')
      if (!existsSync(tsconfigPath)) {
        const where = typecheckRootLabel(root, checkCwd)
        return {
          ok: false as const,
          error: `No tsconfig.json in ${where}. Set path_prefix to the package folder that contains tsconfig.json.`,
        }
      }
      const tsc = resolveTscCommand(checkCwd)
      if (!tsc) {
        return {
          ok: false as const,
          error:
            'TypeScript not found in node_modules. Run npm install (or pnpm/yarn install) in the check root first.',
        }
      }
      const r = await captureSpawnCommand({
        command: tsc.command,
        args: tsc.args,
        cwd: checkCwd,
        timeoutMs: TYPECHECK_COMMAND_TIMEOUT_MS,
        timeoutLabel: 'Typecheck',
        notFoundMessage: 'TypeScript compiler (tsc) not found.',
      })
      const label = typecheckRootLabel(root, checkCwd)
      if (!r.ok) {
        return {
          ok: true as const,
          text: formatTypecheckReport({
            checkRootLabel: label,
            diagnostics: [],
            exitCode: 1,
            timedOut: /timed out/i.test(r.error),
            rawOutput: r.error,
          }),
        }
      }
      const rawOutput = [r.stdout, r.stderr].filter(Boolean).join('\n')
      const parsed = parseTscDiagnostics(rawOutput)
      const filterPaths = Array.isArray(payload?.paths)
        ? payload.paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        : []
      const diagnostics = filterTscDiagnostics(parsed, filterPaths, pathPrefix)
      const text = formatTypecheckReport({
        checkRootLabel: label,
        diagnostics,
        exitCode: r.code,
        rawOutput,
      })
      return { ok: true as const, text }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:coding-execute-command',
  async (evt, payload: { projectPath?: string; command?: string; timeoutSec?: number; runInBackground?: boolean }) => {
    const projectPath = String(payload?.projectPath ?? '').trim()
    const command = String(payload?.command ?? '').trim()
    if (!projectPath || !command) {
      return { ok: false as const, error: 'Missing projectPath or command.' }
    }
    const timeoutSecRaw = Number(payload?.timeoutSec)
    const timeoutMs = Number.isFinite(timeoutSecRaw)
      ? Math.min(120_000, Math.max(3_000, Math.round(timeoutSecRaw * 1000)))
      : 20_000
    const runInBackground = payload?.runInBackground === true
    const runId = randomUUID()
    type OkResult = {
      ok: true
      stdout: string
      stderr: string
      code: number
      timedOut?: boolean
      killed?: boolean
      pid?: number
      runId: string
      streamed: boolean
    }
    type ErrResult = { ok: false; error: string; runId?: string; streamed?: boolean }
    return new Promise<OkResult | ErrResult>((resolve) => {
      const child = spawn(command, {
        cwd: projectPath,
        shell: true,
        detached: runInBackground,
        stdio: 'pipe',
        windowsHide: true,
      })

      const sendOutput = (payloadOut: {
        stream?: 'stdout' | 'stderr' | 'system'
        text?: string
        done?: boolean
        code?: number
        timedOut?: boolean
        killed?: boolean
      }) => {
        try {
          evt.sender.send('voidcast:coding-command-output', { runId, ...payloadOut })
        } catch {
          // window may be gone
        }
      }

      const pid = typeof child.pid === 'number' && child.pid > 0 ? child.pid : 0
      const kind: ActiveCodingProcessKind = runInBackground ? 'background' : 'foreground'
      const runState = registerCodingProcess(evt.sender, {
        runId,
        pid,
        command,
        kind,
      })

      if (runInBackground) {
        sendOutput({ stream: 'system', text: `$ ${command}  (background)` })
        const throttleBg = new ChunkThrottle((stream, text) => {
          sendOutput({ stream, text })
          appendCodingProcessOutput(runId, text)
        }, 50)
        child.stdout?.on('data', (chunk) => {
          throttleBg.push('stdout', String(chunk))
        })
        child.stderr?.on('data', (chunk) => {
          throttleBg.push('stderr', String(chunk))
        })
        child.on('error', (err) => {
          sendOutput({ stream: 'stderr', text: err.message })
          throttleBg.flush()
          unregisterCodingProcess(evt.sender, runId)
          sendOutput({ done: true, code: 1 })
        })
        child.on('close', (code) => {
          throttleBg.flush()
          if (runState.killed) {
            sendOutput({ stream: 'stderr', text: 'Command was stopped.' })
          }
          unregisterCodingProcess(evt.sender, runId)
          sendOutput({
            done: true,
            code: runState.killed ? 130 : (code ?? 0),
            killed: runState.killed || undefined,
          })
        })
        // Keep handle so we get close/exit; do not unref.
        resolve({
          ok: true,
          stdout: `Started in background (pid ${pid || 'n/a'})`,
          stderr: '',
          code: 0,
          pid: pid || undefined,
          runId,
          streamed: true,
        })
        return
      }

      sendOutput({ stream: 'system', text: `$ ${command}` })

      const throttle = new ChunkThrottle((stream, text) => {
        sendOutput({ stream, text })
        appendCodingProcessOutput(runId, text)
      }, 50)

      let stdout = ''
      let stderr = ''
      let settled = false
      let timedOut = false
      let promotedToBackground = false
      let idleTimer: ReturnType<typeof setTimeout> | null = null
      /** After output stops arriving, return to the agent instead of waiting forever
       *  for process exit (agent-browser, dev servers, etc. keep stdio open). */
      const IDLE_PROMOTE_MS = 2_500
      const timeoutLabel = `Command timed out after ${Math.round(timeoutMs / 1000)}s and was stopped.`
      const stoppedLabel = 'Command was stopped.'

      const clearIdleTimer = () => {
        if (idleTimer) {
          clearTimeout(idleTimer)
          idleTimer = null
        }
      }

      const finish = (result: OkResult | ErrResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearIdleTimer()
        unregisterCodingProcess(evt.sender, runId)
        throttle.flush()
        sendOutput({
          done: true,
          code: result.ok ? result.code : undefined,
          timedOut: result.ok ? result.timedOut : undefined,
          killed: result.ok ? result.killed : undefined,
        })
        resolve(result)
      }

      const promoteToBackground = () => {
        if (settled) return
        if (!stdout.trim() && !stderr.trim()) return
        settled = true
        promotedToBackground = true
        clearTimeout(timer)
        clearIdleTimer()
        runState.kind = 'background'
        sendCodingProcessUpdate(evt.sender, {
          action: 'upsert',
          process: toPublicProcess(runState),
        })
        throttle.flush()
        sendOutput({
          stream: 'system',
          text: '[still running — returned to agent; tracked as background]',
        })
        const body = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
        resolve({
          ok: true,
          stdout:
            `${body}\n\n[process still running — moved to background tracking (pid ${pid || 'n/a'})]`.trim(),
          stderr: '',
          code: 0,
          pid: pid || undefined,
          runId,
          streamed: true,
        })
      }

      const bumpIdlePromote = () => {
        if (settled) return
        clearIdleTimer()
        idleTimer = setTimeout(() => {
          promoteToBackground()
        }, IDLE_PROMOTE_MS)
      }

      const timer = setTimeout(() => {
        timedOut = true
        void killProcessTree(pid)
      }, timeoutMs)

      child.stdout?.on('data', (chunk) => {
        const text = String(chunk)
        stdout += text
        throttle.push('stdout', text)
        bumpIdlePromote()
      })
      child.stderr?.on('data', (chunk) => {
        const text = String(chunk)
        stderr += text
        throttle.push('stderr', text)
        bumpIdlePromote()
      })
      child.on('error', (err) => {
        sendOutput({ stream: 'stderr', text: err.message })
        finish({ ok: false, error: err.message, runId, streamed: true })
      })
      child.on('close', (code) => {
        clearIdleTimer()
        if (promotedToBackground) {
          throttle.flush()
          if (runState.killed) {
            sendOutput({ stream: 'stderr', text: stoppedLabel })
          }
          unregisterCodingProcess(evt.sender, runId)
          sendOutput({
            done: true,
            code: runState.killed ? 130 : (code ?? 0),
            killed: runState.killed || undefined,
          })
          return
        }
        if (runState.killed) {
          sendOutput({ stream: 'stderr', text: stoppedLabel })
          finish({
            ok: true,
            stdout: stdout.trim(),
            stderr: [stderr.trim(), stoppedLabel].filter(Boolean).join('\n'),
            code: 130,
            killed: true,
            runId,
            streamed: true,
          })
          return
        }
        if (timedOut) {
          sendOutput({ stream: 'stderr', text: timeoutLabel })
          finish({
            ok: true,
            stdout: stdout.trim(),
            stderr: [stderr.trim(), timeoutLabel].filter(Boolean).join('\n'),
            code: 124,
            timedOut: true,
            runId,
            streamed: true,
          })
          return
        }
        finish({
          ok: true,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code: code ?? 0,
          runId,
          streamed: true,
        })
      })
    })
  },
)

ipcMain.handle(
  'voidcast:coding-kill-command',
  async (_evt, payload: { runId?: string }) => {
    const runId = String(payload?.runId ?? '').trim()
    if (!runId) return { ok: false as const, error: 'Missing runId.' }
    const entry = activeCodingProcesses.get(runId)
    if (!entry) return { ok: false as const, error: 'No running command for that runId.' }
    entry.killed = true
    try {
      await killProcessTree(entry.pid)
      return { ok: true as const }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle('voidcast:coding-list-active-processes', async () => {
  return { processes: listActiveCodingProcesses() }
})

ipcMain.handle('voidcast:coding-kill-all-active-processes', async () => {
  const entries = [...activeCodingProcesses.values()]
  for (const entry of entries) {
    entry.killed = true
    try {
      await killProcessTree(entry.pid)
    } catch {
      // ignore per-process kill errors
    }
  }
  return { ok: true as const, count: entries.length }
})

const MAX_CHAT_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_CHAT_IMAGE_FILES = 4
const MAX_CHAT_FILE_BYTES = 5 * 1024 * 1024
const MAX_CHAT_FILE_SNAPSHOT_BYTES = 400 * 1024
const MAX_CHAT_FILE_COUNT = 8
const CHAT_FILE_EXTENSIONS = new Set([
  'txt',
  'md',
  'pdf',
  'docx',
  'csv',
  'json',
  'js',
  'ts',
  'py',
  'java',
  'cs',
  'html',
  'css',
])
const CHAT_TEXT_FILE_EXTENSIONS = new Set([
  'txt',
  'md',
  'pdf',
  'docx',
  'csv',
  'json',
  'js',
  'ts',
  'py',
  'java',
  'cs',
  'html',
  'css',
])
const CHAT_IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'avif',
  'tif',
  'tiff',
  'svg',
  'heic',
  'heif',
]
const CHAT_IMAGE_EXTENSION_SET = new Set(CHAT_IMAGE_EXTENSIONS)

function clampSnapshotText(raw: string): { content?: string; truncated?: boolean } {
  const text = String(raw ?? '')
  if (!text.trim()) return {}
  if (text.length <= MAX_CHAT_FILE_SNAPSHOT_BYTES) return { content: text }
  return {
    content: text.slice(0, MAX_CHAT_FILE_SNAPSHOT_BYTES),
    truncated: true,
  }
}

function mimeFromImagePath(filePath: string): string {
  const e = path.extname(filePath).replace(/^\./, '').toLowerCase()
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    heic: 'image/heic',
    heif: 'image/heif',
  }
  return map[e] ?? 'image/png'
}

function extFromPath(filePath: string): string {
  return path.extname(filePath).replace(/^\./, '').toLowerCase()
}

function mimeFromChatFilePath(filePath: string): string {
  const ext = extFromPath(filePath)
  const map: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    js: 'text/javascript',
    ts: 'text/typescript',
    py: 'text/x-python',
    java: 'text/x-java-source',
    cs: 'text/plain',
    html: 'text/html',
    css: 'text/css',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
  return map[ext] || 'application/octet-stream'
}

async function toChatFileSnapshot(filePath: string): Promise<{
  name: string
  path: string
  mime: string
  size: number
  ext: string
  content?: string
  truncated?: boolean
}> {
  const st = await stat(filePath)
  if (st.size > MAX_CHAT_FILE_BYTES) {
    throw new Error(`Too large (max 5 MB): ${path.basename(filePath)}`)
  }
  const ext = extFromPath(filePath)
  if (!CHAT_FILE_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type: ${path.basename(filePath)}`)
  }
  const base = {
    name: path.basename(filePath),
    path: filePath,
    mime: mimeFromChatFilePath(filePath),
    size: st.size,
    ext,
  }
  if (!CHAT_TEXT_FILE_EXTENSIONS.has(ext)) return base
  if (ext === 'pdf') {
    try {
      const pdfParseMod = await import('pdf-parse')
      const buf = await readFile(filePath)
      const PDFParseCtor = (pdfParseMod as { PDFParse: new (args: { data: Buffer }) => {
        getText: () => Promise<{ text?: string }>
        destroy: () => Promise<void>
      } }).PDFParse
      const parser = new PDFParseCtor({ data: buf })
      try {
        const parsed = await parser.getText()
        return { ...base, ...clampSnapshotText(parsed?.text || '') }
      } finally {
        await parser.destroy().catch(() => {})
      }
    } catch {
      return base
    }
  }
  if (ext === 'docx') {
    try {
      const mammothMod = await import('mammoth')
      const mammoth = mammothMod.default ?? mammothMod
      const extracted = await mammoth.extractRawText({ path: filePath })
      return { ...base, ...clampSnapshotText(extracted?.value || '') }
    } catch {
      return base
    }
  }
  const buf = await readFile(filePath)
  return { ...base, ...clampSnapshotText(buf.toString('utf8')) }
}

ipcMain.handle('voidcast:read-image-file', async (_evt, payload: { path?: string }) => {
  try {
    const fp = String(payload?.path ?? '').trim()
    if (!fp) return { ok: false as const, error: 'Missing image path.' }
    const buf = await readFile(fp)
    return {
      ok: true as const,
      file: {
        base64: buf.toString('base64'),
        mime: mimeFromImagePath(fp),
        name: path.basename(fp),
        path: fp,
      },
    }
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }
  }
})

ipcMain.handle('voidcast:pick-chat-attachments', async () => {
  const opts: OpenDialogOptions = {
    title: 'Choose attachment(s) for chat',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Supported attachments', extensions: [...CHAT_IMAGE_EXTENSIONS, ...Array.from(CHAT_FILE_EXTENSIONS)] },
    ],
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths?.length) {
    return { ok: false as const }
  }
  const imagePaths = result.filePaths.filter((fp) => CHAT_IMAGE_EXTENSION_SET.has(extFromPath(fp))).slice(0, MAX_CHAT_IMAGE_FILES)
  const filePaths = result.filePaths.filter((fp) => !CHAT_IMAGE_EXTENSION_SET.has(extFromPath(fp))).slice(0, MAX_CHAT_FILE_COUNT)
  const images: { base64: string; mime: string; name: string; path: string }[] = []
  for (const fp of imagePaths) {
    const st = await stat(fp)
    if (st.size > MAX_CHAT_IMAGE_BYTES) {
      return { ok: false as const, error: `Too large (max 4 MB): ${path.basename(fp)}` }
    }
    const buf = await readFile(fp)
    images.push({
      base64: buf.toString('base64'),
      mime: mimeFromImagePath(fp),
      name: path.basename(fp),
      path: fp,
    })
  }
  const files: Array<{
    name: string
    path: string
    mime: string
    size: number
    ext: string
    content?: string
    truncated?: boolean
  }> = []
  for (const fp of filePaths) {
    files.push(await toChatFileSnapshot(fp))
  }
  return { ok: true as const, images, files }
})

ipcMain.handle(
  'voidcast:get-weather',
  async (_evt, payload: { city?: string; forecast?: boolean }) => {
    try {
      const city = String(payload?.city ?? '').trim()
      if (!city) return { ok: false, text: 'Empty city' }
      const forecast = Boolean(payload.forecast)
      const path = encodeURIComponent(city)
      const url = `https://wttr.in/${path}?format=j1`
      const res = await fetch(url)
      if (!res.ok) return { ok: false, text: `HTTP ${res.status}` }
      const data = (await res.json()) as WttrJson
      return { ok: true, text: formatWttrText(data, city, forecast) }
    } catch (e) {
      return {
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

// IPC to show/hide window
ipcMain.handle('voidcast:show-window', () => {
  if (win) {
    win.show()
    win.focus()
  }
})

ipcMain.handle('voidcast:hide-window', () => {
  if (win) {
    win.hide()
  }
})

ipcMain.handle('voidcast:window-minimize', () => {
  win?.minimize()
})

ipcMain.handle('voidcast:window-toggle-maximize', () => {
  if (!win) return false
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return win.isMaximized()
})

ipcMain.handle('voidcast:window-close', () => {
  win?.close()
})

ipcMain.handle('voidcast:window-is-maximized', () => {
  return win?.isMaximized() ?? false
})

ipcMain.handle('voidcast:quit-app', () => {
  isQuitting = true
  app.quit()
})

ipcMain.handle('voidcast:get-lan-network-info', () => {
  const nets = os.networkInterfaces()
  const ips: string[] = []
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      const fam = net.family
      const isV4 = fam === 'IPv4'
      if (isV4 && !net.internal) {
        ips.push(net.address)
      }
    }
  }
  return { ips: [...new Set(ips)] }
})

ipcMain.handle('voidcast:open-path', async (_evt, filePath: string) => {
  const p = String(filePath ?? '').trim()
  if (!p) return { ok: false, text: 'Missing file path' }
  try {
    const err = await shell.openPath(p)
    if (err) return { ok: false, text: err }
    return { ok: true, text: `Opened: ${p}` }
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : String(e) }
  }
})

// ── MCP (stdio servers from ~/.voidcast/mcp.json + project .mcp.json) ────────

function mcpEnabledMapFromPayload(
  payload?: { enabledServers?: Record<string, boolean> },
): Record<string, boolean> {
  const raw = payload?.enabledServers
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'boolean') out[k] = v
  }
  return out
}

type McpIpcPayload = {
  projectPath?: string
  enabledServers?: Record<string, boolean>
  trustedProjectPaths?: string[]
}

function mcpProjectPathFromPayload(payload?: McpIpcPayload): string {
  return typeof payload?.projectPath === 'string' ? payload.projectPath.trim() : ''
}

function mcpTrustedPathsFromPayload(payload?: McpIpcPayload): string[] {
  const raw = payload?.trustedProjectPaths
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function mcpConnectionOpts(payload?: McpIpcPayload): { allowProjectConfig: boolean } {
  const projectPath = mcpProjectPathFromPayload(payload)
  if (!projectPath || !projectHasMcpConfigFile(projectPath)) {
    return { allowProjectConfig: true }
  }
  return {
    allowProjectConfig: isMcpProjectTrustedResolved(
      projectPath,
      mcpTrustedPathsFromPayload(payload),
    ),
  }
}

ipcMain.handle(
  'voidcast:mcp-list-tools',
  async (_evt, payload?: McpIpcPayload) => {
    try {
      const projectPath = mcpProjectPathFromPayload(payload)
      const enabledServers = mcpEnabledMapFromPayload(payload)
      await mcpManager.ensureConnected(projectPath || undefined, enabledServers, mcpConnectionOpts(payload))
      return { ok: true as const, tools: mcpManager.listTools() }
    } catch (e) {
      return {
        ok: false as const,
        tools: [] as ReturnType<typeof mcpManager.listTools>,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

ipcMain.handle(
  'voidcast:mcp-execute-tool',
  async (
    _evt,
    payload: {
      serverId?: string
      toolName?: string
      qualifiedName?: string
      args?: Record<string, unknown>
      projectPath?: string
      enabledServers?: Record<string, boolean>
      trustedProjectPaths?: string[]
    },
  ) => {
    try {
      const projectPath = mcpProjectPathFromPayload(payload)
      const enabledServers = mcpEnabledMapFromPayload(payload)
      await mcpManager.ensureConnected(
        projectPath || undefined,
        enabledServers,
        mcpConnectionOpts(payload),
      )

      let serverId = typeof payload?.serverId === 'string' ? payload.serverId.trim() : ''
      let toolName = typeof payload?.toolName === 'string' ? payload.toolName.trim() : ''
      const qualified =
        typeof payload?.qualifiedName === 'string' ? payload.qualifiedName.trim() : ''
      if ((!serverId || !toolName) && qualified) {
        const parsed = parseMcpToolName(qualified)
        if (parsed) {
          serverId = parsed.serverId
          toolName = parsed.toolName
        }
      }
      if (!serverId || !toolName) {
        return {
          ok: false as const,
          result: 'Error: missing MCP serverId/toolName (or qualifiedName).',
        }
      }
      if (enabledServers[serverId] === false) {
        return {
          ok: false as const,
          result: `Error: MCP server "${serverId}" is disabled in settings.`,
        }
      }
      const args =
        payload?.args && typeof payload.args === 'object' && !Array.isArray(payload.args)
          ? payload.args
          : {}
      const result = await mcpManager.callTool(serverId, toolName, args)
      return { ok: true as const, result, qualifiedName: formatMcpToolName(serverId, toolName) }
    } catch (e) {
      return {
        ok: false as const,
        result: `Error: MCP tool execution failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  },
)

ipcMain.handle(
  'voidcast:mcp-read-result',
  async (
    _evt,
    payload?: {
      path?: string
      startLine?: number
      endLine?: number
      offset?: number
      maxChars?: number
      itemOffset?: number
      itemLimit?: number
      query?: string
    },
  ) => {
    try {
      const result = await readPersistedMcpResult({
        path: typeof payload?.path === 'string' ? payload.path : '',
        startLine: payload?.startLine,
        endLine: payload?.endLine,
        offset: payload?.offset,
        maxChars: payload?.maxChars,
        itemOffset: payload?.itemOffset,
        itemLimit: payload?.itemLimit,
        query: typeof payload?.query === 'string' ? payload.query : undefined,
      })
      return { ok: !result.startsWith('Error:') as boolean, result }
    } catch (e) {
      return {
        ok: false as const,
        result: `Error: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  },
)

ipcMain.handle(
  'voidcast:mcp-reload',
  async (_evt, payload?: McpIpcPayload) => {
    try {
      const projectPath = mcpProjectPathFromPayload(payload)
      const enabledServers = mcpEnabledMapFromPayload(payload)
      return await mcpManager.reload(
        projectPath || undefined,
        enabledServers,
        mcpConnectionOpts(payload),
      )
    } catch (e) {
      return {
        ok: false as const,
        status: [] as ReturnType<typeof mcpManager.getStatus>,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

ipcMain.handle(
  'voidcast:mcp-status',
  async (
    _evt,
    payload?: {
      projectPath?: string
      ensure?: boolean
      enabledServers?: Record<string, boolean>
      trustedProjectPaths?: string[]
    },
  ) => {
    try {
      const projectPath = mcpProjectPathFromPayload(payload)
      const enabledServers = mcpEnabledMapFromPayload(payload)
      const connectionOpts = mcpConnectionOpts(payload)
      if (payload?.ensure) {
        await mcpManager.ensureConnected(
          projectPath || undefined,
          enabledServers,
          connectionOpts,
        )
      }
      const pendingProjectTrust =
        Boolean(projectPath) &&
        projectHasMcpConfigFile(projectPath) &&
        !connectionOpts.allowProjectConfig
      return {
        ok: true as const,
        status: mcpManager.getStatus(),
        configPath: getGlobalMcpConfigPath(),
        pendingProjectTrust,
      }
    } catch (e) {
      return {
        ok: false as const,
        status: [] as ReturnType<typeof mcpManager.getStatus>,
        configPath: getGlobalMcpConfigPath(),
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

ipcMain.handle('voidcast:mcp-open-config', async () => {
  const ensured = await mcpManager.ensureGlobalConfigExists()
  if (!ensured.ok) return { ok: false as const, error: ensured.error }
  try {
    const err = await shell.openPath(ensured.path)
    if (err) return { ok: false as const, path: ensured.path, error: err }
    return { ok: true as const, path: ensured.path }
  } catch (e) {
    return {
      ok: false as const,
      path: ensured.path,
      error: e instanceof Error ? e.message : String(e),
    }
  }
})

ipcMain.handle('voidcast:mcp-stop-all', async () => {
  await mcpManager.stopAll()
  return { ok: true as const }
})

ipcMain.handle('voidcast:mcp-cancel-active-calls', async () => {
  mcpManager.cancelActiveCalls()
  return { ok: true as const }
})

ipcMain.handle('voidcast:mcp-project-config-preview', async (_evt, payload?: McpIpcPayload) => {
  try {
    const projectPath = mcpProjectPathFromPayload(payload)
    if (!projectPath) {
      return { ok: false as const, error: 'Missing project path.' }
    }
    if (!projectHasMcpConfigFile(projectPath)) {
      return { ok: true as const, servers: [] as ReturnType<typeof buildMcpProjectServerPreviews> }
    }
    const projectCfg = await loadProjectMcpConfig(projectPath)
    return {
      ok: true as const,
      servers: buildMcpProjectServerPreviews(projectCfg.mcpServers),
      normalizedProjectPath: normalizeMcpProjectPathResolved(projectPath),
    }
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
      servers: [] as ReturnType<typeof buildMcpProjectServerPreviews>,
    }
  }
})

ipcMain.handle(
  'voidcast:mcp-oauth-sign-in',
  async (_evt, payload?: McpIpcPayload & { serverId?: string }) => {
    const serverId = typeof payload?.serverId === 'string' ? payload.serverId.trim() : ''
    if (!serverId) {
      return {
        ok: false as const,
        status: [] as ReturnType<typeof mcpManager.getStatus>,
        error: 'Missing MCP server id.',
      }
    }
    try {
      const projectPath = mcpProjectPathFromPayload(payload)
      const enabledServers = mcpEnabledMapFromPayload(payload)
      const connectionOpts = mcpConnectionOpts(payload)
      const result = await mcpManager.signInOAuth(
        serverId,
        projectPath || undefined,
        enabledServers,
        connectionOpts,
      )
      if (!result.ok) {
        return {
          ok: false as const,
          status: mcpManager.getStatus(),
          error: result.error,
        }
      }
      return { ok: true as const, status: mcpManager.getStatus() }
    } catch (e) {
      return {
        ok: false as const,
        status: mcpManager.getStatus(),
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

ipcMain.handle(
  'voidcast:mcp-oauth-sign-out',
  async (_evt, payload?: McpIpcPayload & { serverId?: string }) => {
    const serverId = typeof payload?.serverId === 'string' ? payload.serverId.trim() : ''
    if (!serverId) {
      return {
        ok: false as const,
        status: [] as ReturnType<typeof mcpManager.getStatus>,
        error: 'Missing MCP server id.',
      }
    }
    try {
      await mcpManager.signOutOAuth(serverId)
      return { ok: true as const, status: mcpManager.getStatus() }
    } catch (e) {
      return {
        ok: false as const,
        status: mcpManager.getStatus(),
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

ipcMain.handle('voidcast:get-app-version', () => {
  return app.getVersion()
})

// ── Agent Skills (project + ~/.agents|~/.claude|~/.cursor/skills/*/SKILL.md) ─

type AgentSkillSource = 'project' | 'agents' | 'claude' | 'cursor'

type AgentSkillMeta = {
  id: string
  name: string
  description: string
  dirPath: string
  source: AgentSkillSource
}

const GLOBAL_AGENT_SKILL_ROOTS: ReadonlyArray<{
  source: Exclude<AgentSkillSource, 'project'>
  segments: string[]
}> = [
  { source: 'agents', segments: ['.agents', 'skills'] },
  { source: 'claude', segments: ['.claude', 'skills'] },
  { source: 'cursor', segments: ['.cursor', 'skills'] },
]

/** Project-relative skill roots; scanned first so they override globals. */
const PROJECT_SKILL_ROOT_SEGMENTS: ReadonlyArray<string[]> = [
  ['.cursor', 'skills'],
  ['.claude', 'skills'],
  ['.agents', 'skills'],
  ['skills'],
]

const PROJECT_AGENT_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'] as const

function parseSkillFrontmatterLite(raw: string): { name?: string; description?: string } {
  const text = raw.replace(/^\uFEFF/, '')
  if (!text.startsWith('---')) return {}
  const end = text.indexOf('\n---', 3)
  if (end < 0) return {}
  const fm = text.slice(3, end).replace(/^\r?\n/, '')
  const lines = fm.split(/\r?\n/)

  const readBlock = (startIdx: number): string => {
    const parts: string[] = []
    let j = startIdx
    while (j < lines.length && /^\s+/.test(lines[j] ?? '')) {
      parts.push((lines[j] ?? '').replace(/^\s+/, ''))
      j++
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim()
  }

  const extract = (key: string): string | undefined => {
    const keyRe = new RegExp(`^${key}\\s*:\\s*(.*)$`, 'i')
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]?.match(keyRe)
      if (!m) continue
      let rest = m[1].trim()
      if (rest === '>' || rest === '|' || rest === '>-' || rest === '|-') {
        return readBlock(i + 1) || undefined
      }
      if (!rest) {
        const next = lines[i + 1]?.trim() ?? ''
        if (next === '>' || next === '|' || next === '>-' || next === '|-') {
          return readBlock(i + 2) || undefined
        }
        if (/^\s+\S/.test(lines[i + 1] ?? '')) return readBlock(i + 1) || undefined
        return undefined
      }
      if (
        (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) ||
        (rest.startsWith("'") && rest.endsWith("'") && rest.length >= 2)
      ) {
        rest = rest.slice(1, -1)
      }
      return rest.trim() || undefined
    }
    return undefined
  }

  return { name: extract('name'), description: extract('description') }
}

async function scanSkillRootDir(
  rootDir: string,
  source: AgentSkillSource,
  seen: Set<string>,
  found: AgentSkillMeta[],
): Promise<void> {
  let entries: string[] = []
  try {
    entries = await readdir(rootDir)
  } catch {
    return
  }
  for (const entry of entries) {
    const dirPath = path.join(rootDir, entry)
    let isDir = false
    try {
      isDir = (await stat(dirPath)).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    const skillMd = path.join(dirPath, 'SKILL.md')
    let raw = ''
    try {
      raw = await readFile(skillMd, 'utf8')
    } catch {
      continue
    }
    const fm = parseSkillFrontmatterLite(raw)
    const name = (fm.name || entry).trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    found.push({
      id: name,
      name,
      description: (fm.description || '').trim(),
      dirPath,
      source,
    })
  }
}

async function discoverAgentSkillsFromDisk(projectPath?: string): Promise<AgentSkillMeta[]> {
  const found: AgentSkillMeta[] = []
  const seen = new Set<string>()
  const projectRoot = String(projectPath ?? '').trim()

  if (projectRoot) {
    const rootResolved = path.resolve(projectRoot)
    try {
      if ((await stat(rootResolved)).isDirectory()) {
        for (const segments of PROJECT_SKILL_ROOT_SEGMENTS) {
          await scanSkillRootDir(path.join(rootResolved, ...segments), 'project', seen, found)
        }
      }
    } catch {
      // ignore missing / unreadable project path
    }
  }

  const home = os.homedir()
  for (const root of GLOBAL_AGENT_SKILL_ROOTS) {
    await scanSkillRootDir(path.join(home, ...root.segments), root.source, seen, found)
  }

  found.sort((a, b) => a.name.localeCompare(b.name))
  return found
}

async function readProjectAgentInstructionFiles(
  projectPath: string,
): Promise<{ fileName: string; content: string }[]> {
  const root = path.resolve(projectPath)
  try {
    if (!(await stat(root)).isDirectory()) return []
  } catch {
    return []
  }
  const out: { fileName: string; content: string }[] = []
  for (const fileName of PROJECT_AGENT_INSTRUCTION_FILES) {
    const abs = path.join(root, fileName)
    const resolved = path.resolve(abs)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) continue
    try {
      const content = await readFile(resolved, 'utf8')
      if (content.trim()) out.push({ fileName, content })
    } catch {
      // missing file is fine
    }
  }
  return out
}

ipcMain.handle(
  'voidcast:list-agent-skills',
  async (_evt, payload?: { projectPath?: string }) => {
    try {
      const projectPath = String(payload?.projectPath ?? '').trim() || undefined
      const skills = await discoverAgentSkillsFromDisk(projectPath)
      return { ok: true as const, skills }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
        skills: [] as AgentSkillMeta[],
      }
    }
  },
)

ipcMain.handle(
  'voidcast:read-agent-skill',
  async (_evt, payload: { name?: string; projectPath?: string }) => {
    const want = String(payload?.name ?? '').trim()
    if (!want) return { ok: false as const, error: 'Missing skill name.' }
    try {
      const projectPath = String(payload?.projectPath ?? '').trim() || undefined
      const skills = await discoverAgentSkillsFromDisk(projectPath)
      const skill =
        skills.find((s) => s.name.toLowerCase() === want.toLowerCase()) ??
        skills.find((s) => path.basename(s.dirPath).toLowerCase() === want.toLowerCase())
      if (!skill) {
        return { ok: false as const, error: `Skill not found: ${want}` }
      }
      const skillMd = path.join(skill.dirPath, 'SKILL.md')
      const resolved = path.resolve(skillMd)
      const rootResolved = path.resolve(skill.dirPath)
      if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
        return { ok: false as const, error: 'Invalid skill path.' }
      }
      const content = await readFile(resolved, 'utf8')
      return { ok: true as const, name: skill.name, content, dirPath: skill.dirPath }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  },
)

ipcMain.handle(
  'voidcast:read-project-agent-instructions',
  async (_evt, payload: { projectPath?: string }) => {
    const projectPath = String(payload?.projectPath ?? '').trim()
    if (!projectPath) {
      return { ok: false as const, error: 'Missing project path.', files: [] as { fileName: string; content: string }[] }
    }
    try {
      const files = await readProjectAgentInstructionFiles(projectPath)
      return { ok: true as const, files }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
        files: [] as { fileName: string; content: string }[],
      }
    }
  },
)
