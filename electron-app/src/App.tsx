import './App.css'
import './styles/hljs-voidcast.css'
import type { RefObject } from 'react'
import { ChatScreen } from '@/components/chat/ChatScreen'
import { OptionsScreen } from '@/components/options/OptionsScreen'
import { WinChromeBoot } from '@/components/WinChromeBoot'
import { WindowControls } from '@/components/WindowControls'
import { useVoidcastApp } from '@/hooks/useVoidcastApp'

export default function App() {
  const app = useVoidcastApp()
  const onOptions = app.screen === 'options'

  return (
    <div className="relative flex h-full flex-col">
      <WinChromeBoot />
      <audio
        ref={app.audioRef as RefObject<HTMLAudioElement>}
        className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
        aria-hidden
        preload="auto"
      />
      <div className={onOptions ? 'hidden' : 'min-h-0 flex-1'} aria-hidden={onOptions}>
        {app.historyStatus === 'offline' ? (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1">
              <ChatScreen app={app} />
            </div>
            <p
              role="alert"
              className="border-t border-neon-yellow/30 bg-neon-yellow/5 px-4 py-1.5 text-center font-mono text-xs text-neon-yellow"
            >
              Saved chats are unavailable and new chats are not being saved. Restart the app to try
              loading them again.
            </p>
          </div>
        ) : app.sessionsHydrated ? (
          <ChatScreen app={app} />
        ) : (
          <div className="flex h-full flex-col">
            <header className="voidcast-header justify-end">
              <WindowControls />
            </header>
            <div className="m-auto p-4 text-center text-void-text">
              {app.historyStatus === 'failed' ? (
                <>
                  <p role="alert">Could not load saved chats. Chat saving is paused.</p>
                  <div className="mt-3 flex justify-center gap-2">
                    <button className="cyber-btn" type="button" onClick={app.retryChatHistory}>
                      Retry loading chats
                    </button>
                    <button
                      className="cyber-btn"
                      type="button"
                      onClick={app.continueWithoutHistory}
                    >
                      Continue without saved chats
                    </button>
                  </div>
                </>
              ) : (
                <p role="status">Loading chats…</p>
              )}
            </div>
          </div>
        )}
      </div>
      {onOptions ? (
        <div className="min-h-0 flex-1">
          <OptionsScreen app={app} />
        </div>
      ) : null}
    </div>
  )
}
