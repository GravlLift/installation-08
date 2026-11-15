# UI design

The look and layout of the app's pages. This is the reference for the page redesign: what
each page is, how it behaves, and what it needs from the server. Sections are numbered so a
later discussion can point at one and drill into it.

Status: draft 1, 2026-11-13. Phase 1 (pages with still images) is the work in progress.

## 1. The idea

A televised Halo event. The app should feel like the broadcast of a big match: a studio
with large screens, lower-third graphics, a featured game, a pre-game countdown. The
structure borrows from the game's own menus so it feels native to a Halo player: a list of
selectable rows on the left, a large image with a caption on the right, driven by keyboard
or gamepad.

What it replaces: a bare match table, an account box, and player controls copied from
LevelUp's replay page. None of that styling is kept.

## 2. Principles

1. **The match is the show.** Every page points toward watching a match. Chrome stays thin
   and gets out of the way once the replay plays.
2. **Game-menu navigation.** Lists are rows with one clearly focused row. Arrow keys, Enter
   and Escape do everything a mouse can. A gamepad maps onto the same actions.
3. **Broadcast graphics, not dashboards.** Information appears as on-air graphics (bars,
   plates, tickers), never as tables or cards.
4. **Our own controls.** No component is copied from LevelUp's player. There is no
   auto-play toggle: opening a match plays it.
5. **One stylesheet, tokens only.** Colors, type, spacing and motion come from tokens in one
   place. Pages do not carry ad hoc colors or sizes.
6. **Real waits become moments.** Fetching a film and building a map take real time; that
   time is the pre-game screen, not a progress panel.

## 3. Visual system

### 3.1 Color

Dark studio base, one broadcast accent, team colors only where teams are meant.

| Token | Use |
|---|---|
| `--studio-950`, `--studio-900`, `--studio-800` | page base, panels, raised plates (near-black blue-gray) |
| `--ink`, `--ink-dim`, `--ink-faint` | primary text, secondary text, labels and rules |
| `--air` | the on-air accent: focus bar, active row, key numbers (Halo HUD light blue) |
| `--air-hot` | sparing highlight for "live" marks and the countdown (warm amber) |
| `--team-ally`, `--team-enemy` | team ink; follows the user's team color settings |
| `--win`, `--loss` | result marks only |

The HUD and scene tokens the 3D view already reads keep their names and values.

### 3.2 Type

- Display: **Bahnschrift** (ships with Windows; a condensed DIN face that reads as sports
  broadcast), condensed width, uppercase, wide tracking for labels. Falls back to the
  system sans.
- Body: the system sans (Segoe UI).
- Numbers: tabular figures everywhere a number can change (clock, score, countdown).
- Scale: 12 label, 14 body, 18 row title, 28 plate title, 56 feature title, 120 countdown.

No font is downloaded or bundled in phase 1.

### 3.3 Shape, texture, motion

- Angled plates: panels and the focus bar use a slanted edge (a clipped corner or a skewed
  end), the one recurring shape.
- Thin rules and small corner ticks frame content, as on a broadcast graphics package.
- Backdrop treatment: the page's map image fills the screen, blurred, darkened and tinted
  toward the studio color, with a vignette and a faint scanline texture. The same image is
  shown sharp only inside the preview panel.
- Motion: short and purposeful. Focus bar slides between rows (120 ms). A page change wipes
  like a broadcast transition (250 ms). The backdrop drifts slowly (a 40 s pan and zoom).
  Everything respects the system's reduced-motion setting.

## 4. Pages

### 4.1 Home (new)

The broadcast desk. There is no home page today.

- Backdrop: a map still, rotating among the maps of stored matches.
- Top bar: the app mark on the left; on the right the signed-in gamertag, or "Sign in".
- Feature plate: the most recent stored match as "the featured game": map, mode, score,
  result, date, and a primary **Watch** action.
- Main menu, as rows: **Watch** (stored matches), **Recent matches** (from the account,
  when signed in), **Settings**, **Quit** (packaged build only).
- Ticker along the bottom: status lines (assets building, coatings off, sign-in state).
- First run, nothing stored: the feature plate becomes the sign-in prompt and explains the
  three steps (sign in, fetch a match, watch).

### 4.2 Match select

