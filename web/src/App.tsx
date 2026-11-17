// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * App — the whole standalone page, routed: the broadcast Home (`HomeScreen`) at `#/`, the
 * match select page (`MatchSelectScreen`) at `#/matches`, and a match view
 * (`MatchViewScreen`) at `#/matches/<id>` that mounts the lifted 3D scene over real server
 * data. No router dependency is installed, so this is a minimal hand-rolled hash router.
 */
import { useEffect, useState } from 'react'

import { HomeScreen } from './screens/HomeScreen'
import { MatchSelectScreen } from './screens/MatchSelectScreen'
import { MatchViewScreen } from './screens/MatchViewScreen'
import { OptimizeBanner } from './ui/OptimizeBanner'

export type Route = { name: 'home' } | { name: 'list' } | { name: 'match'; matchId: string }

export function parseHash(hash: string): Route {
  // A query on the route (the sign-in link's `?signin=1`) is read by the page itself, not
  // matched here: without dropping it, `#/matches?signin=1` fell through to Home.
  const path = hash.replace(/^#/, '').split('?')[0] || '/'
  const match = /^\/matches\/([^/]+)\/?$/.exec(path)
  if (match) return { name: 'match', matchId: decodeURIComponent(match[1]) }
  if (/^\/matches\/?$/.test(path)) return { name: 'list' }
  return { name: 'home' }
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  return route
}

function navigate(path: string): void {
  window.location.hash = path
}

export function App() {
  const route = useHashRoute()

  return (
    <>
      <OptimizeBanner />
      {route.name === 'match' ? (
        <MatchViewScreen matchId={route.matchId} onBack={() => navigate('/matches')} />
      ) : route.name === 'list' ? (
        <MatchSelectScreen />
      ) : (
        <HomeScreen />
      )}
    </>
  )
}
