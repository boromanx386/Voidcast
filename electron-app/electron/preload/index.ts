import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('voidcast', {
  webSearch: (query: string) => ipcRenderer.invoke('voidcast:web-search', query),
  getWeather: (payload: { city: string; forecast: boolean }) =>
    ipcRenderer.invoke('voidcast:get-weather', payload),
  scrapeUrl: (payload: { url: string; max_chars?: number }) =>
    ipcRenderer.invoke('voidcast:scrape-url', payload),
  savePdf: (payload: {
    content: string
    title?: string
    filename?: string
    outputDir: string
    images?: { mime?: string; base64: string }[]
  }) => ipcRenderer.invoke('voidcast:save-pdf', payload),
  saveImageFromUrl: (payload: {
    imageUrl: string
    outputDir: string
    filename?: string
  }) => ipcRenderer.invoke('voidcast:save-image-from-url', payload),
  saveAudioFromUrl: (payload: {
    audioUrl: string
    outputDir: string
    filename?: string
  }) => ipcRenderer.invoke('voidcast:save-audio-from-url', payload),
  runwareProxy: (payload: {
    api_base_url: string
    api_key: string
    tasks: unknown[]
  }) =>
    ipcRenderer.invoke('voidcast:runware-proxy', payload) as Promise<
      | { ok: true; data: unknown }
      | { ok: false; detail: string }
    >,
  getAppVersion: () => ipcRenderer.invoke('voidcast:get-app-version') as Promise<string>,
  openPath: (filePath: string) => ipcRenderer.invoke('voidcast:open-path', filePath),
  pickDirectory: () =>
    ipcRenderer.invoke('voidcast:pick-directory') as Promise<
      { ok: true; path: string } | { ok: false }
    >,
  pickImages: () =>
    ipcRenderer.invoke('voidcast:pick-images') as Promise<
      | {
          ok: true
          files: { base64: string; mime: string; name: string; path: string }[]
        }
      | { ok: false; error?: string }
    >,
  readImageFile: (payload: { path: string }) =>
    ipcRenderer.invoke('voidcast:read-image-file', payload) as Promise<
      | {
          ok: true
          file: { base64: string; mime: string; name: string; path: string }
        }
      | { ok: false; error?: string }
    >,
  /** LAN IPv4 addresses of this machine (for mobile web UI URLs). */
  getLanNetworkInfo: () =>
    ipcRenderer.invoke('voidcast:get-lan-network-info') as Promise<{ ips: string[] }>,
  showWindow: () => ipcRenderer.invoke('voidcast:show-window'),
  hideWindow: () => ipcRenderer.invoke('voidcast:hide-window'),
  quitApp: () => ipcRenderer.invoke('voidcast:quit-app'),
  onNewChat: (callback: () => void) => {
    ipcRenderer.on('voidcast:new-chat', callback)
    return () => ipcRenderer.removeListener('voidcast:new-chat', callback)
  },
})

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

// --------- Preload scripts loading ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)