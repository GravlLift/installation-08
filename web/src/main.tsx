import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { installCacheDebugHook } from './features/match-replay/scene3d/sessionCacheDebug3d'
import './index.css'
import './ui/broadcast.css'

// Dev-only: exposes window.__it3dCacheDebug(key?) for live cache introspection (never in prod).
if (import.meta.env.DEV) installCacheDebugHook()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
