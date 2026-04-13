/// <reference types="vite/client" />

interface Window {
  ipcRenderer: import('electron').IpcRenderer
  voidcast?: {
    webSearch: (query: string) => Promise<
      | { ok: boolean; text: string }
      | string
    >
    getWeather: (payload: {
      city: string
      forecast: boolean
    }) => Promise<{ ok: boolean; text: string } | string>
    scrapeUrl: (payload: {
      url: string
      max_chars?: number
    }) => Promise<{ ok: boolean; text: string } | string>
    savePdf: (payload: {
      content: string
      title?: string
      filename?: string
      outputDir: string
    }) => Promise<{ ok: boolean; text: string } | string>
    pickDirectory: () => Promise<{ ok: true; path: string } | { ok: false }>
    showWindow: () => Promise<void>
    hideWindow: () => Promise<void>
    quitApp: () => Promise<void>
    onNewChat: (callback: () => void) => () => void
  }
}
