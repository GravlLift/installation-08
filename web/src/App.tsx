/**
 * App — the whole standalone page, routed: the broadcast Home (`HomeScreen`) at `#/`, the
 * match list (`MatchListScreen`) at `#/matches`, and a match view (`MatchViewScreen`) at
 * `#/matches/<id>` that mounts the lifted 3D scene over real server data. No router
 * dependency is installed, so this is a minimal hand-rolled hash router.
 */
import { useEffect, useState } from 'react'

import { HomeScreen } from './screens/HomeScreen'
import { MatchListScreen } from './screens/MatchListScreen'
import { MatchViewScreen } from './screens/MatchViewScreen'

export type Route = { name: 'home' } | { name: 'list' } | { name: 'match'; matchId: string }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/'
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

  if (route.name === 'match') {
    return (
      <MatchViewScreen
        matchId={route.matchId}
        onBack={() => navigate('/matches')}
      />
    )
  }

  if (route.name === 'list') {
    return (
      <MatchListScreen
        onOpenMatch={(matchId) => navigate(`/matches/${encodeURIComponent(matchId)}`)}
      />
    )
  }

  return <HomeScreen />
}
