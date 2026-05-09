import type { Reminder } from '@/lib/reminderStorage'

type Props = {
  reminders: Reminder[]
  onDelete: (id: string) => void
  onMarkDone: (id: string) => void
}

export function RemindersOptionsPanel({ reminders, onDelete, onMarkDone }: Props) {
  return (
    <div className="grid gap-5 text-sm">
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-cyan mr-2">⏰</span>Reminders
        </label>
        {reminders.length === 0 ? (
          <p className="text-xs text-void-dim mt-1">No reminders yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {reminders.map((r) => (
              <li
                key={r.id}
                className={`flex items-start justify-between gap-3 bg-void-black/50 border border-void-muted/30 p-3 rounded ${
                  r.status === 'done' ? 'opacity-50' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className={`font-medium ${r.status === 'done' ? 'line-through' : ''}`}>
                    {r.text}
                  </p>
                  <p className="text-xs text-void-dim mt-0.5">
                    {r.when != null
                      ? new Date(r.when).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'General'}
                    {r.tags.length > 0 && (
                      <span className="ml-2">[{r.tags.join(', ')}]</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {r.status !== 'done' && (
                    <button
                      onClick={() => onMarkDone(r.id)}
                      className="cyber-btn text-xs px-2 py-1"
                      title="Mark done"
                    >
                      ✓
                    </button>
                  )}
                  <button
                    onClick={() => onDelete(r.id)}
                    className="cyber-btn text-xs px-2 py-1"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
