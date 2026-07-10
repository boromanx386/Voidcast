import { createPlanStep, selectPlanApproach } from '@/lib/planArtifact'
import type { PlanArtifact, PlanStep } from '@/types/chat'

type Props = {
  messageId: string
  plan: PlanArtifact
  busy: boolean
  onChange: (messageId: string, plan: PlanArtifact | undefined) => void
  onApproveAndBuild: (messageId: string, plan: PlanArtifact) => void
}

export function PlanArtifactCard({
  messageId,
  plan,
  busy,
  onChange,
  onApproveAndBuild,
}: Props) {
  const editable = plan.status === 'draft' && !busy
  const hasApproaches = Boolean(plan.approaches && plan.approaches.length > 0)
  const selectedId = plan.selectedApproachId

  const setTitle = (title: string) => {
    onChange(messageId, { ...plan, title })
  }

  const setStepText = (stepId: string, text: string) => {
    onChange(messageId, {
      ...plan,
      steps: plan.steps.map((s) => (s.id === stepId ? { ...s, text } : s)),
    })
  }

  const removeStep = (stepId: string) => {
    const next = plan.steps.filter((s) => s.id !== stepId)
    if (next.length === 0) return
    onChange(messageId, { ...plan, steps: next })
  }

  const addStep = () => {
    onChange(messageId, {
      ...plan,
      steps: [...plan.steps, createPlanStep('')],
    })
  }

  const discard = () => {
    onChange(messageId, undefined)
  }

  const pickApproach = (approachId: string) => {
    if (!editable) return
    onChange(messageId, selectPlanApproach(plan, approachId))
  }

  const statusLabel =
    plan.status === 'built' ? 'BUILT' : plan.status === 'approved' ? 'BUILDING' : 'DRAFT'

  const doneCount = plan.steps.filter((s) => s.done).length
  const isRetry = plan.status === 'draft' && doneCount > 0 && doneCount < plan.steps.length

  return (
    <div className="mt-3 border border-neon-purple/35 bg-void-black/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-neon-purple">
          ✦ Plan · {statusLabel}
          {(plan.status === 'approved' || plan.status === 'built') && plan.steps.length > 0
            ? ` · ${doneCount}/${plan.steps.length}`
            : ''}
        </span>
        {plan.status === 'draft' && (
          <button
            type="button"
            className="font-mono text-[10px] text-void-dim hover:text-neon-red"
            disabled={busy}
            onClick={discard}
          >
            DISCARD
          </button>
        )}
      </div>

      {editable ? (
        <input
          type="text"
          className="cyber-input w-full text-sm mb-2"
          value={plan.title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Plan title"
        />
      ) : (
        <h3 className="font-mono text-sm text-neon-cyan mb-2">{plan.title}</h3>
      )}

      {plan.summary?.trim() && (
        <p className="text-xs text-void-dim mb-3 leading-relaxed">{plan.summary}</p>
      )}

      {hasApproaches && (
        <div className="mb-3 space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-void-dim">
            Approaches — pick one
          </p>
          <div className="grid gap-2">
            {plan.approaches!.map((a) => {
              const selected = selectedId === a.id
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={!editable}
                  onClick={() => pickApproach(a.id)}
                  className={`text-left p-2 border transition-colors ${
                    selected
                      ? 'border-neon-purple/50 bg-neon-purple/10'
                      : 'border-void-muted/40 bg-void-black/40 hover:border-void-dim/60'
                  } ${!editable ? 'cursor-default opacity-90' : 'cursor-pointer'}`}
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`font-mono text-xs font-bold ${
                        selected ? 'text-neon-purple' : 'text-neon-cyan'
                      }`}
                    >
                      {a.id}
                    </span>
                    <span className="font-mono text-xs text-void-light">{a.label}</span>
                    {selected && (
                      <span className="ml-auto font-mono text-[9px] text-neon-purple uppercase">
                        selected
                      </span>
                    )}
                  </div>
                  {a.summary?.trim() && (
                    <p className="text-[11px] text-void-dim mt-1 leading-relaxed">{a.summary}</p>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <ol className="space-y-2 mb-3">
        {plan.steps.map((step: PlanStep, idx: number) => {
          const isActive =
            plan.status === 'approved' && !step.done && plan.steps.findIndex((s) => !s.done) === idx
          return (
          <li
            key={step.id}
            className={`flex items-start gap-2 ${isActive ? 'plan-step-active' : ''}`}
          >
            {plan.status === 'draft' ? (
              <span className="font-mono text-[10px] text-void-dim mt-2 w-4 shrink-0">
                {idx + 1}.
              </span>
            ) : (
              <span
                className={`font-mono text-[11px] mt-1.5 w-4 shrink-0 ${
                  step.done ? 'text-neon-green plan-step-done-pop' : isActive ? 'text-neon-cyan' : 'text-void-dim'
                }`}
                aria-label={step.done ? 'Done' : isActive ? 'In progress' : 'Pending'}
              >
                {step.done ? '✓' : isActive ? '▸' : '○'}
              </span>
            )}
            {editable ? (
              <>
                <input
                  type="text"
                  className="cyber-input flex-1 text-xs"
                  value={step.text}
                  onChange={(e) => setStepText(step.id, e.target.value)}
                  placeholder={`Step ${idx + 1}`}
                />
                <button
                  type="button"
                  className="font-mono text-xs text-void-dim hover:text-neon-red mt-1"
                  onClick={() => removeStep(step.id)}
                  aria-label="Remove step"
                >
                  ×
                </button>
              </>
            ) : (
              <span
                className={`text-xs leading-relaxed pt-1 ${
                  step.done
                    ? 'text-void-dim line-through'
                    : isActive
                      ? 'text-void-light'
                      : 'text-void-light'
                }`}
              >
                {step.text}
              </span>
            )}
          </li>
          )
        })}
      </ol>

      {editable && (
        <button type="button" className="cyber-btn text-[10px] mb-3" onClick={addStep}>
          + ADD STEP
        </button>
      )}

      {plan.status === 'draft' && (
        <button
          type="button"
          className="cyber-btn text-xs w-full border-neon-purple/40 text-neon-purple hover:bg-neon-purple/10"
          disabled={
            busy ||
            plan.steps.every((s) => !s.text.trim()) ||
            (hasApproaches && !selectedId)
          }
          onClick={() =>
            onApproveAndBuild(messageId, {
              ...plan,
              steps: plan.steps.filter((s) => s.text.trim()),
            })
          }
        >
          {isRetry ? 'RETRY BUILD' : 'APPROVE & BUILD'}
          {selectedId ? ` · ${selectedId}` : ''}
        </button>
      )}
    </div>
  )
}
