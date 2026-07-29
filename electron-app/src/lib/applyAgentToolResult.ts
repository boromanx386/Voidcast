import type { Dispatch, SetStateAction } from 'react'
import { uid } from '@/lib/chatUid'
import { dedupeNonEmpty } from '@/lib/chatHints'
import {
  commandResultSnippet,
  getCodingProjectPath,
  isCodingToolFailure,
  normalizeCodingContextMemo,
  pushRecentCommand,
  pushRecentUnique,
  type CodingContextMemo,
  type CodingFileCache,
  upsertCodingFileCache,
  invalidateCodingFileCache,
} from '@/lib/codingContextMemo'
import { consumeLastExecuteCommandStreamed } from '@/lib/codingCommandStream'
import { codingRevealPathFromToolResult } from '@/lib/codingReveal'
import { formatEditedFileMemoEntry } from '@/lib/codingEol'
import { MAX_TERMINAL_ROWS } from '@/lib/terminalChunks'
import { toolPhaseForAgentTool } from '@/lib/agentToolPhase'
import { invokeSaveImageFromUrl, dataUrlToBlobUrl, isDataImageUrl, resolveGeneratedImageOutputDir } from '@/lib/saveImage'
import { invokeSaveAudioFromUrl } from '@/lib/saveAudio'
import { loadSettings, type AppSettings } from '@/lib/settings'
import { scheduleUserDataSync } from '@/lib/userDataSync'
import {
  extractRunwareAudioUrls,
  extractRunwareImageUrls,
  extractSavedAudioPaths,
  extractSavedImagePaths,
  parseRunwareAudioToolMeta,
  parseRunwareImageToolMeta,
  type RunwareAudioToolMeta,
  type RunwareImageToolMeta,
} from '@/lib/runwareMessageMeta'
import type { UiMessage } from '@/types/chat'
import type { TerminalLine } from '@/types/coding'
import { isElectron } from '@/lib/platform'

export type AgentToolResultHandlerDeps = {
  asstId: string
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  setToolPhase: (phase: ReturnType<typeof toolPhaseForAgentTool>) => void
  refreshReminders: () => void | Promise<void>
  refreshLongMemories: () => void | Promise<void>
  setCodingContextMemo: Dispatch<SetStateAction<CodingContextMemo>>
  /** Mutable ref for the per-turn working-set file cache, updated on read/write/edit. */
  codingFileCacheRef: React.MutableRefObject<CodingFileCache>
  setCodingTerminalFeed: Dispatch<SetStateAction<TerminalLine[]>>
  setCodingFileTreeNonce: Dispatch<SetStateAction<number>>
  setCodingGitNonce: Dispatch<SetStateAction<number>>
  /** Open coding panel + focus a project-relative path after write/edit. */
  revealCodingFile?: (path: string) => void
  setToolResultBanner: Dispatch<SetStateAction<{ kind: 'pdf'; text: string } | null>>
  setMessages: Dispatch<SetStateAction<UiMessage[]>>
  setAssistantGeneratedImages: Dispatch<SetStateAction<Record<string, string[]>>>
  setAssistantSavedImagePaths: Dispatch<SetStateAction<Record<string, string[]>>>
  setAssistantImageToolMeta: Dispatch<
    SetStateAction<Record<string, Record<string, RunwareImageToolMeta>>>
  >
  setAssistantImageMessageMeta: Dispatch<SetStateAction<Record<string, RunwareImageToolMeta>>>
  setAssistantGeneratedAudios: Dispatch<SetStateAction<Record<string, string[]>>>
  setAssistantSavedAudioPaths: Dispatch<SetStateAction<Record<string, string[]>>>
  setAssistantAudioToolMeta: Dispatch<
    SetStateAction<Record<string, Record<string, RunwareAudioToolMeta>>>
  >
  setAssistantAudioMessageMeta: Dispatch<SetStateAction<Record<string, RunwareAudioToolMeta>>>
}

export type AgentToolResultPayload = {
  name: string
  result: string
  args?: Record<string, unknown>
}

