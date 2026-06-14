import { useEffect, useLayoutEffect, useState } from 'react'
import { pushCloudSecretsToServer } from '@/lib/cloudSecrets'
import {
  pushHostToolConfigToServer,
  resolvePdfOutputDir,
} from '@/lib/hostToolConfig'
import { isElectron } from '@/lib/platform'
import { loadSettings, saveSettings, type AppSettings } from '@/lib/settings'

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  /** PDF folder on the PC running the tools server (from desktop push; used on LAN web). */
  const [hostPdfOutputDir, setHostPdfOutputDir] = useState('')
  const effectivePdfOutputDir = resolvePdfOutputDir(settings.pdfOutputDir, hostPdfOutputDir)
  const [appVersion, setAppVersion] = useState('2.6.5')

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  // Keep UI state in sync when settings are changed outside React state (for example via agent tool).
  useEffect(() => {
    const interval = window.setInterval(() => {
      const stored = loadSettings()
      setSettings((prev) => {
        const changed =
          prev.llmSystemPrompt !== stored.llmSystemPrompt ||
          prev.llmNumCtx !== stored.llmNumCtx ||
          prev.llmTemperature !== stored.llmTemperature ||
          prev.uiTheme !== stored.uiTheme ||
          prev.runwareWidth !== stored.runwareWidth ||
          prev.runwareHeight !== stored.runwareHeight ||
          prev.runwareImageModel !== stored.runwareImageModel ||
          prev.runwareEditModel !== stored.runwareEditModel
        return changed ? stored : prev
      })
    }, 1000)
    return () => {
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!isElectron()) return
    const getVersion = window.voidcast?.getAppVersion
    if (!getVersion) return
    void getVersion()
      .then((v) => {
        const version = String(v || '').trim()
        if (version) setAppVersion(version)
      })
      .catch(() => {
        // Keep fallback version text if IPC call fails.
      })
  }, [])

  useEffect(() => {
    if (!isElectron()) return
    const bridge = window.voidcast
    if (!bridge) return
    void bridge.setAutoUpdateEnabled(Boolean(settings.autoUpdate)).catch(() => {
      // Best-effort setting sync.
    })
    if (!settings.autoUpdate) return
    void bridge.checkForUpdates().catch(() => {
      // Best-effort automatic check.
    })
  }, [settings.autoUpdate])

  // Register cloud API keys on the local TTS server for LAN web proxy (keys never sent to phone).
  useEffect(() => {
    if (!isElectron()) return
    const root = settings.ttsBaseUrl.trim().replace(/\/+$/, '')
    if (!root) return
    const push = () =>
      void pushCloudSecretsToServer(root, {
        openrouterApiKey: settings.openrouterApiKey,
        runwareApiKey: settings.runwareApiKey,
        nvidiaApiKey: settings.nvidiaApiKey,
      }).catch(() => {
        // Best-effort; web client shows 503 if keys were not registered.
      })
    const timer = window.setTimeout(push, 250)
    const heartbeat = window.setInterval(push, 30000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(heartbeat)
    }
  }, [
    settings.ttsBaseUrl,
    settings.openrouterApiKey,
    settings.runwareApiKey,
    settings.nvidiaApiKey,
  ])

  useEffect(() => {
    if (!isElectron()) return
    const root = settings.ttsBaseUrl.trim().replace(/\/+$/, '')
    if (!root || !settings.toolsEnabled.pdf) return
    const push = () =>
      void pushHostToolConfigToServer(root, {
        pdfOutputDir: settings.pdfOutputDir,
      }).catch(() => {})
    const timer = window.setTimeout(push, 300)
    const heartbeat = window.setInterval(push, 30000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(heartbeat)
    }
  }, [settings.ttsBaseUrl, settings.toolsEnabled.pdf, settings.pdfOutputDir])

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-ui-theme', settings.uiTheme)
  }, [settings.uiTheme])

  return {
    settings,
    setSettings,
    hostPdfOutputDir,
    setHostPdfOutputDir,
    effectivePdfOutputDir,
    appVersion,
  }
}
