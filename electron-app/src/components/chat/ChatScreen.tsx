import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type UIEvent as ReactUIEvent,
} from 'react'
import { ChatMarkdown } from '@/components/ChatMarkdown'
import { CodingPanel } from '@/components/CodingPanel'
import { BrainIcon } from '@/components/icons/BrainIcon'
import { CodeIcon } from '@/components/icons/CodeIcon'
import { RobotIcon } from '@/components/icons/RobotIcon'
import {
  AmbientParticles,
  CrtOverlay,
  GlitchText,
  ToolIndicator,
} from '@/components/chat/ChatChrome'
import { SessionItem } from '@/components/chat/SessionItem'
import { dedupeNonEmpty, isToday } from '@/lib/chatHints'
import { CHAT_IMAGE_ACCEPT, imageDataUrl } from '@/lib/imageAttachment'
import { chatFileAcceptList } from '@/lib/fileAttachment'
import { isElectron, isWebStandalone } from '@/lib/platform'
import {
  extractMarkdownImageUrls,
  parseRunwareAudioToolMeta,
  parseRunwareImageToolMeta,
  stripGeneratedAudioLinkArtifacts,
  stripGeneratedImageLinkArtifacts,
  stripRunwareAudioUrlLines,
} from '@/lib/runwareMessageMeta'
import type { LongMemoryCandidate } from '@/types/longMemory'
import type { VoidcastApp } from '@/hooks/useVoidcastApp'

type LocalImagePreview = {
  base64: string
  mime: string
}

const EMPTY_STATE_VARIANTS = {
  dystopian: [
    'NEURAL INTERFACE READY. AWAITING INPUT.',
    'SYSTEM LINK STABLE. ENTER COMMAND.',
    'CHANNEL OPEN. FEED PROMPT TO CONTINUE.',
  ],
  minimal: [
    'Chat is ready. Type your first message.',
    'New session started. Ask anything.',
    'All set. Enter a prompt to continue.',
  ],
  matrix: [
    'Terminal link established. Awaiting input.',
    'Greenline channel open. Enter your prompt.',
    'System ready. Type to continue.',
  ],
  light: [
    'Workspace ready. Start with a prompt.',
    'You are all set. Ask anything.',
    'Session is ready. Type to continue.',
  ],
  'blood-moon': [
    'The void is listening. Feed it a prompt.',
    'Crimson channel open. Transmit when ready.',
    'Blood moon rising. Await your command.',
  ],
  obsidian: [
    'The archive is silent. Enter your query.',
    'Channel stable. Transmit when ready.',
    'Obsidian surface awaits your mark.',
  ],
} as const

type Props = { app: VoidcastApp }

