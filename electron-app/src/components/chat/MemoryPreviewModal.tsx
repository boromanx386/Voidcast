import type { LongMemoryCandidate } from '@/types/longMemory'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type Props = {
  app: Pick<
    VoidcastApp,
    | 'memoryPreviewOpen'
    | 'setMemoryPreviewOpen'
    | 'memoryCandidates'
    | 'setMemoryCandidates'
    | 'longMemoryBusy'
    | 'confirmSaveLongMemory'
  >
}

export function MemoryPreviewModal({ app }: Props) {
  const {
    memoryPreviewOpen,
    setMemoryPreviewOpen,
    memoryCandidates,
    setMemoryCandidates,
    longMemoryBusy,
    confirmSaveLongMemory,
  } = app

  if (!memoryPreviewOpen) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-void-black/80 p-4">
      <div className="w-full max-w-2xl rounded border border-neon-cyan/30 bg-void-dark p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-mono text-neon-cyan">LONG_MEMORY_PREVIEW</div>
          <button
            type="button"
            onClick={() => setMemoryPreviewOpen(false)}
            className="px-2 py-1 text-xs font-mono text-void-dim hover:text-void-light"
          >
            CLOSE
          </button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto space-y-2">
          {memoryCandidates.map((m, idx) => (
            <div key={`${m.kind}-${idx}`} className="rounded border border-void-muted/30 bg-void-black/30 p-2">
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-neon-green/80">
                <span>{m.kind.toUpperCase()} · conf {(m.confidence ?? 0).toFixed(2)} · imp {(m.importance ?? 0).toFixed(2)}</span>
                <button
                  type="button"
                  className="px-2 py-0.5 text-[10px] text-neon-red/80 hover:text-neon-red"
                  onClick={() =>
                    setMemoryCandidates((prev: LongMemoryCandidate[]) =>
                      prev.filter((_: LongMemoryCandidate, i: number) => i !== idx),
                    )
                  }
                >
                  REMOVE
                </button>
              </div>
              <div className="mt-1 text-xs text-void-light">{m.text}</div>
              {!!m.tags?.length && (
                <div className="mt-1 text-[10px] text-void-dim">{m.tags.join(', ')}</div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setMemoryPreviewOpen(false)
              setMemoryCandidates([])
            }}
            className="px-3 py-1 text-xs font-mono text-void-dim hover:text-void-light"
          >
            CANCEL
          </button>
          <button
            type="button"
            onClick={() => void confirmSaveLongMemory()}
            className="cyber-btn text-xs"
            disabled={longMemoryBusy || memoryCandidates.length === 0}
          >
            CONFIRM_SAVE
          </button>
        </div>
      </div>
    </div>
  )
}
