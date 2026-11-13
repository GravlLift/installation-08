# Infinite Theater 3D

A standalone Halo Infinite 3D theater viewer. You sign in to your own Xbox account, pick one
of your recent matches, and the app fetches the match film, builds the map's 3D mesh from
your local game installation, and plays the replay in a 3D scene you can drive from first
person, third person, or a free camera. Everything runs on your machine: a Go server plus
CLI over a local data directory, and a React/Vite web viewer. The app only reads and serves
Halo's own data (the game's installed files and your own match records from the Xbox API);
it has no account of its own and stores no data of other players beyond what a match's own
roster carries.

Requires Go 1.26 or newer and a C/C++ toolchain for cgo (the upstream files-reader includes
the `ooz` decompressor). Building a map mesh, a weapon library, or the first-person library
additionally requires a local Halo Infinite installation.

```powershell
$env:CGO_ENABLED = '1'
go build -o infinite-theater-3d.exe ./cmd/infinite-theater-3d
```

## Day-to-day: serve, fetch, watch

The normal path is the web viewer over the local server.

```powershell
.\infinite-theater-3d.exe serve
```

`serve` starts the local HTTP server (loopback, `127.0.0.1:8177` by default) and, when it
finds a game installation, queues every one-time build in the background: the weapon icon
set, the HUD icon set, the rank badge set, the weapon model library, the first-person
library, the Spartan piece library, and, for every match already in the store, that match's
map mesh and variant layer. A build whose output is already on disk is skipped, so a
restart only builds what is still missing. The builds run one at a time and never block
the server from listening.

Then run the web viewer (from `web/`, see below) and, on the home page:

1. Sign in (Microsoft device-code flow: the server prints a link and a short code, you
   enter the code in your own browser, and the server never sees your password).
2. Open **Recent matches** and click **Fetch** on a match: the server downloads the film,
   its stats, the map variant file, and the public customization of every participant,
   builds the replay document, and adds the match's map and variant builds to the queue.
3. Open the match. The viewer builds the map on demand if it is not ready yet, and plays
   the replay.

The same steps are available from the command line without the web viewer:

```powershell
.\infinite-theater-3d.exe login
.\infinite-theater-3d.exe matches --count 10
.\infinite-theater-3d.exe fetch --match <match-id>
```

Sign-in details: the program uses this project's own public Microsoft app registration (no
secret involved); `--client-id` or `IT3D_CLIENT_ID` replaces it. Tokens are stored encrypted
for the current Windows user with DPAPI under `auth` in the data directory; `logout`
removes them. No route ever returns a token.

For a local `import` (a film you already have on disk), pass `--mvar <file>` and
`--stats <file>` to include the map variant and the scoreboard rows. To rebuild a fetched
replay from its saved inputs without a network request, run
`rebuild <match-id> --data <dir>`.

