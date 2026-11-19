# Hold: a player leaves the film to pose

Status: planned 2026-11-19. Builds on `docs/design/camera-scripts.md` (units 1 and 3 there come
first). Owner: lead session; units go to a Qwen worker.

## What it is

At a chosen moment, a player stops following the film's recorded motion. They stay where they
stood and play a chosen animation: an idle, one of the game's intro emotes, or a Spartan ID
stance. The camera script keeps moving around them. Optionally, the rest of the match freezes on
that moment: other players, ragdolls in mid-fall, projectiles and effects all hold still while
the held player moves. That is the "time stops, the player turns to camera" shot.

## Decisions

1. **A hold is part of the shot, so it lives in the camera script file** as an optional
   `holds` array next to `keys`. One file describes the whole shot, and other tools hand over a
   single document. `parseCameraScript` validates it, and a script without holds is unchanged.

2. **Freezing the world is the script clock at rate 0** (`camera-scripts.md`, decision 9;
   revised 2026-11-19, replacing a `freezeWorld` flag). The world is posed at the clock's document
   frame, `docFrame(s)`; the camera and the held player's animation run on script time `s`. A
   rate of 0 from `at` on stops the world on the kill while the held player turns and emotes; a
   slow rate instead lets the world crawl behind the pose. Ambient motion (clouds, animated
   self-lit surfaces) runs on script time, so the frozen moment still breathes.

3. **The held player's pose is a function of script time, as every pose in the scene is a
   function of its time** (`pose3d.ts`: "nothing accumulates from one frame to the next"). At
   script time `s >= at`, the held pose is computed from `s - at`: a crossfade from the film's
   clip mix at `docMs(at)` to the hold clip
   over `blendMs`, a turn from the heading at `at` to the hold heading over `turnMs`, and the
   pitch eased to the hold pitch (default 0, level) over `blendMs`.

4. **Position: the player's feet at `at`, held there.** A kill made mid-jump keeps the player in
   the air. Dropping to the floor is a later option; a script author picks a grounded `at`.

5. **The weapon held at `at` stays in hand by default** (`weapon: "keep"`; it follows the right
   grip as the clip moves it). `"hide"` removes it, for emotes that use both hands. Props for
   stances are out of scope for version 1.

6. **The held player is drawn even if the film kills them after `at`.** For `f >= at`,
   `placeAvatars` takes the held player's state from the sample at `at`, not from `f`, so a
   later death, respawn or vehicle entry in the film does not reach them.

7. **Camera anchors see the hold.** The camera script's resolver (`feetAt`) returns the held
   position for the held player when `s >= at`, and the clock's document time for everyone
   else. A key that follows the held player therefore orbits a body that stays put.

