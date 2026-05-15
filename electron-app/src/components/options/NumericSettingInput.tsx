import { useCallback, useEffect, useRef, useState } from 'react'

type Props = {
  value: number
  onCommit: (value: number) => void
  min?: number
  max?: number
  /** When true, rounds on commit (default: true if step is a whole number ≥ 1). */
  integer?: boolean
  className?: string
  disabled?: boolean
  placeholder?: string
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function formatDisplay(n: number, integer: boolean) {
  return integer ? String(Math.round(n)) : String(n)
}

/** Allows free typing; clamps to min/max only on blur or Enter. No `type="number"` (mobile-friendly). */
export function NumericSettingInput({
  value,
  onCommit,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  integer: integerProp,
  className = 'cyber-input',
  disabled,
  placeholder,
}: Props) {
  const integer = integerProp ?? true
  const [draft, setDraft] = useState(() => formatDisplay(value, integer))
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(formatDisplay(value, integer))
    }
  }, [value, integer])

  const commit = useCallback(
    (raw: string) => {
      const t = raw.trim().replace(',', '.')
      if (t === '' || t === '-' || t === '.' || t === '-.') {
        setDraft(formatDisplay(value, integer))
        return
      }
      let n = Number(t)
      if (!Number.isFinite(n)) {
        setDraft(formatDisplay(value, integer))
        return
      }
      if (integer) n = Math.round(n)
      n = clamp(n, min, max)
      const display = formatDisplay(n, integer)
      setDraft(display)
      if (n !== value) onCommit(n)
    },
    [value, onCommit, min, max, integer],
  )

  return (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      autoComplete="off"
      spellCheck={false}
      enterKeyHint="done"
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      value={draft}
      onFocus={() => {
        focusedRef.current = true
      }}
      onBlur={(e) => {
        focusedRef.current = false
        commit(e.target.value)
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          setDraft(formatDisplay(value, integer))
          e.currentTarget.blur()
        }
      }}
    />
  )
}
