# Armor pipeline map

## LevelUp reference

| Route or consumer | Data required | Standalone status |
| --- | --- | --- |
| `GET /players/{player_slug}/matches/{match_id}/replay/spartans` | Replay roster and each player's armor manifest. The manifest combines equipped customization, resolved theme and inventory item definitions, body overrides, accessories, coating and visor. Missing players fall back individually. | Fetch saves raw customization in `matches/<id>/customization/<xuid>.json`; no manifest route or definition resolver. |
| `GET /players/{player_slug}/matches/{match_id}/replay/spartan-pieces/{file}` | Shared library: `index.json`, piece and attachment GLBs, texture files, `coatings.json`, coating JSON and swatch PNGs. Filenames are restricted by `meshproto/pieces_armure.go`. | No route or complete library build. `build-piece` produces one GLB. |
| `GET /players/{player_slug}/matches/{match_id}/replay/weapons/spartan.glb` | Animated Spartan body shared by the match. | `/api/weapons/spartan.glb` and `build-spartan` exist; the weapons library builds the body. |

LevelUp registers the routes in `apps/go-api/internal/api/handlers/replay.go` and `replay_spartans.go`. Its `haloadapter/armor_manifest.go` combines theme base regions, equipped item overrides and body/prosthetic overrides. `cmd/mapmesh-build/pieces.go`, `internal/mapmesh/pieces_armure.go`, `pieces_accessoires.go` and `revetements*.go` build the library, optionally using Ekur reference data for coatings. The reference service reads item and theme definitions in addition to customization; inventory paths alone are not geometry IDs.

## Web and standalone wiring

`web/src/lib/replay/spartanArmor.ts` requests the manifest and names the piece-library base URL. `Replay3DView` passes manifests to `scene3d/armory3d.ts`, which uses `armorLibrary3d.ts` to load the index, GLBs, textures and coatings, and `spartanArmor3d.ts` to dress the animated body. These components already exist in the standalone, but `MatchViewScreen.tsx` passes `armor={null}` and the existing hook still uses LevelUp player-scoped URLs.

The standalone runner is `internal/meshjobs` wired by `cmd/infinite-theater-3d/serve_jobs.go`. `serve_startup.go` queues shared libraries and match builds; fetched customization is persisted by `fetch.go`. `dataDirFor` chooses the data root. All generated game assets belong there, outside Git.

## First-person arms

The first-person library includes skinned arm pieces and `bras.json`, ported from LevelUp's `premiere_personne_bras.go`. The viewer selects the followed player's region permutations, binds them to the weapon rig, and uses the Spartan coating library to paint them. Arm material styles require the same Ekur reference used by the Spartan piece build (`IT3D_EKUR_DIR` or `<data>/ekur`).

Rebuild an existing library with `infinite-theater-3d build-firstperson-library --data <data-dir>`. The build route only queues a missing library and does not rebuild an existing one. The build reads the installed game and writes generated assets only under the selected data directory. An existing Spartan coating library must also have been built with Ekur.
