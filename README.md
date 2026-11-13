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

`build-weapon` writes one weapon's static model (no animation; animation lives only on the Spartan rig, which this tool does not build) to a GLB file, read from the index of any installed map (weapons live in the game's shared `globals`/`common` modules):

```powershell
.\infinite-theater-3d.exe build-weapon --weapon <hex-id> --map <module-key> [--game <deploy-root>] --out <file.glb>
```

- `--weapon` is the weapon's `weap` tag GlobalID: 8 hex digits, optional `0x` prefix (e.g. `2b1824d5` for the BR75 Battle Rifle, `48c19d2d` for the MA40 Assault Rifle).
- `--map` is any installed map's module key, as in `build-mesh`; its index covers the game's weapons.
- `--game` and `--out` are as in `build-mesh`.

Based on JGtm's [LevelUp](https://github.com/JGtm/LevelUp) and published Halo modules. See [NOTICE.md](NOTICE.md) and [third_party/README.md](third_party/README.md). Licensed under AGPL-3.0.
