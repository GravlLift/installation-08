# Camera scripts

Status: planned 2026-11-19. Owner: lead session; units 1 to 5 go to a Qwen worker.

## What it is

A camera script is a list of keyframes on the match's time axis. When a script is playing, it
places the 3D camera at every frame, on screen and in the video export alike. It is how a
director gets a shot like this: fly in low behind a player, swing around as they take the kill,
then settle on a wide frame. Scripts are authored by hand in the viewer, and other tools can
write them too, since the format is plain JSON.

A script is data. The renderer evaluates it; nothing else in the scene changes. The "hold"
feature (a player leaving the film's motion to pose) is a separate plan that builds on this one.

## Decisions

1. **A script drives the free camera; there is no fourth camera mode.** `CameraMode3d` is
   `'fp' | 'tp' | 'free'` and 18 files branch on it (HUD level, the first-person rig, the scope,
   the top-down follow, shortcuts, export). The free mode already has every rule a cinematic
   camera wants: no first-person rig, the spectator HUD, a 2D view that follows the living
   players. So a playing script puts the camera choice on Free and replaces the fly-and-orbit
   step with its own placement. Leaving Free (keys 1 or 2, or the mode segment) stops the script.

2. **The contract uses the replay's own terms: game coordinates and document milliseconds.** The
   replay document gives positions in game units (x, y, z with z up) and times as film frames. A
   key's time `t` is milliseconds on the document axis (`frameToMs(frame, doc)`,
   `web/src/lib/replay/replayLogic.ts`), and its points are in game coordinates. The renderer
   converts with `toThree` (`tracks3d.ts`: three = `[x, z, -y]`, no scaling). Any tool that reads
   the same document can write scripts without knowing anything about three.js.

3. **A key can be pinned to the world or to a player, and player anchors are resolved at the time
   being drawn, not at the key's time.** A key that follows player A stays behind A while A runs,
   and a blend from a key on A to a key on B moves smoothly from one to the other. A player's
   position follows `ReplayCamera3d.povState`'s rule for any player: alive, their sample; dead,
   where they fell; not yet spawned, their first spawn.

   **Smooth anchors (2026-11-19).** A player's sample is read on a C1 curve through the track's
   points (`tracks3d.pointStateAt`, `gait3d.cubicAt`: a monotone cubic Hermite in time per axis,
   PCHIP slopes), not a straight line between them: it passes every published point exactly,
   never overshoots a stop, and its velocity is continuous, so a body or a camera following it in
   slow motion no longer steps at the film's 30 or 60 Hz replication rate. On top of that, a
   player point's `smooth` (default 250 ms) averages the feet over a centered Gaussian window
   (±`smooth` document ms, sigma `smooth / 2`, a sample every ~20 ms, at most 24 per side), which
   removes the replication noise the curve still passes through. The film is known ahead, so the
   window is centered and adds no lag on a constant velocity; on a curve it sits slightly inside
   the turn (about acceleration × sigma² / 2). A side of the window stops at a jump faster than
   50 u/s (a respawn or a replication gap) or where the player has no position, so the camera
   cuts with the player instead of gliding across the map. `smooth: 0` is the raw sample. It is a
   pure function of `t`.

4. **A player-relative offset is either world-aligned or turns with the player's heading.**
   `world`: the offset is in game axes and only follows the player's position, so the camera
   never swings when they flick their aim (the default). `heading`: the offset is in the player's
   frame (x forward along the heading, y to their left, z up) and the heading is a circular mean
   over a short window (default 400 ms, 8 samples ending at `t`). The mean is a pure function of
   `t`, so scrubbing and export agree.

