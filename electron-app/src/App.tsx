import './App.css'
import './styles/hljs-voidcast.css'
import type { RefObject } from 'react'
import { ChatScreen } from '@/components/chat/ChatScreen'
import { OptionsScreen } from '@/components/options/OptionsScreen'
import { useVoidcastApp } from '@/hooks/useVoidcastApp'

export default function App() {
  const app = useVoidcastApp()
  const onOptions = app.screen === 'options'

  return (
    <div className="relative h-full">
      <audio
        ref={app.audioRef as RefObject<HTMLAudioElement>}
        className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
        aria-hidden
        preload="auto"
      />
      <div className={onOptions ? 'hidden' : 'h-full'} aria-hidden={onOptions}>
        <ChatScreen app={app} />
      </div>
      {onOptions ? (
        <div className="absolute inset-0 h-full">
          <OptionsScreen app={app} />
        </div>
      ) : null}
    </div>
  )
}
