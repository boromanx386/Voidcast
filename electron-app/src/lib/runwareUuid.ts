const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** RFC-4122 UUID v4. Works without `crypto.randomUUID` (plain HTTP / LAN). */
export function makeUuidV4(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** @deprecated Use `makeUuidV4` */
export const makeRunwareTaskUuid = makeUuidV4

export function isValidRunwareTaskUuid(value: string): boolean {
  return UUID_V4_RE.test(value.trim())
}

/** Ensure every task object has a valid `taskUUID` before proxy/direct Runware calls. */
export function normalizeRunwareTasks(tasks: unknown[]): unknown[] {
  return tasks.map((t) => {
    if (!t || typeof t !== 'object') return t
    const task = { ...(t as Record<string, unknown>) }
    const raw =
      typeof task.taskUUID === 'string'
        ? task.taskUUID
        : typeof task.task_uuid === 'string'
          ? task.task_uuid
          : ''
    const trimmed = raw.trim()
    task.taskUUID = isValidRunwareTaskUuid(trimmed)
      ? trimmed.toLowerCase()
      : makeUuidV4()
    delete task.task_uuid
    return task
  })
}
