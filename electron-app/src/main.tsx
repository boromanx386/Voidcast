import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { initLanAccess } from './lib/lanAuth'
import App from './App'
import './theme-minimal.css'
import './theme-matrix.css'
import './theme-light.css'
import './theme-blood-moon.css'
import './theme-obsidian.css'
import './theme-terminal.css'
// If you want use Node.js, the`nodeIntegration` needs to be enabled in the Main process.
// import './demos/node'

// Must run before any API call: bootstrap ?t= token + install the fetch interceptor.
initLanAccess()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

postMessage({ payload: 'removeLoading' }, '*')
