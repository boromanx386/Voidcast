import './App.css'
import './styles/hljs-voidcast.css'
import type { RefObject } from 'react'
import { ChatScreen } from '@/components/chat/ChatScreen'
import { OptionsScreen } from '@/components/options/OptionsScreen'
import { WindowTitleBar } from '@/components/WindowTitleBar'
import { useVoidcastApp } from '@/hooks/useVoidcastApp'

export default function App() {
  const app = useVoidcastApp()
  const onOptions = app.screen === 'options'

  return (
    <div className="relative flex h-full flex-col">
      <WindowTitleBar />
      <audio
        ref={app.audioRef as RefObject<HTMLAudioElement>}
        className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
        aria-hidden
        preload="auto"
      />
      <div className={onOptions ? 'hidden' : 'min-h-0 flex-1'} aria-hidden={onOptions}>
        <ChatScreen app={app} />
      </div>
      {onOptions ? (
        <div className="min-h-0 flex-1">
          <OptionsScreen app={app} />
        </div>
      ) : null}
    </div>
  )
}