Loading a game in Halo: list on the left, image with caption on the right.

- Left: one list of rows. Each row: map name, mode, result mark and score, date. Stored
  matches and the account's recent matches share the list; a row not yet fetched shows a
  **Fetch** state instead of a score.
- Right: the highlighted row's map image, sharp, with a caption plate: map, mode, playlist,
  score, duration, date, and the two rosters by team.
- Backdrop: the highlighted row's map, treated as in 3.3, cross-fading as focus moves.
- Actions on the focused row: Enter watches (or fetches, then watches); a secondary key
  refetches or removes.
- Filters as tabs above the list: All, Stored, by mode. Kept minimal.

### 4.3 Pre-game (loading)

Replaces the fetch and map-build progress panels.

- Full-screen map image with the match plate: map, mode, teams listed against each other
  as in the game's pre-match screen.
- A single progress line with the real step name (fetching film, building map, building
  variant layer). Real progress, never a fake bar.
- When everything is ready: a short countdown (3, 2, 1) in the game's style, then the
  replay starts. Any key skips the countdown.
- A long first build (minutes) says so plainly and keeps the page interesting: rosters,
  the scoreboard of the match, medals.

### 4.4 Player

Sparse on purpose: the 3D view takes all the room the chrome leaves.

- Layout, windowed: a vertical stack that fills the window and never scrolls. The top strip
  (← Matches, map, mode, date, coatings notice), then the stage, then the transport bar.
  The stage holds the 16:9 scene box, as large as fits, centered across and sitting on the
  bar (spare height goes under the strip). Nothing from the strip or the bar is drawn over
  the scene, so the whole HUD shows, the bottom strip (weapons, grenades, equipment)
  included, and neither one hides.
- Layout, fullscreen: the scene box fills the screen and the strip and the bar are laid
  over it. They hide 3 s after the last activity (mouse move over the player, key, click,
  focus), paused or playing, and come back on the next one; they stay up while a panel of
  their own is open, while the scrub bar is dragged and while the pointer is over them
  (`usePlayerChromeVisibility`).
- Top: a thin score bug (teams, score, clock), broadcast style, already present as the HUD
  overlays; restyled to the system, not redesigned in behavior.
- Bottom: our own transport as a lower third: the scrub bar, and under it a three-column
  row with the time dead center. Left: the camera group with the POV picker at the far
  left, then view and camera mode; then restart, previous event, play/pause and next event
  next to the time. Right: speed next to the time; at the far right sound, then
  scoreboard, settings, film export and fullscreen as icon buttons with hover tooltips.
  No seek buttons: Left and Right seek 10 s from the keyboard.
- The scrub bar marks the selected player's events only, as the game's theater does: his
  kills, deaths and medals (the selected player is the followed one, or in free view the
  last one followed; no player, no marks). One lane per kind so none hides another:
  medals (amber diamonds) above the track, kills (green ticks) on it, deaths (red
  triangles) below it. Within a lane, marks closer than 8 px group into one wider mark
  whose tooltip lists every event (`screens/scrubMarks.ts`). Clicking a mark seeks 2 s
  before its event and never starts a track drag; hovering shows what it is and its clock
  ("Kill: X (BR75) 2:36", "Death: by Y 2:54", "Double Kill 2:36"). The bar stays one tab
  stop: `[` and `]` (and the previous / next event buttons) step to the previous and next event. It fades
  only in fullscreen, with the rest of the chrome (see Layout, fullscreen).
- The camera group is the one home of every camera choice, under one "Camera" label: view
  (`3D | 2D`), camera mode (1st person, 3rd person, Free view, shown short as
  `1st | 3rd | Free` with the full names as tooltips and accessible names) and the POV
  picker. In 2D
  the mode segment stays in place, disabled, so the bar does not jump.
- Camera rule (`screens/cameraChoiceLogic.ts`): free view follows no one. The Free
  segment and the picker's "Free camera" entry are the same state. The player followed
  last stays the reference (the free camera starts behind him, team colors keep his side),
  and picking a player in free view follows him in the last follow mode.
