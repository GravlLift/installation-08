/**
 * App — the whole standalone page, now routed: a match list (`MatchListScreen`) and a match
 * view (`MatchViewScreen`) that mounts the lifted 3D scene over real server data. No router
 * dependency is installed, so this is a minimal hand-rolled hash router: `#/` is the list,
 * `#/matches/<id>` is a match. See `docs/PARITY.md` for what each screen still cannot feed
 * the 3D view from this server alone.
 */
import { useEffect, useState } from 'react'

import { MatchListScreen } from './screens/MatchListScreen'
import { MatchViewScreen } from './screens/MatchViewScreen'

type Route = { name: 'list' } | { name: 'match'; matchId: string }

function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/'
  const match = /^\/matches\/([^/]+)\/?$/.exec(path)
  if (match) return { name: 'match', matchId: decodeURIComponent(match[1]) }
  return { name: 'list' }
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
        onBack={() => navigate('/')}
      />
    )
  }

  return (
    <MatchListScreen
      onOpenMatch={(matchId) => navigate(`/matches/${encodeURIComponent(matchId)}`)}
    />
  )
}
