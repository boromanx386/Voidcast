import {
  app,
  BrowserWindow,
  dialog,
  shell,
  ipcMain,
  Menu,
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
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

async function createWindow() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }

  win = new BrowserWindow({
    title: 'Voidcast',
    autoHideMenuBar: true,
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
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

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Auto update
  update(win)
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
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
      const forecast = Boolean(payload?.forecast)
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
