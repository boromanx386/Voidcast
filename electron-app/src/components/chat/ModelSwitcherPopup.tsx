import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { AppSettings, LlmProvider } from '@/lib/settings'
import {
  CROFAI_LLM_PRESET_MODELS,
  OPENROUTER_LLM_PRESET_MODELS,
  DEEPSEEK_LLM_PRESET_MODELS,
  OPENAI_LLM_PRESET_MODELS,
  NVIDIA_LLM_PRESET_MODELS,
  OPENCODE_GO_LLM_PRESET_MODELS,
} from '@/lib/cloudLlmPresets'
import { fetchOllamaModels } from '@/lib/ollama'
import {
  currentPinnedModelId,
  parsePinnedId,
  pinnedIdLabel,
  toScopedPinnedId,
} from '@/lib/pinnedModels'

interface PinnedItem {
  id: string
  label: string
  provider: LlmProvider
}

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  nvidia: 'NVIDIA',
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  'opencode-go': 'OpenCode Go',
  crofai: 'CrofAI',
}

function providerLabel(provider: LlmProvider): string {
  return PROVIDER_LABELS[provider] ?? provider
}

export type ModelSwitcherSelection = { provider: LlmProvider; modelId: string }

interface ModelSwitcherPopupProps {
  settings: AppSettings
  onSelectModel: (selection: ModelSwitcherSelection) => void
  onManageModels: () => void
  onClose: () => void
  rootRef?: RefObject<HTMLElement | null>
}

export default function ModelSwitcherPopup({
  settings,
  onSelectModel,
  onManageModels,
  onClose,
  rootRef,
}: ModelSwitcherPopupProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [ollamaModels, setOllamaModels] = useState<PinnedItem[]>([])
  const [ollamaFetched, setOllamaFetched] = useState(false)

  const currentId = currentPinnedModelId(settings)
  const pinned = settings.pinnedModels ?? []

  useEffect(() => {
    if (ollamaFetched) return
    const needsOllama =
      settings.llmProvider === 'ollama' || pinned.some((id) => parsePinnedId(id)?.provider === 'ollama')
    if (!needsOllama) return
    let cancelled = false
    fetchOllamaModels(settings.ollamaBaseUrl || 'http://127.0.0.1:11434')
      .then((models) => {
        if (cancelled) return
        setOllamaModels(
          models.map((m) => ({
            id: toScopedPinnedId('ollama', m),
            label: m,
            provider: 'ollama' as const,
          })),
        )
        setOllamaFetched(true)
      })
      .catch(() => {
        if (cancelled) return
        setOllamaModels([])
        setOllamaFetched(true)
      })
    return () => {
      cancelled = true
    }
  }, [pinned, settings.ollamaBaseUrl, settings.llmProvider, ollamaFetched])

  const allPresets = useMemo((): PinnedItem[] => {
    const map: PinnedItem[] = []
    for (const p of OPENROUTER_LLM_PRESET_MODELS) {
      map.push({
        id: toScopedPinnedId('openrouter', p.id),
        label: p.label,
        provider: 'openrouter',
      })
    }
    for (const p of DEEPSEEK_LLM_PRESET_MODELS) {
      map.push({
        id: toScopedPinnedId('deepseek', p.id),
        label: p.label,
        provider: 'deepseek',
      })
    }
    for (const p of OPENAI_LLM_PRESET_MODELS) {
      map.push({
        id: toScopedPinnedId('openai', p.id),
        label: p.label,
        provider: 'openai',
      })
    }
    for (const p of NVIDIA_LLM_PRESET_MODELS) {
      map.push({
        id: toScopedPinnedId('nvidia', p.id),
        label: p.label,
        provider: 'nvidia',
      })
    }
    for (const p of OPENCODE_GO_LLM_PRESET_MODELS) {
      map.push({
        id: toScopedPinnedId('opencode-go', p.id),
        label: p.label,
        provider: 'opencode-go',
      })
    }
    for (const p of CROFAI_LLM_PRESET_MODELS) {
      map.push({
        id: toScopedPinnedId('crofai', p.id),
        label: p.label,
        provider: 'crofai',
      })
    }
    for (const p of ollamaModels) map.push(p)
    return map
  }, [ollamaModels])

  const pinnedItems = useMemo(() => {
    const byId = new Map(allPresets.map((item) => [item.id, item]))
    const items: PinnedItem[] = []
    for (const id of pinned) {
      const found = byId.get(id)
      if (found) {
        items.push(found)
        continue
      }
      const parsed = parsePinnedId(id)
      if (parsed) {
        items.push({
          id: toScopedPinnedId(parsed.provider, parsed.modelId),
          label: parsed.modelId,
          provider: parsed.provider,
        })
        continue
      }
      items.push({ id, label: pinnedIdLabel(id), provider: 'openrouter' })
    }
    return items
  }, [allPresets, pinned])

  const currentProviderItems = useMemo((): PinnedItem[] => {
    const currProv = settings.llmProvider
    if (currProv === 'ollama') return ollamaModels
    return allPresets.filter((item) => item.provider === currProv)
  }, [settings.llmProvider, ollamaModels, allPresets])

  const displayItems = pinnedItems.length > 0 ? pinnedItems : currentProviderItems

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const root = rootRef?.current ?? panelRef.current
      if (root && !root.contains(e.target as Node)) onClose()
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [onClose, rootRef])

  const handleSelect = useCallback(
    (item: PinnedItem) => {
      onSelectModel({ provider: item.provider, modelId: item.id })
      onClose()
    },
    [onSelectModel, onClose],
  )

  return (
    <div
      ref={panelRef}
      className="voidcast-model-switcher absolute bottom-full left-0 z-50 mb-1.5 min-w-[200px] rounded-md border border-void-mid bg-void-dark shadow-lg"
      role="dialog"
      aria-label="Switch model"
    >
      <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-void-dim">
        {pinnedItems.length > 0 ? 'Pinned' : providerLabel(settings.llmProvider)}
      </div>

      <div className="max-h-[240px] overflow-y-auto">
        {displayItems.length === 0 && (
          <div className="px-2.5 py-3 text-center text-[11px] italic text-void-dim">
            No models available
          </div>
        )}
        {displayItems.map((item) => {
          const active = item.provider === settings.llmProvider && item.id === currentId
          return (
            <button
              key={item.id}
              type="button"
              className={`flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-[11px] transition-colors hover:bg-void-mid/60 ${
                active ? 'font-semibold text-neon-cyan' : 'text-void-text'
              }`}
              onClick={() => handleSelect(item)}
            >
              <span className="w-3.5 shrink-0 text-center">{active ? '✓' : ''}</span>
              <span className="truncate">{item.label}</span>
              <span className="ml-auto shrink-0 text-void-dim">({providerLabel(item.provider)})</span>
            </button>
          )
        })}
      </div>

      <div className="border-t border-void-mid px-2 py-1">
        <button
          type="button"
          className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-[11px] text-void-dim transition-colors hover:bg-void-mid/60 hover:text-void-text"
          onClick={() => {
            onManageModels()
            onClose()
          }}
        >
          <span className="text-xs" aria-hidden>
            ⚙
          </span>
          <span>Manage models…</span>
        </button>
      </div>
    </div>
  )
}
