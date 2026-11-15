# Feature parity: LevelUp replay page vs standalone 3D shell

Source (read-only): `P:\software\LevelUp\.worktrees\replay-3d\apps\web\src\features\match-replay\` and `src\lib\replay\`.
Target: `P:\software\infinite-theater-3d` `web\src\`.
`Replay3DView.tsx` and its scene3d/model/layers/sound/settings/export dependencies were lifted into the
target; the gap was in what calls them and in which supporting files were left behind.

The app is routed (`App.tsx`, a hand-rolled hash router) between `screens/MatchListScreen.tsx`
(`GET /api/matches`) and `screens/MatchViewScreen.tsx` (fetches the document, context and mesh for one
match id and mounts `Replay3DView`). `src/lib/api/standalone.ts` is the client for this server's own
routes, reached through the Vite dev proxy (`vite.config.ts`, `/api` to `127.0.0.1:8177`).
`screens/useMatchReplayContext.ts` fetches `GET /api/matches/{id}/context` (header, scoreboard,
regulation, kill and medal events) and feeds the kill feed, the score banner data and
`playWindow`/`timeLimitMs`; until it arrives, `buildKillsFromDocument` keeps the kill feed drawn
from the document's own `killCauses`.

## 1. Replay3DView props (view inputs)

| Feature | Source in LevelUp (file:line) | State in standalone | What is needed to wire it |
|---|---|---|---|
| meshPath (map GLB) | `ui/Replay3DView.tsx:56`, fed by `lib/replay/meshBuild.ts:217-236` (`useReplayMesh3d`) and `lib/replay/queries.ts:128` (`replayMeshPath`) | **wired**: `src/lib/api/standalone.ts` (`meshUrl`) points at this server's own `GET /api/matches/{id}/mesh.glb`, through the Vite dev proxy; `MatchViewScreen` pre-checks it with `checkMesh` (a `HEAD`, falling back to a `GET` of the typed 404 body) before mounting the 3D view. `mesh_not_built` shows a build panel (`screens/useMeshBuild.ts` + `MeshBuildPanel` in `MatchViewScreen.tsx`) instead of a dead end: it checks `GET .../mesh/state` once (a build may already be queued/building from another tab), offers a "Build map" button that calls `POST .../mesh/build`, polls the state route every 2s while queued/building, and mounts the 3D view the moment it reports `ready` (no reload). The panel also offers **Cancel** (`POST .../mesh/cancel`, `ca86818`). `failed` shows the server's error text and a Retry button | none |
| variantPath (mvar object layer) | `ui/Replay3DView.tsx:58`, `meshBuild.ts:73,141` | **wired** (`1839da2`): `screens/useVariantLayer.ts` polls `GET /api/matches/{id}/variant/state` and passes the `variant.glb` URL once the per-match variant layer is built (built by `POST .../variant/build` or the serve startup queue) | none |
| weaponsPath (weapon models folder) | `ui/Replay3DView.tsx:59`, consumed by `scene3d/weaponModels3d.ts:108` via `Replay3DView.tsx:190-194` | server done: `GET /api/weapons` + `GET /api/weapons/{key}.glb` (built by `build-weapons` or `POST /api/weapons/build`). **wired**: `screens/MatchViewScreen.tsx` passes `weaponsPath="/api/weapons"` | none |
| armor (spartan armor manifest + pieces) | `ui/Replay3DView.tsx:61`, `meshBuild.ts:77,228-231`, `lib/replay/spartanArmor.ts:87-103` | **wired** (`5a0f9c0`, `95972d7`): `GET /api/matches/{id}/spartans` serves each player's armor manifest from the cached GameCMS definitions, and `MatchViewScreen.tsx` passes a `ReplayArmorSource` (`matchId`, `piecesPath`) to the scene, which loads the piece library from `GET /api/spartan-pieces/{file}` | prosthetics and armor coatings are still open, see §5 |
| doc (replay document) | `lib/replay/queries.ts:37-79` (`useMatchReplay`, route `/players/{slug}/matches/{id}/replay`) | **wired**: `src/lib/api/standalone.ts` (`fetchReplayDocument`) calls this server's own `GET /api/matches/{id}/replay` (gzip over the wire, decompressed transparently by `fetch`) through the Vite proxy; `normalizeReplayDocument` kept unchanged | none |
| frameRef / playback clock | n/a (page-local ref) | wired: `screens/MatchViewScreen.tsx` (`ReplayViewer`'s `frameRef`), driven by `PlaybackBar`'s `requestAnimationFrame` loop in the same file | none, functionally equivalent (LevelUp's `useReplayClock`/`useReplayPlayback` are richer but not required) |
| viewpoint (followed player) | `ui/ReplayCanvas.tsx:192` (required prop, page-resolved) | wired: `screens/MatchViewScreen.tsx` state + `<select>` in `PlaybackBar` | none |
| colorOfXuid | `layers/useSlotIdentity.ts:239-246` (team-ally/team-enemy semantic tokens) | **wired**: `src/lib/replay/teamIdentityFromDocument.ts` reads `doc.roster[].team` (the SAME sole source of allegiance `filmAllegiance.ts` uses) and resolves it through `rosterLogic.colorByXuidResolver` + the real `useReplayInks` team tokens (light-blue ink, `6d0a37d`) | `useSlotIdentity.ts`'s scoreboard join and bot-takeover ("fiche") gating via `seatLogic.ts` are NOT ported (neither file exists here) |
| locale | `ui/Replay3DView.tsx:67` | wired, hardcoded `'en'`: `screens/MatchViewScreen.tsx` | fine for a standalone shell; add a picker if i18n parity is wanted |
| width / height | `ui/Replay3DView.tsx:68-69` | wired: `ResizeObserver` in `screens/MatchViewScreen.tsx` (`ReplayViewer`) | none |
| compact | `ui/Replay3DView.tsx:71`, used by `Replay3DSlot.tsx:73` for the inset view | not used (default `false`); no inset view exists in the shell | n/a unless an inset/picture-in-picture mode is added |
| active | `ui/Replay3DView.tsx:73`, used by `Replay3DSlot.tsx:73` to freeze rendering when 2D is shown | not used (default `true`); shell has no 2D mode to switch away to | n/a unless a 2D fallback is added |
| action.shotFx | `scene3d/action3dInputs.ts:42`, built in `ui/ReplayCanvas.tsx:358-364` from `useReplayFx`/`useReplayStaticLayers` | **wired**: `MatchViewScreen` calls `buildShotFx(doc, aimHoldFrames)` directly (shot tints restored and saturated, `be2bad7`, `d67b04f`) | `aimHoldFrames` uses a fixed 0.6s-of-gameplay default, same as LevelUp's own page |
| action.kills | `scene3d/action3dInputs.ts:43`, from `ui/ReplayCanvas.tsx:250` (`killsOfFeed(feedEntries)`) | **wired**: `useMatchReplayContext.ts` builds feed entries from the context's highlight events (`collectKillEvents`, `collectMedalEvents`, `buildFeedEntries`), falling back to `buildKillsFromDocument` (`doc.killCauses`) until the context arrives; weapon icons resolve through the weapon label catalog (`a855cb6`, `c76bff5`, `498f965`) | none |
| action.mapObjectives | `scene3d/action3dInputs.ts:44`, `ui/ReplayCanvas.tsx:339` (`normalizeMapObjectives(doc.mapObjectives)`) | **wired**: `MatchViewScreen` calls `normalizeMapObjectives(doc.mapObjectives)`; objective zones for King of the Hill and Strongholds are filled from the match's stored `map.mvar` at fetch/import time (`serve_objectives.go`) | none |
| action.allegiance / pageAllegiance | `scene3d/action3dInputs.ts:46-51`, from `doc`'s film allegiance model, required prop of `ReplayCanvas.tsx:175` | **wired**: `teamIdentityFromDocument.ts` calls the SAME `buildFilmAllegiance` the source page uses, referenced on the followed viewpoint (falling back to the first roster entry) | none |
| action.inks (per-player colors) | `layers/useReplayInks.ts`, theme-aware palette version | wired, but theme-independent: `screens/MatchViewScreen.tsx` (`useReplayInks(0)`, palette version hardcoded to 0) | pass a real palette-version signal if the shell ever supports theme switching |
| action.show.* (layer toggles) | `scene3d/action3dInputs.ts:21-39`, driven by `useReplaySettings`/`useReplayDrawer` toggle panel in `ui/ReplayCanvas.tsx:274,710-729` | **wired**: `screens/MatchViewScreen.tsx` (`useAction3dShow`) builds the 12 `Action3dShow` flags straight from `useReplaySettings` (already lifted), and the "Layers" section of `ReplaySettingsDrawer` toggles them live | `useReplaySettings`' other fields (aim/zones/trail/heatmap/marker colors) stay unread; they drive the 2D canvas only |
| action.shotHoldFrames / framesPerSecond / deathHoldFrames | `ui/ReplayCanvas.tsx:364` | wired: `screens/MatchViewScreen.tsx` computed from `framesPerSecond(doc)` | none |
| action.colorOfSlot / nameOfSlot | `layers/useSlotIdentity.ts:217-238` (slot ownership resolved from the film) | **wired**: `teamIdentityFromDocument.ts` builds the same slot-ownership resolvers `rosterLogic.ts` exports, with the context scoreboard as the name source and no seat gating | a slot a human has "taken over" from a bot still shows the bot's color/name (no `seatLogic.ts`) |
| action.nameOfXuid | `layers/useSlotIdentity.ts:238` (roster-based name resolver) | wired, different source: `screens/MatchViewScreen.tsx` looks up `doc.roster` directly via `displayPlayerName`, falling back to `teamIdentityFromDocument`'s own `nameOfXuid` | functionally equivalent |
| action.seatedOfXuid | `layers/useSlotIdentity.ts:250` (`seated.isSeated`, tracks bot takeover) | stubbed: `screens/MatchViewScreen.tsx` always returns `true` (no `seatLogic.ts`) | port the seated/bot-takeover logic if bot handling matters |
| action.locale | same as top-level `locale` | wired `'en'`: `screens/MatchViewScreen.tsx` | none |
| aids (3D analysis overlays) | `settings/useReplay3dAids.ts`, merged inside `Replay3DView.tsx:112-113` | **wired**: hook is lifted unchanged and called inside `Replay3DView.tsx`; the `Aids3dSection` in `ReplaySettingsDrawer` toggles each of the 8 flags live | none |
| playWindow | `ui/Replay3DView.tsx:77`, computed once per page in LevelUp's `model/replayWindow.ts` | **wired**: `replayWindow(doc, context.header)` in `useMatchReplayContext.ts`, fed by the context route's `header.t0_ms` / `playable_duration_seconds` (`74e6c0b`) | none |
| timeLimitMs | `ui/Replay3DView.tsx:83`, from match context header | **wired**: `context.regulation_seconds * 1000` in `useMatchReplayContext.ts` | none |
| soundListenerRef | `ui/Replay3DView.tsx` and `sound/useReplaySound.ts` | **wired**: the 3D camera updates the sound listener every frame (spatial sound enabled, `dcdbf8f`) | none |

## 2. Controls around the 3D view (not props of the view)

| Feature | Source in LevelUp (file:line) | State in standalone | What is needed to wire it |
|---|---|---|---|
| Play / pause | `ui/ReplayTransport.tsx` via `useReplayPlayback` | wired, minimal: `screens/MatchViewScreen.tsx` (`PlaybackBar`) plain button | none for parity of function; cosmetic only |
| Seek / scrubber | `ui/ReplayTransport.tsx` + `ui/ReplayTimelineTracks.tsx` (kill markers, presence bars, media thumbnails) | wired but bare: `screens/MatchViewScreen.tsx` plain `<input type="range">`, no track visuals | port `hooks/useReplayTimeline.ts` + `ui/ReplayTimelineTracks.tsx` |
| Speed control | `ui/ReplayTransport.tsx`, `useReplaySettings.setSpeed` | wired: `screens/MatchViewScreen.tsx` fixed `[0.25,0.5,1,2,4]` select | none |
| Follow / viewpoint picker | `ui/ReplayTimelineTracks.tsx` menu, resolved via `useReplayTimeline` | wired: `screens/MatchViewScreen.tsx` plain select over `doc.roster` | none |
| Camera mode (fp/tp/free) | `ui/Replay3DView.tsx:329-349` (buttons inside the lifted component) | wired: same code, lifted unchanged; the third-person camera stays out of the map through a spring arm (`c0c9be1`) | none |
| 2D / 3D toggle | `ui/Replay3DSlot.tsx:87-105` | missing: shell has no 2D canvas at all, so no toggle is needed or possible | n/a unless a 2D mode is ported too |
| Settings drawer (layer toggles, 3D aids, lighting/look, FOV) | `settings/ReplaySettingsDrawer.tsx`, `ReplaySettingsAids3d.tsx`, `ReplaySettingsLook3d.tsx` | **wired, simplified**: `features/match-replay/settings/ReplaySettingsDrawer.tsx` is a fresh shell (fixed bottom-right panel, Escape/click-outside/close-button dismiss, focus-on-open). It composes a ported `Aids3dSection`, a ported `Look3dSection`, and a `LayersSection` scoped to the 12 `Action3dShow` flags. Settings labels wrap instead of truncating (`fb1e79b`). `SettingsToggle`/`InfoMark` are local primitives since the source's version imports LevelUp's shadcn `Button` | left out on purpose: the 2D map's aim/zones/trail/heatmap toggles, marker-color choice and export; sound category filters are wired |
| Sound (toggle, volume, spatial listener) | `sound/useReplaySound.ts`, `sound/ReplaySoundControls.tsx` | **wired**: playback, seeking, volume, mute, categories and camera listener; spatial sound on (`dcdbf8f`) | missing sound assets are silent; the sound set is hand-produced and imported with `import-sounds` (see README) |
| Export / recording (image, video) | `export/useReplayExport.ts`, `ReplayExportDialog.tsx`, `Export3dChoice.tsx` | missing: only the export support files were lifted; the scene registers itself for export but nothing reads that registration | port the capture/encoder files and the export dialog (in progress, see TODO) |
| Kill feed | `ui/ReplayKillFeed.tsx`, fed by `action.kills` | **wired**: real kills from the context's highlight events (document `killCauses` until the context loads), the game's kill feed atlas sprite on every kill whose damage source the decode names (weapons, grenades, melee, vehicles, splatter, falls; contour icon as the last resort), a kill-details.json older than the sprite field re-decoded once on first request, kills without a weapon when the kill-details are absent (`a87b067`) | none |
| Score banner / scoreboard / team panel | `ui/ReplayScoreBanner.tsx`, `ui/ReplayTeams.tsx`, `ui/ReplayTeamHeader.tsx` | context route serves the scoreboard rows and the score banner data (outcome, score label, rounds, regulation: `4cba90b`, `bf33f18`); the match header shows the map, mode, score and played time (`ec98ab7`, `bf8e657`). The full scoreboard overlay is removed and not yet re-added as a real component (`d53ab5d`) | a real scoreboard component over the context rows (in progress, see TODO) |
| Victory overlay / round-break overlay / bomb countdown | `ui/ReplayVictoryOverlay.tsx`, `ReplayRoundBreakOverlay.tsx`, `ReplayBombCountdownOverlay.tsx` | missing: none lifted | port `ReplayPublishedPanels.tsx` and its dependencies |
| Hover tooltips (placements, weapon pads, flags, ground weapons, vehicles) | `ui/ReplayCanvasTips.tsx`, `ReplayGroundWeaponTip.tsx`, etc., only shown in 2D mode | n/a: 2D canvas does not exist in the shell | n/a unless 2D mode is ported |
| Keyboard shortcuts | `hooks/useReplayShortcuts.ts` | **wired**: `screens/MatchViewScreen.tsx` calls the hook (unchanged) with real callbacks: Space/K play-pause, and and J/L seek, frame-step, R restart, F fullscreen | `toggleSound` (M) controls mute; `zoom` is left undefined (it drives the 2D camera's pan/zoom keys) |
| Fullscreen | `hooks/useReplayFullscreen.ts`, button in `ReplayTransport.tsx` | **wired**: `useReplayFullscreen.ts` ported and driven by the F key; the 16:9 player frame and a fullscreen button are not in place yet | transport bar work (in progress, see TODO) |
| Surface inspector (alt/click probe) | `ui/useSurfaceProbe.ts`, rendered inside `Replay3DView.tsx` | wired: lifted unchanged | none |
| View-grip tuner overlay | `ui/useViewGripTuner.ts`, rendered inside `Replay3DView.tsx` | wired: lifted unchanged | none |
| Loading screen | `ui/ReplayChargement3d.tsx`, rendered inside `Replay3DView.tsx` | wired: lifted unchanged | none |
| FPS / cadence HUD | `ui/ReplayCadence3d.tsx`, rendered inside `Replay3DView.tsx` | wired: lifted unchanged | none |
| In-view HUD (health/shield, held-weapon icon, scope zoom overlay, kill popups, medal badges) | `ui/ReplayAth3d.tsx` + `ReplayAthFil3d.tsx`, `ReplayAthLunette3d.tsx`, `ReplayKillPopup3d.tsx`, `MedalBadges.tsx`, `components/ui/WeaponIcon.tsx` | **wired**: the HUD stays visible in third person with pinned ammo behavior (`1e3164c`); health, weapon-in-hand and scope zoom read from the document; kill popups fire for real; medal badges show nothing (no medal source in the document) | medal badges need a medal source |

## 3. LevelUp API routes the scene/loaders call

| Route | Caller (LevelUp file) | What it returns | Shimmed in standalone? |
|---|---|---|---|
| `GET /players/{slug}/matches/{id}/replay` | `lib/replay/queries.ts:37-79` | the replay document that `Replay3DView` renders | yes: `GET /api/matches/{id}/replay` |
| `GET /players/{slug}/matches/{id}/replay/context` | `lib/replay/queries.ts:90-102` | header, scoreboard rows, kill/event feed, media list | yes: `GET /api/matches/{id}/context` (the standalone's own context, built from the stored film, stats and map variant: outcome, score, regulation, objective stats, kills, medals; it holds no per-player top-weapon or MVP columns, which are derived from a match database the standalone does not keep) |
| `GET /players/{slug}/matches/{id}/replay/background` / `background.png` | `lib/replay/queries.ts:111-125,223-252` | map background image calibration (2D-only) | not shimmed; not needed by the 3D view |
| `GET /players/{slug}/matches/{id}/replay/callouts` | `lib/replay/queries.ts:261-274` | named map zones (2D-only) | not shimmed; not needed by the 3D view |
| `HEAD`/`GET .../replay/mesh.glb` | `lib/replay/queries.ts:128-130,189-196` | the 3D map mesh GLB | yes: `GET /api/matches/{id}/mesh.glb` (range-capable) |
| `HEAD`/`GET .../replay/variant.glb` | `lib/replay/queries.ts:136-138,203-210` | variant object layer GLB | yes: `GET /api/matches/{id}/variant.glb` (per match, `1839da2`) |
| `GET .../replay/weapons` (folder) | `lib/replay/queries.ts:141-143` | weapon GLB models, keyed by weapon | yes: `GET /api/weapons` (index + coating files) and `GET /api/weapons/{file}` |
| `GET .../replay/first-person` (folder) | `scene3d/premierePersonne3d.ts:48-54` | the first-person rig library | yes: `GET /api/first-person/index.json`, `bras.json`, `{file}` |
| `GET`/`POST .../replay/mesh/build` | `lib/replay/meshBuild.ts:96-98,158-210` | build status, build trigger | yes: mesh, variant, weapons, first-person and spartan-pieces state/build routes (one shared queue, at most one heavy build at a time; `POST .../mesh/cancel` cancels a running map build, `ca86818`) |
| `GET .../replay/spartans` | `lib/replay/spartanArmor.ts:103` | spartan armor manifest per player | yes: `GET /api/matches/{id}/spartans` (`5a0f9c0`) |
| `GET .../replay/spartan-pieces/{file}` | `lib/replay/spartanArmor.ts:87-88` | armor piece model files | yes: `GET /api/spartan-pieces/{file}` (the library build is enqueued at serve startup) |

## Replay document fields

Measured, not read from code: the same film (Live Fire, Ranked Oddball, match `7d798138`)
built by LevelUp and by this repo, compared field by field at the top level.
Redo this comparison on one match per game mode before calling the document complete.

| Field | LevelUp | Standalone | Drives |
|---|---|---|---|
| `killEffects` | 31 | 31 | kill effect per weapon |
| `weaponLabels` | 14 | 14 | weapon names and icons (kill feed, HUD) |
| `grenadeLabels` | 4 | 4 | grenade names |
| `abilityLabels` | 3 | 3 | equipment names |
| `objectiveObjects` | 93 | 93 | objective objects on the map |
| `carriedEquipment` | 28 | 28 | equipment a player carries |
| `riftPoses` | 6 | 6 | objective poses |
| `skullCarries` | 46 | 46 | Oddball: who holds the ball |
| `scoreTimeline` | present | present | score banner over time |
| `padPickups` | 37 | 37 | weapon pad pickups |
| `weaponPads` | 8 | 8 | weapon pads |
| `projectiles` | 372 | 539 | projectile paths (decoder difference: the vendored decoder is newer and denser) |

Small differences, all decoder differences (older LevelUp decoder, schema 116, 100 ms
frame interval vs the vendored decoder, schema 122, 33 ms): `stances` 3,260 / 3,266,
`drawnWeapons` 594 / 610, `ammoReads` 3,413 / 3,416, `weaponChanges` 205 / 206.

## Standalone-only screens

These have no LevelUp source page to port from: LevelUp runs server-side against an
already-authenticated fleet of players, so this standalone app needs its own account UI.
Added to `screens/MatchListScreen.tsx` (the home screen):

| Screen/section | File(s) | What it does |
|---|---|---|
| Account panel | `screens/AccountPanel.tsx` + `screens/useAuthState.ts` | Sign in with Xbox (Microsoft device-code flow), shows the code/link/countdown while pending, the gamertag once signed in, the server's error with a retry on failure. Polls `GET /api/auth/state` every 2s while pending. |
| Recent remote matches | `screens/RemoteMatchesPanel.tsx` + `screens/useRemoteMatches.ts` + `screens/useMatchFetchQueue.ts` | The account's recent matches from `GET /api/remote/matches`, each "Open" (already in the local store) or "Fetch" (downloads and builds it via `POST /api/matches/{id}/fetch`, polling `GET .../fetch/state` every 2s; single-flight client-side, a 409 falls back to polling the row's own state). A completed fetch refreshes the local list so the row becomes "Open". Opening a match selects the signed-in player (`f624d7a`). |

## 4. Per-mode data parity (replay document + match context)

Audited by comparing the two servers' outputs for the same film (`tools/parity`), not by
reading code. The two matches both servers hold are `7d798138` (Ranked Oddball) and
`9220185c` (Recharge / Ranked Slayer); the four matches the reference does not hold
(`19628ee2` Strongholds, `d01ba030` King of the Hill, `a2c79b5e` Slayer, `f9a8ab62` CTF)
are checked for internal completeness of their own document instead.

Status: **fixed** = ported this pass and gated by a Go test; **report** = a real difference
that lives in the vendored decoder or in the reference's database, not portable from its Go
builder or context route; **parity** = already equal, no change needed.

### 4.1 Replay document (per mode)

| Mode (match) | Field | Reference | Ours | Status |
|---|---|---|---|---|
| Oddball `7d798138` | `skullCarries` | 46 | 46 | parity |
| Oddball `7d798138` | `scoreTimeline` | present (no `targetScore`: a `[rounds_decide]` mode, the score is read in rounds) | present (same) | parity |
| Oddball `7d798138` | `projectiles` | 372 (schema 116, 100 ms grid) | 539 (schema 122, 33 ms grid) | report: decoder difference, the vendored decoder is newer and denser |
| Oddball `7d798138` | `stances` / `drawnWeapons` / `ammoReads` / `weaponChanges` | 3260 / 594 / 3413 / 205 | 3266 / 610 / 3416 / 206 | report: same decoder difference |
| Oddball `7d798138` | `coverage.fallbacks` / `carriedEquipment` / `padPickups` | 30 / 28 / 15 | 21 / 31 / 16 | report: decoder-side counts, not in the builder or context route |
| Strongholds `19628ee2` | `scoreTimeline` | n/a | present, no `targetScore` | complete (Strongholds is not in `[score_target]`) |
| King of the Hill `d01ba030` | `scoreTimeline.targetScore` | n/a | 4 (from `[score_target]` "Ranked:King of the Hill" = 4) | fixed: `replay.ScoreTarget` table + `Input.ScoreTarget` |
| Slayer `a2c79b5e` | `scoreTimeline.targetScore` | n/a | 50 (from `[score_target]` "Ranked:Slayer" = 50) | fixed: same as above |
| CTF `f9a8ab62` | `scoreTimeline.targetScore` | n/a | from `[score_target]` (the variant's declared capture target) | fixed: same as above |

### 4.2 Match context (header, scoreboard, regulation)

| Mode (match) | Field | Reference | Ours | Status |
|---|---|---|---|---|
| all | `header.outcome` / `outcome_code` / `outcome_color` / `outcome_color_token` | the viewer's result (win / loss / tie / dnf colors) | was always the neutral default | fixed: `contextOutcome` reads the API `Outcome` per xuid (`4cba90b`) |
| all | `header.map_image_url` | present | absent for a `.jpg` map | fixed: the probe tries `.png` then `.jpg` |
| all | `header.score_timeline_kind` | `hidden` (frag modes) / `events` (point modes) / absent (curve) | absent | fixed: `contextScoreTimelineKind` ports the `[score_timeline]` tokens |
| all | `header.is_ranked` | true for a `Ranked:` variant | false | fixed: set from the pair-name category |
| all | `regulation_seconds` | 720 for the ten declared variants, absent otherwise | absent | fixed: `contextRegulationSeconds` ports the `[regulation_seconds]` table |
| all | `header.t0_ms` / `playable_duration_seconds` | join-based (17809 / 14886 on the two shared matches) | film-based (29983 / 26203) | report: the two read different clocks (the reference joins the API join times, the standalone reads the film's own origin) |
| Oddball `7d798138` | `header.score_label` | `2 - 1` (rounds) | was `185 - 200` (cumulative points) | fixed: `contextScore` reads `[rounds_decide]` in rounds (`bf33f18`), points demoted to `score_points_label` |
| Oddball `7d798138` | `scoreboard` rounds | per-team `RoundsWon` | was the payload's (stale) | fixed: the builder records `TeamRoundsWon` from the payload teams |
| Strongholds `19628ee2` | objective `zone_captures` / `zone_secures` / `zone_offensive_kills` / `zone_defensive_kills` / `zone_scoring_ticks` / `time_in_zones_seconds` | n/a | present, non-empty on all 8 rows | complete |
| King of the Hill `d01ba030` | same six zone fields | n/a | present, non-empty on all 8 rows | complete |
| CTF `f9a8ab62` | objective `flag_captures` / `flag_grabs` / `flag_secures` / `flag_steals` / `flag_returns` / `flag_capture_assists` / `flag_carriers_killed` / `flag_returners_killed` / `kills_as_flag_carrier` / `kills_as_flag_returner` / `time_as_flag_carrier_seconds` | n/a | present, non-empty on all 8 rows | complete |
| Slayer `a2c79b5e` | objective | n/a | absent on purpose (a frag mode has no objective block) | complete |
| all | `scoreboard[].is_mvp` / `top_weapon_id` / `top_weapon_label` / `weapon_kills` | present | absent | report: the reference derives these from its match database, not from the film or the API payload |
| all | `scoreboard[].expected_*` / `*_stddev` | present | present (from `skill.json`) | parity |

## 5. Viewer features ported from LevelUp

The features lifted from the reference's replay page into this standalone viewer, with the
merged commit that landed each one (on `port/web`). "In progress" means the build side is
merged and the on-screen result is still being finished.

| Feature | State | Commit |
|---|---|---|
| Armor (per-player armor manifests from the fetched customization + cached GameCMS definitions, piece library, scene wiring) | done | `5a0f9c0` (manifest route), `5e11149` (GameCMS fetch + shared cache), `95972d7` (scene pointed at the standalone routes), `0859280`/`763506c`/`270a307` (piece library build and routes), `62658bd` (rank badges) |
| First-person armor and arms (per-player arms on the followed player's rig, built from the piece library and painted against the coating reference) | done | `f3a6f8c` (player armor for the arms), `8c0a1e2` (the exported coating work, called from first person), `ba42e5b` (Nyexc arm selection) |
| Armor coatings (Ekur reference read at the Spartan piece library build; neutral fallback when the reference is absent) | done | `0859280` (piece library build with coatings), `36f490e` (mask comparison) |
| Weapon coatings (each player's equipped weapon painted with its coating, third and first person) | in progress | `2e100c4` (build coatings into the weapon library), `66bbfc4` (serve each player's equipped coatings with the match), `a49a6fe` (paint the weapon models), `498f965` (each coating resolves to its own model key), `dd12400` (pipeline doc); open items in [WEAPON-COATINGS.md](WEAPON-COATINGS.md) |
| Kill feed icons (contour weapon icons on kill events, missing replay weapon icons filled) | done | `a855cb6`, `c76bff5`, `469bdb0` |
| HUD (first and third person: health, shield, held weapon, scope, kill popups) | done | `1e3164c` (HUD visible in third person, ammo behavior pinned), `6d0a37d` (light-blue HUD ink) |
| Ammo (HUD ammo readout pinned to the document's ammo reads) | done | `1e3164c` |
| Grenade icons (HUD equipment/grenade icon set, built from the install and served) | done | `e810f10` (build and serve the set), `f91bd4e` (correct HUD grenade icons) |
| Glass (dark layered glass rendered clear) | done | `4e1a941` |
| Camera collision (third-person camera kept out of the map) | done | `c0c9be1` (spring arm) |
| Map build cancel (cancel a running map build from the build panel) | done | `ca86818` |
| Settings labels (wrap instead of truncating) | done | `fb1e79b` |
