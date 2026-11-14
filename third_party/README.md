# Upstream modules

The source files below are as of 2026-11-13, with the documented changes noted per module. Each retains its own `go.mod`, license and notices. The listed h1 values are the Go module zip hashes, before the documented omissions. To compare against a future tag, download its module zip with `go mod download`, extract it outside this repository, and compare its module directory with the matching directory here, accounting for these omissions.

| Directory | Upstream | Version | Zip hash | License |
| --- | --- | --- | --- | --- |
| film-decoder | https://github.com/JGtm/halo-infinite-film-decoder | v1.3.6 | `h1:CP7zIqapzMcHHam2aKBMsXAsaNgJCzjTWk27petIpxc=` | AGPL-3.0 |
| map-images | https://github.com/JGtm/halo-infinite-map-images | v1.0.1 | `h1:Op1TrnECQKrCxOjWkI2Cb9WGf+S5nOikyap5eGZdPA=` | AGPL-3.0 |
| files-reader | https://github.com/JGtm/halo-infinite-files-reader | v1.0.1 | `h1:sqD4leKw4x9yC+JdXWAVHOio6LOqF+VzKgcWZ5SL688=` | AGPL-3.0; `ooz` GPL-3.0 |

`files-reader/ooz` uses cgo and requires a C/C++ toolchain.

`vgmstream/` holds no code: only the license texts and the notice of the vgmstream decoder
the packaged build carries (r2168, pinned and hash-checked by `tools/package.ps1`, run as a
separate program by the announcer build). See [vgmstream/NOTICE.md](vgmstream/NOTICE.md).

## Changes from upstream v1.3.6 (film-decoder)

The film-decoder module carries the LevelUp `feat/replay-3d` port on upstream v1.3.6.
Document schema 125, facts schema 23. Local steps 113–122 were renumbered 116–125
after upstream schema 115; see [the rebase inventory](REBASE-v1.3.6.md). Kept capabilities:

- Full-rate tracks (`FullRateTrack`, `Track.FullRate`) with absolute-millisecond times,
  independent of the 33 ms document grid.
- Shot direction from the shooter's aim (`shots_visee.go`, `Shot.P`).
- Aim-only samples for records without a position (`VehicleScan.Aims`).
- Move stick readings from the control view.
- Control-view stances: crouch, slide, jump derived from vertical velocity.
- Shooter identification by control place.
- Drawn weapon per slot (`DrawnWeapons`).
- Damage events per slot (`Damages`).
- Kill cause attribution (`KillCauses`).
- Player gestures: reload, grenade throw, punch (`Actions` / `PlayerAction`).
- Carried ammo reads per life and weapon slot (`AmmoReads`).
- Sub-frame shot offset inside the document frame (`Shot.O`, computed against the
  actual frame interval).
- Blob codec `REPLAYINPUTS30` (upstream v1.3.6 ships `REPLAYINPUTS29`).
- `filmcache` additions for a decode tool that receives an explicit manifest path outside
  the cache layout: `ParseManifest` (renders the entries of a manifest file by its bytes,
  the same `manifestJSON` shape as `Open`) and `NewSource` (a `Source` whose chunks read
  from a caller-given folder, via a `direct` field on `Source` that `Chunk` consults before
  the cache path). These serve `infinite-theater-3d decode --manifest <file>`; `Open` and
  `OpenChunkDir` keep reconstructing the path from the cache layout and are unchanged.
- `decfilm.LoadMapQuantCatalogBytes` (new file `decfilm/catalog_bytes.go`) reads the map
  quantization catalog from its bytes, not a file path: the standalone embeds its reference
  catalog in the binary (`go:embed`, `internal/refdata`). It lives in the facade so the
  `profile` layer, whose sources are fingerprinted, stays identical to upstream.
