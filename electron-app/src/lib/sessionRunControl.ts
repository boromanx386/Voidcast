import { cancelActiveMcpCalls } from '@/lib/mcpTools'
import { reopenPlanAsDraft } from '@/lib/planArtifact'
import { sessionAgentStore } from '@/lib/sessionAgentStore'

/**
 * Stop a chat's live run: abort it, cancel its in-flight MCP calls and reopen
 * any plan that was mid-build. Shared by the composer Stop button and the local
 * control API so both behave identically.
 */
export function stopSessionRun(key: string): void {
  const owner = sessionAgentStore.canonicalKey(key)
  sessionAgentStore.stop(key)
  void cancelActiveMcpCalls(owner)
  sessionAgentStore.setMessages(key, (prev) =>
    prev.map((m) =>
      m.plan?.status === 'approved' ? { ...m, plan: reopenPlanAsDraft(m.plan) } : m,
    ),
  )
}
