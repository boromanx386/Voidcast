import type { PlanArtifact, PlanStep } from '@/types/chat'

type Props = {
  plan: PlanArtifact
}

export function PlanBuildProgress({ plan }: Props) {
  const doneCount = plan.steps.filter((s) => s.done).length
  const activeIdx = plan.steps.findIndex((s) => !s.done)

  return (
    <div className="plan-build-progress">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="plan-build-progress__title">Building plan</span>
        <span className="text-[11px] font-medium tabular-nums text-void-dim">
          {doneCount}/{plan.steps.length}
        </span>
      </div>
      <p className="mb-2 truncate text-sm font-medium text-void-light">{plan.title}</p>
      <ol className="max-h-40 space-y-1.5 overflow-y-auto">
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
                className={`mt-0.5 w-4 shrink-0 text-[11px] ${
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