- `replay.ScoreTarget` (new file `replay/score_target_table.go`, LOCAL-CHANGE):
  the `[score_target]` table of LevelUp's `regulation.toml`, measured per variant, ported
  verbatim. The LevelUp application injects the table into `ScoreInput.TargetScore`; the
  standalone has no config file, so the values live in this module and
  `internal/build` sets the input from the match variant. An absent variant returns no
  target (the timeline's safe fallback).

## Omitted upstream files

The upstream notices identify the following as game imagery or Forge assets. They are excluded under this project's no game-derived assets policy, regardless of corpus size:

- `map-images/himap/testdata/carte_validee_v1.png`
- `files-reader/mapvar/testdata/cliffhanger_map.mvar`
- `files-reader/mapvar/testdata/cliffhanger_ridgeline.mvar`
- `files-reader/mapvar/testdata/vagabond_fo08_wetland.mvar`
- `files-reader/hinavmesh/testdata/01af558d-53ab-4f05-ba68-92d805fc6260.navmesh.blob`
- `files-reader/hinavmesh/testdata/df7dbf08-b8de-4ade-9d7f-1947128c9ae4.navmesh.blob`

All module testdata totals are below 50 MiB. The decoder includes pseudonymized match recordings and derived fixtures, plus identifier and label tables and measured map bounds; its NOTICE documents their provenance, including identifiers read from installation headers. These are data and observations, not game meshes, textures, sounds or scripts. The upstream notices describe the omitted Forge files as public UGC downloads, not installation extracts; the reference image is Microsoft game imagery.

## Changes from upstream (map-images v1.0.1, files-reader v1.0.1)

These two modules are modified copies. The changes come from the LevelUp 3D replay work
(three-way merge against the LevelUp fork point, no conflicts):

- `files-reader`: module reader additions needed by the world mesh build (10 files).
- `map-images`: world mesh collection and GLB export for the 3D viewer: structure, decor
  and placed objects, layered materials and height blend, cut-out materials, baked light
  probes and lamps, sun and sky, terrain heightfields, weapons, armor pieces (117 new files,
  15 modified). New dependency: `github.com/woozymasta/bcn` v0.7.0.
  - `himap/couches_noms.go` (LOCAL-CHANGE): surface recognition by names now refuses to
    classify a color-map family on its secondary control map, which is shared with other
    shader families; only rohg forms (control map as primary) match on it. A shader of a
    color-map family whose color map is absent was misread as a zero-colored gradient layer
    (dark walls on Live Fire, materials of shaders `2aaf6012`/`25144b6b`). Covered by the
    synthetic test `himap/couches_noms_surface_test.go` (new).
  - `himap/arsenal_roster.go` (new, LOCAL-CHANGE): `Arsenal.RosterArmes` enumerates every
    weapon's `weap` GlobalID in the installed modules (the weapon-settings group does not
    exist in the game; the `weap` tags themselves are the roster). It reads the unexported
    geometry index through an `Arsenal` method because no external package can, mirroring the
    existing `Grenade` pattern. Serves the standalone weapon-library build
    (`cmd/infinite-theater-3d build-weapons`).
  - `himap/terrain_melange.go`, `himap/terrain_melange_bake.go` (new, LOCAL-CHANGE) and
    `terrain_collecte.go`, `terrain_maillage.go`, `maillage_monde.go` (modified): an `rtrn`
    terrain now publishes its palette blend instead of one palette color. Each node's weight
    programs (a small stack machine over the node's BC1/BC3 input textures) are evaluated per
    cell, the palette is grouped by color into the four layers the viewer draws, and the
    sequential weights are baked into a mask atlas on UV set 1. Entries without a color map
    (Live Fire's grass) draw the three-color gradient of the Material Layer Data indexed by
    their packed map's alpha. Adds `tagInfo.cibleDonnees` (data reference table lookup).
    Covered by `himap/terrain_melange_test.go` (new).
  - `himap/decorateurs.go`, `himap/decorateurs_pose.go`, `himap/glb_decorateurs.go` (new,
    LOCAL-CHANGE) and `terrain_collecte.go`, `maillage_monde.go`, `glb.go` (modified): a
    terrain's scattered decorators (Live Fire's grass clumps). Reads the `dcrt` meshes (10-bit
    positions, buffers in the tag's resource section), runs each placement description's density
    program on the nodes of every quadtree level under the tiles read, scatters clumps with a
    seeded generator (thinned per kind to a budget), and writes one node per mesh with
    `EXT_mesh_gpu_instancing`. `couches_noms.go` and `decoupe.go` (modified) give the clump
    shaders (`bd7bb1c4`, `d313108e`) a gradient surface and an alpha cutout; that form applies
    only when the shader declares its gradient colors. Covered by `himap/decorateurs_test.go` (new).
  - `himap/couches.go`, `himap/couches_noms.go`, `himap/glb_couches.go` (LOCAL-CHANGE): a level
    shader may skip a template layer (Live Fire's boulder shader `804d3276` declares layers 1, 2
    and 4). Each layer keeps its template rank (`Couche.Rang`), and the GLB writes it as `rang`
    when it differs from the layer's position, so a reader takes the macro mask channel and the
    height blend index of the template layer. Before this, layer 4 read layer 3's mask channel
    (empty on those boulders) and the dirt never showed. Covered by
    `himap/couches_rang_test.go` (new).

Tests: `map-images` passes. `files-reader/hinavmesh` fails before and after the merge
because its game-derived fixtures are not shipped here.
