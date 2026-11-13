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

## Sign in and fetch a match

Sign-in uses the device-code flow: the program prints a Microsoft address and a short code,
you enter the code in your own browser, and the program never sees your password. It uses
this project's own public Microsoft app registration; `--client-id` or `IT3D_CLIENT_ID`
replaces it. Tokens are stored encrypted for the current Windows user in the data directory.

```powershell
.\infinite-theater-3d.exe login
.\infinite-theater-3d.exe matches --count 10
.\infinite-theater-3d.exe fetch --match <match-id>
.\infinite-theater-3d.exe serve
```

For a local `import`, pass `--mvar <file>` with `--stats <file>` to include live objective zones.

To rebuild a fetched replay from its saved inputs without a network request, run
`.\infinite-theater-3d.exe rebuild <match-id> --data <dir>`.

The same steps are available to the web viewer through `serve`: `POST /api/auth/login`
starts the device-code flow, `GET /api/auth/state` reports `signed_out`, `pending` (with the
address and code to show), `signed_in` or `failed`, `POST /api/auth/logout` signs out,
`GET /api/remote/matches` lists recent matches, and `POST /api/matches/{id}/fetch` with
`GET /api/matches/{id}/fetch/state` downloads and builds one. State-changing routes accept
requests from loopback origins only. No route ever returns a token.

