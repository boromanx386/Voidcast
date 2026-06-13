type Props = {
  isDragOver: boolean
}

export function ChatDragOverlay({ isDragOver }: Props) {
  if (!isDragOver) return null

  return (
    <div
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center
        bg-void-black/70 backdrop-blur-sm border-2 border-dashed border-neon-cyan/60"
      aria-hidden
    >
      <div className="px-6 py-4 font-mono text-sm uppercase tracking-wider text-neon-cyan
        border border-neon-cyan/40 bg-void-dark/85 rounded">
        ⬇ DROP FILES TO ATTACH
        <div className="mt-1 text-[11px] normal-case tracking-normal text-void-dim">
          Images (PNG / JPEG / WebP …) and supported files (TXT, MD, PDF, DOCX, CSV, JSON, code).
        </div>
      </div>
    </div>
  )
}
