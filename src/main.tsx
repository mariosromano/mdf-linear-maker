import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { readBridgeFlags } from './lib/bridge'

// Apply the MakeReal house theme before first paint when embedded with ?theme=makereal
if (readBridgeFlags().makerealTheme) {
  document.documentElement.dataset.theme = 'makereal'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
