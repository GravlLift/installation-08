// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { installClientErrorReporting } from './lib/clientLog'
import { installCacheDebugHook } from './features/match-replay/scene3d/sessionCacheDebug3d'
import { installRendererDebugHook } from './features/match-replay/scene3d/sessionRendererDebug3d'
import './index.css'
import './ui/broadcast.css'

// The page's uncaught errors and unhandled rejections go to server.log.
installClientErrorReporting()

// Dev-only: exposes window.__it3dCacheDebug(key?) and window.__it3dRendererDebug() for live
// introspection (never in prod).
if (import.meta.env.DEV) {
  installCacheDebugHook()
  installRendererDebugHook()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
