# Infinite Theater 3D

A local-first 3D theater replay viewer for Halo Infinite. Status: early, skeleton only. The current CLI reports information from a local film chunk directory and can build a map's 3D mesh; there is no viewer yet.

Requires Go 1.26.11 or newer and a C/C++ toolchain for cgo (the upstream files-reader includes the `ooz` decompressor). Building a map mesh additionally requires a local Halo Infinite installation.

```powershell
$env:CGO_ENABLED = '1'
go build ./cmd/infinite-theater-3d
.\infinite-theater-3d.exe version
.\infinite-theater-3d.exe decode-info <chunk-dir>
.\infinite-theater-3d.exe build-mesh --map sgh_blueprint --out sgh_blueprint.glb
```

The CLI also builds a map variant's object layer (`build-variant`), a weapon's static model (`build-weapon`), the Spartan body with its game animations (`build-spartan`), a single Spartan armor piece (`build-piece`), and a weapon's first-person rig with its arms and animations (`build-firstperson`). See their sections below.

## build-mesh

`build-mesh` writes a native map's world mesh (geometry, sun, baked light probes, placed lights) to a GLB file, built in-process from the local game installation:

```powershell
.\infinite-theater-3d.exe build-mesh --map <module-key> [--game <deploy-root>] --out <file.glb>
```

- `--map` is the map's installed module key (its folder name under `<deploy>/pc/levels/multi`), e.g. `sgh_blueprint` (Recharge), `sgh_streets` (Streets), `ctf_aquarius` (Aquarius).
- `--game` is the game's `deploy` root; omitted, it is auto-detected the way the game-file reading chain always does: the `LEVELUP_HALO_DEPLOY` environment variable first, then a Steam or Xbox install found on disk.
- `--out` is the GLB file to write.

The map's objective-anchor positions, name list and background calibration come from reference data shipped inside the binary (`internal/mapref`), not from the game install: see [NOTICE.md](NOTICE.md).

## build-variant

