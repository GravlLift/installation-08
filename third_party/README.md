# Upstream modules

The source files below are as of 2026-11-13, with the documented changes noted per module. Each retains its own `go.mod`, license and notices. The listed h1 values are the Go module zip hashes, before the documented omissions. To compare against a future tag, download its module zip with `go mod download`, extract it outside this repository, and compare its module directory with the matching directory here, accounting for these omissions.

| Directory | Upstream | Version | Zip hash | License |
| --- | --- | --- | --- | --- |
| film-decoder | https://github.com/JGtm/halo-infinite-film-decoder | v1.3.2 | `h1:pIE2RB0i666fGg3A0hcvlB5mYsocSIsjOXV31um4+vY=` | AGPL-3.0 |
| map-images | https://github.com/JGtm/halo-infinite-map-images | v1.0.1 | `h1:Op1TrnECQKrCxOjWkI2Cb9WGf+S5nOikyap5eGZdPA=` | AGPL-3.0 |
| files-reader | https://github.com/JGtm/halo-infinite-files-reader | v1.0.1 | `h1:sqD4leKw4x9yC+JdXWAVHOio6LOqF+VzKgcWZ5SL688=` | AGPL-3.0; `ooz` GPL-3.0 |

`files-reader/ooz` uses cgo and requires a C/C++ toolchain.

## Changes from upstream v1.3.2 (film-decoder)

The film-decoder module is a port of the LevelUp `feat/replay-3d` branch onto the published
v1.3.2 upstream (base `ac8d6c3da`). Schema version 122, facts schema 23. Kept capabilities:

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
- Blob codec `REPLAYINPUTS30` (upstream v1.3.2 ships `REPLAYINPUTS29`).
- `filmcache` additions for a decode tool that receives an explicit manifest path outside
  the cache layout: `ParseManifest` (renders the entries of a manifest file by its bytes,
  the same `manifestJSON` shape as `Open`) and `NewSource` (a `Source` whose chunks read
  from a caller-given folder, via a `direct` field on `Source` that `Chunk` consults before
  the cache path). These serve `infinite-theater-3d decode --manifest <file>`; `Open` and
  `OpenChunkDir` keep reconstructing the path from the cache layout and are unchanged.

## Omitted upstream files

The upstream notices identify the following as game imagery or Forge assets. They are excluded under this project's no game-derived assets policy, regardless of corpus size:

- `map-images/himap/testdata/carte_validee_v1.png`
- `files-reader/mapvar/testdata/cliffhanger_map.mvar`
- `files-reader/mapvar/testdata/cliffhanger_ridgeline.mvar`
- `files-reader/mapvar/testdata/vagabond_fo08_wetland.mvar`
- `files-reader/hinavmesh/testdata/01af558d-53ab-4f05-ba68-92d805fc6260.navmesh.blob`
- `files-reader/hinavmesh/testdata/df7dbf08-b8de-4ade-9d7f-1947128c9ae4.navmesh.blob`

All module testdata totals are below 50 MiB. The decoder includes pseudonymized match recordings and derived fixtures, plus identifier and label tables and measured map bounds; its NOTICE documents their provenance, including identifiers read from installation headers. These are data and observations, not game meshes, textures, sounds or scripts. The upstream notices describe the omitted Forge files as public UGC downloads, not installation extracts; the reference image is Microsoft game imagery.
