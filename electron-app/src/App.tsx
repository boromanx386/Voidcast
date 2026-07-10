import './App.css'
import './styles/hljs-voidcast.css'
import { ChatScreen } from '@/components/chat/ChatScreen'
import { OptionsScreen } from '@/components/options/OptionsScreen'
import { useVoidcastApp } from '@/hooks/useVoidcastApp'

export default function App() {
  const app = useVoidcastApp()

  if (app.screen === 'options') {
    return <OptionsScreen app={app} />
  }

  return <ChatScreen app={app} />
}
