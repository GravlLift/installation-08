# Infinite Theater 3D

A local-first 3D theater replay viewer for Halo Infinite. Status: early, skeleton only. The current CLI reports information from a local film chunk directory; there is no viewer yet.

Requires Go 1.26.11 or newer and a C/C++ toolchain for cgo (the upstream files-reader includes the `ooz` decompressor). A local Halo Infinite installation will be needed later for building game-derived assets.

```powershell
$env:CGO_ENABLED = '1'
go build ./cmd/infinite-theater-3d
.\infinite-theater-3d.exe version
.\infinite-theater-3d.exe decode-info <chunk-dir>
```

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
