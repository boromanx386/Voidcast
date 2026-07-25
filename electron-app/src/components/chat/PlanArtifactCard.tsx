import { useState } from 'react'
import { createPlanStep, planHasResearch, selectPlanApproach } from '@/lib/planArtifact'
import type { PlanArtifact, PlanStep } from '@/types/chat'

type Props = {
  messageId: string
  plan: PlanArtifact
  busy: boolean
  onChange: (messageId: string, plan: PlanArtifact | undefined) => void
  onApproveAndBuild: (messageId: string, plan: PlanArtifact) => void
  onReviseWithCustomNote: (messageId: string, plan: PlanArtifact, customNote: string) => void
}

function planStatusLabel(status: PlanArtifact['status']): string {
  if (status === 'built') return 'Built'
  if (status === 'approved') return 'Building'
  return 'Draft'
}

const FINDINGS_PREVIEW_MAX = 280

export function PlanArtifactCard({
  messageId,
  plan,
  busy,
  onChange,
  onApproveAndBuild,
  onReviseWithCustomNote,
}: Props) {
  const editable = plan.status === 'draft' && !busy
  const hasApproaches = Boolean(plan.approaches && plan.approaches.length > 0)
  const selectedId = plan.selectedApproachId
  const [customOpen, setCustomOpen] = useState(false)
  const [customNote, setCustomNote] = useState('')
  const [researchOpen, setResearchOpen] = useState(false)
  const showResearch = planHasResearch(plan)

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

  const submitCustom = () => {
    const note = customNote.trim()
    if (!note || busy) return
    onReviseWithCustomNote(messageId, plan, note)
    setCustomNote('')
    setCustomOpen(false)
  }

  const statusLabel = planStatusLabel(plan.status)
  const doneCount = plan.steps.filter((s) => s.done).length
  const isRetry = plan.status === 'draft' && doneCount > 0 && doneCount < plan.steps.length
  const findings = plan.research?.findings?.trim() ?? ''
  const findingsPreview =
    findings.length > FINDINGS_PREVIEW_MAX
      ? `${findings.slice(0, FINDINGS_PREVIEW_MAX).trimEnd()}…`
      : findings

  return (
    <div className="plan-artifact-card">
      <div className="plan-artifact-card__header">
        <span className="plan-artifact-card__badge">
          Plan · {statusLabel}
          {(plan.status === 'approved' || plan.status === 'built') && plan.steps.length > 0
            ? ` · ${doneCount}/${plan.steps.length}`
            : ''}
        </span>
        {plan.status === 'draft' && (
          <button
            type="button"
            className="plan-artifact-card__discard"
            disabled={busy}
            onClick={discard}
          >
            Discard
          </button>
        )}
      </div>

      {editable ? (
        <input
          type="text"
          className="cyber-input mb-2 w-full text-sm"
          value={plan.title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Plan title"
        />
      ) : (
        <h3 className="mb-2 text-sm font-medium text-void-light">{plan.title}</h3>
      )}

      {plan.summary?.trim() && (
        <p className="mb-3 text-xs leading-relaxed text-void-dim">{plan.summary}</p>
      )}

      {hasApproaches && (
        <div className="mb-3 space-y-2">
          <p className="plan-artifact-card__section-label">Approaches — pick one</p>
          <div className="grid gap-2">
            {plan.approaches!.map((a) => {
              const selected = selectedId === a.id
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={!editable}
                  onClick={() => pickApproach(a.id)}
                  className={`rounded border p-2 text-left transition-colors ${
                    selected
                      ? 'border-neon-purple/50 bg-neon-purple/10'
                      : 'border-void-muted/40 bg-void-black/40 hover:border-void-dim/60'
                  } ${!editable ? 'cursor-default opacity-90' : 'cursor-pointer'}`}
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-xs font-semibold ${
                        selected ? 'text-neon-purple' : 'text-void-text'
                      }`}
                    >
                      {a.id}
                    </span>
                    <span className="text-xs text-void-light">{a.label}</span>
                    {selected && (
                      <span className="ml-auto text-[10px] text-neon-purple">Selected</span>
                    )}
                  </div>
                  {a.summary?.trim() && (
                    <p className="mt-1 text-[11px] leading-relaxed text-void-dim">{a.summary}</p>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {showResearch && plan.research && (
        <div className="plan-artifact-card__research mb-3">
          <button
            type="button"
            className="plan-artifact-card__research-toggle"
            onClick={() => setResearchOpen((o) => !o)}
            aria-expanded={researchOpen}
          >
            <span className="plan-artifact-card__section-label">
              Research
              {plan.research.keyFiles.length ? ` · ${plan.research.keyFiles.length} files` : ''}
            </span>
            <span className="text-[10px] text-void-dim">{researchOpen ? 'Hide' : 'Show'}</span>
          </button>
          {researchOpen && (
            <div className="plan-artifact-card__research-body">
              {plan.research.keyFiles.length > 0 && (
                <p className="mb-1.5 text-[11px] leading-relaxed text-void-light">
                  <span className="text-void-dim">Key files: </span>
                  {plan.research.keyFiles.join(', ')}
                </p>
              )}
              {plan.research.searches && plan.research.searches.length > 0 && (
                <p className="mb-1.5 text-[11px] leading-relaxed text-void-dim">
                  Searches: {plan.research.searches.join(' | ')}
                </p>
              )}
              {findingsPreview && (
                <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-void-dim">
                  {findingsPreview}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <ol className="mb-3 space-y-2">
        {plan.steps.map((step: PlanStep, idx: number) => {
          const isActive =
            plan.status === 'approved' && !step.done && plan.steps.findIndex((s) => !s.done) === idx
          return (
            <li
              key={step.id}
              className={`flex items-start gap-2 ${isActive ? 'plan-step-active' : ''}`}
            >
              {plan.status === 'draft' ? (
                <span className="mt-2 w-4 shrink-0 text-[10px] text-void-dim">{idx + 1}.</span>
              ) : (
                <span
                  className={`mt-1.5 w-4 shrink-0 text-[11px] ${
                    step.done
                      ? 'text-neon-green plan-step-done-pop'
                      : isActive
                        ? 'text-neon-cyan'
                        : 'text-void-dim'
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
                    className="mt-1 text-xs text-void-dim hover:text-neon-red"
                    onClick={() => removeStep(step.id)}
                    aria-label="Remove step"
                  >
                    ×
                  </button>
                </>
              ) : (
                <span
                  className={`pt-1 text-xs leading-relaxed ${
                    step.done ? 'text-void-dim line-through' : 'text-void-light'
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
        <button type="button" className="plan-artifact-card__add-step" onClick={addStep}>
          + Add step
        </button>
      )}

      {editable && (
        <div className="mb-3 mt-1">
          {!customOpen ? (
            <button
              type="button"
              className="plan-artifact-card__custom-toggle"
              onClick={() => setCustomOpen(true)}
            >
              + Something else…
            </button>
          ) : (
            <div className="plan-artifact-card__custom">
              <p className="plan-artifact-card__section-label mb-1.5">Your approach</p>
              <textarea
                className="cyber-input mb-2 w-full resize-y text-xs"
                rows={3}
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
                placeholder="Describe what you want instead — the agent will revise the plan (not build yet)."
                disabled={busy}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="plan-artifact-card__revise"
                  disabled={busy || !customNote.trim()}
                  onClick={submitCustom}
                >
                  Revise plan
                </button>
                <button
                  type="button"
                  className="plan-artifact-card__discard"
                  disabled={busy}
                  onClick={() => {
                    setCustomOpen(false)
                    setCustomNote('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {plan.status === 'draft' && (
        <button
          type="button"
          className="plan-artifact-card__approve"
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
          {isRetry ? 'Retry build' : 'Approve & build'}
          {selectedId ? ` · ${selectedId}` : ''}
        </button>
      )}
    </div>
  )
}
