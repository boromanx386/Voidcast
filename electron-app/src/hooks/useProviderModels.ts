import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { CloudLlmPreset } from '@/lib/cloudLlmPresets'
import {
  EMPTY_LIVE_CATALOG,
  getLiveCatalog,
  liveCatalogProviderFor,
  loadLiveCatalog,
  mergeModelLists,
  subscribeLiveCatalogs,
  type LiveCatalogSource,
} from '@/lib/liveModels'

export type ProviderModels = {
  /** Curated presets, under their hand-written labels. */
  recommended: CloudLlmPreset[]
  /** Live catalog models the presets do not cover, newest first. */
  more: CloudLlmPreset[]
  all: CloudLlmPreset[]
  loading: boolean
  error: string | null
  fetchedAt: number
  refresh: () => void
  /** False for providers without a live catalog: `more` is then always empty. */
  live: boolean
}

/**
 * Curated + live models for a picker. Loads on mount when the cache is stale; `refresh` forces
 * a refetch. Every picker shares one store, so a refresh anywhere updates them all.
 */
export function useProviderModels(
  provider: string,
  curated: CloudLlmPreset[],
  source: LiveCatalogSource,
): ProviderModels {
  const liveProvider = liveCatalogProviderFor(provider)
  const getSnapshot = useCallback(
    () => (liveProvider ? getLiveCatalog(liveProvider) : EMPTY_LIVE_CATALOG),
    [liveProvider],
  )
  const state = useSyncExternalStore(subscribeLiveCatalogs, getSnapshot)
  const { openrouterBaseUrl, ttsBaseUrl, opencodeGoApiKey } = source

  useEffect(() => {
    if (!liveProvider) return
    void loadLiveCatalog(liveProvider, { openrouterBaseUrl, ttsBaseUrl, opencodeGoApiKey })
  }, [liveProvider, openrouterBaseUrl, ttsBaseUrl, opencodeGoApiKey])

  const refresh = useCallback(() => {
    if (!liveProvider) return
    void loadLiveCatalog(
      liveProvider,
      { openrouterBaseUrl, ttsBaseUrl, opencodeGoApiKey },
      { force: true },
    )
  }, [liveProvider, openrouterBaseUrl, ttsBaseUrl, opencodeGoApiKey])

  const merged = useMemo(() => mergeModelLists(curated, state.models), [curated, state.models])

  return {
    recommended: merged.recommended,
    more: merged.more,
    all: useMemo(() => [...merged.recommended, ...merged.more], [merged]),
    loading: state.loading,
    error: state.error,
    fetchedAt: state.fetchedAt,
    refresh,
    live: Boolean(liveProvider),
  }
}
