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

Sparse on purpose: the 3D view fills the window.

- Top: a thin score bug (teams, score, clock), broadcast style, already present as the HUD
  overlays; restyled to the system, not redesigned in behavior.
- Bottom: our own transport as a lower third. Play/pause, a scrub bar with kill and
  objective marks, time, speed, camera mode (first person, third person, free), the
  player picker, sound, settings, fullscreen. It fades out while playing and returns on
  mouse move or key press.
- No auto-play toggle.
- The settings drawer and the scoreboard keep their functions and take the new tokens.
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

## 10. 2D view (idea, not started)

A top-down view of the match, our own, built from the map we already load rather than from
hand-made background images. Origin: a birds-eye render of Live Fire made while checking
the grass, which read as a usable map straight away.

- **Source**: the built map mesh, drawn by an orthographic camera looking straight down.
  The camera's bounds are known, so world position to pixel is exact with no per-map
  calibration. Works for any map that has a mesh, Forge maps included.
- **Roofs** are the problem: seen from above, most of a map is rooftop and the floors
  people fight on are hidden.
- **Chosen approach: one image per floor.** Slice the map into height bands and render
  each band from above with everything over it removed. The view shows the band the
  followed player is on and switches as they change floor; other floors can show faintly.
  Needed in any case for stacked maps such as Recharge.
- **Where the bands come from**: the film. Every position a player stood on is in the
  replay, so the walked heights cluster into floors without tuning by hand. To check
  against maps with ramps and uneven ground (Live Fire) before trusting it.
- **Lighting**: flat light from above. The baked sun gives long shadows that read as walls.
- **On screen**: full size as its own view of the player (as the 2D replay it replaces
  was), with the same transport; later a corner minimap over the 3D view.
- **Not decided**: rendered once per map and stored, or drawn live from the loaded mesh;
  what the players, objectives, weapons on the ground and kills look like on it.
