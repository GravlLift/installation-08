# Infinite Theater 3D

A local-first 3D theater replay viewer for Halo Infinite. Status: early, skeleton only. The current CLI reports information from a local film chunk directory; there is no viewer yet.

Requires Go 1.26.11 or newer and a C/C++ toolchain for cgo (the upstream files-reader includes the `ooz` decompressor). A local Halo Infinite installation will be needed later for building game-derived assets.

```powershell
$env:CGO_ENABLED = '1'
go build ./cmd/infinite-theater-3d
.\infinite-theater-3d.exe version
.\infinite-theater-3d.exe decode-info <chunk-dir>
```

Based on JGtm's [LevelUp](https://github.com/JGtm/LevelUp) and published Halo modules. See [NOTICE.md](NOTICE.md) and [third_party/README.md](third_party/README.md). Licensed under AGPL-3.0.
