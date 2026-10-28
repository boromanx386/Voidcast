/**
 * Batches stdout/stderr chunks so rapid subprocess output does not flood IPC/React.
 * Shared by Electron main (no path aliases) and the renderer.
 *
 * Timed flushes emit whole lines only: pipe chunks split lines at arbitrary bytes, and the
 * terminal turns every emitted piece into its own row. A trailing partial line is held back
 * until its newline arrives, or released after `tailHoldMs` of silence so prompts without a
 * newline ("Proceed? ") still show up.
 */
export class ChunkThrottle {
  private buf = { stdout: '', stderr: '' }
  private tailSince = { stdout: 0, stderr: 0 }
  private timer: ReturnType<typeof setTimeout> | null = null
  private timerDue = 0

  constructor(
    private readonly onFlush: (stream: 'stdout' | 'stderr', text: string) => void,
    private readonly intervalMs = 50,
    private readonly tailHoldMs = 250,
  ) {}

  push(stream: 'stdout' | 'stderr', text: string): void {
    if (!text) return
    this.buf[stream] += text
    this.tailSince[stream] = Date.now()
    this.schedule(this.intervalMs)
  }

  /** Emits everything buffered, partial lines included (process exit, snapshot for the agent). */
  flush(): void {
    this.clearTimer()
    for (const stream of ['stdout', 'stderr'] as const) {
      const text = this.buf[stream]
      if (!text) continue
      this.buf[stream] = ''
      this.onFlush(stream, text)
    }
  }

  // Keeps the earlier deadline: a pending tail check must not delay fresh output.
  private schedule(ms: number): void {
    const due = Date.now() + ms
    if (this.timer != null) {
      if (this.timerDue <= due) return
      clearTimeout(this.timer)
    }
    this.timerDue = due
    this.timer = setTimeout(() => {
      this.timer = null
      this.flushLines()
    }, ms)
  }

  private clearTimer(): void {
    if (this.timer != null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private flushLines(): void {
    const now = Date.now()
    let nextTailCheck = Infinity
    for (const stream of ['stdout', 'stderr'] as const) {
      const text = this.buf[stream]
      if (!text) continue
      const age = now - this.tailSince[stream]
      if (age >= this.tailHoldMs) {
        this.buf[stream] = ''
        this.onFlush(stream, text)
        continue
      }
      const cut = text.lastIndexOf('\n') + 1
      if (cut > 0) {
        this.buf[stream] = text.slice(cut)
        this.onFlush(stream, text.slice(0, cut))
      }
      if (this.buf[stream]) nextTailCheck = Math.min(nextTailCheck, this.tailHoldMs - age)
    }
    if (nextTailCheck !== Infinity) this.schedule(Math.max(1, nextTailCheck))
  }
}
