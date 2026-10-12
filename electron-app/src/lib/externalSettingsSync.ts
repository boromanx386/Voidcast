import type { AppSettings } from '@/lib/settings'

/**
 * Fields that can be changed outside React state — an agent tool writing straight to
 * disk, or another window. Only these are mirrored back into live state.
 *
 * Anything else in settings (notably the coding folder) belongs to a surface that is
 * tracking it properly already; adopting it from disk would resurrect a stale value
 * written by another chat.
 */
export const EXTERNAL_SETTINGS_KEYS = [
  'llmSystemPrompt',
  'llmNumCtx',
  'llmTemperature',
  'uiTheme',
  'runwareWidth',
  'runwareHeight',
  'runwareImageModel',
  'runwareEditModel',
  'pinnedModels',
] as const

export function stringArraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const aa = a ?? []
  const bb = b ?? []
  if (aa.length !== bb.length) return false
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false
  }
  return true
}

/**
 * Adopt only the externally-owned keys from `stored`, keeping every other field as-is.
 *
 * Never return `stored` wholesale: settings is one shared object, and a whole-object
 * replace drags unrelated chat state (coding folder) along with it.
 */
export function mergeExternalSettings(prev: AppSettings, stored: AppSettings): AppSettings {
  let next = prev
  const adopt = (patch: Partial<AppSettings>) => {
    next = { ...next, ...patch }
  }

  if (next.llmSystemPrompt !== stored.llmSystemPrompt) {
    adopt({ llmSystemPrompt: stored.llmSystemPrompt })
  }
  if (next.llmNumCtx !== stored.llmNumCtx) adopt({ llmNumCtx: stored.llmNumCtx })
  if (next.llmTemperature !== stored.llmTemperature) {
    adopt({ llmTemperature: stored.llmTemperature })
  }
  if (next.uiTheme !== stored.uiTheme) adopt({ uiTheme: stored.uiTheme })
  if (next.runwareWidth !== stored.runwareWidth) adopt({ runwareWidth: stored.runwareWidth })
  if (next.runwareHeight !== stored.runwareHeight) adopt({ runwareHeight: stored.runwareHeight })
  if (next.runwareImageModel !== stored.runwareImageModel) {
    adopt({ runwareImageModel: stored.runwareImageModel })
  }
  if (next.runwareEditModel !== stored.runwareEditModel) {
    adopt({ runwareEditModel: stored.runwareEditModel })
  }
  if (!stringArraysEqual(next.pinnedModels, stored.pinnedModels)) {
    adopt({ pinnedModels: stored.pinnedModels })
  }

  return next
}