export function ChatScreen({ app }: Props) {
  const {
    settings,
    setSettings,
    appVersion,
    menuOpen,
    setMenuOpen,
    input,
    setInput,
    messages,
    busy,
    error,
    setError,
    toolPhase,
    contextUsageInfo,
    setContextUsageInfo,
    contextWarnDismissed,
    setContextWarnDismissed,
    contextCompressBusy,
    subAgentPanelOpen,
    setSubAgentPanelOpen,
    subAgentPanelBusy,
    setSubAgentPanelBusy,
    subAgentPanelText,
    setSubAgentPanelText,
    longMemoryBusy,
    memoryCandidates,
    memoryPreviewOpen,
    setMemoryPreviewOpen,
    setMemoryCandidates,
    extractLongMemoryNow,
    confirmSaveLongMemory,
    sessions,
    activeSessionId,
    sidebarCollapsed,
    setSidebarCollapsed,
    pendingDeleteId,
    setPendingDeleteId,
    renamingSessionId,
    renameValue,
    setRenameValue,
    canSaveSession,
    saveOrUpdateSession,
    newChat,
    openSession,
    forkSession,
    exportSessionToMarkdown,
    deleteSession,
    startRenameSession,
    cancelRenameSession,
    commitRenameSession,
    openOptions,
    onSend,
    onStop,
    onRead,
    startEdit,
    cancelEdit,
    commitEdit,
    editingMessageId,
    editInputValue,
    setEditInputValue,
    summarizeContextNow,
    toolResultBanner,
    setToolResultBanner,
    assistantGeneratedImages,
    assistantSavedImagePaths,
    assistantImageToolMeta,
    assistantImageMessageMeta,
    assistantGeneratedAudios,
    assistantSavedAudioPaths,
    assistantAudioToolMeta,
    assistantAudioMessageMeta,
    playingId,
    ttsOk,
    abortTts,
    showCodingPanel,
    setShowCodingPanel,
    codingPanelAvailable,
    codingFileTreeNonce,
    codingTerminalFeed,
    applyCodingProjectPath,
    pendingImages,
    pendingFiles,
    isDragOver,
    chatAttachmentInputRef,
    onChatDragEnter,
    onChatDragOver,
    onChatDragLeave,
    onChatDrop,
    onPickChatAttachments,
    openChatAttachmentPicker,
    removePendingImage,
    removePendingFile,
    isRecording,
    sttPending,
    recordingDuration,
    recorderRef,
    recordingTimerRef,
    toggleSttRecording,
    audioRef,
  } = app

  const listEndRef = useRef<HTMLDivElement | null>(null)
  const chatMessagesRef = useRef<HTMLElement | null>(null)
  const savedChatScrollRef = useRef(0)
  const thinkingScrollRef = useRef<HTMLDivElement | null>(null)
  const [thinkingPinned, setThinkingPinned] = useState(true)
  const [localImagePreviews, setLocalImagePreviews] = useState<Record<string, LocalImagePreview>>({})
  const localPreviewLoadingRef = useRef<Set<string>>(new Set())
  const [emptyStateSeed] = useState(() => Math.floor(Math.random() * 1_000_000))

  const downloadImage = useCallback(async (url: string) => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`)
      const blob = await res.blob()
      const objUrl = URL.createObjectURL(blob)
      const fileFromUrl = (() => {
        try {
          const p = new URL(url).pathname.split('/').pop() || ''
          return p.trim()
        } catch {
          return ''
        }
      })()
      const safeName = fileFromUrl || `runware-${Date.now()}.jpg`
      const a = document.createElement('a')
      a.href = objUrl
      a.download = safeName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [setError])

  const openLocalImage = useCallback(async (filePath: string) => {
    try {
      const vc = window.voidcast?.openPath
      if (!vc) throw new Error('Open image is available only in Electron app.')
      const r: unknown = await vc(filePath)
      if (typeof r === 'string') return
      const obj = r as { ok?: boolean; text?: string }
      if (obj.ok === false) throw new Error(obj.text || 'Failed to open image.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [setError])

  const onChatScroll = useCallback((e: ReactUIEvent<HTMLElement>) => {
    savedChatScrollRef.current = e.currentTarget.scrollTop
  }, [])

  const uiDystopian = settings.uiTheme === 'dystopian'
  const canSend = useMemo(
    () => (!!input.trim() || pendingImages.length > 0 || pendingFiles.length > 0) && !busy,
    [input, pendingImages.length, pendingFiles.length, busy],
  )
  const canStop = busy
  const todaySessions = useMemo(() => sessions.filter((s) => isToday(s.updatedAt)), [sessions])
  const olderSessions = useMemo(() => sessions.filter((s) => !isToday(s.updatedAt)), [sessions])
  const desktopRuntime = isElectron()

  const emptyStateMessage = useMemo(() => {
    const variants =
      settings.uiTheme === 'dystopian'
        ? EMPTY_STATE_VARIANTS.dystopian
        : settings.uiTheme === 'matrix'
          ? EMPTY_STATE_VARIANTS.matrix
          : settings.uiTheme === 'light'
            ? EMPTY_STATE_VARIANTS.light
            : settings.uiTheme === 'blood-moon'
              ? EMPTY_STATE_VARIANTS['blood-moon']
              : settings.uiTheme === 'obsidian'
                ? EMPTY_STATE_VARIANTS.obsidian
                : EMPTY_STATE_VARIANTS.minimal
    return variants[emptyStateSeed % variants.length]
  }, [settings.uiTheme, emptyStateSeed])

  const assistantRenderCache = useMemo(() => {
    const out: Record<
      string,
      {
        markdownContent: string
        inlineImageUrls: string[]
        localImagePaths: string[]
      }
    > = {}
    for (const m of messages) {
      if (m.role !== 'assistant') continue
      const trustedImageUrls = dedupeNonEmpty([
        ...(m.generatedImageUrls || []),
        ...(assistantGeneratedImages[m.id] || []),
      ])
      const trustedAudioUrls = dedupeNonEmpty([...(assistantGeneratedAudios[m.id] || [])])
      const markdownContent = desktopRuntime
        ? stripGeneratedAudioLinkArtifacts(
            stripGeneratedImageLinkArtifacts(m.content, trustedImageUrls),
            trustedAudioUrls,
          )
        : stripGeneratedAudioLinkArtifacts(
            stripGeneratedImageLinkArtifacts(
              stripRunwareAudioUrlLines(m.content),
              trustedImageUrls,
            ),
            trustedAudioUrls,
          )
      const markdownImageUrls = new Set(extractMarkdownImageUrls(m.content))
      const inlineImageUrls = trustedImageUrls.filter((u) => !markdownImageUrls.has(u))
      const localImagePaths = desktopRuntime
        ? dedupeNonEmpty([
            ...(m.generatedImagePaths || []),
            ...(assistantSavedImagePaths[m.id] || []),
          ])
        : []
      out[m.id] = { markdownContent, inlineImageUrls, localImagePaths }
    }
    return out
  }, [
    messages,
    assistantGeneratedImages,
    assistantGeneratedAudios,
    assistantSavedImagePaths,
    desktopRuntime,
  ])

  useEffect(() => {
    const readImageFile = window.voidcast?.readImageFile
    if (!desktopRuntime || !readImageFile) return
    const candidates = new Set<string>()
    for (const msg of messages) {
      if (msg.role !== 'assistant' || !msg.generatedImagePaths?.length) continue
      for (const p of msg.generatedImagePaths) {
        const path = (p || '').trim()
        if (path) candidates.add(path)
      }
    }
    for (const p of candidates) {
      if (localImagePreviews[p] || localPreviewLoadingRef.current.has(p)) continue
      localPreviewLoadingRef.current.add(p)
      void readImageFile({ path: p })
        .then((res) => {
          if (!res.ok || !res.file?.base64?.trim()) return
          setLocalImagePreviews((prev) => ({
            ...prev,
            [p]: {
              base64: res.file.base64.replace(/\s+/g, ''),
              mime: (res.file.mime || 'image/png').trim() || 'image/png',
            },
          }))
        })
        .finally(() => {
          localPreviewLoadingRef.current.delete(p)
        })
    }
  }, [desktopRuntime, localImagePreviews, messages])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    if (!busy) {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [busy])

  useEffect(() => {
    if (thinkingPinned && thinkingScrollRef.current) {
      thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight
    }
  }, [messages, thinkingPinned])

  return (
    <div
      className={`voidcast-app${uiDystopian ? ' grid-bg' : ''}`}
      onDragEnter={onChatDragEnter}
      onDragOver={onChatDragOver}
      onDragLeave={onChatDragLeave}
      onDrop={onChatDrop}
    >
      {uiDystopian && (
        <>
          <CrtOverlay />
          <AmbientParticles />
        </>
      )}
      {isDragOver && (
        <div
          className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center
            bg-void-black/70 backdrop-blur-sm border-2 border-dashed border-neon-cyan/60"
          aria-hidden
        >
          <div className="px-6 py-4 font-mono text-sm uppercase tracking-wider text-neon-cyan
            border border-neon-cyan/40 bg-void-dark/85 rounded">
            ⬇ DROP FILES TO ATTACH
            <div className="mt-1 text-[11px] normal-case tracking-normal text-void-dim">
              Images (PNG / JPEG / WebP …) and supported files (TXT, MD, PDF, DOCX, CSV, JSON, code).
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="voidcast-header min-w-0">
        {/* Menu Button */}
        <button
          type="button"
          aria-label="Open sessions menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="group relative flex h-8 w-8 shrink-0 items-center justify-center
            bg-void-mid border border-void-dim/50 hover:border-neon-cyan/50
            transition-all duration-300 hover:shadow-[0_0_12px_rgba(var(--ui-accent-rgb),0.25)]"
          style={{ clipPath: 'polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)' }}
        >
          <span
            className="font-mono text-lg text-neon-cyan transition-colors group-hover:text-neon-cyan"
            aria-hidden
          >
            ⌘
          </span>
        </button>

        {/* Status & Actions */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-3">
          {codingPanelAvailable && (
            <button
              type="button"
              onClick={() => setShowCodingPanel((v) => !v)}
              className={`cyber-btn flex h-8 w-8 shrink-0 items-center justify-center p-0 ${showCodingPanel ? 'border-neon-cyan/60 text-neon-cyan' : ''}`}
              title={showCodingPanel ? 'Hide coding panel' : 'Show coding panel'}
              aria-label={showCodingPanel ? 'Hide coding panel' : 'Show coding panel'}
            >
              <CodeIcon className="h-4 w-4 text-current" />
            </button>
          )}
          <button
            type="button"
            disabled={busy || longMemoryBusy || messages.length === 0}
            onClick={() => void extractLongMemoryNow()}
            className="cyber-btn flex h-8 w-8 shrink-0 items-center justify-center p-0 disabled:opacity-50"
            title="Summarize this chat and save relevant long-term memory"
            aria-label={
              longMemoryBusy ? 'Saving long-term memory…' : 'Save long-term memory'
            }
          >
            {longMemoryBusy ? (
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-void-dim border-t-neon-cyan"
                aria-hidden
              />
            ) : (
              <BrainIcon className="h-4 w-4 text-current" />
            )}
          </button>

          {/* Save Button */}
          {canSaveSession && (
            <button
              type="button"
              onClick={saveOrUpdateSession}
              className="cyber-btn flex h-8 w-8 shrink-0 items-center justify-center p-0"
              title="Save chat session"
              aria-label="Save chat session"
            >
              <svg
                className="h-4 w-4 text-current"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            </button>
          )}

          {/* Stop Button */}
          {canStop && (
            <button
              type="button"
              onClick={onStop}
              className="cyber-btn cyber-btn-danger shrink-0 px-2 text-[11px] sm:px-3 sm:text-xs"
            >
              ABORT
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Sidebar Menu */}
      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-void-black/80 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
          <nav 
            className="fixed left-0 top-0 z-50 flex h-full w-72 max-w-[85vw] flex-col 
              bg-void-dark/95 border-r border-neon-cyan/20 shadow-[4px_0_30px_rgba(var(--ui-accent-rgb),0.1)]
              backdrop-blur-xl"
          >
            {/* Menu Header */}
            <div className="px-4 py-4 border-b border-void-muted/30">
              <div className="flex items-center gap-3">
                <span className="text-neon-cyan font-mono text-lg">⌘</span>
                <span className="font-display text-sm tracking-widest text-void-light uppercase">NAVIGATION</span>
              </div>
            </div>

            {/* Menu Items */}
            <div className="flex flex-col gap-1 p-2">
              <button
                type="button"
                onClick={() => openOptions('general')}
                className="flex items-center gap-3 rounded px-4 py-3 text-left
                  text-void-light hover:text-neon-cyan hover:bg-neon-cyan/5
                  border border-transparent hover:border-neon-cyan/20 transition-all"
              >
                <span className="text-neon-cyan">⚙</span>
                <span className="font-mono text-sm">SETTINGS</span>
              </button>
              
              <div className="h-px bg-void-muted/30 my-2" />
              
              <button
                type="button"
                onClick={newChat}
                className="flex items-center gap-3 rounded px-4 py-3 text-left
                  text-void-light hover:text-neon-cyan hover:bg-neon-cyan/5
                  border border-transparent hover:border-neon-cyan/20 transition-all"
              >
                <span className="text-neon-green">+</span>
                <span className="font-mono text-sm">NEW_SESSION</span>
              </button>
            </div>

            {/* Sessions List */}
            <div className="flex-1 border-t border-void-muted/30 overflow-y-auto p-2">
              <div className="px-2 py-2 text-xs font-mono text-void-dim uppercase tracking-wider">
                CHAT_HISTORY
              </div>
              
              {/* Today */}
              <button
                type="button"
                onClick={() => setSidebarCollapsed((p) => ({ ...p, today: !p.today }))}
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-mono text-void-dim hover:text-void-light"
              >
                <span>TODAY [{todaySessions.length}]</span>
                <span>{sidebarCollapsed.today ? '▶' : '▼'}</span>
              </button>
              
              {!sidebarCollapsed.today && (
                <div className="space-y-1 mt-1">
                  {todaySessions.length === 0 && (
                    <div className="px-3 py-2 text-xs font-mono text-void-dim/50">NO_SESSIONS</div>
                  )}
                  {todaySessions.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      isActive={s.id === activeSessionId}
                      isRenaming={renamingSessionId === s.id}
                      isPendingDelete={pendingDeleteId === s.id}
                      renameValue={renameValue}
                      onOpen={() => openSession(s)}
                      onStartRename={() => startRenameSession(s)}
                      onRenameChange={(v) => setRenameValue(v)}
                      onCommitRename={() => commitRenameSession(s.id)}
                      onCancelRename={cancelRenameSession}
                      onStartDelete={() => setPendingDeleteId(s.id)}
                      onConfirmDelete={() => deleteSession(s.id)}
                      onCancelDelete={() => setPendingDeleteId(null)}
                      onFork={() => forkSession(s)}
                      onExport={() => exportSessionToMarkdown(s)}
                    />
                  ))}
                </div>
              )}

              {/* Older */}
              <button
                type="button"
                onClick={() => setSidebarCollapsed((p) => ({ ...p, older: !p.older }))}
                className="flex w-full items-center justify-between px-3 py-2 mt-2 text-xs font-mono text-void-dim hover:text-void-light"
              >
                <span>ARCHIVE [{olderSessions.length}]</span>
                <span>{sidebarCollapsed.older ? '▶' : '▼'}</span>
              </button>
              
              {!sidebarCollapsed.older && (
                <div className="space-y-1 mt-1">
                  {olderSessions.length === 0 && (
                    <div className="px-3 py-2 text-xs font-mono text-void-dim/50">NO_ARCHIVE</div>
                  )}
                  {olderSessions.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      isActive={s.id === activeSessionId}
                      isRenaming={renamingSessionId === s.id}
                      isPendingDelete={pendingDeleteId === s.id}
                      renameValue={renameValue}
                      onOpen={() => openSession(s)}
                      onStartRename={() => startRenameSession(s)}
                      onRenameChange={(v) => setRenameValue(v)}
                      onCommitRename={() => commitRenameSession(s.id)}
                      onCancelRename={cancelRenameSession}
                      onStartDelete={() => setPendingDeleteId(s.id)}
                      onConfirmDelete={() => deleteSession(s.id)}
                      onCancelDelete={() => setPendingDeleteId(null)}
                      onFork={() => forkSession(s)}
                      onExport={() => exportSessionToMarkdown(s)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-void-muted/30">
              <div className="text-xs font-mono text-void-dim/50 text-center">
                {`VOIDCAST_NEXUS // BUILD_${appVersion}`}
              </div>
            </div>
          </nav>
        </>
      )}

      {/* Chat Messages */}
      <main
        ref={chatMessagesRef}
        onScroll={onChatScroll}
        className="voidcast-messages min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl flex flex-col gap-4">
          {/* Empty State */}
          {messages.length === 0 && (
            <div
              className={`relative overflow-hidden rounded-lg p-8 text-center animate-fade-in-up ${
                uiDystopian
                  ? 'border border-neon-cyan/20 bg-void-dark/80'
                  : 'border border-void-muted/50 bg-void-mid/70'
              }`}
            >
              {uiDystopian && (
                <>
                  {/* Decorative glow */}
                  <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-neon-cyan/10 blur-3xl" aria-hidden />
                  <div className="absolute -left-20 -bottom-20 h-48 w-48 rounded-full bg-neon-magenta/10 blur-3xl" aria-hidden />
                </>
              )}
              
              <div className="relative">
                <p className="text-void-text text-sm mb-6 font-mono animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
                  {emptyStateMessage}
                  {uiDystopian && <span className="animate-cursor-blink ml-1">_</span>}
                </p>
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((m, index) => (
            <div 
              key={m.id} 
              className={`message-container ${m.role === 'user' ? 'user' : 'assistant'} animate-message-in group`}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className={`message-bubble ${m.role === 'user' ? 'message-user' : 'message-assistant'}`}>
                {/* Role indicator */}
                <div className="message-meta">
                  <span className={`message-role ${m.role === 'user' ? 'text-neon-purple' : 'text-neon-cyan'}`}>
                    {m.role === 'user' ? 'USER' : 'Void Agent'}
                  </span>
                </div>
                
                {/* Content */}
                {m.role === 'assistant' ? (
                  <div className="min-w-0 space-y-3">
                    {(() => {
                      const cached = assistantRenderCache[m.id]
                      const trustedAudio = dedupeNonEmpty([...(assistantGeneratedAudios[m.id] || [])])
                      const markdownContent = cached?.markdownContent || stripGeneratedAudioLinkArtifacts(
                        stripRunwareAudioUrlLines(m.content),
                        trustedAudio,
                      )
                      const inlineImageUrls = cached?.inlineImageUrls || []
                      const localImagePaths = cached?.localImagePaths || []
                      const renderItems = localImagePaths.length > 0
                        ? localImagePaths.map((p, i) => ({
                            key: `${m.id}-local-${i}`,
                            src: localImagePreviews[p]
                              ? imageDataUrl(localImagePreviews[p].base64, localImagePreviews[p].mime)
                              : '',
                            url: inlineImageUrls[i] || '',
                            localPath: p,
                            hasPreview: Boolean(localImagePreviews[p]),
                          }))
                        : desktopRuntime
                          ? []
                          : inlineImageUrls.map((url, i) => ({
                              key: `${m.id}-url-${i}`,
                              src: url,
                              url,
                              localPath: '',
                              hasPreview: true,
                            }))
                      return (
                        <>
                          {m.thinking?.trim() ? (
                            <details
                              className="rounded border border-neon-cyan/25 bg-void-black/40"
                              open={busy && index === messages.length - 1}
                            >
                              <summary className="cursor-pointer px-3 py-2 text-[11px] font-mono text-neon-cyan/90 hover:text-neon-cyan flex items-center gap-2">
                                <span>THINKING</span>
                                {busy && index === messages.length - 1 ? (
                                  <button
                                    type="button"
                                    className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-neon-cyan/30 hover:bg-neon-cyan/10 transition-colors"
                                    title={thinkingPinned ? 'Auto-scroll: ON' : 'Auto-scroll: OFF'}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      setThinkingPinned((p) => !p)
                                    }}
                                  >
                                    {thinkingPinned ? '📌 FOLLOW ON' : '📍 FOLLOW OFF'}
                                  </button>
                                ) : null}
                              </summary>
                              <div
                                ref={thinkingScrollRef}
                                className="max-h-64 overflow-y-auto border-t border-void-muted/30 px-3 py-2 text-xs font-mono text-void-dim whitespace-pre-wrap break-words"
                              >
                                {m.thinking}
                              </div>
                            </details>
                          ) : null}
                          <ChatMarkdown content={markdownContent} />
                          {renderItems.length > 0 ? (
                            <div className="flex flex-wrap gap-3">
                              {renderItems.map((item) => (
                                <div
                                  key={item.key}
                                  className="rounded border border-void-muted/40 p-2 bg-void-black/30"
                                >
                                  <a
                                    href={item.localPath || item.url || item.src}
                                    target={item.localPath ? undefined : '_blank'}
                                    rel={item.localPath ? undefined : 'noreferrer'}
                                    className="block"
                                    onClick={item.localPath ? (e) => {
                                      e.preventDefault()
                                      void openLocalImage(item.localPath)
                                    } : undefined}
                                  >
                                    {item.hasPreview ? (
                                      <img
                                        src={item.src}
                                        alt="Generated"
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                        className="max-h-64 max-w-full rounded border border-void-muted/40 object-contain"
                                      />
                                    ) : (
                                      <div className="max-h-64 w-[220px] rounded border border-void-muted/40 bg-void-black/40 px-3 py-2 text-xs font-mono text-void-dim">
                                        Loading local image preview...
                                      </div>
                                    )}
                                  </a>
                                  <div className="mt-2 flex gap-2">
                                    {!item.localPath && !settings.runwareAutoSaveImages ? (
                                      <button
                                        type="button"
                                        onClick={() => void downloadImage(item.url)}
                                        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                                          border border-neon-green/30 text-neon-green
                                          hover:bg-neon-green/10 hover:border-neon-green/50
                                          transition-all"
                                      >
                                        ⬇ DOWNLOAD
                                      </button>
                                    ) : !item.localPath ? (
                                      <span className="text-xs font-mono text-void-dim">
                                        Local image unavailable on this platform.
                                      </span>
                                    ) : null}
                                  </div>
                                  {assistantImageToolMeta[m.id]?.[item.url] ? (
                                  <details className="mt-2 border border-void-muted/30 rounded bg-void-black/30">
                                    <summary className="cursor-pointer px-2 py-1 text-[11px] font-mono text-neon-cyan/80 hover:text-neon-cyan">
                                      IMAGE_INFO
                                    </summary>
                                    <div className="px-2 pb-2 pt-1 text-[11px] font-mono text-void-dim whitespace-pre-wrap break-all">
                                      {(() => {
                                        const meta =
                                          assistantImageToolMeta[m.id]?.[item.url]
                                          || assistantImageMessageMeta[m.id]
                                          || parseRunwareImageToolMeta(m.content)
                                        if (!meta) return ''
                                        const lines: string[] = []
                                        if (meta.model) lines.push(`model: ${meta.model}`)
                                        if (meta.size) lines.push(`size: ${meta.size}`)
                                        if (meta.prompt) lines.push(`prompt: ${meta.prompt}`)
                                        if (typeof meta.steps === 'number') lines.push(`steps: ${meta.steps}`)
                                        if (typeof meta.cfgScale === 'number') lines.push(`cfg_scale: ${meta.cfgScale}`)
                                        if (typeof meta.seed === 'number') lines.push(`seed: ${meta.seed}`)
                                        if (typeof meta.costUsd === 'number') lines.push(`cost_usd: ${meta.costUsd.toFixed(6)}`)
                                        if (typeof meta.elapsedMs === 'number') lines.push(`elapsed_ms: ${meta.elapsedMs}`)
                                        if (meta.taskUuid) lines.push(`task_uuid: ${meta.taskUuid}`)
                                        if (meta.imageUuid) lines.push(`image_uuid: ${meta.imageUuid}`)
                                        return lines.join('\n')
                                      })()}
                                    </div>
                                  </details>
                                ) : (
                                  assistantImageMessageMeta[m.id] || parseRunwareImageToolMeta(m.content)
                                ) ? (
                                  <details className="mt-2 border border-void-muted/30 rounded bg-void-black/30">
                                    <summary className="cursor-pointer px-2 py-1 text-[11px] font-mono text-neon-cyan/80 hover:text-neon-cyan">
                                      IMAGE_INFO
                                    </summary>
                                    <div className="px-2 pb-2 pt-1 text-[11px] font-mono text-void-dim whitespace-pre-wrap break-all">
                                      {(() => {
                                        const meta = assistantImageMessageMeta[m.id] || parseRunwareImageToolMeta(m.content)
                                        if (!meta) return ''
                                        const lines: string[] = []
                                        if (meta.model) lines.push(`model: ${meta.model}`)
                                        if (meta.size) lines.push(`size: ${meta.size}`)
                                        if (meta.prompt) lines.push(`prompt: ${meta.prompt}`)
                                        if (typeof meta.steps === 'number') lines.push(`steps: ${meta.steps}`)
                                        if (typeof meta.cfgScale === 'number') lines.push(`cfg_scale: ${meta.cfgScale}`)
                                        if (typeof meta.seed === 'number') lines.push(`seed: ${meta.seed}`)
                                        if (typeof meta.costUsd === 'number') lines.push(`cost_usd: ${meta.costUsd.toFixed(6)}`)
                                        if (typeof meta.elapsedMs === 'number') lines.push(`elapsed_ms: ${meta.elapsedMs}`)
                                        if (meta.taskUuid) lines.push(`task_uuid: ${meta.taskUuid}`)
                                        if (meta.imageUuid) lines.push(`image_uuid: ${meta.imageUuid}`)
                                        return lines.join('\n')
                                      })()}
                                    </div>
                                  </details>
                                ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </>
                      )
                    })()}
                    {(() => {
                      // Only URLs confirmed by a real generate_music_runware tool result.
                      const inlineAudioUrls = dedupeNonEmpty([
                        ...(assistantGeneratedAudios[m.id] || []),
                      ])
                      return inlineAudioUrls.length > 0 ? (
                        <div className="space-y-2">
                          {inlineAudioUrls.map((url, i) => {
                            const savedPath = assistantSavedAudioPaths[m.id]?.[i]
                            return (
                              <div
                                key={`${m.id}-runware-audio-${i}`}
                                className="rounded border border-void-muted/40 p-2 bg-void-black/30"
                              >
                                <div className="mb-2 text-[11px] font-mono text-neon-cyan/80">
                                  GENERATED_AUDIO_{i + 1}
                                  {savedPath ? ' (local)' : ' (url)'}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {savedPath && (
                                    <button
                                      type="button"
                                      onClick={() => void openLocalImage(savedPath)}
                                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                                        border border-neon-green/30 text-neon-green
                                        hover:bg-neon-green/10 hover:border-neon-green/50
                                        transition-all"
                                    >
                                      ▶ OPEN_LOCAL
                                    </button>
                                  )}
                                  {!savedPath && (
                                    <span className="text-xs font-mono text-void-dim">
                                      Enable auto-save to open local file.
                                    </span>
                                  )}
                                </div>
                                {(assistantAudioToolMeta[m.id]?.[url] ||
                                  assistantAudioMessageMeta[m.id] ||
                                  parseRunwareAudioToolMeta(m.content)) ? (
                                  <details className="mt-2 border border-void-muted/30 rounded bg-void-black/30">
                                    <summary className="cursor-pointer px-2 py-1 text-[11px] font-mono text-neon-cyan/80 hover:text-neon-cyan">
                                      AUDIO_INFO
                                    </summary>
                                    <div className="px-2 pb-2 pt-1 text-[11px] font-mono text-void-dim whitespace-pre-wrap break-all">
                                      {(() => {
                                        const meta =
                                          assistantAudioToolMeta[m.id]?.[url]
                                          || assistantAudioMessageMeta[m.id]
                                          || parseRunwareAudioToolMeta(m.content)
                                        if (!meta) return ''
                                        const lines: string[] = []
                                        if (meta.model) lines.push(`model: ${meta.model}`)
                                        if (meta.prompt) lines.push(`prompt: ${meta.prompt}`)
                                        if (meta.outputFormat) lines.push(`output_format: ${meta.outputFormat}`)
                                        if (typeof meta.durationSec === 'number') lines.push(`duration_sec: ${meta.durationSec}`)
                                        if (typeof meta.steps === 'number') lines.push(`steps: ${meta.steps}`)
                                        if (typeof meta.cfgScale === 'number') lines.push(`cfg_scale: ${meta.cfgScale}`)
                                        if (meta.guidanceType) lines.push(`guidance_type: ${meta.guidanceType}`)
                                        if (meta.vocalLanguage) lines.push(`vocal_language: ${meta.vocalLanguage}`)
                                        if (typeof meta.seed === 'number') lines.push(`seed: ${meta.seed}`)
                                        if (typeof meta.costUsd === 'number') lines.push(`cost_usd: ${meta.costUsd.toFixed(6)}`)
                                        if (typeof meta.elapsedMs === 'number') lines.push(`elapsed_ms: ${meta.elapsedMs}`)
                                        if (meta.taskUuid) lines.push(`task_uuid: ${meta.taskUuid}`)
                                        if (meta.audioUuid) lines.push(`audio_uuid: ${meta.audioUuid}`)
                                        return lines.join('\n')
                                      })()}
                                    </div>
                                  </details>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      ) : null
                    })()}
                  </div>
                ) : editingMessageId === m.id ? (
                  <div className="space-y-2">
                    <textarea
                      className="voidcast-textarea w-full"
                      rows={3}
                      value={editInputValue}
                      onChange={(e) => setEditInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          commitEdit(m.id)
                        } else if (e.key === 'Escape') {
                          cancelEdit()
                        }
                      }}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => commitEdit(m.id)}
                        className="cyber-btn text-xs"
                      >
                        RESEND
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="px-3 py-1 text-xs font-mono text-void-dim hover:text-void-light"
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="min-w-0 max-w-full overflow-hidden text-void-white whitespace-pre-wrap break-words [overflow-wrap:anywhere] space-y-2 rounded px-1 -mx-1"
                  >
                    {m.images && m.images.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {m.images.map((b64, i) => (
                          <img
                            key={`${m.id}-img-${i}`}
                            src={imageDataUrl(b64, m.imageMimes?.[i] ?? 'image/png')}
                            alt=""
                            className="max-h-48 max-w-full rounded border border-void-muted/40 object-contain"
                          />
                        ))}
                      </div>
                    )}
                    {m.fileAttachments && m.fileAttachments.length > 0 && (
                      <div className="space-y-1 rounded border border-void-muted/40 bg-void-black/20 p-2 text-xs font-mono">
                        {m.fileAttachments.map((f) => (
                          <div key={f.id} className="text-void-dim">
                            FILE: {f.name} ({f.ext || 'unknown'}) {f.truncated ? '[truncated]' : ''}
                            <div className="break-all text-[10px] text-void-dim/80">{f.path}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {m.content.length > 0 ? (
                      m.content
                    ) : m.images?.length ? (
                      <span className="text-void-dim text-xs font-mono">(no caption)</span>
                    ) : m.fileAttachments?.length ? (
                      <span className="text-void-dim text-xs font-mono">(file attached)</span>
                    ) : (
                      <span className="text-void-dim text-xs font-mono">
                        (no text content)
                      </span>
                    )}
                  </div>
                )}
                
                {/* Actions for user */}
                {m.role === 'user' && !editingMessageId && (
                  <div className="mt-2 flex flex-wrap gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => startEdit(m)}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                        border border-void-muted/50 text-void-dim
                        hover:border-neon-cyan/50 hover:text-neon-cyan
                        transition-all"
                    >
                      ✎ EDIT
                    </button>
                  </div>
                )}
                
                {/* Actions for assistant */}
                {m.role === 'assistant' && m.content.trim().length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-void-muted/30 pt-3">
                    <button
                      type="button"
                      disabled={ttsOk === false}
                      onClick={() => {
                        if (playingId === m.id) {
                          abortTts()
                          return
                        }
                        void onRead(m)
                      }}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                        border border-neon-cyan/30 text-neon-cyan
                        hover:bg-neon-cyan/10 hover:border-neon-cyan/50
                        disabled:opacity-40 disabled:cursor-not-allowed
                        transition-all"
                    >
                      <span className={playingId === m.id ? 'animate-pulse' : ''}>
                        {playingId === m.id ? '◼' : '▶'}
                      </span>
                      {playingId === m.id ? 'STOP' : 'SPEAK'}
                    </button>
                    {dedupeNonEmpty([...(m.generatedImagePaths || []), ...(assistantSavedImagePaths[m.id] || [])]).length > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          void openLocalImage(
                            dedupeNonEmpty([
                              ...(m.generatedImagePaths || []),
                              ...(assistantSavedImagePaths[m.id] || []),
                            ]).slice(-1)[0],
                          )
                        }
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-mono
                          border border-neon-green/30 text-neon-green
                          hover:bg-neon-green/10 hover:border-neon-green/50
                          transition-all"
                      >
                        🖼 OPEN IMG
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Busy Indicator */}
          {busy && (
            <div className="flex items-center gap-3 px-4 py-3 bg-void-dark/80 border border-void-muted/30 rounded">
              <div className="typing-dots">
                <span />
                <span />
                <span />
              </div>
              <span className="text-void-text text-sm font-mono">
                {toolPhase ? (
                  <ToolIndicator phase={toolPhase} />
                ) : (
                  'PROCESSING...'
                )}
              </span>
            </div>
          )}

          <div ref={listEndRef} />
        </div>
      </main>

      {/* Tool Result Banner */}
      {toolResultBanner && (
        <div className="tool-result-banner mx-4 my-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-mono text-neon-green/70 uppercase tracking-wider">
                PDF_EXPORT_RESULT
              </div>
              <div className="mt-1 whitespace-pre-wrap break-all text-xs font-mono">
                {toolResultBanner.text}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setToolResultBanner(null)}
              className="text-neon-green/50 hover:text-neon-green px-2 py-1 text-xs font-mono"
            >
              DISMISS
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="error-banner mx-4 my-2 flex items-center gap-3">
          <span className="text-neon-red">⚠</span>
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* Context: manual warning with COMPRESS, or auto-compress status only */}
      {contextUsageInfo?.shouldWarn &&
        !settings.contextAutoCompress &&
        !contextWarnDismissed && (
        <div className="border-t border-neon-yellow/30 bg-neon-yellow/5 px-4 py-3 mx-4 my-2 rounded">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-mono text-neon-yellow">
              <span className="opacity-70">CONTEXT_WARNING:</span>
              {' '}CTX_USAGE {Math.round(contextUsageInfo.ratio * 100)}%
              ({contextUsageInfo.promptTokens}/{contextUsageInfo.maxTokens})
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || contextCompressBusy}
                onClick={() => void summarizeContextNow()}
                className="cyber-btn text-xs"
              >
                {contextCompressBusy ? 'COMPRESSING...' : 'COMPRESS'}
              </button>
              <button
                type="button"
                onClick={() => setContextWarnDismissed(true)}
                className="px-3 py-1 text-xs font-mono text-void-dim hover:text-void-light"
              >
                IGNORE
              </button>
            </div>
          </div>
          <div className="context-bar mt-2">
            <div
              className={`context-fill ${contextUsageInfo.ratio > 0.9 ? 'danger' : contextUsageInfo.ratio > 0.7 ? 'warning' : ''}`}
              style={{ width: `${Math.min(100, contextUsageInfo.ratio * 100)}%` }}
            />
          </div>
        </div>
      )}
      {settings.contextAutoCompress &&
        contextUsageInfo?.shouldCompress &&
        (contextCompressBusy || busy) && (
        <div className="border-t border-neon-cyan/25 bg-neon-cyan/5 px-4 py-2 mx-4 my-2 rounded">
          <div className="text-sm font-mono text-neon-cyan">
            <span className="opacity-70">CONTEXT:</span>
            {' '}CTX {Math.round(contextUsageInfo.ratio * 100)}%
            {contextCompressBusy ? ' · auto-compressing…' : ' · auto-compress when idle'}
          </div>
        </div>
      )}

      {subAgentPanelOpen &&
        settings.subAgent.enabled &&
        settings.subAgent.showAnalysisWindow !== false && (
        <div
          className="fixed right-4 top-20 z-[65] w-[min(22rem,calc(100vw-2rem))] max-h-[min(70vh,32rem)] flex flex-col rounded border border-neon-cyan/40 bg-void-dark/95 shadow-lg backdrop-blur-sm"
          role="dialog"
          aria-label="Sub-agent vision analysis"
        >
          <div className="flex items-center justify-between gap-2 border-b border-void-muted/30 px-3 py-2">
            <div className="text-xs font-mono text-neon-cyan">
              {subAgentPanelBusy ? 'SUB_AGENT · WORKING' : 'SUB_AGENT · ANALYSIS'}
            </div>
            <button
              type="button"
              onClick={() => {
                setSubAgentPanelOpen(false)
                setSubAgentPanelBusy(false)
                setSubAgentPanelText('')
              }}
              className="px-2 py-0.5 text-[10px] font-mono text-void-dim hover:text-void-light"
            >
              CLOSE
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {subAgentPanelBusy ? (
              <div className="flex items-center gap-2 text-xs font-mono text-void-dim">
                <span
                  className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-void-dim border-t-neon-cyan"
                  aria-hidden
                />
                {subAgentPanelText}
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words text-xs font-mono text-void-light">
                {subAgentPanelText}
              </pre>
            )}
          </div>
        </div>
      )}

      {memoryPreviewOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-void-black/80 p-4">
          <div className="w-full max-w-2xl rounded border border-neon-cyan/30 bg-void-dark p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-mono text-neon-cyan">LONG_MEMORY_PREVIEW</div>
              <button
                type="button"
                onClick={() => setMemoryPreviewOpen(false)}
                className="px-2 py-1 text-xs font-mono text-void-dim hover:text-void-light"
              >
                CLOSE
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto space-y-2">
              {memoryCandidates.map((m, idx) => (
                <div key={`${m.kind}-${idx}`} className="rounded border border-void-muted/30 bg-void-black/30 p-2">
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-neon-green/80">
                    <span>{m.kind.toUpperCase()} · conf {(m.confidence ?? 0).toFixed(2)} · imp {(m.importance ?? 0).toFixed(2)}</span>
                    <button
                      type="button"
                      className="px-2 py-0.5 text-[10px] text-neon-red/80 hover:text-neon-red"
                      onClick={() =>
                        setMemoryCandidates((prev: LongMemoryCandidate[]) =>
                          prev.filter((_: LongMemoryCandidate, i: number) => i !== idx),
                        )
                      }
                    >
                      REMOVE
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-void-light">{m.text}</div>
                  {!!m.tags?.length && (
                    <div className="mt-1 text-[10px] text-void-dim">{m.tags.join(', ')}</div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setMemoryPreviewOpen(false)
                  setMemoryCandidates([])
                }}
                className="px-3 py-1 text-xs font-mono text-void-dim hover:text-void-light"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={() => void confirmSaveLongMemory()}
                className="cyber-btn text-xs"
                disabled={longMemoryBusy || memoryCandidates.length === 0}
              >
                CONFIRM_SAVE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input Area */}
      <footer className="voidcast-input-area">
        <div className="mx-auto max-w-3xl">
          <input
            id="voidcast-chat-attach-input"
            ref={chatAttachmentInputRef as RefObject<HTMLInputElement>}
            type="file"
            accept={
              isWebStandalone()
                ? CHAT_IMAGE_ACCEPT
                : `${CHAT_IMAGE_ACCEPT},${chatFileAcceptList()}`
            }
            multiple
            className={
              isWebStandalone()
                ? 'sr-only'
                : 'hidden'
            }
            aria-hidden={!isWebStandalone()}
            onChange={(e) => void onPickChatAttachments(e)}
          />
          {pendingImages.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2" aria-live="polite">
              {pendingImages.map((p, i) => (
                <div
                  key={`pending-${i}-${p.base64.slice(0, 8)}`}
                  className="relative shrink-0"
                >
                  <img
                    src={imageDataUrl(p.base64, p.mime)}
                    alt=""
                    className="h-12 w-12 rounded border border-void-muted/60 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePendingImage(i)}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded border border-void-muted bg-void-black text-[9px] text-void-dim hover:border-neon-red/50 hover:text-neon-red"
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {pendingFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2" aria-live="polite">
              {pendingFiles.map((f, i) => (
                <div
                  key={f.id}
                  className="relative rounded border border-void-muted/60 bg-void-black/30 px-2 py-1 text-xs font-mono text-void-dim"
                >
                  <div>{f.name}{f.truncated ? ' [truncated]' : ''}</div>
                  <button
                    type="button"
                    onClick={() => removePendingFile(i)}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded border border-void-muted bg-void-black text-[9px] text-void-dim hover:border-neon-red/50 hover:text-neon-red"
                    aria-label="Remove file"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="input-wrapper">
            {isWebStandalone() ? (
              <label
                htmlFor="voidcast-chat-attach-input"
                className={`shrink-0 px-3 py-3 mb-px text-xs font-mono border border-void-muted bg-void-black/80 text-neon-cyan hover:border-neon-cyan/50 hover:bg-neon-cyan/5 transition-colors inline-flex items-center justify-center cursor-pointer ${busy ? 'opacity-40 pointer-events-none' : ''}`}
                style={{
                  clipPath:
                    'polygon(0 6px, 6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px))',
                }}
                title="Attach image from gallery"
                aria-label="Attach image from gallery"
              >
                +
              </label>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void openChatAttachmentPicker()}
                className="shrink-0 px-3 py-3 mb-px text-xs font-mono border border-void-muted bg-void-black/80 text-neon-cyan hover:border-neon-cyan/50 hover:bg-neon-cyan/5 transition-colors disabled:opacity-40"
                style={{
                  clipPath:
                    'polygon(0 6px, 6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px))',
                }}
                title="Attach image or file"
                aria-label="Attach files and images"
              >
                +
              </button>
            )}
            {settings.sttProvider === 'openrouter' && !isWebStandalone() && (
              <button
                type="button"
                disabled={busy || sttPending}
                onClick={() => void toggleSttRecording()}
                className={`shrink-0 px-3 py-3 mb-px text-xs font-mono border transition-colors disabled:opacity-40 ${
                  isRecording
                    ? 'border-neon-red bg-neon-red/10 text-neon-red animate-pulse'
                    : 'border-void-muted bg-void-black/80 text-neon-green hover:border-neon-green/50 hover:bg-neon-green/5'
                }`}
                style={{
                  clipPath:
                    'polygon(0 6px, 6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px))',
                }}
                title={isRecording ? `Recording ${recordingDuration}s (click to stop)` : sttPending ? 'Transcribing...' : 'Voice input'}
                aria-label={isRecording ? 'Stop recording' : sttPending ? 'Transcribing' : 'Start voice input'}
              >
                {sttPending ? (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                ) : isRecording ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                )}
              </button>
            )}
            <textarea
              className="voidcast-textarea"
              rows={2}
              placeholder="Type a message..."
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void onSend()
                }
              }}
            />
            
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void onSend()}
              className="send-btn"
              aria-label="Send message"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </button>
          </div>
          
          {/* Input hints (attachments + unsaved only; model list lives in LLM options) */}
          {(pendingImages.length > 0 ||
            pendingFiles.length > 0) && (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs font-mono text-void-dim">
              <span>
                {pendingImages.length > 0 && (
                  <span className="text-neon-cyan/70">
                    {pendingImages.length} image{pendingImages.length === 1 ? '' : 's'}{' '}
                    attached
                  </span>
                )}
                {pendingFiles.length > 0 && (
                  <span
                    className={
                      pendingImages.length > 0
                        ? 'ml-2 text-neon-green/70'
                        : 'text-neon-green/70'
                    }
                  >
                    {pendingFiles.length} file{pendingFiles.length === 1 ? '' : 's'} attached
                  </span>
                )}
              </span>
              
            </div>
          )}
        </div>
      </footer>
      </div>
      {showCodingPanel && codingPanelAvailable && (
        <CodingPanel
          settings={settings}
          fileTreeRevision={codingFileTreeNonce}
          agentShellFeed={codingTerminalFeed}
          onCodingUiChange={(patch) =>
            setSettings((s) => ({ ...s, coding: { ...s.coding, ...patch } }))
          }
          onUpdateProjectPath={applyCodingProjectPath}
        />
      )}
      </div>

      {/* System Status */}
      <div className="system-status">
        <div className="status-item min-w-0 shrink gap-2">
          <RobotIcon className="h-3.5 w-3.5 text-void-dim/70 shrink-0" />
          <span
            className="truncate text-void-text/80"
            title={`${settings.llmProvider}: ${settings.llmProvider === 'ollama' ? settings.ollamaModel : settings.llmProvider === 'nvidia' ? settings.nvidiaModel : settings.openrouterModel}`}
          >
            {settings.llmProvider === 'ollama'
              ? settings.ollamaModel
              : settings.llmProvider === 'nvidia'
                ? settings.nvidiaModel
                : settings.openrouterModel}
          </span>
          <span className="text-void-dim/30 select-none">|</span>
          <span className="text-void-dim/60 text-[10px]">{isWebStandalone() ? 'TTS' : 'TTS/STT'}</span>
          <span
            className={`dot ${ttsOk === true ? 'online' : ttsOk === false ? 'offline' : 'busy'}`}
            title={`TTS service ${ttsOk === true ? 'READY' : ttsOk === false ? 'OFFLINE' : 'CHECKING'}`}
          />
        </div>
        <div className="footer-context-readout flex min-w-0 max-w-[min(100%,22rem)] flex-col items-end gap-0.5 text-right font-mono">
          {contextUsageInfo ? (
            <>
              <span className="text-[11px] leading-tight text-void-dim tabular-nums">
                <span className="text-void-dim/60">CTX </span>
                <span className="text-void-text">{contextUsageInfo.promptTokens}</span>
                <span className="text-void-dim/50">/</span>
                <span>{contextUsageInfo.maxTokens}</span>
                <span className="ml-1.5 text-void-dim/70">
                  {Math.round(contextUsageInfo.ratio * 100)}%
                </span>
              </span>
              <span className="text-[10px] leading-tight text-void-dim/70 tabular-nums">
                <span className="text-void-dim/50">OUT </span>
                <span>{contextUsageInfo.outputTokens}</span>
              </span>
              <div
                className="h-1 w-full max-w-[14rem] overflow-hidden rounded-sm bg-void-muted/70"
                title={`Context window usage: ${contextUsageInfo.promptTokens} / ${contextUsageInfo.maxTokens} prompt tokens`}
              >
                <div
                  className={`h-full transition-[width] duration-500 ${
                    contextUsageInfo.ratio > 0.9
                      ? 'bg-neon-red/90'
                      : contextUsageInfo.ratio > 0.7
                        ? 'bg-neon-yellow/85'
                        : 'bg-neon-cyan/75'
                  }`}
                  style={{
                    width: `${Math.min(100, contextUsageInfo.ratio * 100)}%`,
                  }}
                />
              </div>
            </>
          ) : (
            <span className="text-[11px] text-void-dim/45 tabular-nums">CTX —</span>
          )}
        </div>
      </div>

      <audio ref={audioRef as RefObject<HTMLAudioElement>} className="hidden" />
    </div>
  )
}
