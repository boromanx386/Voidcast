import type { AppSettings } from '@/lib/settings'
import { isElectron, isLanWebClient } from '@/lib/platform'
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { LongMemoryItem } from '@/types/longMemory'
import type { Reminder } from '@/lib/reminderStorage'
import { BrainIcon } from '@/components/icons/BrainIcon'
import { ClockIcon } from '@/components/icons/ClockIcon'
import { LanWebAccessPanel } from '@/components/options/LanWebAccessPanel'
import {
  clearNotificationSound,
  loadNotificationSound,
  saveNotificationSound,
  type NotificationSoundKind,
} from '@/lib/notificationSoundStorage'
import {
  MAX_NOTIFICATION_SOUND_BYTES,
  invalidateNotificationSoundCache,
  looksLikeAudioFile,
  notificationSoundAcceptList,
  notificationSoundFromFile,
  playNotificationSound,
} from '@/lib/notificationSounds'

type Props = {
  settings: AppSettings
  setSettings: Dispatch<SetStateAction<AppSettings>>
  useLongMemoryInActiveChat: boolean
  onToggleUseLongMemoryInActiveChat: (enabled: boolean) => void
  longMemories: LongMemoryItem[]
  onDeleteLongMemory: (id: string) => void
  onUpdateLongMemory: (id: string, text: string) => void
  reminders: Reminder[]
  onDeleteReminder: (id: string) => void
  onMarkDoneReminder: (id: string) => void
}