5. **Interpolation: centripetal Catmull-Rom on positions and look targets; a run of keys is
   ONE move.** A `cut` key (a jump at its time, with no blend) splits the script into runs, and
   the spline's neighbor points never cross a cut. At the ends of a run the missing neighbor is
   a phantom point mirrored through the end key (`2*P1 - P2`), so the first and last segments
   still curve. Before the first key the camera holds the first key's pose, and after the last
   key it holds the last key's pose, both still resolved at `t`, so a held key on a player keeps
   following that player.

   **Timing (2026-11-19).** The camera travels each spline BY DISTANCE: the distance along the
   run is a C1 monotone cubic of time (PCHIP, Fritsch-Butland slopes) that passes every key at its
   `t`. The speed therefore changes smoothly through every interior key, never stops at one, and
   the camera never backs up along its path; uneven key spacing gives a smooth acceleration, not
   a jump. Only a run's ENDS ease: the first segment's `ease` (the second key's) starts the run
   from rest when it is `smooth` (the default) or `in`, and the last key's `ease` brings it to
   rest when it is `smooth` or `out`; `linear` leaves that end at its segment's own speed. An
   interior `ease` other than `cut` does not shape the timing. A dwell is two keys at one place.
   `fov` and `roll` follow the same kind of curve through their key values.

   **Keys are sparse.** Keys of one run must be at least 250 ms apart
   (`CAMERA_SCRIPT_MIN_KEY_GAP_MS`); a cut may follow at any gap. A move is a few keys with the
   spline between them; a path sampled into dense keys loses the spline and carries each
   sample's error into the frame as jitter (the 2026-11-19 demo scripts, keyed every 100 ms, read
   as the camera lurching in and out).

6. **Field of view in the game's own convention.** `fov` is horizontal degrees at 16:9, the same
   as the game's FOV setting (`fovLogic.ts`: `GAME_FOV_DEFAULT` 100, `verticalFovOf`), with an
   accepted range of 10 to 150 so tight cinematic lenses work. When it is absent, the user's FOV
   setting applies.

7. **Evaluation is one pure function**, `evaluateCameraScript(script, tMs, resolve)`, that returns
   `{ position, target, verticalFov, rollDeg, focusDistance, aperture, shake, near }` in three.js
   coordinates (the lens and shake: decision 10). The screen loop, scrubbing
   and the export all reach it through `ReplayCamera3d.placeCamera`, which the export already calls
   with each frame (`replayExportScene3d.ts`, `exportFrame`). One path means the video matches what
   you previewed.

8. **Scripts are stored by the server, per match**, as JSON files in the app's data directory,
   behind `GET/PUT/DELETE /api/matches/{id}/camera-scripts/{name}` and a list route. The routes
   are also how another local tool hands a script to Installation 08. They are never stored
   in browser storage, which the app window can lose.

9. **A script has its own clock (added 2026-11-19).** Key times are *script* milliseconds, and
   an optional `clock` maps script time to document time through a rate track: rate 1 plays the
   film at its speed, 0.25 is slow motion, 0 freezes the world, up to 4 fast-forwards. The camera
   always moves on script time, so a camera can whip around a player while the world crawls or
   stands still. Without a `clock`, script time is document time (start 0, rate 1), so a
   clock-less script reads exactly as before. Document time is the integral of the rate:
   `docMs(s) = clock.startMs + ∫₀ˢ rate`, in closed form per segment, so it is a pure function of
   `s` and the export samples it exactly. Player anchors resolve at `docMs(s)`. The hold plan
   (`hold.md`) uses this clock for its frozen world.
   - Fractional frames already render smoothly: live playback hands the 3D view a fractional
     `frameRef` (`usePlaybackLoop.ts:37`, `Replay3DView.tsx:551`), and tracks, flights and clips
     interpolate between samples (confirmed 2026-11-19). Sound at a rate other than 1 is not
     time-stretched: it is muted while the rate is not 1 (version 1).
   - Higher-level camera maneuvers (orbit, snorricam, corkscrew, flyby, push-in) are the
     intended authoring layer above keys: a maneuver is a function from script time to a pose,
     and a chain of maneuvers can be compiled into keys plus a clock. Where that layer lives is
     open; this format is its compile target either way.