Use `--data <dir>` on each command to select a data directory. The default is
`IT3D_DATA_DIR`, else the `data` folder of the repo checkout the program runs from
(gitignored; worktrees share the main checkout's), else
`%LOCALAPPDATA%\infinite-theater-3d\data` outside any checkout. Tokens are encrypted for
this Windows user with DPAPI under `auth`; `logout` removes the stored credentials. Fetch
stores the film, stats, map variant, and public player customization with the replay. It
reuses verified chunks on a subsequent attempt. Films expire on the service, and a film
still being finalized must be tried again later. Real service compatibility has not yet
been verified.
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

## build-weapons

`build-weapons` builds the whole weapon model library at once: every weapon in the installed
game's roster (its `weap` tags), the game's grenade projectiles, and the Spartan body with its
game animations, into the data directory's `weapons` folder, plus the `index.json` the viewer
reads. Each model reuses the same per-model builder `build-weapon` and `build-spartan` use
(`mapmesh`), so the GLBs are byte-compatible with a single-weapon build:

```powershell
.\infinite-theater-3d.exe build-weapons --map <module-key> [--game <deploy-root>] [--data <dir>]
```

- `--map` is any installed map's module key; its index's search path covers the game's
  `globals`/`common` modules, where the weapons and the Spartan live.
- `--game` is the deploy root; omitted, it auto-detects the same way `build-mesh` does.
- `--data` is the data directory the library lands in (`<dir>/weapons`); default as above
  (`IT3D_DATA_DIR`, else the checkout's `data` folder, else `%LOCALAPPDATA%`).

The roster is the game's own `weap` tags, so the library covers every weapon a match can name
without a replay-specific selection. A weapon whose model cannot be read (no visible geometry
in its `default` variant, or an unreadable material) is written as an empty `<key>.none`
marker, not an error: the build continues and the viewer falls back to a placeholder for it.
The command reports how many were built, how many skipped, the total bytes, and the wall time.

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

## build-firstperson-library

`build-firstperson-library` builds the whole first-person library at once: every weapon the
game renders in first person (the arms of the Spartan's default armor and the weapon on the
one skeleton of the weapon's own FP animation graph, every distinct animation baked on),
into `<data>/first-person`:

```powershell
.\infinite-theater-3d.exe build-firstperson-library [--game <deploy-root>] [--data <dir>] [--map <module-key>]
```

- `--map` is any installed map's module key; its index covers the game's weapons and
  globals. Omitted, the first map in the data store is used; with no map in the store the
  build fails with a named error.
- The library holds one rig per first-person-capable weapon, named by the content digest of
  the written rig (`rig-<16 hex>.glb`): two weapons on the same rig share a file. Shared
  images are externalized to the library's texture depot (`texture-<32 hex>.png|jpg`), so
  every rig stays small. `index.json` (the per-weapon and per-rig entries the viewer reads)
  and `bras.json` (the arm pieces catalog, written empty: this library does not build piece
  GLBs, the view uses the arms baked in each rig) are written last; a weapon whose rig
  cannot be read gets an empty `<key>.none` marker and a `failures` entry, and the build
  continues. A build interrupted mid-way resumes: files already built are kept.

## serve

`serve` is the local HTTP server (standard library only) over the data directory. It binds
to loopback by default and serves the match list, a match's replay document (gzip as stored,
or decompressed), and a map's mesh (range-capable):

```powershell
.\infinite-theater-3d.exe serve [--addr <host:port>] [--web <dir>] [--data <dir>] [--game <deploy-root>] [--map <module-key>]
```

- `--addr` is the listen address (loopback by default, `127.0.0.1:8177`).
- `--data` is the data directory (default: `IT3D_DATA_DIR`, else the checkout's `data` folder, else `%LOCALAPPDATA%/infinite-theater-3d/data`).
- `--game` is the game deploy root passed to on-demand map and weapon builds; omitted, it
  auto-detects the same way `build-mesh` does.
- `--map` is the installed map whose module index the weapon-library build opens (its search
  path covers the game's `globals`/`common` weapons). Omitted, it defaults to the first map
  in the data store; with no map in the store the weapon routes answer `409`.

Routes:

- `GET /api/health` — version and liveness.
- `GET /api/matches` — the match summaries, newest first.
- `GET /api/matches/{id}/replay` — the match's built replay document (gzip if the client
  accepts it, otherwise decompressed).
- `GET /api/matches/{id}/mesh.glb` — the map's geometry (range-capable). A missing mesh is a
  JSON `404` naming the module key.
- `POST /api/matches/{id}/mesh/build` — starts or joins the on-demand build of the match's
  map. Answers `202` with the state JSON while it builds, `200` `ready` when the file is
  already present, `404` for an unknown match, and `409` when the match has no map module.
  Refused with `403` from a non-loopback `Origin`, so another website open in the browser
  cannot trigger a build.
- `GET /api/matches/{id}/mesh/state` — the module's build state:
  `{"state":"absent|queued|building|ready|failed","moduleKey":"...","error":"...",
  "queuePosition":N,"startedAt":"...","elapsedMs":N}` (fields that do not apply are omitted).

The weapon library (built by `build-weapons`, or on demand through the routes below) is
served the same way the viewer addresses it: one GLB per model key.

- `GET /api/weapons` — the weapon library's index (`{"schema":1,"weapons":[...8-hex keys...]}`).
  Before the library is built it is a JSON `404` `{"error":"weapons_not_built"}`.
- `GET /api/weapons/{key}.glb` — one weapon model (range-capable), where `{key}` is a model
  key: a weapon's 8-hex `weap` family, `grenade<rank>`, or `spartan`. A name that is not a
  well-formed model key, or that would escape the weapons folder, is a JSON `404`
  `{"error":"weapon_model_not_available"}`. A weapon with no readable model has no GLB (an
  empty `<key>.none` marker is written instead), so its fetch is a `404` the viewer treats as
  a placeholder.
- `POST /api/weapons/build` — starts or joins the weapon-library build (one job, queued with
  the map builds so it never runs beside one). Answers `202` while it builds, `200` `ready`
  when the library is already present, `409` when there is no map key to open an index from,
  and `503` when the build runner is unavailable. Refused with `403` from a non-loopback
  `Origin`, as the map build is.
- `GET /api/weapons/state` — the weapon library's build state, in the same JSON shape as the
  mesh state (its `moduleKey` is `weapons`).

The first-person library (built by `build-firstperson-library`, or on demand through the
routes below) is served the way the viewer addresses it: it derives the folder from the
weapons path it is given (`/api/weapons` to `/api/first-person`).

- `GET /api/first-person/index.json` — the first-person library's index: the per-weapon
  entries (`weapon`, `file`), the per-rig entries (`file`, `bones`, `triangles`, `bytes`,
  `idleWeapon`, `clips`, `actions`, `missingActions`) and the texture depot summary. Before
  the library is built it is a JSON `404` `{"error":"first_person_not_built"}`.
- `GET /api/first-person/bras.json` — the arm pieces catalog (written empty by this
  library). Before the build it is a JSON `404` `{"error":"first_person_not_built"}`.
- `GET /api/first-person/{file}` — one library file (a `rig-<16 hex>.glb` or a
  `texture-<32 hex>.png|jpg`, range-capable). A name that is not one of the library's own,
  or that would escape the library folder, is a JSON `404`
  `{"error":"first_person_file_not_available"}`.
- `POST /api/first-person/build` — starts or joins the first-person-library build (one job,
  queued with the map builds and the weapon-library build so at most one heavy build runs
  at a time). Answers `202` while it builds, `200` `ready` when the library is already
  present, `409` when there is no map key to open an index from, and `503` when the build
  runner is unavailable. Refused with `403` from a non-loopback `Origin`, as the others are.
- `GET /api/first-person/state` — the first-person library's build state, in the same JSON
  shape as the mesh state (its `moduleKey` is `first-person`).

At launch, when a game install is found, `serve` starts every one-time build in the
background at once, in this order: the weapon icon set, the weapon model library, the
first-person library, and, for every match in the store, that match's map mesh and variant
layer (each distinct map module once). A build whose output is already in the data folder
is skipped, so a restart only builds what is still missing. The builds land in the data
directory (`<data>/assets/weapons-icons/...`, `<data>/weapons`, `<data>/first-person`,
`<data>/maps/...` and each match's own folder) and run one at a time, never blocking the
server from listening. A match fetched while the server runs is added to the same queue
the moment the fetch route saves it. With no game install found the startup logs once and
queues nothing; the on-demand routes below still answer and can trigger a build.

A map, the weapon library and the first-person library build at most one at a time
process-wide: the jobs share the map build queue, so no two of them run together. A
build writes each GLB, texture and index to a temporary file in its library folder and
renames it into place on success, so a half-written file is never served.

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
map's GLB at `web/public/dev/map.glb`. Weapon models are served by the `serve` weapon
routes (`/api/weapons` index and `/api/weapons/{key}.glb`); the viewer is pointed at
them by passing a non-null `weaponsPath` to the scene (the `WeaponModels` base). Per-player
armor is still passed as `null` in this standalone build; the scene falls back to its
built-in default appearance, exactly as it already does in LevelUp when those assets are
not yet available.

Based on JGtm's [LevelUp](https://github.com/JGtm/LevelUp) and published Halo modules. See [NOTICE.md](NOTICE.md) and [third_party/README.md](third_party/README.md). Licensed under AGPL-3.0.

