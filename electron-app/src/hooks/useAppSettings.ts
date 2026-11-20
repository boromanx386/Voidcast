import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { mergeExternalSettings } from '@/lib/externalSettingsSync'
import type { LanSyncState } from '@/lib/cloudSecrets'
import { resolvePdfOutputDir } from '@/lib/hostToolConfig'
import { isElectron } from '@/lib/platform'
import { loadSettings, saveSettings, type AppSettings } from '@/lib/settings'

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  /** PDF folder on the PC running the tools server (from desktop push; used on LAN web). */
  const [hostPdfOutputDir, setHostPdfOutputDir] = useState('')
  const effectivePdfOutputDir = resolvePdfOutputDir(settings.pdfOutputDir, hostPdfOutputDir)
  const [appVersion, setAppVersion] = useState('2.12.8')

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

  const lastLanEnabled = useRef<boolean | undefined>(undefined)
  const [lanSync, setLanSync] = useState<LanSyncState>({ pairing: null, error: false })
  const registration = useMemo(
    () =>
      settings.lanWebAccessEnabled
        ? {
            openrouterApiKey: settings.openrouterApiKey,
            runwareApiKey: settings.runwareApiKey,
            nvidiaApiKey: settings.nvidiaApiKey,
            deepseekApiKey: settings.deepseekApiKey,
            openaiApiKey: settings.openaiApiKey,
            opencodeGoApiKey: settings.opencodeGoApiKey,
            pdfOutputDir: settings.toolsEnabled.pdf ? settings.pdfOutputDir : '',
          }
        : null,
    [
      settings.lanWebAccessEnabled,
      settings.openrouterApiKey,
      settings.runwareApiKey,
      settings.nvidiaApiKey,
      settings.deepseekApiKey,
      settings.openaiApiKey,
      settings.opencodeGoApiKey,
      settings.toolsEnabled.pdf,
      settings.pdfOutputDir,
    ],
  )
  useEffect(() => {
    const bridge = window.voidcast
    if (!isElectron() || !bridge) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const sync = async () => {
      try {
        const pairing = await bridge.syncLanAccess(registration)
        if (cancelled) return
        setLanSync({ pairing, error: false })
        // Restore the registration if the tools server restarts while sharing.
        if (registration) timer = setTimeout(sync, 30000)
      } catch {
        if (cancelled) return
        setLanSync({ pairing: null, error: true })
        timer = setTimeout(sync, 3000)
      }
    }
    const toggleChanged = lastLanEnabled.current !== Boolean(registration)
    lastLanEnabled.current = Boolean(registration)
    if (toggleChanged || !registration) {
      setLanSync({ pairing: null, error: false })
      void sync()
    } else {
      timer = setTimeout(sync, 250)
    }
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [registration])

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-ui-theme', settings.uiTheme)
  }, [settings.uiTheme])

  return {
    settings,
    setSettings,
    hostPdfOutputDir,
    setHostPdfOutputDir,
    effectivePdfOutputDir,
    lanSync,
    appVersion,
  }
}