10. **The lens: depth of field and camera shake (added 2026-11-19).** Both are pure functions of
    script time, so the preview and the export agree, and a script without the new fields draws
    exactly as before (the depth of field pass is not even in the compositor then).
    - **Depth of field** is physically based (`scene3d/dof3d.ts`): a thin lens on a full-frame
      sensor (36 x 24 mm), its focal length from the camera's vertical field over the sensor's
      24 mm height (`f = 12 mm / tan(vfov / 2)`), world units of 3.048 m. A point at distance D,
      focused at S with f-number N, blurs to a circle of confusion of diameter
      `f^2 / (N (S - f)) * |D - S| / D` on the sensor, clamped to a radius of 2% of the frame's
      height (21.6 px at 1080p). Because the blur follows the real optics, a wide field blurs
      little: at the game's default 100 degrees (an 18 mm lens) f/1.4 focused at 3 m gives under
      2 px of background blur (radius, 1080p); a 40 degree `fov` (a 59 mm lens) gives about 18 px. Shoot
      shallow focus with a narrow `fov`, as a cinematographer would. The pass runs on the HDR
      image after the bloom, before tone mapping: separate near and far fields at half size
      (the foreground's blur bleeds over in-focus edges, the background's never pulls in a sharp
      silhouette, so there is no halo), a ring gather of up to 289 taps, and a CoC-aware upsample.
      `ReplayCamera3d.placeCamera` hands each frame's lens to `PostFx3d.setLens` (null when no
      script plays), on screen and in the export alike. The 2D (top-down) view never draws it.
    - **Shake** turns the camera about its own axes after the key's roll (yaw and pitch at the
      full size, roll at half); it never moves the camera's position. Each entry is a sum of
      three sines per axis, all starting at phase 0 (the jolt starts from zero, with no jump), with
      frequency ratios and signs seeded from the entry's index and `at`, inside an envelope
      `amp * exp(-(s - at) / decay)`. Entries add. It runs on script time, so a frozen world can
      still shake.

## Script format, version 1

```json
{
  "version": 1,
  "matchId": "a521164d-...",
  "name": "intro-a",
  "keys": [
    {
      "t": 312400,
      "pos":  { "at": "player", "xuid": "2533...", "offset": [-3, 0.5, 1.2], "relative": "heading" },
      "look": { "at": "player", "xuid": "2533...", "offset": [0, 0, 0.35] },
      "fov": 70,
      "roll": 0,
      "ease": "smooth"
    },
    {
      "t": 315000,
      "pos":  { "at": "world", "point": [12.4, -40.1, 6.0] },
      "look": { "at": "world", "point": [10.0, -38.0, 4.5] },
      "ease": "linear"
    }
  ]
}
```

- `t`: script milliseconds (document milliseconds when there is no `clock`); keys are sorted by
  `t`, and two keys may share a `t` only when the second is a `cut`.
- `clock` (optional): `{ "startMs": 310000, "rates": [{ "s": 0, "rate": 1 }, { "s": 1800, "rate": 1 },
  { "s": 2300, "rate": 0.25, "ease": "smooth" }] }`. `startMs` is the document time at script
  time 0 (finite, at least 0). `rates` is sorted by `s` (script ms, at least 0), at least one entry,
  at most 512; each `rate` is 0 to 4; `ease` (default `smooth`) is how the rate moves from the
  previous entry's rate to this one, using the same curves as keys (`cut`: the previous rate holds
  until `s`, then jumps). Before the first entry the first rate holds, after the last the last
  rate holds. The script's length is the later of its last key's `t` and its last rate's `s`.
- `pos`, `look`: `{ at: "world", point: [x, y, z] }` or
  `{ at: "player", xuid, offset?: [x, y, z], relative?: "world" | "heading", window?: ms, smooth?: ms }`.
  A player point is that player's feet at `t`, plus `offset`. Without `offset`, a `look` aims at
  the body's center (`BODY_CENTER` above the feet, `body3d.ts`). `relative` defaults to `world`,
  `window` to 400. `smooth` (document ms, 0 to 2000, default 250) is the half-width of the
  centered Gaussian average of the feet (decision 3); 0 reads the raw sample. The heading of a
  `heading` offset keeps its own `window`.
- `fov` (optional, 10 to 150), `roll` (optional, degrees, positive turns the frame clockwise),
  `ease` (optional, default `smooth`; the first key's `ease` is ignored).
- `aperture` (optional, per key): the lens's f-number, 0.7 to 32 (1.4 is very shallow, 8 is
  deep). When NO key has one, the script has no depth of field. A key without one takes the
  nearest earlier key's aperture, else the nearest later key's, across cuts, so a lens set once on
  the first key holds for the whole script. Between keys the aperture follows the same C1 curve as
  `fov`, in stops (log2 of the f-number): f/1.4 to f/5.6 passes f/2.8 halfway.
