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

Based on JGtm's [LevelUp](https://github.com/JGtm/LevelUp) and published Halo modules. See [NOTICE.md](NOTICE.md) and [third_party/README.md](third_party/README.md). Licensed under AGPL-3.0.
