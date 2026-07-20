/**
 * Batches stdout/stderr chunks so rapid subprocess output does not flood IPC/React.
 * Shared by Electron main (no path aliases) and the renderer.
 */
export class ChunkThrottle {
  private buf = { stdout: '', stderr: '' }
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly onFlush: (stream: 'stdout' | 'stderr', text: string) => void,
    private readonly intervalMs = 50,
  ) {}

  push(stream: 'stdout' | 'stderr', text: string): void {
    if (!text) return
    this.buf[stream] += text
    if (this.timer == null) {
      this.timer = setTimeout(() => this.flush(), this.intervalMs)
    }
  }

  flush(): void {
    if (this.timer != null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    for (const stream of ['stdout', 'stderr'] as const) {
      const text = this.buf[stream]
      if (!text) continue
      this.buf[stream] = ''
      this.onFlush(stream, text)
    }
  }
}