`build-variant` writes a map variant's object layer (the crates, cover and accessories a `.mvar` places that neither the map's own structure nor its scenario do) to its own GLB, no sun or lighting (those are the map's):

```powershell
.\infinite-theater-3d.exe build-variant --map <map-key> --mvar <file.mvar> [--game <deploy-root>] [--forge-materials <file.json>] [--forge-objects <file.json>] --out <file.glb>
```

- `--map` is the variant's map key: an installed map's module folder name (e.g. `sgh_blueprint` for Recharge), or a Forge map's `map_id` (resolved against the game's own Forge canvas modules, falling back to the variant's own `level_id` for a canvas the catalog does not yet name).
- `--mvar` is the path to the variant's `.mvar` file; this tool never downloads one itself.
- `--game` is as in `build-mesh`.
- `--forge-materials` is an optional override for the Forge material tints catalog (JSON). Omitted, this tool uses the copy embedded in the binary (`internal/mapref`, from LevelUp's `data/titles/halo_infinite/reference/forge_materials.json`, ~160 KB); see [NOTICE.md](NOTICE.md).
- `--forge-objects` is an optional override for the Forge object visibility catalog (JSON). Omitted, this tool uses the copy embedded in the binary (`internal/mapref`, from LevelUp's `data/titles/halo_infinite/reference/forge_objects.json`, ~3.8 MB); without any catalog (impossible now that one is embedded, but true of an empty override file), Forge's own editor-only markers (blockers, gameplay volumes, spawn/nav-mesh markers, generic lights, FX) would be placed in the layer along with everything else.
- `--out` is the GLB file to write.

## build-weapon

`build-weapon` writes one weapon's static third-person model (no animation; a weapon only animates on the Spartan body's reload/fire clips, not ported — see build-spartan) to a GLB file, read from the index of any installed map (weapons live in the game's shared `globals`/`common` modules):

```powershell
.\infinite-theater-3d.exe build-weapon --weapon <hex-id> --map <module-key> [--game <deploy-root>] --out <file.glb>
```

- `--weapon` is the weapon's `weap` tag GlobalID: 8 hex digits, optional `0x` prefix (e.g. `2b1824d5` for the BR75 Battle Rifle, `48c19d2d` for the MA40 Assault Rifle).
- `--map` is any installed map's module key, as in `build-mesh`; its index covers the game's weapons.
- `--game` and `--out` are as in `build-mesh`.

## build-spartan

`build-spartan` writes the Spartan body (default armor) as an animated skinned GLB: squelette, geometry and influences, with the posture/class-agnostic body animations baked on (idle, locomotion in eight directions, crouch, slide, airborne, landing, climb, thruster dodge, melee, death — `mapmesh.BodyAnimations`, 73 animations as of this build):

```powershell
.\infinite-theater-3d.exe build-spartan --map <module-key> [--game <deploy-root>] --out <file.glb>
```

- `--map` is any installed map's module key; its index covers the game's globals, where the Spartan render_model and its animation graphs live.
- `--game` and `--out` are as in `build-mesh`.

Not baked on: each weapon's own reload/fire/vent clips, which LevelUp selects by the weapon held (its `meshproto.ClipsDesArmes`/`ClipsDesClasses` catalogs) — that is viewer-side animation-selection wiring this repo does not have yet.

## build-piece

`build-piece` writes one Spartan armor piece (a region's permutation) as a skinned GLB, on the Spartan's full skeleton so a viewer can pose every piece on the one body rig:

```powershell
.\infinite-theater-3d.exe build-piece --region <hex-id> --permutation <hex-id> --map <module-key> [--game <deploy-root>] --out <file.glb>
```

- `--region` and `--permutation` are the piece's key (StringIDs): 8 hex digits, optional `0x` prefix.
- `--map` is any installed map's module key; its index covers the game's globals.
- `--game` and `--out` are as in `build-mesh`.

Not ported: LevelUp builds every piece of the Spartan (and the arms) at once into a library folder with a shared index and texture depot, and paints each material with a coating style read from the community Ekur reference (a Blender plugin's JSON export, external to this repo). This tool builds one piece at a time with its textures embedded in its own GLB, in its default (unpainted) color, matching LevelUp's own documented behavior when no Ekur reference is given.

## build-firstperson

`build-firstperson` writes one weapon's first-person rig (arms, weapon and every distinct animation its graph carries) as an animated skinned GLB:

```powershell
.\infinite-theater-3d.exe build-firstperson --weapon <hex-id> --map <module-key> [--game <deploy-root>] [--no-arms] --out <file.glb>
```

- `--weapon` is the weapon's `weap` tag GlobalID, as in `build-weapon`; only weapons with a first-person block build (most arena weapons; swords and the gravity hammer have no FP rig block to read).
- `--map` is any installed map's module key; its index covers the game's weapons and globals (arms live there, like the Spartan body).
- `--no-arms` keeps the skeleton and clips without the Spartan's arm geometry, for a viewer that poses its own arms.
- `--game` and `--out` are as in `build-mesh`.

## Web viewer (development)

`web/` is a Vite + React + TypeScript app with the 3D replay scene lifted from LevelUp's
`apps/web` (`src/features/match-replay/scene3d/` and its supporting model/layers/sound/i18n
code), ported to run standalone against two local files instead of the LevelUp API.

```powershell
cd web
npm install
npm run dev   # http://localhost:5183
```

It loads a replay document and a map mesh from `web/public/dev/` (gitignored — not
checked in): put a normalized replay document at `web/public/dev/replay.json` and the
map's GLB at `web/public/dev/map.glb`. Weapon models and per-player armor are passed as
`null` for now (no server route serves them yet in this standalone build); the scene
falls back to its built-in default appearance, exactly as it already does in LevelUp
when those assets are not yet available.

Based on JGtm's [LevelUp](https://github.com/JGtm/LevelUp) and published Halo modules. See [NOTICE.md](NOTICE.md) and [third_party/README.md](third_party/README.md). Licensed under AGPL-3.0.