8. **Clips come from the game's own animation graphs** (the effects-from-game-data rule). The
   body GLB today carries only the gameplay set (`internal/mapmesh/spartan.go`,
   `BodyAnimations`: idles, locomotion, melee, deaths). The pose clips are the game's
   `mp/intro_emote/...` and `menu/stance/...` animation paths, plus the
   `menu/customization/any/any/idle` and `lobby/.../idle` idles. The Library already classifies
   these paths (`P:\software\infinite-library\internal\viewer\server_armor_poses.go`,
   `classifyPose`, Jordan's own code), and that classification is ported here. They are decoded
   on demand, one clip per request, and cached in the data directory, because baking hundreds of
   stances into the body GLB would make every match load them.

## Format addition (inside the camera script, version 1)

```json
"holds": [
  {
    "xuid": "2533...",
    "at": 315200,
    "clip": "mp:intro_emote:i_see_you",
    "loop": false,
    "blendMs": 250,
    "heading": 135,
    "turnMs": 400,
    "pitch": 0,
    "weapon": "keep",
    "until": null
  }
]
```

- `at`: script ms; the player leaves the film at the document time `docMs(at)`. `xuid` must be a player of the match. An
  unknown xuid is dropped with a warning, never thrown, the same rule as camera anchors.
- `clip`: a clip name the scene can resolve: a gameplay clip already in the body GLB
  (`combat:rifle:idle`), or a pose clip from the pose catalog (unit H4). An unknown clip falls back
  to the weapon class's idle.
- `loop` (default false: hold the clip's last frame), `blendMs` (default 250, 0 to 2000),
  `heading` (game degrees; default: the heading at `at`), `turnMs` (default 400, 0 to 5000),
  `pitch` (degrees; default 0), `weapon` (`keep` | `hide`, default `keep`), `until` (script ms
  or null; the player rejoins the film at `until` after a reverse blend of `blendMs`).
- At most one hold per player, at most 16 holds.

## How it fits the scene (confirmed in code, 2026-11-19)

- `ReplayScene3d.render(frame)` (`scene3d/replayScene3d.ts:558`) and
  `ReplayExportScene3d.exportFrame(frame)` (`scene3d/replayExportScene3d.ts:122`) are the two
  entries that pose a frame, and `primeFirstFrame` (`:525`) is a third. With the script clock,
  the frame they receive is already the clock's document frame, and the script time comes from
  the playhead in `cameraScriptStore.ts`. `placeAvatars(f)` reads the playhead only for held
  players: a held player at `s >= at` is drawn from the sample at `docMs(at)` and posed at `s - at`.
- The pose input in `placeAvatars` (`:781`) is
  `{ h, p, crouch, eyeDrop, mix: this.action?.motion(xuid, f, rider, a.mix) }`, applied by
  `placeBody` and then `poseSpartan` (`pose3d.ts:133`). The hold builds the same structure:
  `h` and `p` from the hold's turn and pitch, `crouch: false`, and `mix` from the film's mix at
  `at` faded out while the hold clip fades in. A `ClipMix` is weighted layers
  (`clipSample3d.ts:25`, `ClipLayer { clip, time, weight, loop }`). The worker reads how
  `ClipRig.apply` treats weights before writing the crossfade, since this plan does not confirm
  that.
- Clip lookup: the body GLB's clips are a `SpartanClips` catalog (`clips3d.ts:57`, `get(name)`),
  registered per source model (`spartanClipsOf`). Pose clips from the catalog join it at runtime
  (`SpartanClips` gains `add(clip)`), and each Spartan copy's `ClipRig` must cover the bones those
  clips animate. The worker checks whether `ClipRig` binds bones up front (`clipSample3d.ts:54`,
  "Bones animated by at least one clip"), and if it does, rebuilds or extends the rig when a clip
  arrives.
- The held player's weapon: `this.action.heldWeapon(slot, f)` is called with `at` instead of `f`,
  and with nothing when `weapon` is `hide`.

## Authoring UI (in the camera panel)

A Hold section under the key list:

- Player (defaults to the reference player), **Hold here** (sets `at` to the current frame), and
  Remove.
- Clip picker: the gameplay idles first, then the intro emotes and stances from the pose catalog,
  with names as the catalog gives them. Picking one previews it in place.
- **Face camera** sets `heading` so the player faces the free camera's current position, plus a
  heading field for fine-tuning. Turn, blend and pitch fields, Loop and Hide weapon toggles, and
  Freeze world, which writes a rate-0 entry into the script clock at `at`.

## Units of work

Same rules as the camera script units: run only the touched test files with `--maxWorkers=2`; the
lead runs full suites before merge and sees each visual change in the viewer.

- **H1. Format and hold state** (pure): `scene3d/hold3d.ts` with the hold types,
  `parseHolds` (called from `parseCameraScript`) and
  `holdStateAt(hold, sMs)` returning `{ active, sinceMs, clipTime, blendIn, heading, pitch }`
  (heading turned along the shorter arc). Plus `hold3d.test.ts`. Needs camera unit 1.
- **H2. Scene integration**: the playhead read in the three entries above, the held
  branch in `placeAvatars`, the crossfaded mix, the resolver change, and tests in the files
  touched. Needs camera unit 3 and H1.
- **H3. Pose catalog** (Go, independent of H1 and H2): `GET /api/spartan/poses` lists the
  idle, emote and stance clips of the Spartan's animation graphs, classified by path as the Library
  does (ported from `classifyPose` and `armorPoses`), with names from the clip's resolved
  name. `GET /api/spartan/poses/{name}` decodes one clip on the body's skeleton and serves it in
  a form `clips3d.ts` already reads, cached under the data directory. Read
  `bodyAnimationClips` in `internal/mapmesh/spartan.go` for how a clip is found by path
  (`gs.Tous()`, `entry.Chemin()`, `gs.Resout`) and decoded. The serving format (a GLB holding one
  animation, or JSON tracks matching `ClipTrack`) is the worker's first finding to report before
  building. This plan does not confirm that `himap` can write an animation-only GLB.
- **H4. Hold UI**: the Hold section of the camera panel. Needs camera unit 4, H2 and H3.
- **H5. Export sound under a freeze** (small): while the world is frozen, the export's sound mix
  stops at `at` and does not play the film's later shots. Read how the export mixes sound on the
  match axis first (`export/useReplayExport.ts`).

## Acceptance

- `hold3d.test.ts`: parse rules and rejections; blend weights at 0, half, and full `blendMs`; the turn takes the short
  way across 359/0; a non-looping clip holds its last frame; `until` blends back.
- Go tests for the pose catalog: classification over a fake clip listing (port the Library's
  `server_armor_poses_test.go` cases), one decoded clip served and cached, and an unknown name
  answered with 404.
- In the viewer (the lead's check): on a real kill, hold the killer with an intro emote and
  Freeze world. The world stops on the kill frame, the killer turns and emotes, the camera script
  orbits them, and scrubbing back before `at` plays the film normally. Then export it with Clean
  frame, and the video matches the preview.
