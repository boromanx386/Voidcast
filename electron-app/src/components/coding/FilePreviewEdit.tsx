import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildFindHighlightHtml } from '@/lib/filePreviewFindHighlight'
import {
  findAllMatchRanges,
  replaceAllInText,
  type TextRange,
} from '@/lib/filePreviewFindReplace'
import { focusTextareaMatch, revealTextareaMatch } from '@/lib/textareaFindScroll'

type Props = {
  draft: string
  busy?: boolean
  onDraftChange: (next: string) => void
  onSave: () => void
  onCancel: () => void
}

export function FilePreviewEdit({ draft, busy = false, onDraftChange, onSave, onCancel }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const pendingRevealRef = useRef<TextRange | null>(null)
  const keepFindFocusRef = useRef(false)
  const [findQuery, setFindQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [matchIndex, setMatchIndex] = useState(-1)
  const [findStatus, setFindStatus] = useState<string | null>(null)

  const matchRanges = useMemo(
    () => findAllMatchRanges(draft, findQuery, matchCase),
    [draft, findQuery, matchCase],
  )

  const activeRange =
    matchIndex >= 0 && matchIndex < matchRanges.length ? matchRanges[matchIndex] : null

  const lastRevealedIndexRef = useRef(-2)

  const highlightHtml = useMemo(
    () => buildFindHighlightHtml(draft, findQuery, matchCase, matchIndex),
    [draft, findQuery, matchCase, matchIndex],
  )

  const syncHighlightScroll = useCallback(() => {
    const ta = textareaRef.current
    const hl = highlightRef.current
    if (!ta || !hl) return
    hl.scrollTop = ta.scrollTop
    hl.scrollLeft = ta.scrollLeft
  }, [])

  const restoreFindFocus = useCallback(() => {
    if (!keepFindFocusRef.current) return
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
    })
  }, [])

  useLayoutEffect(() => {
    const pending = pendingRevealRef.current
    if (pending) {
      pendingRevealRef.current = null
      const el = textareaRef.current
      if (el) {
        if (keepFindFocusRef.current) revealTextareaMatch(el, pending)
        else focusTextareaMatch(el, pending)
      }
      syncHighlightScroll()
      restoreFindFocus()
      return
    }
    if (matchIndex < 0 || !activeRange) return
    if (matchIndex === lastRevealedIndexRef.current) return
    lastRevealedIndexRef.current = matchIndex
    const el = textareaRef.current
    if (!el) return
    if (keepFindFocusRef.current) revealTextareaMatch(el, activeRange)
    else focusTextareaMatch(el, activeRange)
    syncHighlightScroll()
    restoreFindFocus()
  }, [activeRange, matchIndex, restoreFindFocus, syncHighlightScroll])

  useLayoutEffect(() => {
    syncHighlightScroll()
  }, [highlightHtml, syncHighlightScroll])

  const goToMatch = useCallback(
    (nextIndex: number, options?: { focusCode?: boolean }) => {
      if (!findQuery.trim()) {
        setFindStatus('Enter find text')
        return
      }
      if (matchRanges.length === 0) {
        setMatchIndex(-1)
        setFindStatus('No matches')
        return
      }
      keepFindFocusRef.current = !options?.focusCode
      const wrapped =
        ((nextIndex % matchRanges.length) + matchRanges.length) % matchRanges.length
      lastRevealedIndexRef.current = -2
      setMatchIndex(wrapped)
      setFindStatus(null)
    },
    [findQuery, matchRanges],
  )

  const runFindNext = useCallback(
    (focusCode = false) => {
      if (matchRanges.length === 0) {
        setMatchIndex(-1)
        setFindStatus(findQuery.trim() ? 'No matches' : 'Enter find text')
        return
      }
      const next = matchIndex < 0 ? 0 : matchIndex + 1
      goToMatch(next, { focusCode })
    },
    [findQuery, goToMatch, matchIndex, matchRanges.length],
  )

  const runFindPrev = useCallback(
    (focusCode = false) => {
      if (matchRanges.length === 0) {
        setMatchIndex(-1)
        setFindStatus(findQuery.trim() ? 'No matches' : 'Enter find text')
        return
      }
      const prev = matchIndex < 0 ? matchRanges.length - 1 : matchIndex - 1
      goToMatch(prev, { focusCode })
    },
    [findQuery, goToMatch, matchIndex, matchRanges.length],
  )

  const runReplace = useCallback(() => {
    if (!findQuery.trim()) {
      setFindStatus('Enter find text')
      return
    }
    if (matchRanges.length === 0) {
      setFindStatus('No matches')
      return
    }
    const index = matchIndex < 0 ? 0 : matchIndex
    const range = matchRanges[index]
    if (!range) return

    const next = draft.slice(0, range.start) + replaceQuery + draft.slice(range.end)
    const cursor = range.start + replaceQuery.length
    onDraftChange(next)
    pendingRevealRef.current = { start: cursor, end: cursor }
    keepFindFocusRef.current = true
    setMatchIndex(index)
    setFindStatus(null)
  }, [draft, findQuery, matchIndex, matchRanges, onDraftChange, replaceQuery])

  const runReplaceAll = useCallback(() => {
    if (!findQuery.trim()) {
      setFindStatus('Enter find text')
      return
    }
    const { text, count } = replaceAllInText(draft, findQuery, replaceQuery, matchCase)
    if (count === 0) {
      setFindStatus('No matches')
      return
    }
    onDraftChange(text)
    setMatchIndex(-1)
    lastRevealedIndexRef.current = -2
    setFindStatus(`Replaced ${count}`)
    restoreFindFocus()
  }, [draft, findQuery, matchCase, onDraftChange, replaceQuery, restoreFindFocus])

  const findQueryKeyRef = useRef('')

  useEffect(() => {
    const key = `${findQuery}\0${matchCase ? '1' : '0'}`
    if (key === findQueryKeyRef.current) return
    findQueryKeyRef.current = key
    lastRevealedIndexRef.current = -2
    setMatchIndex(-1)
    setFindStatus(null)
  }, [findQuery, matchCase])

  useEffect(() => {
    if (matchIndex < 0) return
    if (matchRanges.length === 0) {
      setMatchIndex(-1)
      return
    }
    if (matchIndex >= matchRanges.length) {
      lastRevealedIndexRef.current = -2
      setMatchIndex(matchRanges.length - 1)
    }
  }, [matchIndex, matchRanges.length])

  useEffect(() => {
    const t = requestAnimationFrame(() => {
      window.focus()
      findInputRef.current?.focus()
    })
    return () => cancelAnimationFrame(t)
  }, [])

  const matchLabel =
    findQuery.trim() && matchRanges.length > 0 && matchIndex >= 0
      ? `${matchIndex + 1} of ${matchRanges.length}`
      : findQuery.trim()
        ? matchRanges.length === 0
          ? '0 matches'
          : `${matchRanges.length} match${matchRanges.length === 1 ? '' : 'es'} · Enter to jump`
        : 'Find & replace'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="file-preview-find-bar shrink-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={findInputRef}
            type="text"
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onFocus={() => {
              keepFindFocusRef.current = true
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (e.shiftKey) runFindPrev(false)
                else runFindNext(false)
              }
            }}
            placeholder="Find"
            className="cyber-input min-w-[5rem] flex-1 px-2 py-1 text-[11px]"
            disabled={busy}
          />
          <input
            type="text"
            value={replaceQuery}
            onChange={(e) => setReplaceQuery(e.target.value)}
            onFocus={() => {
              keepFindFocusRef.current = true
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runReplace()
              }
            }}
            placeholder="Replace"
            className="cyber-input min-w-[5rem] flex-1 px-2 py-1 text-[11px]"
            disabled={busy}
          />
          <label className="flex shrink-0 items-center gap-1 text-[10px] text-void-dim">
            <input
              type="checkbox"
              checked={matchCase}
              onChange={(e) => setMatchCase(e.target.checked)}
              disabled={busy}
            />
            Aa
          </label>
          <button
            type="button"
            className="file-preview-find-btn"
            title="Previous match (Shift+Enter in Find)"
            onClick={() => runFindPrev(false)}
            disabled={busy}
          >
            ↑
          </button>
          <button
            type="button"
            className="file-preview-find-btn"
            title="Next match (Enter in Find)"
            onClick={() => runFindNext(false)}
            disabled={busy}
          >
            ↓
          </button>
          <button
            type="button"
            className="file-preview-find-btn"
            title="Replace current match"
            onClick={runReplace}
            disabled={busy}
          >
            Repl
          </button>
          <button
            type="button"
            className="file-preview-find-btn"
            title="Replace all matches"
            onClick={runReplaceAll}
            disabled={busy}
          >
            All
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-void-dim">
          <span>{matchLabel}</span>
          {findStatus ? <span className="text-neon-yellow">{findStatus}</span> : null}
        </div>
      </div>
      <div className="file-preview-edit-stage">
        <pre
          ref={highlightRef}
          className="file-preview-edit-highlight"
          aria-hidden
          dangerouslySetInnerHTML={{ __html: highlightHtml }}
        />
        <textarea
          ref={textareaRef}
          value={draft}
          wrap="off"
          onChange={(e) => onDraftChange(e.target.value)}
          onScroll={syncHighlightScroll}
          onFocus={() => {
            keepFindFocusRef.current = false
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
              e.preventDefault()
              keepFindFocusRef.current = true
              findInputRef.current?.focus()
              findInputRef.current?.select()
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
              e.preventDefault()
              runFindNext(true)
            } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'g') {
              e.preventDefault()
              runFindPrev(true)
            } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
              e.preventDefault()
              onSave()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
          spellCheck={false}
          disabled={busy}
          className="file-preview-edit-textarea file-preview-edit-textarea--layered"
        />
      </div>
    </div>
  )
}
