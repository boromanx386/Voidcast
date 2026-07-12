/**
 * Runtime detection: Electron preload exposes `window.voidcast`; browser build does not.
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.voidcast)
}

/** Set at build time in `vite.config.web.ts` — authoritative for the LAN/phone bundle. */
export function isWebBuild(): boolean {
  return import.meta.env.VITE_BUILD_TARGET === 'web'
}

/** Phone/browser UI (served from TTS server), never the desktop Electron shell. */
export function isLanWebClient(): boolean {
  if (isWebBuild()) return true
  return typeof window !== 'undefined' && !isElectron()
}

/** @deprecated Prefer `isLanWebClient` — kept for existing call sites. */
export function isWebStandalone(): boolean {
  return isLanWebClient()
}

export function defaultTtsBaseUrlForRuntime(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8765'
  if (isLanWebClient()) return window.location.origin
  return 'http://127.0.0.1:8765'
}

/** When using the web UI served from the TTS host, Ollama is proxied at this path. */
export function defaultOllamaBaseUrlForRuntime(): string {
  if (typeof window === 'undefined') return 'http://localhost:11434'
  if (isLanWebClient()) return `${window.location.origin}/api/ollama`
  return 'http://localhost:11434'
}

/** Cloud LLM/TTS/STT calls go through TTS server; keys never reach the browser. */
export function usesServerCloudProxy(): boolean {
  return isLanWebClient()
}

export function cloudProxySetupHint(): string {
  return (
    'Cloud API keys are set only in the desktop Voidcast app (General options). ' +
    'Keep the desktop app and local server running on the same PC — do not enter keys on the phone.'
  )
}

export function openRouterApiBaseForRuntime(desktopUrl?: string): string {
  if (isLanWebClient()) return `${window.location.origin}/api/openrouter/api/v1`
  const u = (desktopUrl || '').trim()
  return u || 'https://openrouter.ai/api/v1'
}

export function nvidiaApiBaseForRuntime(desktopUrl?: string): string {
  if (isLanWebClient()) return `${window.location.origin}/api/nvidia/v1`
  const u = (desktopUrl || '').trim()
  return u || 'https://integrate.api.nvidia.com/v1'
}

export function deepseekApiBaseForRuntime(desktopUrl?: string): string {
  if (isLanWebClient()) return `${window.location.origin}/api/deepseek`
  const u = (desktopUrl || '').trim()
  return u || 'https://api.deepseek.com'
}
