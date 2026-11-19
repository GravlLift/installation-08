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

4. **A player-relative offset is either world-aligned or turns with the player's heading.**
   `world`: the offset is in game axes and only follows the player's position, so the camera
   never swings when they flick their aim (the default). `heading`: the offset is in the player's
   frame (x forward along the heading, y to their left, z up) and the heading is a circular mean
   over a short window (default 400 ms, 8 samples ending at `t`). The mean is a pure function of
   `t`, so scrubbing and export agree.

5. **Interpolation: centripetal Catmull-Rom on positions and look targets, with an ease per
   segment.** Each key's `ease` says how the camera arrives at that key from the previous one:
   `smooth` (ease in and out, the default), `linear`, `in`, `out`, or `cut` (a jump at the key's
   time, with no blend). A `cut` splits the script into runs, and the spline's neighbor points never
   cross a cut. At the ends of a run the missing neighbor is a phantom point mirrored through
   the end key (`2*P1 - P2`), so the first and last segments still curve. Before the first key the camera
   holds the first key's pose, and after the last key it holds the last key's pose, both still
   resolved at `t`, so a held key on a player keeps following that player. `fov` and `roll` are
   eased linearly with the same ease.

6. **Field of view in the game's own convention.** `fov` is horizontal degrees at 16:9, the same
   as the game's FOV setting (`fovLogic.ts`: `GAME_FOV_DEFAULT` 100, `verticalFovOf`), with an
   accepted range of 10 to 150 so tight cinematic lenses work. When it is absent, the user's FOV
   setting applies.

7. **Evaluation is one pure function**, `evaluateCameraScript(script, tMs, resolve)`, that returns
   `{ position, target, verticalFov, roll }` in three.js coordinates. The screen loop, scrubbing
   and the export all reach it through `ReplayCamera3d.placeCamera`, which the export already calls
   with each frame (`replayExportScene3d.ts`, `exportFrame`). One path means the video matches what
   you previewed.

8. **Scripts are stored by the server, per match**, as JSON files in the app's data directory,
   behind `GET/PUT/DELETE /api/matches/{id}/camera-scripts/{name}` and a list route. The routes
   are also how another local tool hands a script to Installation 08. They are never stored
   in browser storage, which the app window can lose.

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

- `t`: document milliseconds; keys are sorted by `t`, and two keys may share a `t` only when the
  second is a `cut`.
- `pos`, `look`: `{ at: "world", point: [x, y, z] }` or
  `{ at: "player", xuid, offset?: [x, y, z], relative?: "world" | "heading", window?: ms }`.
  A player point is that player's feet at `t`, plus `offset`. Without `offset`, a `look` aims at
  the body's center (`BODY_CENTER` above the feet, `body3d.ts`). `relative` defaults to `world`,
  `window` to 400.
- `fov` (optional, 10 to 150), `roll` (optional, degrees, positive turns the frame clockwise),
  `ease` (optional, default `smooth`; the first key's `ease` is ignored).
- `name`: 1 to 64 characters, `[a-z0-9_-]`. The server writes the name that is in the URL.
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

## Out of scope for version 1

Time remapping (slow motion on the kill), depth of field, camera shake, a render endpoint so
another tool can trigger an export remotely, and finding a player's best kill automatically. The format
leaves room for each: a later version adds top-level fields, and `version` gates them.

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
3. **Scene integration**: `ReplayCamera3d` script slot, the `render`/`primeFirstFrame`
   orbit skip, `ScopeView3d.hold`, `cameraScriptStore.ts`, and registration in
   `Replay3DView.tsx`; plus tests in `replayCamera3d.test.ts`.
4. **Camera panel**: `ui/CameraScriptPanel.tsx`, its pure model (key capture to anchor
   conversion, the dirty state, the API client), the panel slot and toolbar button in
   `MatchViewScreen.tsx`/`PlayerTransport.tsx`, the `c` shortcut, and stopping the script when
   the camera leaves Free; plus tests for the model and the panel.
5. **Export additions**: script range and clean frame in `ReplayExportDialog.tsx` and
   `useReplayExport.ts`/`export3dFrame.ts`; plus their tests.

Units 1 and 2 are independent. Unit 3 needs 1. Unit 4 needs 2 and 3. Unit 5 needs 3.

## Acceptance

- `cameraScript3d.test.ts` covers: a key on a world point; a player key that follows a moving
  player between keys; a blend from player A to player B; `cut` (no blend, and the spline's
  neighbor points not crossing it); holding before the first key and after the last; heading
  mean across the 359/0 degree seam; fov and roll easing; and each validation rejection.
- Go tests cover: a round trip, the list, delete, an invalid name, a mismatched `matchId`, a
  foreign Origin refused, oversize refused, and an unknown match.
- In the viewer (the lead's check): author a three-key script on a real match, scrub through it,
  play it, export it at 1080p with Clean frame, and the file shows the same moves as the preview.
