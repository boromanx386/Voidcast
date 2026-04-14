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
  type NativeImage,
  type OpenDialogOptions,
} from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { update } from './update'
import { scrapePublicUrlToText } from './scrape'
import { savePdfToFolder } from './pdf'

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
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

// Create tray icon
function createTray() {
  // Create a simple tray icon (16x16 cyan triangle)
  const iconSize = 16
  const icon = nativeImage.createEmpty()
  
  // Try to load favicon first, fallback to a simple icon
  const iconPath = path.join(process.env.VITE_PUBLIC, 'favicon.ico')
  
  try {
    const loadedIcon = nativeImage.createFromPath(iconPath)
    if (!loadedIcon.isEmpty()) {
      tray = new Tray(loadedIcon.resize({ width: 16, height: 16 }))
    } else {
      // Create a simple colored icon programmatically
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
  
  tray.setToolTip('Voidcast - Neural Interface')
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

  win = new BrowserWindow({
    title: 'Voidcast',
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    show: false, // Start hidden until ready
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

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
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
      // Show window if hidden, then send clipboard text
      if (!win.isVisible()) {
        win.show()
      }
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
  globalShortcut.unregisterAll()
})

app.whenReady().then(() => {
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

ipcMain.handle(
  'voidcast:save-pdf',
  async (
    _evt,
    payload: {
      content?: string
      title?: string
      filename?: string
      outputDir?: string
    },
  ) => {
    return savePdfToFolder(payload)
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

// New window example arg: new windows url
ipcMain.handle('open-win', (_, arg) => {
  const childWindow = new BrowserWindow({
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    childWindow.loadFile(indexHtml, { hash: arg })
  }
})

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

ipcMain.handle('voidcast:quit-app', () => {
  isQuitting = true
  app.quit()
})
