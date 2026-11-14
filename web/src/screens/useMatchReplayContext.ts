import { useEffect, useMemo, useState } from 'react'
import type { MatchHighlightEvent, MatchScoreboardRow, MatchViewHeader } from '../lib/api/types'
import type { ReplayDocumentReady } from '../lib/replay/replayNormalize'
import { collectKillEvents } from '../features/match-view/_momentum'
import { buildFeedEntries, collectMedalEvents, killsOfFeed } from '../features/match-replay/model/killFeedLogic'
import { replayWindow } from '../features/match-replay/model/replayWindow'
import { medalsOfFeed } from '../features/match-replay/sound/announcerSound'
import { buildKillsFromDocument } from '../lib/replay/killsFromDocument'
import { useAuthState } from './useAuthState'
import { xuidOfGamertag } from './useDefaultViewpoint'

export interface ReplayContext {
  header: MatchViewHeader
  scoreboard: MatchScoreboardRow[]
  highlight_events: MatchHighlightEvent[]
  media: { media_items: unknown[] }
  source_unavailable: boolean
  regulation_seconds?: number
}

export function useMatchReplayContext(matchId: string, doc: ReplayDocumentReady) {
  const auth = useAuthState()
  const gamertag = auth.phase.phase === 'signed_in' ? auth.phase.gamertag : ''
  const xuid = xuidOfGamertag(doc.roster, gamertag)
  const [context, setContext] = useState<ReplayContext | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setContext(null)
    const load = async () => {
      try {
        const query = xuid ? `?xuid=${encodeURIComponent(xuid)}` : ''
        const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}/context${query}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json() as ReplayContext
        if (controller.signal.aborted) return
        setContext(data)
        if (data.source_unavailable) timer = setTimeout(() => void load(), 30_000)
      } catch (err) {
        if (!controller.signal.aborted) console.warn('Failed to load match context', err)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [matchId, xuid])

  return useMemo(() => {
    const identity = new Map((context?.scoreboard ?? []).map((row) => [row.xuid, { ally: false }]))
    const events = context?.highlight_events ?? []
    const feed = buildFeedEntries(collectKillEvents(events, identity), collectMedalEvents(events), context?.header.t0_ms ?? 0, doc)
    return {
      context,
      // Until the context arrives (or if it cannot load), the kills the document itself
      // carries keep the kill feed and kill markers drawn.
      kills: context ? killsOfFeed(feed) : buildKillsFromDocument(doc),
      medals: medalsOfFeed(feed),
      playWindow: replayWindow(doc, context?.header),
      timeLimitMs: context?.regulation_seconds != null ? context.regulation_seconds * 1000 : null,
    }
  }, [context, doc])
}