export function applyAgentToolResult(
  deps: AgentToolResultHandlerDeps,
  payload: AgentToolResultPayload,
): void {
  const {
    asstId,
    settings,
    setSettings,
    setToolPhase,
    refreshReminders,
    refreshLongMemories,
    setCodingContextMemo,
    codingFileCacheRef,
    setCodingTerminalFeed,
    setCodingFileTreeNonce,
    setCodingGitNonce,
    revealCodingFile,
    setToolResultBanner,
    setMessages,
    setAssistantGeneratedImages,
    setAssistantSavedImagePaths,
    setAssistantImageToolMeta,
    setAssistantImageMessageMeta,
    setAssistantGeneratedAudios,
    setAssistantSavedAudioPaths,
    setAssistantAudioToolMeta,
    setAssistantAudioMessageMeta,
  } = deps

  const { name, result, args } = payload

  setToolPhase(toolPhaseForAgentTool(name))

  if (
    name === 'add_reminder' ||
    name === 'list_reminders' ||
    name === 'delete_reminder' ||
    name === 'update_reminder'
  ) {
    void refreshReminders()
    scheduleUserDataSync(settings.ttsBaseUrl)
  }
  if (name === 'update_settings') {
    setSettings(loadSettings())
    void refreshLongMemories()
    scheduleUserDataSync(settings.ttsBaseUrl)
  }
  if (
    name === 'list_directory' ||
    name === 'read_file' ||
    name === 'write_file' ||
    name === 'edit_code' ||
    name === 'search_files' ||
    name === 'glob_files' ||
    name === 'find_symbols' ||
    name === 'git_status' ||
    name === 'git_diff' ||
    name === 'git_log' ||
    name === 'git_show' ||
    name === 'execute_command' ||
    name === 'coding_explore'
  ) {
    setCodingContextMemo((prev) => {
      const next = { ...prev }
      if (name === 'list_directory') {
        const p = typeof args?.path === 'string' ? args.path : ''
        next.lastDirectory = p || '.'
      } else if (name === 'glob_files') {
        const p = typeof args?.path_prefix === 'string' ? args.path_prefix : ''
        if (p) next.lastDirectory = p
      } else if (name === 'coding_explore') {
        const goal = typeof args?.goal === 'string' ? args.goal.trim() : ''
        if (goal) next.recentSearches = pushRecentUnique(next.recentSearches, `explore:${goal}`, 8)
        const p = typeof args?.path_prefix === 'string' ? args.path_prefix.trim() : ''
        if (p) next.lastDirectory = p
      } else if (name === 'read_file' || name === 'write_file' || name === 'edit_code') {
        const p = typeof args?.path === 'string' ? args.path : ''
        let entry = p
        if (name === 'read_file' && entry) {
          const s = typeof args?.start_line === 'number' ? args.start_line : undefined
          const e = typeof args?.end_line === 'number' ? args.end_line : undefined
          if (s !== undefined && e !== undefined) entry = `${entry} (lines ${s}-${e})`
          else if (s !== undefined) entry = `${entry} (from line ${s})`
          else if (e !== undefined) entry = `${entry} (to line ${e})`
        } else if (name === 'edit_code' && entry) {
          entry = formatEditedFileMemoEntry(entry, result)
        } else if (name === 'write_file' && entry) {
          entry = `${entry} (written)`
        }
        if (entry) next.recentFiles = pushRecentUnique(next.recentFiles, entry)
      } else if (name === 'search_files') {
        const q = typeof args?.query === 'string' ? args.query : ''
        next.recentSearches = pushRecentUnique(next.recentSearches, q, 6)
      } else if (
        name === 'git_status' ||
        name === 'git_diff' ||
        name === 'git_log' ||
        name === 'git_show'
      ) {
        let label = name
        if (name === 'git_log') {
          const p = typeof args?.path === 'string' ? args.path : ''
          label = p ? `git_log -- ${p}` : 'git_log'
        } else if (name === 'git_show') {
          const ref = typeof args?.ref === 'string' ? args.ref : ''
          const p = typeof args?.path === 'string' ? args.path : ''
          label = p ? `git_show ${ref || 'HEAD'} -- ${p}` : `git_show ${ref || 'HEAD'}`
        } else if (name === 'git_diff') {
          const p = typeof args?.path === 'string' ? args.path : ''
          const staged = args?.staged === true
          label = p
            ? `git_diff${staged ? ' --staged' : ''} -- ${p}`
            : `git_diff${staged ? ' --staged' : ''}`
        }
        next.recentGitOps = pushRecentUnique(next.recentGitOps, label, 6)
      } else if (name === 'execute_command') {
        const c = typeof args?.command === 'string' ? args.command : ''
        const ok = !isCodingToolFailure('execute_command', result)
        next.recentCommands = pushRecentCommand(
          next.recentCommands,
          { command: c, ok, snippet: commandResultSnippet(result) },
          6,
        )
      }

      if (isCodingToolFailure(name, result)) {
        let failureLabel = name
        if (name === 'edit_code' || name === 'read_file' || name === 'write_file') {
          const p = typeof args?.path === 'string' ? args.path : ''
          if (p) failureLabel = `${name} (${p})`
        } else if (name === 'execute_command') {
          const c = typeof args?.command === 'string' ? args.command : ''
          if (c) failureLabel = `${name}: ${c.split(' ')[0]}`
        }
        const failureEntry = `${failureLabel}: ${result.slice(0, 120)}`
        next.recentFailures = pushRecentUnique(next.recentFailures, failureEntry, 6)
      }

      return normalizeCodingContextMemo(next, getCodingProjectPath(settings))
    })

    // Update per-turn file cache for working-set reuse.
    const filePath = typeof args?.path === 'string' ? args.path.trim() : ''
    if (name === 'read_file' && filePath && !isCodingToolFailure('read_file', result)) {
      // Strip line-number prefix for clean cache content (single-read result only).
      const lines = result.split('\n')
      const cleanLines: string[] = []
      for (const l of lines) {
        const m = l.match(/^\s*\d+\|\s?(.*)$/)
        cleanLines.push(m ? m[1] : l)
      }
      codingFileCacheRef.current = upsertCodingFileCache(
        codingFileCacheRef.current,
        filePath,
        cleanLines.join('\n'),
      )
    } else if (name === 'write_file' && filePath && !isCodingToolFailure('write_file', result)) {
      const content = typeof args?.content === 'string' ? args.content : ''
      if (content) {
        codingFileCacheRef.current = upsertCodingFileCache(
          codingFileCacheRef.current,
          filePath,
          content,
        )
      }
    } else if (name === 'edit_code' && filePath && !isCodingToolFailure('edit_code', result)) {
      // Content changed; invalidate so next read_file freshens the cache.
      codingFileCacheRef.current = invalidateCodingFileCache(
        codingFileCacheRef.current,
        filePath,
      )
    }
  }

  if (name === 'execute_command') {
    // Foreground runs already streamed `$ cmd` + chunks via IPC; skip duplicate dump.
    if (!consumeLastExecuteCommandStreamed()) {
      const cmd = typeof args?.command === 'string' ? args.command : ''
      const raw = String(result ?? '').trimEnd()
      const MAX = 120_000
      const body =
        raw.length > MAX
          ? `${raw.slice(0, MAX)}\n\n… [truncated ${(raw.length - MAX).toLocaleString()} chars]`
          : raw
      const ts = Date.now()
      const idBase = uid()
      setCodingTerminalFeed((prev) =>
        [
          ...prev,
          {
            id: `exec-cmd-${idBase}`,
            stream: 'system' as const,
            text: `$ ${cmd || '(empty command)'}`,
            ts,
          },
          ...(body
            ? ([
                {
                  id: `exec-out-${idBase}`,
                  stream: 'stdout' as const,
                  text: body,
                  ts,
                },
              ] as const)
            : []),
        ].slice(-MAX_TERMINAL_ROWS),
      )
    }
  }
  if (name === 'write_file' || name === 'edit_code' || name === 'execute_command') {
    setCodingFileTreeNonce((n) => n + 1)
    setCodingGitNonce((n) => n + 1)
  }
  const revealPath = codingRevealPathFromToolResult(name, result, args)
  if (revealPath && revealCodingFile) {
    revealCodingFile(revealPath)
  }
  if (
    name === 'git_status' ||
    name === 'git_diff' ||
    name === 'git_log' ||
    name === 'git_show'
  ) {
    setCodingGitNonce((n) => n + 1)
  }
  if (name === 'save_pdf') {
    setToolResultBanner({ kind: 'pdf', text: result })
  }
  if (name === 'generate_image' || name === 'edit_image_runware') {
    const urls = extractRunwareImageUrls(result)
    const meta = parseRunwareImageToolMeta(result)
    if (meta) {
      setAssistantImageMessageMeta((prev) => ({ ...prev, [asstId]: meta }))
    }
    const remoteUrls = urls.filter((u) => !isDataImageUrl(u))
    const dataUrls = urls.filter((u) => isDataImageUrl(u))

    const attachRemoteUrls = (httpUrls: string[]) => {
      if (httpUrls.length === 0) return
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== asstId) return m
          return {
            ...m,
            generatedImageUrls: dedupeNonEmpty([...(m.generatedImageUrls || []), ...httpUrls]),
          }
        }),
      )
      setAssistantGeneratedImages((prev) => {
        const cur = prev[asstId] || []
        const next = Array.from(new Set([...cur, ...httpUrls]))
        return { ...prev, [asstId]: next }
      })
      if (meta) {
        setAssistantImageToolMeta((prev) => {
          const cur = prev[asstId] || {}
          const next = { ...cur }
          for (const u of httpUrls) next[u] = meta
          return { ...prev, [asstId]: next }
        })
      }
    }

    const attachSavedPaths = (savedPaths: string[]) => {
      if (savedPaths.length === 0) return
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== asstId) return m
          return {
            ...m,
            generatedImagePaths: dedupeNonEmpty([
              ...(m.generatedImagePaths || []),
              ...savedPaths,
            ]),
          }
        }),
      )
      setAssistantSavedImagePaths((prev) => {
        const cur = prev[asstId] || []
        const next = Array.from(new Set([...cur, ...savedPaths]))
        return { ...prev, [asstId]: next }
      })
      if (meta) {
        setAssistantImageToolMeta((prev) => {
          const cur = prev[asstId] || {}
          const next = { ...cur }
          for (const p of savedPaths) next[p] = meta
          return { ...prev, [asstId]: next }
        })
      }
    }

    attachRemoteUrls(remoteUrls)

    if (dataUrls.length > 0 || (remoteUrls.length > 0 && settings.runwareAutoSaveImages && settings.runwareImageOutputDir.trim())) {
      void (async () => {
        const saved: string[] = []
        const outputDir = resolveGeneratedImageOutputDir(settings)

        for (const u of dataUrls) {
          if (isElectron()) {
            const txt = await invokeSaveImageFromUrl({
              imageUrl: u,
              outputDir,
            }).catch((e) => (e instanceof Error ? e.message : String(e)))
            saved.push(txt)
          }
        }

        if (settings.runwareAutoSaveImages && settings.runwareImageOutputDir.trim()) {
          for (const u of remoteUrls) {
            const txt = await invokeSaveImageFromUrl({
              imageUrl: u,
              outputDir: settings.runwareImageOutputDir,
            }).catch((e) => (e instanceof Error ? e.message : String(e)))
            saved.push(txt)
          }
        }

        const savedPaths = extractSavedImagePaths(saved.join('\n'))
        attachSavedPaths(savedPaths)

        if (!isElectron() && dataUrls.length > 0) {
          const blobUrls: string[] = []
          for (const u of dataUrls) {
            try {
              blobUrls.push(dataUrlToBlobUrl(u))
            } catch {
              /* ignore invalid data URLs */
            }
          }
          attachRemoteUrls(blobUrls)
        }
      })()
    }
  }
  if (name === 'generate_music_runware') {
    const urls = extractRunwareAudioUrls(result)
    const meta = parseRunwareAudioToolMeta(result)
    if (meta) {
      setAssistantAudioMessageMeta((prev) => ({ ...prev, [asstId]: meta }))
    }
    if (urls.length > 0) {
      setAssistantGeneratedAudios((prev) => {
        const cur = prev[asstId] || []
        const next = Array.from(new Set([...cur, ...urls]))
        return { ...prev, [asstId]: next }
      })
      if (meta) {
        setAssistantAudioToolMeta((prev) => {
          const cur = prev[asstId] || {}
          const next = { ...cur }
          for (const u of urls) next[u] = meta
          return { ...prev, [asstId]: next }
        })
      }
    }
    if (urls.length > 0 && settings.runwareAutoSaveMusic && settings.runwareMusicOutputDir.trim()) {
      void (async () => {
        const saved: string[] = []
        for (const u of urls) {
          const txt = await invokeSaveAudioFromUrl({
            audioUrl: u,
            outputDir: settings.runwareMusicOutputDir,
          }).catch((e) => (e instanceof Error ? e.message : String(e)))
          saved.push(txt)
        }
        if (saved.length > 0) {
          const savedPaths = extractSavedAudioPaths(saved.join('\n'))
          if (savedPaths.length > 0) {
            setAssistantSavedAudioPaths((prev) => {
              const cur = prev[asstId] || []
              const next = Array.from(new Set([...cur, ...savedPaths]))
              return { ...prev, [asstId]: next }
            })
          }
        }
      })()
    }
  }
}
