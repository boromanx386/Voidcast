import { invokeWriteCodingFile } from '@/lib/codingTools'
import { formatPlanMarkdown, PLAN_FILES_DIR } from '@/lib/planArtifact'
import type { PlanArtifact } from '@/types/chat'

const PLAN_FILE_WRITE_DEBOUNCE_MS = 400

const pending = new Map<string, ReturnType<typeof setTimeout>>()
const lastWritten = new Map<string, string>()
const ignoredProjects = new Set<string>()

/** Plans are per-machine working notes: keep them out of the project's git status. */
async function ensurePlanDirIgnored(projectPath: string): Promise<void> {
  if (ignoredProjects.has(projectPath)) return
  const res = await invokeWriteCodingFile(projectPath, `${PLAN_FILES_DIR}/.gitignore`, '*\n')
  if (res.ok) ignoredProjects.add(projectPath)
}

/**
 * Mirror a plan into its markdown file. Debounced per file so card typing and bursts of
 * update_plan_progress collapse into one write; safe to call from state updaters because
 * the last call for a path always wins.
 */
export function schedulePlanFileWrite(plan: PlanArtifact | undefined): void {
  const file = plan?.file
  if (!plan || !file) return
  const key = `${file.projectPath}\u0000${file.path}`
  const content = formatPlanMarkdown(plan)
  const prev = pending.get(key)
  if (prev) clearTimeout(prev)
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key)
      if (lastWritten.get(key) === content) return
      void ensurePlanDirIgnored(file.projectPath)
        .then(() => invokeWriteCodingFile(file.projectPath, file.path, content))
        .then((res) => {
          if (res.ok) lastWritten.set(key, content)
          else console.warn(`[plan-file] ${file.path}: ${res.text}`)
        })
    }, PLAN_FILE_WRITE_DEBOUNCE_MS),
  )
}
