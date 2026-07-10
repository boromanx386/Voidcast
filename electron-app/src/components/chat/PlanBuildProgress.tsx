import type { PlanArtifact, PlanStep } from '@/types/chat'

type Props = {
  plan: PlanArtifact
}

export function PlanBuildProgress({ plan }: Props) {
  const doneCount = plan.steps.filter((s) => s.done).length
  const activeIdx = plan.steps.findIndex((s) => !s.done)

  return (
    <div className="border border-neon-purple/45 bg-void-black/90 p-3 rounded animate-fade-in-up">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-neon-purple">
          ✦ Building plan
        </span>
        <span className="font-mono text-[10px] text-neon-cyan">
          {doneCount}/{plan.steps.length}
        </span>
      </div>
      <p className="font-mono text-xs text-neon-cyan mb-2 truncate">{plan.title}</p>
      <ol className="space-y-1.5 max-h-40 overflow-y-auto">
        {plan.steps.map((step: PlanStep, idx: number) => {
          const isActive = idx === activeIdx
          return (
            <li
              key={step.id}
              className={`flex items-start gap-2 text-xs leading-relaxed ${
                isActive ? 'plan-step-active' : ''
              }`}
            >
              <span
                className={`font-mono text-[11px] mt-0.5 w-4 shrink-0 ${
                  step.done ? 'text-neon-green plan-step-done-pop' : 'text-void-dim'
                }`}
                aria-label={step.done ? 'Done' : isActive ? 'In progress' : 'Pending'}
              >
                {step.done ? '✓' : isActive ? '▸' : '○'}
              </span>
              <span
                className={
                  step.done
                    ? 'text-void-dim line-through'
                    : isActive
                      ? 'text-void-light'
                      : 'text-void-dim'
                }
              >
                {step.text}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
