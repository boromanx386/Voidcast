import type { ProviderModels } from '@/hooks/useProviderModels'

/** `<option>`s for a model `<select>`: presets and the live catalog in one A–Z list. */
export function LiveModelOptions({ models }: { models: ProviderModels }) {
  return (
    <>
      {models.all.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </>
  )
}

/** Search list for the manual model-id field, so the long live catalog is findable by typing. */
export function LiveModelDatalist({ id, models }: { id: string; models: ProviderModels }) {
  if (!models.live) return null
  return (
    <datalist id={id}>
      {models.all.map((m) => (
        <option key={m.id} value={m.id} label={m.label} />
      ))}
    </datalist>
  )
}

function ago(ts: number): string {
  const min = Math.max(0, Math.round((Date.now() - ts) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

/** One line under the picker: how many live models, when fetched, and a refresh button. */
export function LiveCatalogStatus({ models }: { models: ProviderModels }) {
  if (!models.live) return null
  return (
    <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-void-dim">
      <span className="flex-1 truncate">
        {models.loading
          ? 'Fetching the live model list…'
          : models.error
            ? `⚠ Live model list unavailable (${models.error}) — showing presets`
            : models.fetchedAt
              ? `${models.all.length} models (${models.added} from the live catalog) · updated ${ago(models.fetchedAt)} · type in the model field to search`
              : 'Live model list not loaded yet'}
      </span>
      <button
        type="button"
        className="shrink-0 rounded border border-void-muted/40 px-1.5 py-0.5 transition-colors hover:border-void-dim hover:text-void-text disabled:opacity-50"
        disabled={models.loading}
        onClick={models.refresh}
        title="Fetch the provider's model list now"
      >
        ↻
      </button>
    </div>
  )
}
