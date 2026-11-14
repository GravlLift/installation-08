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
set, the HUD icon set, the rank badge set, the announcer's voice lines and the weapons' reload sounds, the weapon model
library, the first-person library, the Spartan piece library, and, for every match already in the store, that match's
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

The Ekur reference is the community Blender plugin's JSON export of the game (its
`materials/`, `stylelists/` and `styles/` folders plus `globals.json` and
`visor_data.json`). Use a full export of the installed game: an older export lacks newer
armor and weapons, which then render neutral. The three coating libraries (Spartan pieces,
weapons, first person) record a short stamp of the export in their `index.json`; when the
export changes, `serve` moves the stale library aside at its next start, rebuilds it, and
removes the old copy once the rebuild succeeds. With no export set, existing libraries are
kept. The viewer shows a quiet notice in its top bar when the export is missing or invalid
("Coatings off") or when some materials are absent from it ("Coatings incomplete: N pieces
are missing from the Ekur export"); when everything is fine it shows nothing.

| Command | What it builds | Key flags |
|---|---|---|
| `build-mesh` | one map's world mesh (geometry, sun, light probes, placed lights) to a GLB | `--map <module-key>`, `--out <file.glb>`, `--game <deploy-root>` |
| `build-variant` | a map variant's object layer (the crates and cover a `.mvar` places) to its own GLB | `--map <key> --mvar <file.mvar> --out <file.glb>` |
| `build-weapons` | the whole weapon model library (every installed `weap` tag, the grenades, the Spartan body) plus `index.json`; with an Ekur reference, the weapon coating files too | `--map <module-key>`, `--data <dir>` |
| `build-icons` | the weapon icon set (PNG set + `index.json`) and the HUD equipment/grenade icon set | `--data <dir>`, `--game <root>` |
| `build-sounds` | the announcer's voice lines (168 calls) and every weapon's reload sounds, repacked to Ogg Vorbis into `<data>/assets/sounds/halo_infinite/` with `announcer.json` and `reloads.json` | `--lang en\|fr`, `--data <dir>` |
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
.\infinite-theater-3d.exe serve [--addr <host:port>] [--web <dir>] [--data <dir>] [--game <deploy-root>] [--map <module-key>] [--read-only]
```

- `--addr` is the listen address (loopback by default, `127.0.0.1:8177`).
- `--web` is a directory of static files to serve for non-API paths (the built web app).
- `--read-only` refuses every state-changing request (403): for a server shown to others through a tunnel, so a viewer cannot start a sign-in, a fetch or a build.
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
- Announcer and reload sounds: `GET /api/announcer/state` (the job state plus `built` and
  `stale`, true when both manifests are there and when either is of an older format, which is
  rebuilt), `POST /api/announcer/build` (one job extracts both).
- `GET /api/coatings/status`: whether the Ekur export is `ok`, `not_set` or `invalid`, and
  per coating library whether it is built, stale, and how many of its materials the export
  does not know (`materials_missing`). It never carries a path or an environment value.
- Static assets: `GET /static/weapons-assets/halo_infinite/jeu/{file}` (weapon icons),
  `.../hud/{file}` (HUD equipment and grenade icons), `GET /static/ranks/halo_infinite/{file}`
  (rank badges), `GET /static/sounds/halo_infinite/{file}` (replay sounds).

## Replay sounds

The sound set is built into the program: the viewer plays the match's sounds straight from
`/static/sounds/halo_infinite/` on a fresh install, no setup needed. The set (183 `.ogg`
files, one per stem) cannot be rebuilt from a game installation: it was hand-produced for a
replay player (decoded, assembled and picked by ear) by JGtm's
[LevelUp](https://github.com/JGtm/LevelUp) and ships in `internal/sounds`, embedded in the
binary (see [NOTICE.md](NOTICE.md)).

To replace individual files with your own versions, copy them into the data directory:

```powershell
.\infinite-theater-3d.exe import-sounds --from <sounds-dir> [--data <dir>]
```

The import copies every `.ogg` file (subfolders kept), skips files already present and
identical, and replaces a changed one. The route serves a file from
`<data>/assets/sounds/halo_infinite/` when it exists there, otherwise from the built-in
set; a name in neither set is a `404`.

The announcer's calls (medals, objectives, mode name, time warnings) come from your own
game install. `serve` extracts them once at startup like the other one-time builds, or by
hand:

```powershell
.\infinite-theater-3d.exe build-sounds [--lang en|fr] [--data <dir>] [--game <deploy-root>]
```

The game stores the voice as Wwise Vorbis. The program rebuilds each line's standard Ogg
Vorbis headers and pages around the game's own audio packets, without decoding or
re-encoding (`internal/wwvorbis`, a port of ww2ogg; no other program runs). The 168 lines are
168 `.ogg` files, about 5.4 MB of 48 kHz stereo. A rebuild removes the take files of an
earlier extraction that the new `announcer.json` no longer lists (`announcer_<line>_<nn>`
`.ogg` or `.wav` only). Without an extraction `announcer.json` is a `404` and only the
built-in round-over voice speaks.

The same command extracts every weapon's reload. The game posts a reload's sounds from the
Spartan's third-person reload animation of the held weapon's type
(`<stance>:<class>:<type>:reload_1`, standing and crouched); the build reads each animation's
sound events and their frames, follows each `snd!` tag to its third-person Wwise event and
writes every take as `reload_<media id>.ogg` (183 files, about 1.4 MB of 48 kHz mono, for 52
weapon tags), with `reloads.json`. A weapon type with no `reload_1` animation (the battery
weapons, which vent, and the melee weapons) gets no entry and its reloads stay silent. The viewer
plays each sound at its frame after the film's reload action, cancels the rest of the reload at
the player's death, weapon change, melee, throw, shot or next reload, and brings every reload's
loudest sound to one level (`web/src/features/match-replay/sound/reloadLoudness.ts`). Without an
extraction `reloads.json` is a `404` and no reload sounds.

## Other commands

- `version`, `decode-info <chunk-dir>`.
- `decode --chunks <dir> --map <name> --out <doc.json> [--manifest <file>] [--stats <file>]
  [--catalog <file>]`: build a replay document from film chunks already on disk.
- `import --chunks <dir> --map <name> [--manifest <file>] [--stats <file>] [--mvar
  <file>] [--match <id>] [--catalog <file>] [--data <dir>]`: build and store a match from
  local files.
- `rebuild <match-id> [--data <dir>]`: rebuild a stored match from its saved inputs.

## Packaged build

`tools/package.ps1` produces a self-contained Windows binary with the web viewer
embedded:

```powershell
tools\package.ps1 -Version 0.1.0
```

Requires `go`, `gcc` (a C toolchain for cgo), and `npm` on `PATH`. The script builds
`web\` (`npm run build`), stages `web\dist\index.html` and `web\dist\assets\` into
`internal\webdist\files`, builds the Go binary with the `embedweb` build tag, the
`-ldflags` version, and a static MinGW link (no `libwinpthread-1.dll` or other
MinGW runtime DLLs on the target machine), and writes:

```
dist\infinite-theater-3d-<version>-windows-amd64\
    infinite-theater-3d.exe
    LICENSE
    NOTICE.md
    README.md
    third_party\...
dist\infinite-theater-3d-<version>-windows-amd64.zip
```

The exe needs nothing beside it, the announcer extraction included. `-OutDir <dir>` writes
the exe, the folder and the zip somewhere other than `dist\`.

The exe is a single file: double-click it (or run it with no arguments) and it serves
and opens the viewer in the default browser. A `version` subcommand prints the build
version. The sound set is built in and the announcer is extracted at first start (see
Replay sounds above); the Ekur export is still
user-supplied; pass `--data <dir>` and `--game <deploy-root>` if the defaults do not
apply.

With `-Installer` the script additionally compiles a Windows installer (Inno Setup 6)
from `tools\installer.iss` and writes `dist\infinite-theater-3d-<version>-setup.exe`:

```powershell
tools\package.ps1 -Version 0.1.0 -Installer
```

The installer is per-user (no administrator prompt) and installs the whole release
folder to `%LOCALAPPDATA%\Programs\Infinite Theater 3D`: it shows the license, offers a
Start menu shortcut (always) and a desktop shortcut (optional, off by default), and asks
whether to launch the program at the end. Uninstalling removes the installed files only;
the data folder (`%LOCALAPPDATA%\infinite-theater-3d`) is never touched. The script
finds `ISCC.exe` on `PATH` or in the usual Inno Setup 6 install locations and fails
with a clear message when it is not there.

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