export function GeneralOptionsPanel({
  settings,
  setSettings,
  useLongMemoryInActiveChat,
  onToggleUseLongMemoryInActiveChat,
  longMemories,
  onDeleteLongMemory,
  onUpdateLongMemory,
  reminders,
  onDeleteReminder,
  onMarkDoneReminder,
}: Props) {
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null)
  const [editingMemoryText, setEditingMemoryText] = useState('')
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    () => {
      if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported'
      return Notification.permission
    },
  )

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') {
      setNotifPermission('unsupported')
      return
    }
    try {
      const result = await Notification.requestPermission()
      setNotifPermission(result)
    } catch {
      setNotifPermission(Notification.permission)
    }
  }

  const [soundFileNames, setSoundFileNames] = useState<
    Record<NotificationSoundKind, string | null>
  >({ reply: null, error: null })
  const [soundError, setSoundError] = useState<string | null>(null)
  const replyFileInputRef = useRef<HTMLInputElement | null>(null)
  const errorFileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [reply, errorSound] = await Promise.all([
        loadNotificationSound('reply').catch(() => null),
        loadNotificationSound('error').catch(() => null),
      ])
      if (cancelled) return
      setSoundFileNames({
        reply: reply?.fileName ?? null,
        error: errorSound?.fileName ?? null,
      })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const onPickNotificationSound = async (
    kind: NotificationSoundKind,
    e: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!looksLikeAudioFile(file)) {
      setSoundError(`Not an audio file: ${file.name}`)
      return
    }
    if (file.size > MAX_NOTIFICATION_SOUND_BYTES) {
      setSoundError(
        `Sound too large (max ${Math.round(MAX_NOTIFICATION_SOUND_BYTES / (1024 * 1024))} MB): ${file.name}`,
      )
      return
    }
    try {
      const payload = await notificationSoundFromFile(file)
      await saveNotificationSound(kind, payload)
      invalidateNotificationSoundCache(kind)
      setSoundFileNames((prev) => ({ ...prev, [kind]: payload.fileName }))
      setSoundError(null)
    } catch (err) {
      setSoundError(err instanceof Error ? err.message : String(err))
    }
  }

  const onClearNotificationSound = async (kind: NotificationSoundKind) => {
    try {
      await clearNotificationSound(kind)
      invalidateNotificationSoundCache(kind)
      setSoundFileNames((prev) => ({ ...prev, [kind]: null }))
      setSoundError(null)
    } catch (err) {
      setSoundError(err instanceof Error ? err.message : String(err))
    }
  }

  const previewNotificationSound = (kind: NotificationSoundKind) => {
    void playNotificationSound(kind, { volume: settings.notificationSoundVolume })
  }

  const startEditMemory = (m: LongMemoryItem) => {
    setEditingMemoryId(m.id)
    setEditingMemoryText(m.text)
  }
  const commitEditMemory = () => {
    if (editingMemoryId && editingMemoryText.trim()) {
      void onUpdateLongMemory(editingMemoryId, editingMemoryText.trim())
    }
    setEditingMemoryId(null)
    setEditingMemoryText('')
  }
  const cancelEditMemory = () => {
    setEditingMemoryId(null)
    setEditingMemoryText('')
  }

  useEffect(() => {
    const bridge = window.voidcast
    if (!isElectron() || !bridge) return

    const offAvailable = bridge.onUpdateCanAvailable((payload) => {
      if (payload?.update) {
        setUpdateStatus(`Update available: v${payload.newVersion ?? '?'}`)
      } else {
        setUpdateStatus('No update available.')
      }
      setUpdateChecking(false)
    })
    const offError = bridge.onUpdateError((payload) => {
      setUpdateStatus(payload?.message || 'Update check failed.')
      setUpdateChecking(false)
    })
    const offDownloaded = bridge.onUpdateDownloaded(() => {
      setUpdateStatus('Update downloaded. Restart app to install.')
      setUpdateChecking(false)
    })
    return () => {
      offAvailable()
      offError()
      offDownloaded()
    }
  }, [])

  const checkForUpdate = async () => {
    const bridge = window.voidcast
    if (!isElectron() || !bridge) {
      setUpdateStatus('Update check is available only in desktop app.')
      return
    }
    setUpdateChecking(true)
    setUpdateStatus('Checking for updates...')
    try {
      const result = await bridge.checkForUpdates()
      const maybe = result as { error?: { message?: string } } | null
      if (maybe?.error) {
        setUpdateStatus(maybe.error.message || 'Update check failed.')
        setUpdateChecking(false)
      }
    } catch (e) {
      setUpdateStatus(e instanceof Error ? e.message : String(e))
      setUpdateChecking(false)
    }
  }

  return (
    <div className="grid gap-5 text-sm">
      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-cyan mr-2">◆</span> INTERFACE_THEME
        </label>
        <select
          className="form-select"
          value={settings.uiTheme}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              uiTheme:
                e.target.value === 'minimal'
                  ? 'minimal'
                  : e.target.value === 'matrix'
                    ? 'matrix'
                    : e.target.value === 'light'
                      ? 'light'
                      : e.target.value === 'blood-moon'
                        ? 'blood-moon'
                        : e.target.value === 'obsidian'
                          ? 'obsidian'
                          : 'dystopian',
            }))
          }
        >
          <option value="dystopian">Dystopian (neon / CRT)</option>
          <option value="minimal">Minimal (zinc / indigo)</option>
          <option value="matrix">Matrix (green / code rain)</option>
          <option value="light">Light (warm paper)</option>
          <option value="blood-moon">Blood Moon (crimson void)</option>
          <option value="obsidian">Obsidian (neutral dark)</option>
        </select>
        <p className="text-xs text-void-dim mt-1">
          Dystopian uses CRT/particles; Matrix uses green phosphor + digital rain. Minimal and Light stay calm.
        </p>
      </div>

      <div className="bg-void-black/50 border border-neon-cyan/25 p-4 rounded">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-neon-cyan"
            checked={settings.autoSaveChat}
            onChange={(e) =>
              setSettings((s) => ({ ...s, autoSaveChat: e.target.checked }))
            }
          />
          <span>
            <span className="text-xs font-mono text-neon-cyan uppercase tracking-wider">
              AUTO_SAVE_CHAT
            </span>
            <span className="mt-1 block text-xs text-void-dim">
              Automatically save chat sessions as you go. Turn off to show a manual save button in the header.
            </span>
          </span>
        </label>
      </div>

      <div className="bg-void-black/50 border border-neon-green/25 p-4 rounded space-y-3">
        <p className="flex items-center gap-2 text-xs font-mono text-neon-green uppercase tracking-wider">
          <span className="mr-1">♫</span>
          CHAT_SOUNDS
        </p>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-neon-green"
            checked={settings.notificationSoundsEnabled}
            onChange={(e) =>
              setSettings((s) => ({ ...s, notificationSoundsEnabled: e.target.checked }))
            }
          />
          <span>
            <span className="text-xs font-mono text-neon-green uppercase tracking-wider">
              ENABLE_CHAT_SOUNDS
            </span>
            <span className="mt-1 block text-xs text-void-dim">
              Play your selected local audio when an assistant reply finishes or when a chat error occurs.
            </span>
          </span>
        </label>

        <div className="form-group !mb-0">
          <label className="form-label">
            VOLUME
            <span className="ml-3 font-mono text-neon-green">
              {Math.round(settings.notificationSoundVolume * 100)}%
            </span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            className="form-slider w-full"
            value={settings.notificationSoundVolume}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                notificationSoundVolume: Number(e.target.value) || 0,
              }))
            }
          />
        </div>

        {(['reply', 'error'] as NotificationSoundKind[]).map((kind) => {
          const name = soundFileNames[kind]
          const accent = kind === 'reply' ? 'text-neon-cyan' : 'text-neon-red'
          const inputRef = kind === 'reply' ? replyFileInputRef : errorFileInputRef
          return (
            <div key={kind} className="rounded border border-void-muted/30 bg-void-black/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-mono uppercase tracking-wider ${accent}`}>
                  {kind === 'reply' ? '✓ ON_REPLY_DONE' : '✗ ON_CHAT_ERROR'}
                </span>
                {name && (
                  <span className="text-[10px] font-mono text-void-dim truncate max-w-[55%]" title={name}>
                    {name}
                  </span>
                )}
              </div>
              {!name && (
                <p className="text-xs text-void-dim">
                  No sound selected. Pick a local audio file (MP3 / WAV / OGG / M4A / FLAC).
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <input
                  ref={inputRef}
                  type="file"
                  accept={notificationSoundAcceptList()}
                  className="hidden"
                  onChange={(e) => void onPickNotificationSound(kind, e)}
                />
                <button
                  type="button"
                  className="cyber-btn text-xs"
                  onClick={() => inputRef.current?.click()}
                >
                  {name ? 'CHANGE' : 'PICK FILE'}
                </button>
                {name && (
                  <button
                    type="button"
                    className="cyber-btn text-xs"
                    onClick={() => previewNotificationSound(kind)}
                  >
                    ▶ PREVIEW
                  </button>
                )}
                {name && (
                  <button
                    type="button"
                    className="cyber-btn text-xs"
                    onClick={() => void onClearNotificationSound(kind)}
                  >
                    CLEAR
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {soundError && (
          <p className="text-xs text-neon-red">{soundError}</p>
        )}
        <p className="text-[10px] text-void-dim">
          Max {Math.round(MAX_NOTIFICATION_SOUND_BYTES / (1024 * 1024))} MB per file. Stored locally in IndexedDB on this device.
        </p>
      </div>

      {isLanWebClient() ? (
        <div className="bg-void-black/50 border border-neon-cyan/25 p-4 rounded">
          <p className="text-xs font-mono text-neon-cyan uppercase tracking-wider mb-2">
            CLOUD_API_KEYS
          </p>
          <p className="text-xs text-void-dim leading-relaxed">
            API keys are configured only in the desktop Voidcast app (General options). This
            browser session uses the local server proxy — keys never appear on your phone.
          </p>
        </div>
      ) : (
        <>
      {isElectron() && <LanWebAccessPanel settings={settings} setSettings={setSettings} />}

      <div className="bg-void-black/50 border border-void-muted/30 p-3 rounded">
        <p className="text-xs font-mono text-neon-cyan uppercase tracking-wider mb-1">
          CLOUD_API_KEYS
        </p>
        <p className="text-xs text-void-dim leading-relaxed">
          Stored locally on this PC.
          {settings.lanWebAccessEnabled
            ? ' With LAN web access on, keys are also forwarded to the local server for phone clients.'
            : ''}
        </p>
      </div>

      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-yellow mr-2">⚿</span> RUNWARE_API_KEY
        </label>
        <input
          type="password"
          className="cyber-input"
          value={settings.runwareApiKey}
          onChange={(e) =>
            setSettings((s) => ({ ...s, runwareApiKey: e.target.value }))
          }
          placeholder="rw_..."
          autoComplete="off"
        />
        <a
          href="https://runware.ai/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-neon-cyan underline decoration-neon-cyan/35 underline-offset-2 hover:decoration-neon-cyan"
        >
          Get Runware API key
        </a>
      </div>

      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-cyan mr-2">⚿</span> OPENROUTER_API_KEY
        </label>
        <input
          type="password"
          className="cyber-input"
          value={settings.openrouterApiKey}
          onChange={(e) =>
            setSettings((s) => ({ ...s, openrouterApiKey: e.target.value }))
          }
          placeholder="sk-or-v1-..."
          autoComplete="off"
        />
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-neon-cyan underline decoration-neon-cyan/35 underline-offset-2 hover:decoration-neon-cyan"
        >
          Get OpenRouter API key
        </a>
      </div>

      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-cyan mr-2">⚿</span> NVIDIA_API_KEY
        </label>
        <input
          type="password"
          className="cyber-input"
          value={settings.nvidiaApiKey}
          onChange={(e) =>
            setSettings((s) => ({ ...s, nvidiaApiKey: e.target.value }))
          }
          placeholder="nvapi-..."
          autoComplete="off"
        />
        <a
          href="https://build.nvidia.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-neon-cyan underline decoration-neon-cyan/35 underline-offset-2 hover:decoration-neon-cyan"
        >
          Get NVIDIA API key
        </a>
      </div>

      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-cyan mr-2">⚿</span> DEEPSEEK_API_KEY
        </label>
        <input
          type="password"
          className="cyber-input"
          value={settings.deepseekApiKey}
          onChange={(e) =>
            setSettings((s) => ({ ...s, deepseekApiKey: e.target.value }))
          }
          placeholder="sk-..."
          autoComplete="off"
        />
        <a
          href="https://platform.deepseek.com/api_keys"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-neon-cyan underline decoration-neon-cyan/35 underline-offset-2 hover:decoration-neon-cyan"
        >
          Get DeepSeek API key
        </a>
      </div>

      <div className="form-group">
        <label className="form-label">
          <span className="text-neon-cyan mr-2">⚿</span> OPENCODE_GO_API_KEY
        </label>
        <input
          type="password"
          className="cyber-input"
          value={settings.opencodeGoApiKey}
          onChange={(e) =>
            setSettings((s) => ({ ...s, opencodeGoApiKey: e.target.value }))
          }
          placeholder="sk-..."
          autoComplete="off"
        />
        <a
          href="https://opencode.ai/auth"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-neon-cyan underline decoration-neon-cyan/35 underline-offset-2 hover:decoration-neon-cyan"
        >
          Get OpenCode Go API key
        </a>
      </div>
        </>
      )}

      {isElectron() && (
        <div className="bg-void-black/50 border border-neon-cyan/25 p-4 rounded">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-neon-cyan"
              checked={settings.autoUpdate}
              onChange={(e) =>
                setSettings((s) => ({ ...s, autoUpdate: e.target.checked }))
              }
            />
            <span>
              <span className="text-xs font-mono text-neon-cyan uppercase tracking-wider">
                AUTO_UPDATE
              </span>
              <span className="mt-1 block text-xs text-void-dim">
                Automatically check updates on startup (desktop app).
              </span>
            </span>
          </label>

          {!settings.autoUpdate && (
            <div className="mt-3">
              <button
                type="button"
                className="cyber-btn text-xs"
                disabled={updateChecking}
                onClick={() => void checkForUpdate()}
              >
                {updateChecking ? 'CHECKING…' : 'CHECK FOR UPDATE'}
              </button>
              {updateStatus && (
                <p className="text-xs text-void-dim mt-2">{updateStatus}</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="bg-void-black/50 border border-neon-cyan/25 p-4 rounded space-y-3">
        <p className="flex items-center gap-2 text-xs font-mono text-neon-cyan uppercase tracking-wider">
          <BrainIcon className="h-4 w-4 shrink-0 text-neon-cyan" aria-hidden />
          LONG_MEMORY
        </p>
        <p className="text-[10px] text-void-dim leading-relaxed">
          Long memory and reminders sync both ways via the local server while the desktop app is
          running (~30s).
        </p>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-neon-cyan"
            checked={useLongMemoryInActiveChat}
            onChange={(e) => onToggleUseLongMemoryInActiveChat(e.target.checked)}
          />
          <span>
            <span className="text-xs font-mono text-neon-cyan uppercase tracking-wider">
              USE_LONG_MEMORY_GLOBALLY
            </span>
            <span className="mt-1 block text-xs text-void-dim">
              Apply long-memory retrieval to all chats, including newly created chats.
            </span>
          </span>
        </label>
        <div className="space-y-2 max-h-56 overflow-y-auto">
          {longMemories.length === 0 ? (
            <p className="text-xs text-void-dim">No saved long memory items yet.</p>
          ) : (
            longMemories.map((m) => (
              <div key={m.id} className="rounded border border-void-muted/30 bg-void-black/30 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-mono text-neon-green/80 uppercase">{m.kind}</div>
                  <div className="flex items-center gap-1">
                    {editingMemoryId !== m.id && (
                      <button
                        type="button"
                        className="text-[10px] font-mono text-neon-cyan/80 hover:text-neon-cyan"
                        onClick={() => startEditMemory(m)}
                      >
                        EDIT
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-[10px] font-mono text-neon-red/80 hover:text-neon-red"
                      onClick={() => void onDeleteLongMemory(m.id)}
                    >
                      DELETE
                    </button>
                  </div>
                </div>
                {editingMemoryId === m.id ? (
                  <div className="mt-1 space-y-1">
                    <textarea
                      className="w-full rounded border border-void-muted/50 bg-void-black/60 px-2 py-1 text-xs text-void-white outline-none focus:border-neon-cyan/50"
                      rows={2}
                      value={editingMemoryText}
                      onChange={(e) => setEditingMemoryText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          commitEditMemory()
                        } else if (e.key === 'Escape') {
                          cancelEditMemory()
                        }
                      }}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="cyber-btn text-xs"
                        onClick={commitEditMemory}
                      >
                        SAVE
                      </button>
                      <button
                        type="button"
                        className="px-2 py-0.5 text-[10px] font-mono text-void-dim hover:text-void-light"
                        onClick={cancelEditMemory}
                      >
                        CANCEL
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-void-light">{m.text}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bg-void-black/50 border border-neon-orange/25 p-4 rounded space-y-3">
        <p className="flex items-center gap-2 text-xs font-mono text-neon-orange uppercase tracking-wider">
          <ClockIcon className="h-4 w-4 shrink-0 text-neon-orange" aria-hidden />
          REMINDERS
        </p>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-neon-orange"
            checked={settings.reminderNotificationsEnabled}
            onChange={(e) =>
              setSettings((s) => ({ ...s, reminderNotificationsEnabled: e.target.checked }))
            }
          />
          <span>
            <span className="text-xs font-mono text-neon-orange uppercase tracking-wider">
              DESKTOP_NOTIFICATIONS
            </span>
            <span className="mt-1 block text-xs text-void-dim">
              Show a Windows toast when a scheduled reminder is due (requires the app to be running).
            </span>
            {notifPermission !== 'granted' && (
              <span className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono text-neon-yellow/90">
                  {notifPermission === 'unsupported'
                    ? 'Notifications not supported on this runtime.'
                    : notifPermission === 'denied'
                      ? 'Permission denied. Enable Voidcast notifications in Windows Settings → System → Notifications.'
                      : 'Permission not granted yet.'}
                </span>
                {notifPermission !== 'unsupported' && notifPermission !== 'denied' && (
                  <button
                    type="button"
                    className="cyber-btn text-xs"
                    onClick={() => void requestNotificationPermission()}
                  >
                    REQUEST PERMISSION
                  </button>
                )}
              </span>
            )}
          </span>
        </label>
        <div className="space-y-2 max-h-56 overflow-y-auto">
          {reminders.length === 0 ? (
            <p className="text-xs text-void-dim">No reminders yet.</p>
          ) : (
            reminders.map((r) => (
              <div
                key={r.id}
                className={`rounded border border-void-muted/30 bg-void-black/30 px-2 py-1.5 ${
                  r.status === 'done' ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-mono text-neon-orange/80 uppercase">
                    {r.when != null
                      ? new Date(r.when).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'General'}
                  </div>
                  <div className="flex items-center gap-1">
                    {r.status !== 'done' && (
                      <button
                        type="button"
                        className="text-[10px] font-mono text-neon-green/80 hover:text-neon-green"
                        onClick={() => void onMarkDoneReminder(r.id)}
                      >
                        DONE
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-[10px] font-mono text-neon-red/80 hover:text-neon-red"
                      onClick={() => void onDeleteReminder(r.id)}
                    >
                      DELETE
                    </button>
                  </div>
                </div>
                <div className={`text-xs text-void-light ${r.status === 'done' ? 'line-through' : ''}`}>
                  {r.text}
                </div>
                {r.tags.length > 0 && (
                  <div className="text-[10px] text-void-dim mt-0.5">[{r.tags.join(', ')}]</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  )
}
