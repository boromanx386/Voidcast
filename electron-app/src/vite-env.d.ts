/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_TARGET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  /** Present in Electron; absent in the standalone web build. */
  ipcRenderer?: import('electron').IpcRenderer
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
    saveImageFromUrl: (payload: {
      imageUrl: string
      outputDir: string
      filename?: string
    }) => Promise<{ ok: boolean; text: string } | string>
    openPath: (filePath: string) => Promise<{ ok: boolean; text: string } | string>
    pickDirectory: () => Promise<{ ok: true; path: string } | { ok: false }>
    /** Electron: native dialog + base64; absent in web build. */
    pickImages: () => Promise<
      | { ok: true; files: { base64: string; mime: string; name: string }[] }
      | { ok: false; error?: string }
    >
    getLanNetworkInfo: () => Promise<{ ips: string[] }>
    showWindow: () => Promise<void>
    hideWindow: () => Promise<void>
    quitApp: () => Promise<void>
    onNewChat: (callback: () => void) => () => void
  }
}
