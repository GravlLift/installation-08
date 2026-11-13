# Feature parity: LevelUp replay page vs standalone 3D shell

Source (read-only): `P:\software\LevelUp\.worktrees\replay-3d\apps\web\src\features\match-replay\` and `src\lib\replay\`.
Target: `P:\software\infinite-theater-3d\.worktrees\port-web\web\src\`.
`Replay3DView.tsx` and its scene3d/model/layers/sound/settings/export dependencies were lifted byte-identical into the
target; the gap is entirely in what calls them (`App.tsx` vs LevelUp's `ReplayCanvas.tsx` / `Replay3DSlot.tsx` / page route)
and in which supporting files were left behind.

## 1. Replay3DView props (view inputs)

| Feature | Source in LevelUp (file:line) | State in standalone | What is needed to wire it |
|---|---|---|---|
| meshPath (map GLB) | `ui/Replay3DView.tsx:56`, fed by `lib/replay/meshBuild.ts:217-236` (`useReplayMesh3d`) and `lib/replay/queries.ts:128` (`replayMeshPath`) | wired, but to a static file: `App.tsx:23` (`MESH_PATH = '/dev/map.glb'`), not to a server route | serve `/players/{slug}/matches/{id}/replay/mesh.glb` (or an equivalent standalone route) and fetch it instead of the static path |
| variantPath (mvar object layer) | `ui/Replay3DView.tsx:58`, `meshBuild.ts:73,141` | missing: `App.tsx:221` passes `variantPath={null}` | serve `.../replay/variant.glb` and pass its URL |
| weaponsPath (weapon models folder) | `ui/Replay3DView.tsx:59`, `meshBuild.ts:75,227` | missing: `App.tsx:221` passes `weaponsPath={null}` | serve `.../replay/weapons` folder and pass its base path |
| armor (spartan armor manifest + pieces) | `ui/Replay3DView.tsx:61`, `meshBuild.ts:77,228-231`, `lib/replay/spartanArmor.ts:87-103` | missing: `App.tsx:222` passes `armor={null}` | serve `.../replay/spartans` and `.../replay/spartan-pieces/{file}`, build a `ReplayArmorSource` |
| doc (replay document) | `lib/replay/queries.ts:37-79` (`useMatchReplay`, route `/players/{slug}/matches/{id}/replay`) | wired, but to a static file: `App.tsx:34-54` fetches `/dev/replay.json` | serve the same route (or static export of it) and keep `normalizeReplayDocument` |
| frameRef / playback clock | n/a (page-local ref) | wired: `App.tsx:157,224` (`frameRef`), driven by `PlaybackBar` `requestAnimationFrame` loop at `App.tsx:81-97` | none, functionally equivalent (LevelUp's `useReplayClock`/`useReplayPlayback` are richer but not required) |
| viewpoint (followed player) | `ui/ReplayCanvas.tsx:192` (required prop, page-resolved) | wired: `App.tsx:161,225` state + `<select>` in `PlaybackBar` L137-151 | none |
| colorOfXuid | `layers/useSlotIdentity.ts:239-246` (team-ally/team-enemy semantic tokens) | wired but different source: `App.tsx:28-32` hashes xuid to an HSL hue (no team/roster awareness) | replace with a team-aware color function once allegiance data exists |
| locale | `ui/Replay3DView.tsx:67` | wired, hardcoded `'en'`: `App.tsx:210,227` | fine for a standalone shell; add a picker if i18n parity is wanted |
| width / height | `ui/Replay3DView.tsx:68-69` | wired: `ResizeObserver` in `App.tsx:165-174` | none |
| compact | `ui/Replay3DView.tsx:71`, used by `Replay3DSlot.tsx:73` for the inset view | not used (default `false`); no inset view exists in the shell | n/a unless an inset/picture-in-picture mode is added |
| active | `ui/Replay3DView.tsx:73`, used by `Replay3DSlot.tsx:73` to freeze rendering when 2D is shown | not used (default `true`); shell has no 2D mode to switch away to | n/a unless a 2D fallback is added |
| action.shotFx | `scene3d/action3dInputs.ts:42`, built in `ui/ReplayCanvas.tsx:358-364` from `useReplayFx`/`useReplayStaticLayers` | stubbed: `App.tsx:179` (`shotFx: []`) | compute shot-fx from the doc client-side, or serve it pre-baked |
| action.kills | `scene3d/action3dInputs.ts:43`, from `ui/ReplayCanvas.tsx:250` (`killsOfFeed(feedEntries)`), `feedEntries` from `/replay/context` | stubbed: `App.tsx:180` (`kills: []`) | fetch `.../replay/context` and run `killsOfFeed` (file not ported, see §3) |
| action.mapObjectives | `scene3d/action3dInputs.ts:44`, `ui/ReplayCanvas.tsx:339` (`normalizeMapObjectives(doc.mapObjectives)`) | stubbed: `App.tsx:181` (`mapObjectives: []`) | call `normalizeMapObjectives(doc.mapObjectives)` — the function is already ported (`layers/objectivesLayer.ts`) but unused |
| action.allegiance / pageAllegiance | `scene3d/action3dInputs.ts:46-51`, from `doc`'s film allegiance model, required prop of `ReplayCanvas.tsx:175` | stubbed: `App.tsx:182-183` (`NO_ALLEGIANCE`) — no team tinting, no ally/enemy shield color | resolve allegiance from the doc (film has team/xuid data) instead of passing the neutral constant |
| action.inks (per-player colors) | `layers/useReplayInks.ts`, theme-aware palette version | wired, but theme-independent: `App.tsx:176` (`useReplayInks(0)`, palette version hardcoded to 0) | pass a real palette-version signal if the shell ever supports theme switching |
| action.show.* (layer toggles) | `scene3d/action3dInputs.ts:21-39`, driven by `useReplaySettings`/`useReplayDrawer` toggle panel in `ui/ReplayCanvas.tsx:274,710-729` | hardcoded true/false: `App.tsx:185-198` — all flags on except `groundWeaponsSpecialOnly`/`groundWeaponsStarting`, with no UI to change them | port `useReplaySettings` + a settings panel, or accept fixed defaults |
| action.shotHoldFrames / framesPerSecond / deathHoldFrames | `ui/ReplayCanvas.tsx:364` | wired: `App.tsx:199-201` computed from `framesPerSecond(doc)` | none |
| action.colorOfSlot / nameOfSlot | `layers/useSlotIdentity.ts:217-238` (slot ownership resolved from the film) | stubbed: `App.tsx:202,204` both return `null` always | port `useSlotIdentity` (not in the lifted set) and feed it the doc |
| action.nameOfXuid | `layers/useSlotIdentity.ts:238` (roster-based name resolver) | wired, different source: `App.tsx:205-208` looks up `doc.roster` directly via `displayPlayerName` | functionally equivalent, no action needed |
| action.seatedOfXuid | `layers/useSlotIdentity.ts:250` (`seated.isSeated`, tracks bot takeover) | stubbed: `App.tsx:209` always returns `true` | port the seated/bot-takeover logic if bot handling matters |
| action.locale | same as top-level `locale` | wired `'en'`: `App.tsx:210` | none |
| aids (3D analysis overlays) | `settings/useReplay3dAids.ts`, merged inside `Replay3DView.tsx:112-113` | wired: hook is lifted unchanged and called inside `Replay3DView.tsx:112`, defaults apply | add a settings UI to toggle aids (see §2) |
| playWindow | `ui/Replay3DView.tsx:77`, computed once per page in LevelUp's `model/replayWindow.ts` | missing: `App.tsx:231` passes `null` | compute a `ReplayWindowBounds` from the doc, or accept the "play whole film" fallback this already triggers |
| timeLimitMs | `ui/Replay3DView.tsx:83`, from match context header | missing: `App.tsx:232` passes `null` | fetch `.../replay/context` header and extract the regulation time limit |
| soundListenerRef | `ui/Replay3DView.tsx:85`, filled by `sound.listener` in `ui/ReplayCanvas.tsx:787` (from `useReplaySound`) | missing entirely: `App.tsx:218-233` call omits the prop | port `useReplaySound` (not in the lifted set) and wire a listener ref |

## 2. Controls around the 3D view (not props of the view)

| Feature | Source in LevelUp (file:line) | State in standalone | What is needed to wire it |
|---|---|---|---|
| Play / pause | `ui/ReplayTransport.tsx` via `useReplayPlayback` | wired, minimal: `App.tsx:100-107` plain button | none for parity of function; cosmetic only |
| Seek / scrubber | `ui/ReplayTransport.tsx` + `ui/ReplayTimelineTracks.tsx` (kill markers, presence bars, media thumbnails) | wired but bare: `App.tsx:108-119` plain `<input type="range">`, no track visuals | port `hooks/useReplayTimeline.ts` + `ui/ReplayTimelineTracks.tsx` (neither is in the lifted set) |
| Speed control | `ui/ReplayTransport.tsx`, `useReplaySettings.setSpeed` | wired: `App.tsx:123-136` fixed `[0.25,0.5,1,2,4]` select | none |
| Follow / viewpoint picker | `ui/ReplayTimelineTracks.tsx` menu, resolved via `useReplayTimeline` | wired: `App.tsx:137-151` plain select over `doc.roster` | none |
| Camera mode (fp/tp/free) | `ui/Replay3DView.tsx:329-349` (buttons inside the lifted component) | wired: same code, lifted unchanged | none |
| 2D / 3D toggle | `ui/Replay3DSlot.tsx:87-105` | missing: shell has no 2D canvas at all, so no toggle is needed or possible | n/a unless a 2D mode is ported too |
| Settings drawer (layer toggles, 3D aids, lighting/look, FOV) | `settings/ReplaySettingsDrawer.tsx`, `ReplaySettingsAids3d.tsx`, `ReplaySettingsLook3d.tsx`, driven by `hooks useReplay3dAids/Fov/Look` | code present but not wired: the three hooks (`settings/useReplay3dAids.ts`, `useReplay3dFov.ts`, `useReplay3dLook.ts`) are lifted and read inside `Replay3DView.tsx:112,258,263`, but no panel exists to change their defaults | port the three drawer components + `ReplaySettingsDrawer.tsx` and mount it in `App.tsx` |
| Sound (toggle, volume, spatial listener) | `sound/useReplaySound.ts`, `sound/ReplaySoundControls.tsx` | missing: only low-level sound-effect synthesis files were lifted (e.g. `sound/impactSound.ts`); no React hook or UI control exists, and `soundListenerRef` is never populated (see §1) | port `useReplaySound.ts` + `ReplaySoundControls.tsx` |
| Export / recording (image, video) | `export/useReplayExport.ts`, `ReplayExportDialog.tsx`, `Export3dChoice.tsx`, `export/replayCapture.ts`, `replayVideoEncoder.ts` | missing: only `eventLoopYield.ts`, `exportFormats.ts`, `exportLayoutStore.ts`, `replay3dExportStore.ts` were lifted; the scene registers itself for export (`Replay3DView.tsx:271-275`, `registerReplay3DExport`) but nothing ever reads that registration | port the capture/encoder files and the export dialog |
| Kill feed | `ui/ReplayKillFeed.tsx`, fed by `action.kills` | missing: component not lifted, and its data source (`action.kills`) is stubbed empty anyway | port `ReplayKillFeed.tsx` once `action.kills` is wired |
| Score banner / scoreboard / team panel | `ui/ReplayScoreBanner.tsx`, `ui/ReplayTeams.tsx`, `ui/ReplayTeamHeader.tsx`, fed by `/replay/context` scoreboard rows | missing: none of these components were lifted | port the components + fetch `.../replay/context` |
| Victory overlay / round-break overlay / bomb countdown | `ui/ReplayVictoryOverlay.tsx`, `ReplayRoundBreakOverlay.tsx`, `ReplayBombCountdownOverlay.tsx`, assembled via `ui/ReplayPublishedPanels.tsx` into `ReplayCanvas`'s `mapOverlays` prop | missing: none lifted | port `ReplayPublishedPanels.tsx` and its dependencies |
| Hover tooltips (placements, weapon pads, flags, ground weapons, vehicles) | `ui/ReplayCanvasTips.tsx`, `ReplayGroundWeaponTip.tsx`, etc., only shown in 2D mode (`!small2d` gate, `ui/ReplayCanvas.tsx:770`) | n/a: 2D canvas does not exist in the shell | n/a unless 2D mode is ported |
| Keyboard shortcuts | `hooks/useReplayShortcuts.ts` | code present but not wired: file is lifted (`hooks/useReplayShortcuts.ts`) but never imported by `App.tsx` or `Replay3DView.tsx` | call the hook from `App.tsx` with real playback/seek callbacks |
| Fullscreen | `hooks/useReplayFullscreen.ts`, button in `ReplayTransport.tsx` | missing: hook was not lifted at all | port `useReplayFullscreen.ts` and add a button |
| Surface inspector (alt/click probe) | `ui/useSurfaceProbe.ts`, rendered inside `Replay3DView.tsx:308-316` | wired: lifted unchanged, works out of the box | none |
| View-grip tuner overlay | `ui/useViewGripTuner.ts`, rendered inside `Replay3DView.tsx:317-321` | wired: lifted unchanged | none |
| Loading screen | `ui/ReplayChargement3d.tsx`, rendered inside `Replay3DView.tsx:322` | wired: lifted unchanged | none |
| FPS / cadence HUD | `ui/ReplayCadence3d.tsx`, rendered inside `Replay3DView.tsx:328` | wired: lifted unchanged | none |
| In-view HUD (health/shield, held-weapon icon, scope zoom overlay, kill popups, medal badges) | `ui/ReplayAth3d.tsx` + `ReplayAthFil3d.tsx`, `ReplayAthLunette3d.tsx`, `ReplayKillPopup3d.tsx`, `MedalBadges.tsx`, `components/ui/WeaponIcon.tsx` | wired for data already in `doc` (health, weapon-in-hand, scope zoom); kill popups and medal badges wired in code but show nothing because `action.kills` is stubbed empty (see §1) | wire `action.kills` to see popups/medals; the rest already works |

## 3. LevelUp API routes the scene/loaders call

| Route | Caller (LevelUp file) | What it returns | Shimmed in standalone? |
|---|---|---|---|
| `GET /players/{slug}/matches/{id}/replay` | `lib/replay/queries.ts:37-79` (`useMatchReplay`) | the replay document (`ReplayDocument`) that `Replay3DView` renders | yes, but as a static file: `App.tsx:24,41` fetches `/dev/replay.json` instead of this route |
| `GET /players/{slug}/matches/{id}/replay/context` | `lib/replay/queries.ts:90-102` (`useMatchReplayContext`) | header, scoreboard rows, kill/event feed, media list | not shimmed; nothing in the shell calls it, so kills/scoreboard/media are all empty |
| `GET /players/{slug}/matches/{id}/replay/background` | `lib/replay/queries.ts:111-125` | map background image calibration (2D-only) | not shimmed; not needed by the 3D view |
| `GET /players/{slug}/matches/{id}/replay/background.png` | `lib/replay/queries.ts:223-252` | map background image blob (2D-only) | not shimmed; not needed by the 3D view |
| `GET /players/{slug}/matches/{id}/replay/callouts` | `lib/replay/queries.ts:261-274` | named map zones (2D-only) | not shimmed; not needed by the 3D view |
| `HEAD`/`GET /players/{slug}/matches/{id}/replay/mesh.glb` | `lib/replay/queries.ts:128-130,189-196`; fetched by `scene3d/meshFetch.ts` via `Replay3DView.tsx:149` | the 3D map mesh GLB | partially: the mesh IS fetched (`scene3d/meshFetch.ts` is lifted and used), but from the static `/dev/map.glb` path instead of this route |
| `HEAD`/`GET /players/{slug}/matches/{id}/replay/variant.glb` | `lib/replay/queries.ts:136-138,203-210` | variant object layer GLB (crates, cover from the `.mvar`) | not shimmed; `App.tsx:221` passes `variantPath: null` |
| `GET /players/{slug}/matches/{id}/replay/weapons` (folder, `<key>.glb` files) | `lib/replay/queries.ts:141-143`; consumed by `scene3d/weaponModels3d.ts` via `Replay3DView.tsx:190-194` | weapon GLB models, keyed by weapon | not shimmed; `App.tsx:221` passes `weaponsPath: null` |
| `GET`/`POST /players/{slug}/matches/{id}/replay/mesh/build` | `lib/replay/meshBuild.ts:96-98,158-210` | mesh/variant build status, and triggers a build | not shimmed; no build flow exists in the standalone server |
| `GET /players/{slug}/matches/{id}/replay/spartans` | `lib/replay/spartanArmor.ts:103` | spartan armor manifest per player | not shimmed; `App.tsx:222` passes `armor: null` |
| `GET /players/{slug}/matches/{id}/replay/spartan-pieces/{file}` | `lib/replay/spartanArmor.ts:87-88`, consumed by `scene3d/armorLibrary3d.ts` | armor piece model files | not shimmed; same as above |

The standalone server (whatever replaces the LevelUp Go API here) needs to serve the mesh/variant/weapons/spartans/
spartan-pieces routes (or static equivalents under `/dev/`) and the `/replay/context` route if kills, scoreboard, and
HUD popups are to show real data; `/replay/mesh/build`, `/replay/background*`, and `/replay/callouts` are not required
for the 3D-only shell.
