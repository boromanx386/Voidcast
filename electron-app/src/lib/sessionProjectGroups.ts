import { normalizeMcpProjectPath } from '@/lib/mcpProjectTrust'

export const GENERAL_SESSION_GROUP_KEY = '__general__'

export type SessionProjectRef = {
  id: string
  updatedAt: number
  codingProjectPath?: string
  codingContextMemo?: { projectPath?: string }
}

export type SessionProjectGroup<T extends SessionProjectRef> = {
  /** Normalized path key, or GENERAL_SESSION_GROUP_KEY. */
  key: string
  /** Display label (folder basename or "General"). */
  label: string
  /** Original path for tooltip; empty for General. */
  path: string
  sessions: T[]
  latestUpdatedAt: number
}

/** Path bound on the session (no settings fallback). Empty = General chat. */
export function sessionBoundProjectPath(session: SessionProjectRef | undefined): string {
  const fromSession = (session?.codingProjectPath ?? '').trim()
  if (fromSession) return fromSession
  // Legacy sessions may only have memo.projectPath
  return (session?.codingContextMemo?.projectPath ?? '').trim()
}

export function projectPathGroupKey(projectPath: string): string {
  const normalized = normalizeMcpProjectPath(projectPath)
  return normalized || GENERAL_SESSION_GROUP_KEY
}

/** Last path segment for sidebar headers; full path stays in tooltip. */
export function projectPathDisplayLabel(projectPath: string): string {
  const trimmed = projectPath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!trimmed) return 'General'
  const parts = trimmed.split('/').filter(Boolean)
  return parts[parts.length - 1] || trimmed
}

/**
 * Group sessions by bound project path.
 * General (no path) first; then projects by most-recent activity.
 * Within each group: updatedAt desc.
 */
export function groupSessionsByProject<T extends SessionProjectRef>(
  sessions: T[],
): SessionProjectGroup<T>[] {
  const map = new Map<string, SessionProjectGroup<T>>()

  for (const session of sessions) {
    const path = sessionBoundProjectPath(session)
    const key = projectPathGroupKey(path)
    const existing = map.get(key)
    if (existing) {
      existing.sessions.push(session)
      if (session.updatedAt > existing.latestUpdatedAt) {
        existing.latestUpdatedAt = session.updatedAt
      }
    } else {
      map.set(key, {
        key,
        label: projectPathDisplayLabel(path),
        path,
        sessions: [session],
        latestUpdatedAt: session.updatedAt,
      })
    }
  }

  for (const group of map.values()) {
    group.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  const groups = Array.from(map.values())
  groups.sort((a, b) => {
    if (a.key === GENERAL_SESSION_GROUP_KEY) return -1
    if (b.key === GENERAL_SESSION_GROUP_KEY) return 1
    return b.latestUpdatedAt - a.latestUpdatedAt
  })
  return groups
}
