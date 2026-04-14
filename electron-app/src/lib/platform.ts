/**
 * Runtime detection: Electron preload exposes `window.voidcast`; browser build does not.
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.voidcast)
}

/** Renderer loaded as a normal web page (TTS server static build), not inside Electron. */
export function isWebStandalone(): boolean {
  return typeof window !== 'undefined' && !isElectron()
}

export function defaultTtsBaseUrlForRuntime(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8765'
  if (isWebStandalone()) return window.location.origin
  return 'http://127.0.0.1:8765'
}

/** When using the web UI served from the TTS host, Ollama is proxied at this path. */
export function defaultOllamaBaseUrlForRuntime(): string {
  if (typeof window === 'undefined') return 'http://localhost:11434'
  if (isWebStandalone()) return `${window.location.origin}/api/ollama`
  return 'http://localhost:11434'
}