- What each camera draws (`model/hudLevel.ts`): first person shows the arms rig and the
  whole HUD; third person keeps the followed player's whole HUD (weapon corner, grenades,
  shield, kill feed, kill popups, score strip) without the aim (reticle, scope masks,
  Bandit frame); free view follows no one and keeps the score strip and the kill feed; 2D
  keeps the score strip alone (the kill feed would sit over the map's lower left).
- The bar stays on one row down to a 1280 px window: when short of room the POV picker
  shrinks first (to 72 px, its name ellipsized). Only in a bar narrower than 1210 px do its
  groups wrap to a second row; a group never breaks inside.
- Panels opened from the bar (settings, export) open one at a time on the right inside the
  scene box (in fullscreen, between the strip and the bar laid over it), never over either;
  they scroll when taller than that space.
  The bar's button toggles its panel, Escape and a click outside close the settings
  drawer, and the export button shows the progress of a running export.
- Safe insets: the player publishes how far its chrome reaches into the 16:9 box as
  `--bc-chrome-top` and `--bc-chrome-bottom` (`usePlayerChromeInsets`): 0 windowed, the
  overlap in fullscreen. The bar's panels sit between them and the HUD's shield never goes
  above the top one.
- Fullscreen takes the whole player (scene, strip, bar, panels).
- No auto-play toggle.
- The settings drawer and the scoreboard keep their functions and take the new tokens. The
  scoreboard is one connected panel in the light-blue HUD style, the teams as its columns,
  each team header striped with its in-game team color. Columns follow the game's in-match
  scoreboard: Score, K, D, A (the film's counters at the current time, each only when the
  film records it), then the mode's stat from the match stats: Caps in CTF, Ball time in
  Oddball, Hill time in Strongholds and King of the Hill. The mode stat is a match total
  (the film has no per-player series for it) and the panel says so; rows rank by score.
- Back returns to match select with the same row focused.

## 5. Components

Shared pieces, each built once:

- `FocusList` and `FocusRow`: the gamepad-style list with one focused row; owns arrow,
  Enter, Escape and gamepad handling.
- `Plate`: the angled panel, in feature, caption and lower-third sizes.
- `Backdrop`: the treated full-screen map image with cross-fade and drift.
- `TopBar`, `Ticker`.
- `ScoreBug`, `Transport` (player page).
- `Countdown`.

## 6. Input

| Action | Keyboard | Gamepad |
|---|---|---|
| Move focus | arrow keys | d-pad, left stick |
| Select | Enter | A |
| Back | Escape | B |
| Play/pause | Space | A (in player) |
| Seek | Left/Right, J/L | bumpers |
| Scoreboard | Tab (hold) | View |
| Camera mode (3D view) | 1, 2, 3 (1st, 3rd, free) | |
| Previous / next event of the selected player | [ / ] | |
| View 3D / 2D | V | |
| Fullscreen | F | |

Mouse always works: hover focuses, click selects. Gamepad support is phase 1b; the focus
model is built for it from the start.

## 7. What the pages need from the server

Found while checking the current data (2026-11-13):

- **Match list rows need more fields.** `GET /api/matches` returns map name, map asset id,
  duration, players and import time. The rows also need mode, playlist, score, result and
  the time the match was played. All of them already exist in each match's stored context
  header; the list should carry them.
- **Recent (remote) matches have no image.** `GET /api/remote/matches` returns id, map
  name, mode and time. A row needs the map's asset id so the preview can show its image.
- **Map stills are small.** The stored images are 560 x 316. That is fine sharp in the
  preview panel and fine blurred as a backdrop, and too small for a sharp full-screen
  image. A larger image per map (the service's hero image) would be saved at fetch time.
- **A map image for maps with no stored match.** Home and the remote list want an image
  before the first fetch of that map.
- **Quit.** The packaged program runs with a console window; a Quit action needs a
  loopback-only shutdown route.

## 8. Phases

1. **Pages with stills** (now): the visual system, Home, Match select, Pre-game, the
   player's transport and score bug, using the existing map images.
   1b. Gamepad input.
2. **Light map build**: a lower-detail map file small enough to load on a menu page.
3. **Live backdrops**: replace the stills with the 3D map and a camera that drifts and
   flies between pages. Later, optionally, menu rows placed on a surface in the map.

## 9. Open questions

1. Name and mark: does the app keep "Infinite Theater 3D" on air, and does it get a logo?
2. Home's featured game: the most recent stored match, or the most recent match the
   signed-in player won?
3. Countdown: always, or only the first time a match is opened?
4. Stored and remote matches in one list (as drafted in 4.2) or two tabs?
5. Larger map images: fetch the hero image for every map up front on sign-in, or only as
   matches are fetched? (As built: only as matches are fetched; a stored image under
   1000 px wide is replaced on the next fetch of a match on that map.)

## 10. 2D view (live: `V` or the `3D | 2D` switch; corner minimap in 3D: `N`)

A top-down view of the match, our own, built from the map we already load rather than from
hand-made background images. Origin: a birds-eye render of Live Fire made while checking
the grass, which read as a usable map straight away.

- **Source**: the built map mesh, drawn by an orthographic camera looking straight down.
  The camera's bounds are known, so world position to pixel is exact with no per-map
  calibration. Works for any map that has a mesh, Forge maps included. The map keeps its
  own painted materials; nothing is swapped for flat colors.
- **Roofs** are the problem: seen from above, most of a map is rooftop and the floors
  people fight on are hidden.
- **Chosen approach: one fixed picture of the whole map.** The camera cuts a headroom over
  the match's highest walked floor (so no roof over it) and stops under its lowest one, both
  fixed for the match (`topDownLogic.ts`), so the map's pixels never change during playback:
  it only pans and zooms. A cut that followed the followed player (his floor shown, every
  slab over his head cut away, the floors above as a faint ghost image) was tried and
  dropped on 2026-11-15: the map changed shape as he moved, which looked wrong and did not
  help. Height bands clustered from the walked heights failed earlier on Recharge: ramps
  make the walked heights continuous.
- **Lighting and height** (`topDownShade3d.ts`, `topDownStage3d.ts`): every map surface drops
  the sun, the game's lamps and baked light and the probes' reflections for one flat light
  (full on floors, 0.6 on walls, metals reflecting the same flat value), so there are no hot
  spots or skylight pools. Levels read by an absolute height shading over the match's walked
  span: its highest floor at full light, its lowest at 0.6 with a cool tint. The swap is one
  shared uniform per render; the 3D lighting is untouched and the shadow map is not redrawn
  while the top-down view shows.
- **Left out** (`hiddenFromTop` in `topDownLogic.ts`): grass and foliage clumps, the coarse
  `decor*` nodes, every see-through or blended surface (decals, light cards, glass), every
  alpha-tested cutout of the Forge object layer (ivy, plants, shrubs, leaves), and map
  cutouts that do not lie flat (foliage cards; a flat grate or mesh floor stays).
- **Framing** (`topDownNavLogic.ts`, `topDownInput3d.ts`): the walked area fits the scene box,
  and in fullscreen between the top strip and transport bar laid over it (read from the
  page; their place is kept while they fade out). Wheel zooms toward the cursor (up to 8x), a drag pans, both clamped to the
  area; a double click or `0` goes back to the whole map. Zoomed in, the view keeps the
  followed player inside its central 60%; a drag hands the framing to the viewer until the
  next reset.
- **Players** (`playerMarkers3d.ts`): a disc in team color at the feet with a facing wedge,
  a fixed size on screen at any zoom, drawn over the map on a light edge and a dark halo
  (ink and studio tokens) so it reads on dark and bright floors; a ring on the followed
  player; every living player is drawn, and a player on another floor than the followed
  one (over his head, or well below his feet) is dimmed to 0.75 with an up or down arrow
  in his disc and on his tag. A dead player waiting to respawn is a cross in his team color where
  he fell. Name tags do not pile up: in rank order (the followed player, then the drawn
  floor, then the other floors) each tag goes over its marker, else under it, else is
  hidden.
- **Corner minimap** (`topDownMinimap3d.ts`, `minimapLogic.ts`): in first and third person,
  a square at the top right (the kill feed holds the bottom left) with the same fixed map
  picture around the followed player, 40 u across, with a dot per living player. The map
  around him is rendered into a cached image twice the minimap's span, redone only when he
  strays from its center, at most twice a second; each frame only draws the turned square
  and the dots. `N` shows or hides it (`M` is the sound key); the choice is remembered.
- **Not decided**: what objectives, weapons on the ground and kills look like on it.
