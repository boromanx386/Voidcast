import { useEffect, useLayoutEffect, useState } from 'react'
import { mergeExternalSettings } from '@/lib/externalSettingsSync'
import { isElectron } from '@/lib/platform'
import { loadSettings, saveSettings, type AppSettings } from '@/lib/settings'

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const effectivePdfOutputDir = settings.pdfOutputDir.trim()
  const [appVersion, setAppVersion] = useState('2.14.0')

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  // Keep UI state in sync when settings are changed outside React state (for example via
  // agent tool). Only the externally-owned keys are adopted — replacing the whole object
  // would drag the coding folder of another chat back in.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const stored = loadSettings()
      setSettings((prev) => mergeExternalSettings(prev, stored))
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

  // Start/stop the loopback control API in the main process (opt-in).
  useEffect(() => {
    if (!isElectron()) return
    void window.voidcast?.setControlApiEnabled(Boolean(settings.controlApiEnabled)).catch(() => {
      // Best-effort setting sync.
    })
  }, [settings.controlApiEnabled])

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-ui-theme', settings.uiTheme)
  }, [settings.uiTheme])

  return {
    settings,
    setSettings,
    effectivePdfOutputDir,
    appVersion,
  }
}