Data directory: use `--data <dir>` on any command, or set `IT3D_DATA_DIR`. The default is
the `data` folder of the checkout the program runs from (gitignored; worktrees share the
main checkout's), else `%LOCALAPPDATA%\infinite-theater-3d\data` outside any checkout.
Films expire on the service, and a film still being finalized must be tried again later.

## One-time builds

The heavy assets are all built once from the local game installation into the data
directory, either at `serve` startup or by hand. When a coating is involved (armor pieces,
weapon coatings, first-person arm painting), the build reads the Ekur coating reference:
set `IT3D_EKUR_DIR` to the folder that holds it, or put it in `<data>/ekur`. Without it,
coated materials render in their neutral color.

| Command | What it builds | Key flags |
|---|---|---|
| `build-mesh` | one map's world mesh (geometry, sun, light probes, placed lights) to a GLB | `--map <module-key>`, `--out <file.glb>`, `--game <deploy-root>` |
| `build-variant` | a map variant's object layer (the crates and cover a `.mvar` places) to its own GLB | `--map <key> --mvar <file.mvar> --out <file.glb>` |
| `build-weapons` | the whole weapon model library (every installed `weap` tag, the grenades, the Spartan body) plus `index.json`; with an Ekur reference, the weapon coating files too | `--map <module-key>`, `--data <dir>` |
| `build-icons` | the weapon icon set (PNG set + `index.json`) and the HUD equipment/grenade icon set | `--data <dir>`, `--game <root>` |
| `build-firstperson-library` | the whole first-person rig library (one rig per first-person-capable weapon, shared texture depot, `index.json`) | `--data <dir>`, `--map <module-key>` |
| `build-spartan` | the Spartan body with its game animations, to one GLB | `--map <module-key>`, `--out <file.glb>` |
| `build-piece` | one Spartan armor piece (a region's permutation) to one GLB | `--region <hex-id> --permutation <hex-id> --map <key> --out <file.glb>` |
| `build-firstperson` | one weapon's first-person rig to one GLB | `--weapon <hex-id> --map <key> --out <file.glb>`, `--no-arms` |
| `build-weapon` | one weapon's static third-person model to one GLB | `--weapon <hex-id> --map <key> --out <file.glb>` |

A map's module key is its folder name under `<deploy>/pc/levels/multi` (for example
`sgh_blueprint` for Recharge). `--game` is the game's `deploy` root; omitted, it is
auto-detected (`LEVELUP_HALO_DEPLOY` first, then a Steam or Xbox install found on disk).
The map's objective-anchor positions, name list and background calibration come from
reference data shipped inside the binary (`internal/mapref`), not from the game install:
see [NOTICE.md](NOTICE.md).

## serve

```powershell
.\infinite-theater-3d.exe serve [--addr <host:port>] [--web <dir>] [--data <dir>] [--game <deploy-root>] [--map <module-key>]
```

- `--addr` is the listen address (loopback by default, `127.0.0.1:8177`).
- `--web` is a directory of static files to serve for non-API paths (the built web app).
- `--data`, `--game` and `--map` are as above.

Routes (all under `/api` unless noted; state-changing routes accept loopback origins only):

- `GET /api/health` and `GET /api/matches` (summaries, newest first).
- `GET /api/matches/{id}/replay` (the built replay document, gzip as stored or
  decompressed) and `GET /api/matches/{id}/context` (header, scoreboard, regulation,
  kill and medal events, media; `?xuid=` for one player's perspective).
- `GET /api/matches/{id}/mesh.glb` / `mesh/state`; `POST .../mesh/build`;
  `POST .../mesh/cancel`.
- `GET /api/matches/{id}/variant.glb` / `variant/state`; `POST .../variant/build`.
- `GET /api/matches/{id}/spartans` (per-player armor manifests, including the equipped
  weapon coatings).
- Auth: `POST /api/auth/login`, `GET /api/auth/state`, `POST /api/auth/logout`,
  `GET /api/remote/matches?count=N`, `POST /api/matches/{id}/fetch`,
  `GET /api/matches/{id}/fetch/state`.
- Weapon library: `GET /api/weapons` (index + coating files), `GET /api/weapons/{file}`
  (one model GLB, range-capable), `POST /api/weapons/build`, `GET /api/weapons/state`.
- First-person library: `GET /api/first-person/index.json`, `bras.json`, `state`;
  `POST /api/first-person/build`; `GET /api/first-person/{file}` (a rig or texture).
- Spartan piece library: `GET /api/spartan-pieces/{file}`, `POST /api/spartan-pieces/build`,
  `GET /api/spartan-pieces/state`.
- Static assets: `GET /static/weapons-assets/halo_infinite/jeu/{file}` (weapon icons),
  `.../hud/{file}` (HUD equipment and grenade icons), `GET /static/ranks/halo_infinite/{file}`
  (rank badges), `GET /static/sounds/halo_infinite/{file}` (replay sounds).

## Replay sounds

The viewer plays the match's sounds from `<data>/assets/sounds/halo_infinite/` (one
`.ogg` per stem). That set cannot be rebuilt from a game installation: it was hand-produced
for a replay player (decoded, assembled and picked by ear), and its source material no
longer exists. Copy it into the data directory:

```powershell
.\infinite-theater-3d.exe import-sounds --from <sounds-dir> [--data <dir>]
```

The import copies every `.ogg` file (subfolders kept), skips files already present and
identical, and replaces a changed one. Until the import has run, `serve` logs one line at
startup naming this command, and the route answers `404` for every sound.

## Other commands

- `version`, `decode-info <chunk-dir>`.
- `decode --chunks <dir> --map <name> --out <doc.json> [--manifest <file>] [--stats <file>]
  [--catalog <file>]`: build a replay document from film chunks already on disk.
- `import --chunks <dir> --map <name> [--manifest <file>] [--stats <file>] [--mvar
  <file>] [--match <id>] [--catalog <file>] [--data <dir>]`: build and store a match from
  local files.
- `rebuild <match-id> [--data <dir>]`: rebuild a stored match from its saved inputs.

## Web viewer

`web/` is a Vite + React + TypeScript app. For development:

```powershell
cd web
npm install
npm run dev   # http://localhost:5183, proxies /api to 127.0.0.1:8177
```

For production, build the app and point `serve` at the output with `--web <dir>`.

The home screen offers sign-in and the account's recent matches (fetch or open). A match
page shows the map and mode names, the score, the replay in 3D with first/third/free
camera, the kill feed, the HUD (health, shield, weapon, ammo, grenade and equipment
icons), the settings drawer, and the match sounds. See [docs/PARITY.md](docs/PARITY.md)
for what the viewer covers and what is still open, and [docs/TODO.md](docs/TODO.md) for
the open list.

Based on JGtm's [LevelUp](https://github.com/JGtm/LevelUp) and published Halo modules. See
[NOTICE.md](NOTICE.md) and [third_party/README.md](third_party/README.md). Licensed under
AGPL-3.0.
