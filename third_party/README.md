# Upstream modules

The source files below are unmodified as of 2026-11-13. Each retains its own `go.mod`, license and notices. The listed h1 values are the Go module zip hashes, before the documented omissions. To compare against a future tag, download its module zip with `go mod download`, extract it outside this repository, and compare its module directory with the matching directory here, accounting for these omissions.

| Directory | Upstream | Version | Zip hash | License |
| --- | --- | --- | --- | --- |
| film-decoder | https://github.com/JGtm/halo-infinite-film-decoder | v1.3.2 | `h1:pIE2RB0i666fGg3A0hcvlB5mYsocSIsjOXV31um4+vY=` | AGPL-3.0 |
| map-images | https://github.com/JGtm/halo-infinite-map-images | v1.0.1 | `h1:Op1TrnECQKrCxOjWkI2Cb9WGf+S5nOikyap5eGZdPA=` | AGPL-3.0 |
| files-reader | https://github.com/JGtm/halo-infinite-files-reader | v1.0.1 | `h1:sqD4leKw4x9yC+JdXWAVHOio6LOqF+VzKgcWZ5SL688=` | AGPL-3.0; `ooz` GPL-3.0 |

`files-reader/ooz` uses cgo and requires a C/C++ toolchain.

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

Tests: `map-images` passes. `files-reader/hinavmesh` fails before and after the merge
because its game-derived fixtures are not shipped here.
