/**
 * Screen — the broadcast page frame: the Backdrop behind, the TopBar on top, the page's
 * content in the middle and the Ticker at the bottom. Every broadcast page is one Screen;
 * the keyed `bc-view` div replays the broadcast wipe animation (260 ms) on each page change.
 */
import type { ReactNode } from 'react'

import { Backdrop } from './Backdrop'
import { Ticker, type TickerProps } from './Ticker'
import { TopBar, type TopBarProps } from './TopBar'

export interface ScreenProps extends TopBarProps, TickerProps {
  /** Re-keys the view, so a page change replays the wipe animation. */
  id: string
  /** The page body, laid out by the page's own class (e.g. `bc-home`). */
  children: ReactNode
  /** The map image behind the page. */
  backdropUrl: string | null
  /** A sharper backdrop treatment. */
  sharp?: boolean
}

export function Screen({
  id,
  gamertag,
  onSignIn,
  crumb,
  items,
  keys,
  backdropUrl,
  sharp,
  children,
}: ScreenProps) {
  return (
    <>
      <Backdrop imageUrl={backdropUrl} sharp={sharp} />
      <div className="bc-stage">
        <header>
          <TopBar gamertag={gamertag} onSignIn={onSignIn} crumb={crumb} />
        </header>
        <main className="bc-main">
          <section key={id} className="bc-view">
            {children}
          </section>
        </main>
        <Ticker items={items} keys={keys} />
      </div>
    </>
  )
}
