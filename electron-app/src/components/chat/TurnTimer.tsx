import { useElapsedMs } from '@/hooks/useElapsedMs'
import { formatDurationMs } from '@/lib/turnTimer'

type Props = {
  /** Epoch ms when the turn started (stamped when the assistant message is created). */
  startedAt?: number
  /** Epoch ms when the turn ended (stamped in the run's finally block). */
  endedAt?: number
  /** Whether this turn is still running — drives the live tick. */
  live?: boolean
}

/**
 * Per-turn duration chip shown at the bottom of an assistant bubble.
 * Ticks live while the turn runs, freezes to the final duration afterwards.
 */
export function TurnTimer({ startedAt, endedAt, live }: Props) {
  const elapsed = useElapsedMs(startedAt, endedAt, Boolean(live))
  if (elapsed == null) return null
  return (
    <span className="turn-timer" title={live ? 'Turn in progress' : 'Total turn duration'}>
      ⏱ {formatDurationMs(elapsed)}
    </span>
  )
}