- `focus` (optional, per key): the point the lens focuses on, the same shapes as `pos`/`look` (a
  player point without `offset` is the body's center); absent, or a player who is not in the
  match, it is the key's `look` point. The focus distance is measured ALONG THE VIEW AXIS (a lens
  focuses on a plane: a subject off the center of the frame is sharp at its depth), at least 0.05
  units. In a run where no key has a `focus`, the lens focuses on the look target at every frame
  (the exact distance from the camera to the target). In a run where some key has one, each key's
  focus distance (its look distance when it has none) follows the same C1 curve as `fov`: a focus
  pull. The pose carries `focusDistance` (world units) and `aperture`, both null without depth of field.
- `near` (optional, per key): the MAP's cutaway depth in WORLD UNITS (1 u = 3.048 m, the unit of
  offsets and focus distances), 0.01 to 10. Map geometry nearer to the camera than `near` (a depth
  along the view axis) is cut away and never drawn, so the camera can sit behind a wall and see
  through it: a cutaway. It cuts the map only (the level's structure, decor, glass, decals, back
  faces and the variant layer's placed objects): players, armor, weapons, corpses, grenades,
  projectiles, effects, beams, shields and the sky are never cut, so a body lying inside `near`
  stays whole. A key without one takes the nearest earlier key's `near` IN ITS RUN, else the
  nearest later key's in the run; a run where no key has one cuts nothing, so a cutaway never
  leaks across a cut into the next shot. Between keys it follows the same C1 curve as `fov`. The
  pose carries `near` (null: no cut). The camera's own near and far planes never move: the cut is
  one world-space clip plane (normal the camera's forward, through `position + forward * near`)
  on the map's materials alone (`scene3d/mapCut3d.ts`), aimed only for the 3D view's scene
  render, screen and export alike, and at rest for every other draw (top-down view, minimap,
  environment probes). A cut wall is not in the depth buffer, so ambient occlusion and the depth
  of field see no wall there; the team outline's mask draws only players; shadows ignore the cut,
  so a wall cut away still casts its shadow. A cut wall shows its inside (no capping).
- `weight` (optional, per key, 2026-11-20): the camera's weight, in SECONDS, 0 to 3
  (`CAMERA_SCRIPT_WEIGHT_MAX`). It is the settle time of a spring between the scripted path and the
  camera, applied to the position and to the look point, each on its own, in world space
  (`scene3d/cameraWeight3d.ts`): the camera lags the path, settles onto it and overshoots very
  slightly, the way a heavy rig operated by a person never snaps. The spring is second order with
  damping ratio 0.85 (`CAMERA_WEIGHT_DAMPING`: a step overshoots by about 0.6%, is within 2% of its
  target by 0.9 `weight` and within 0.4% at `weight`); a path moving at constant speed v is
  trailed by `v * 0.36 * weight`. 0 or absent on every key of a run is today's exact pose. A key
  without one takes the nearest earlier key's IN ITS RUN, else the nearest later key's (the `near`
  rule); between keys it follows the same C1 curve as `fov`. `lookWeight` (same units, range and
  carry) is the look point's own settle time; a run where no key has one uses `weight` for both.
  Guidance: 0.15 to 0.4 s reads as a heavy handheld or a steadicam; 0.6 to 1.2 s as a crane or a
  drone that lags a sprint; a `lookWeight` smaller than `weight` keeps the subject framed while the
  body of the camera drifts behind.
  The pose stays a pure function of script time (exports render frames out of order, with motion
  blur subframes, and scrubbing jumps): the camera is the convolution of the scripted path with
  the spring's impulse response over the last 3 settle times (`CAMERA_WEIGHT_WINDOW`; the kernel
  left beyond is under 1e-5), not a simulation stepped frame to frame. The path is sampled on an
  absolute grid of script time (120 Hz, coarser in powers of two for a long weight, at least 8
  steps per settle time, down to 15 Hz) and taken as a straight line between samples, which the
  kernel integrates in closed form; its weights sum to exactly 1, so a still path gives exactly
  that path and a last key held long enough is reached exactly. Before a run's first key the path
  is held at that key: every run, the one after a cut included, starts at rest on its first key
  exactly. While the clock is frozen the script time still runs, so the camera settles onto the
  frozen world. Fov, roll, aperture and `near` are not weighted; a focus that follows the look
  point is measured to the weighted target. The samples are cached per script, per run and grid
  time, so a frame of playback evaluates one or two new ones (about 0.2 ms in all, measured in the
  test); a scrub that leaves the window evaluates a whole window (about 45 samples, 5 to 15 ms).
  A sample at an earlier script time asks the scene for the players AT THAT SCRIPT TIME
  (`ScriptSubjects.feetAt`'s `sMs`: the holds active then), so a weighted camera on a player who
  becomes held trails into the hold instead of jumping to it.
- `shakes` (optional, top level): at most 64 entries sorted by `at`, each
  `{ "at": 4200, "amp": 1.5, "decay": 250, "freq": 12 }`: `at` script ms (at least 0) where the
  jolt starts; `amp` its starting size in degrees of rotation, in (0, 10]; `decay` its e-folding
  time in ms, in (0, 10000] (the size falls to 37% after `decay`, 5% after 3 x `decay`); `freq`
  its main frequency in Hz, in (0, 60], default 12. Overlapping entries add.
- `look` (optional): `{ "preset": "film", "tone": "aces", "exposure": 0, "contrast": 1.35,
  "saturation": 1.2, "vignette": 0.3, "grain": 0.2, "bloom": 0.5, "warmth": 0.15 }`, an opt-in
  film look for the shot, on screen and in the export alike (`scene3d/filmLook3d.ts`,
  `postFx3d.ts`). `preset` is required and is `film`; every other field is optional, and the
  values above are its defaults. Without `look` the view draws its game-matched default,
  untouched. While a script with a look plays (free camera, 3D view):
  - `tone` (`aces` or `agx`, default `aces`): the tone curve under the film response. `aces` is
    the view's own game-matched curve; `agx` swaps in AgX (flatter, greyer) for the output pass
    alone.
  - `exposure` (-3 to 3): stops on top of the view's exposure, for the output pass alone.
  - `bloom` (0 to 2): the bloom pass is in the chain whatever the drawer's Bloom setting, at this
    gain (the view's own is 0.3). It glows only what the view already renders above its
    threshold; no light is added.
  - `contrast` (0.5 to 2): the film curve's slope at mid grey. Below mid grey a power toe (above
    1 it presses the blacks down), above it a shoulder that rolls into white (slope 0.5 at
    white); 0 stays 0 and 1 stays 1. `saturation` (0 to 2,
    1 = none), `warmth` (-1 cool to 1 warm, red and blue gain of at most 8 %), `vignette` (0 to 1,
    the corners' darkening; a soft ellipse following the frame), and `grain` (0 to 1, fine
    monochrome grain, strongest in the mid tones). They run in a film pass after anti-aliasing
    and before the team outline's line, which keeps its exact color. The grain is seeded by the
    frame's script time: the same frame always has the same grain, so an export is reproducible
    and a paused frame does not swim.
  - When the script stops, or plays without a look, the chain is the default one again (ACES at
    the view's exposure, the drawer's bloom setting, no film pass).
- `name`: 1 to 64 characters, `[a-z0-9_-]`. The server writes the name that is in the URL.
- `lights` (optional): hero light rigs, cinematography rather than a game effect, at most 8, one
  per player: `[{ "xuid": "2533...", "key": 2.5, "fill": 0.8, "rim": 3, "azimuth": 40,
  "elevation": 25, "rimColor": "team" }]`. While the script plays, each rig follows its player's
  body center (resolved like a player anchor: at the clock's document time, a held player's held
  body) and lights only Spartans and their weapons, never the map (`scene3d/heroLightShader3d.ts`
  grafts it into those materials alone). A rig is three shadowless directional lights that reach
  fragments within 0.6 u of the body center, fading out by 0.9 u, so it lights its player, their
  weapon, and at most someone standing right against them.
  - `key`, `fill`, `rim`: intensities 0 to 10, in three.js directional-light units (the view's sun
    at full daylight is 3.2). Defaults 2.5, 0.8, 3; 0 turns that light off.
  - `azimuth` (degrees, -180 to 180, default 40) and `elevation` (degrees, -90 to 90, default 25)
    place the key relative to the camera's view of the player: azimuth 0 is the camera's own side,
    positive turns the key toward screen right, elevation lifts it above the horizontal. The fill
    mirrors the key across the camera axis (`-azimuth`) at half the elevation; the rim sits behind
    the player, straight opposite the camera, at the key's elevation. The rig turns with the
    camera every frame (`heroRigOf`, `scene3d/heroLights3d.ts`).
  - `rimColor`: `white` (default) or `team` (the player's team color at full brightness).
  - Validation refuses more than 8 rigs, an empty or repeated `xuid`, and any value out of range.
    A rig on a player with no state at the time draws nothing. No script, a tracked camera, or a
    stopped script: no hero light. The export places the rigs after the camera on every frame.
- `deathHoldMs` (optional, top level): how long a dead body stays on the floor while the script
  plays, in document ms (the film's own time, not script time), 0 to 30000. Absent, the view's
  default hold (1.4 s, `deathHoldFrames`) exactly. While a script with it drives the camera (free
  camera, on screen and in the export alike), each death's body, cross and label linger that long
  after the death (`deathHoldFramesOf`, `scene3d/deaths3d.ts`); when the script stops, the default
  returns. It is a pure function of the frame: a longer hold only changes which bodies are present
  at a frame. A ragdoll bake is at most 4 s long; a body held past it keeps the last baked pose.
  Use it when a shot needs two bodies down together (a posthumous winner and their victim).
- `outlines` (optional, top level, boolean, default true): `false` takes the team outline
  (`scene3d/outline3d.ts`: its mask pass and its line pass) out of the frame while the script
  drives the camera (free camera, on screen and in the export alike): no team line, no X-ray
  silhouettes through walls, and no cost (the compositor skips both passes). It only turns the
  outline off: with the console's `outline` knob off (`perfToggles3d`), a script never turns it
  on. When the script stops, the knob's state returns (`replayScene3d.applyOutline`).
- `shockLook` (optional, top level, `beam` or `arc`, default `beam`): how the Shock Rifle's shot
  draws while the script drives the camera (free camera, on screen and in the export alike).
  `beam`, or absent, is the default look exactly: three jagged beams (`scene3d/shockShots3d.ts`).
  `arc` draws it as electricity (`scene3d/shockArcShot3d.ts`): a thin jagged blue-white core bolt
  from the muzzle to the shot's end point, short forking side arcs off it (one per 0.5 u of bolt,
  at most 32), and, when the shot hit the scenery, the impact's two arcs, read from the game's own
  impact effect (count, lifetime, emission radius, growth). Bolt and forks re-seed 20 times a second
  and fade over 0.25 s, as the beams do; each stroke keeps a minimum on-screen width (1.5 px core,
  4 px glow), so the shot stays thin at 0.4 u from the camera and still reads at 30 u. Every point
  is a pure function of the shot and the document time: a freeze holds, an export draws the same
  frames in any order. The game data gives the shot's arc texture, sizes and lifetimes but no bolt
  geometry; the bolt's width, roughness and fork layout are named estimates (the file's header).
  When the script stops, the default look returns. Validation rejects any other value.
- Validation rejects an unknown `version`, a `matchId` that differs from the route's, a key with
  no `pos` or `look`, a non-finite number, an out-of-range `fov`, and more than 512 keys. A
  player anchor whose xuid is not in the match is not a validation error: it resolves to null, and
  the evaluator falls back to the key's previous resolved point, or to the world origin when there
  is none, so a script from another match never throws.

## How it fits the scene (confirmed in code, 2026-11-19)

- `ReplayCamera3d.placeCamera(f, dt)` (`scene3d/replayCamera3d.ts:65`) returns early in free
  mode. A script that is playing takes over before that return:
  `if (this.script) { this.placeScripted(f); return status }`.
- `ReplayScene3d.render` (`replayScene3d.ts:579`) and `primeFirstFrame` (`:539`) run
  `fly.step` and `orbit.update()` in free mode. `orbit.update()` turns the camera toward
  `orbit.target`, which would undo the script's orientation, so both are skipped while a script
  plays, and `orbit.enabled` is false then (`:585`). The script also writes its look target into
  `orbit.target`, so stopping it leaves the free camera orbiting what it was looking at.
- `placeScope` (`:831`) calls `scopeView.reset(camera)` outside first person, which would put
  the field of view back to the base. `ScopeView3d` gains `hold(camera, verticalFov)` (folds the
  scope, then poses that fov), and `placeScope` calls it with the script's fov while a script plays.
- Roll: after `lookAt`, rotate the camera about its own view axis (`camera.rotateZ(-roll)` in
  radians, so that positive roll turns the frame clockwise).
- Export: `beginExport` applies the export's camera mode and disables the orbit
  (`replayExportScene3d.ts:113`). A playing script stays set on `ReplayCamera3d`, so
  `exportFrame` goes through `placeCamera` and gets the scripted pose. The page must export with
  camera `free` while a script plays, which it already does when the camera choice is Free.
- The page reaches the scene the way the export does: a module store that `Replay3DView`
  registers into (`export/replay3dExportStore.ts` is the pattern). A new
  `scene3d/cameraScriptStore.ts` holds the registered host: `capture()` (the free camera's
  position, orbit target and vertical fov, in game coordinates), `setScript(script | null)`,
  `subjectAt(xuid, frame)` (feet and heading, for turning a captured world pose into a
  player-relative key), and the frame interval for ms/frame conversion.
- The per-player floor offset: every avatar is placed with the followed player's
  `originAboveFloor` (`replayScene3d.ts:778`, `feetOf`). Player anchors use the same function, so
  the camera lines up with the bodies you see.

## Authoring UI

A third panel next to Settings and Export (`MatchViewScreen.tsx:129`,
`panel: 'settings' | 'export' | 'camera'`), opened from a toolbar button beside Export. It is a
real tool, with no placeholder controls. Per the viewer layout rule, it never covers the camera
view selector at the top left.

- **Script**: a picker of the match's saved scripts, New, a name field, Save, Delete.
- **Play**: plays the script (the camera choice goes to Free, and the panel shows it is playing).
  Stop, or leaving Free, stops it.
- **Add key** (button and the `c` key, which no shortcut uses today; the free camera's WASD/QE
  and the player keys in `useReplayShortcuts.ts:141` stay as they are): it captures the free
  camera at the current frame. The panel's anchor choice decides what is written:
  - Position: World, or Follow <player> with "world-aligned" or "turns with heading". With a
    player, the captured world position is converted into that player's offset at this frame.
  - Look: Orbit point (the free camera's target, as a world point), or <player> (with the captured
    target converted into an offset from that player's feet).
- **Key list**: time (match clock), a summary of the anchors, an ease picker, fov and roll
  fields, Go to (seeks to the key's frame through the page's scrub path, `onScrub`, and pauses),
  Set from camera (recaptures this key's pose), and Delete.
- Unsaved edits are marked on the Save button. Leaving the match with unsaved edits asks once.

## Export additions

- **Script range**: while a script plays, the export panel offers "Use script range", which sets
  the bounds to the first and last key's frames.
- **Clean frame**: an export option that paints no HUD and no name tags, for footage that gets
  graphics composited over it later. It is off by default. It applies to any 3D export, not only scripted ones.
- **Camera track**: an export run by URL (`#/matches/<id>?autoexport=<script>...`) also uploads
  the camera of every encoded frame to `PUT /api/matches/{id}/exports/{name}/camera`, stored as
  `exports\<name>.camera.json` beside the clip (`GET` the same path to read it):
  `{version:1, matchId, script, fps, units, samples:[{i, frame, scriptMs, pos, dir, fov, target, sightBlockedAt, nearCover}]}`
  in world coordinates (world units, z up); `fov` is the camera's VERTICAL degrees, `target` the
  script's look point. A camera path is measured from it (speed, turn rate, distance to the
  subject) instead of judged by eye. `sightBlockedAt` is the distance from the camera to the first
  map surface between it and `target` (null: clear); surfaces nearer than the script's `near` (the
  map's cutaway; without one, the camera's near plane) are cut away and ignored, so a cutaway is
  not flagged. `nearCover` (0 to 1) is the share of the frame covered by map geometry nearer than
  35% of the camera-to-target distance and beyond that same cut, from a 12 x 7 grid of first-hit rays through the frame against the same
  surfaces (`scene3d/cameraSight3d.ts`): it catches a wall slab filling a third of the shot. Both
  are null without a target.
- **Motion blur** (`&blur=<subframes 1..32>`, default 1 = off; `&shutter=<degrees 1..360>`,
  default 180): each file frame is the GPU average, in linear light, of N subframes centered on
  the frame's time and spread over `shutter / 360` of the frame interval
  (`export/exportShutter.ts`, `scene3d/exportAccumulator3d.ts`). A script export spreads them in
  script time and maps each to its film frame with the script's clock; a plain export
  interpolates toward the next plan frame. Tags, HUD and the camera track are the center
  subframe's. Rendering cost grows with N.
- **Supersampling** (`&ss=1|2`, default 1): the 3D frame renders at 2x the file's size on each
  side (through the pixel ratio, so the outline keeps its share of the frame) and is box-filtered
  down. It needs about four times the GPU memory of a plain export.
- Both are 3D-export options of `ExportRunOptions` (`motionBlur`, `supersample`); the export
  dialog does not offer them yet. An invalid value is refused with its reason, like the other
  parameters.

## Out of scope for version 1

Time-stretched sound under slow motion, a render endpoint so another tool can trigger an export
remotely, and finding a player's best kill automatically. The format leaves room for each: a
later version adds top-level fields, and `version` gates them. (Depth of field and camera shake,
once listed here, are in version 1 as optional fields: decision 10.)

## Units of work

Each unit is one worker brief with its own reading set. Builders run only the test files they
touched, with `--maxWorkers=2`. The lead runs the full suites once before merge, and sees every
visual change in the viewer before reporting it done.

1. **Format and evaluator** (pure, no scene): `scene3d/cameraScript3d.ts` with the types,
   `parseCameraScript` (validation, as above), and `evaluateCameraScript`; plus
   `cameraScript3d.test.ts`. Reading set: `tracks3d.ts` (lines 1 to 115), `fovLogic.ts`, `body3d.ts`.
2. **Server storage**: `cmd/infinite-theater-3d/serve_camera_scripts.go` with routes
   registered in `remote_routes.go`, the origin check as in `serve_bvh.go` (`originAllowed`),
   the match id checked with `store.MatchIDValid`, the name validated, the body checked for
   shape and size (256 KB cap), written atomically under the match's data directory; plus Go
   tests. Reading set: `serve_bvh.go`, `remote_routes.go` (lines 340 to 400), the store's
   match-path helper.
1b. **The clock** (pure): `clock` parsing and validation, `scriptClockOf(script)` with
   `docMsAt(s)`, `rateAt(s)` and `lengthMs`, and `evaluateCameraScript` taking script time and
   resolving anchors at `docMsAt(s)`; plus tests (each ease's integral against a fine numeric sum,
   rate 0 freezing document time, no clock being the identity).
3. **Scene integration**: `ReplayCamera3d` script slot posed at a script time, the
   `render`/`primeFirstFrame` orbit skip, `ScopeView3d.hold`, `cameraScriptStore.ts` (which also
   holds the playhead, the script time being drawn), registration in `Replay3DView.tsx`, and the
   script transport: while a script plays, `usePlaybackLoop` advances script time by wall time ×
   the page speed and sets `frameRef` to the clock's document frame; the page's own scrub stops
   the script; plus tests in `replayCamera3d.test.ts` and `usePlaybackLoop`'s tests.
4. **Camera panel**: `ui/CameraScriptPanel.tsx`, its pure model (key capture to anchor
   conversion, the dirty state, the API client), the panel slot and toolbar button in
   `MatchViewScreen.tsx`/`PlayerTransport.tsx`, the `c` shortcut, and stopping the script when
   the camera leaves Free; plus tests for the model and the panel.
5. **Export additions**: clean frame, and "Export script": the plan samples script time at the
   export rate over the script's length and maps each sample to its document frame
   (`replayExportPlan.ts` builds a list of document frames today, so the list is the seam), with
   the playhead set before each `exportFrame`; sound muted where the rate is not 1. In
   `ReplayExportDialog.tsx`, `useReplayExport.ts`, `replayExportPlan.ts`, `export3dFrame.ts`;
   plus their tests.

Units 1 and 2 are independent and done. 1b is next. Unit 3 needs 1b. Unit 4 needs 2 and 3 and
waits on where the maneuver layer lives. Unit 5 needs 3.

## Acceptance

- `cameraScript3d.test.ts` covers: a key on a world point; a player key that follows a moving
  player between keys; a blend from player A to player B; `cut` (no blend, and the spline's
  neighbor points not crossing it); holding before the first key and after the last; heading
  mean across the 359/0 degree seam; fov and roll easing; and each validation rejection.
- Go tests cover: a round trip, the list, delete, an invalid name, a mismatched `matchId`, a
  foreign Origin refused, oversize refused, and an unknown match.
- In the viewer (the lead's check): author a three-key script on a real match, scrub through it,
  play it, export it at 1080p with Clean frame, and the file shows the same moves as the preview.
