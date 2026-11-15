# Infinite Theater 3D

By Jordan Hewitt ([llampwall](https://github.com/llampwall)), built on JGtm's LevelUp. See
[Credits](#credits).

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

## First run (downloaded release)

This is the path for someone who downloaded the release zip, not someone building from
source.

- **Requirements**: Windows, and Halo Infinite installed through Steam or the Xbox app. The
  app auto-detects a Steam install (the default Steam install, or any Steam library
  `libraryfolders.vdf` declares) and an Xbox app install
  (`<drive>:\XboxGames\Halo Infinite\Content\deploy`) on any drive letter. If your install is
  somewhere else, set `LEVELUP_HALO_DEPLOY` to that install's `deploy` folder before starting
  (see `third_party/map-images/himap/deploy_root.go` for the exact search order). Without a
  detected install, map, weapon, icon and sound builds cannot run, but sign-in and fetching
  matches still work.
- **Start**: double-click `infinite-theater-3d.exe`, or run it with no arguments. It starts
  the local server and opens the web viewer in your default browser.
- **Sign-in**: click Sign in on the home page. The server shows a short code and a link
  (Microsoft's own device-code flow); open the link in any browser, sign in with your own
  Microsoft/Xbox account, and enter the code there. The app only asks for Xbox Live sign-in
  and offline access (OAuth scopes `Xboxlive.signin Xboxlive.offline_access`); it never sees
  your password, and the resulting tokens are stored DPAPI-encrypted for your Windows user
  under `auth` in the data directory (`logout` removes them, no route ever returns one).
- **First match fetch**: open Recent matches and click Fetch on one. The server downloads
  that match's film, stats, map variant file, and every participant's public customization,
  then builds the replay document.
- **First map build**: opening a match queues a build of its map mesh from your local game
  files if it isn't built yet. This can take several minutes on a first run (unmeasured
  precisely; the UI itself warns a first build "can take minutes", see
  `docs/UI-DESIGN.md`), and the finished map file is large: existing map GLBs run 600–900 MB
  on disk, mostly texture data (`docs/TODO.md`). Builds happen in the data directory, not the
  install folder.
- **Coatings (automatic on first start)**: armor, weapon and first-person paint coatings
  need an Ekur export: the JSON tables [TheHaloArchive/ekur](https://github.com/TheHaloArchive/ekur)
  extracts from the game, used only as a lookup table for the coatings. The app builds it
  itself; nothing is downloaded and no Ekur is run. It reads the coating data straight from
  your installed game and writes the export to `<data>/ekur` (the same five parts an Ekur
  export has: `materials/`, `stylelists/`, `styles/`, `globals.json`, `visor_data.json`;
  about 52,000 small files, 109 MB, about 20 to 25 seconds on a Steam install). When the
  server starts and there is no valid `<data>/ekur` (and `IT3D_EKUR_DIR` is unset), it builds
  the export first, then the three coating libraries; no click needed. The `setup-coatings`
  command does the same by hand, and the match viewer's top bar shows a **Set up coatings**
  button only if that automatic step failed (until it succeeds, coated materials render in a
  neutral color and the bar shows "Coatings off"). The home screen's "Getting ready" panel
  shows the first start's progress (coatings, announcer sounds, weapons, armor, first-person
  arms) until every step is done. If you already have a full Ekur export, point `IT3D_EKUR_DIR` at it instead: the
  variable always wins over `<data>/ekur`, and while it is set the app never writes its own.
  With an export too old to know some newer armor or weapons, those pieces stay neutral and
  the bar shows "Coatings incomplete: N pieces are missing from the Ekur export". Nothing
  else about the export reaches the viewer (no path, no environment value).

See [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) for what is still rough at this release.

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
`IT3D_EKUR_DIR` when it is set (it always wins), otherwise `<data>/ekur` when that folder is
a valid export. Without one, coated materials render in their neutral color.

The Ekur reference is the JSON export the app writes from the game (its `materials/`,
`stylelists/` and `styles/` folders plus `globals.json` and `visor_data.json`; nothing else in
it is read). It is built automatically when `serve` starts without a valid one (see First
run), and the `setup-coatings` command builds it by hand; an export made with Ekur itself
works too, via `IT3D_EKUR_DIR`. Use a full export of the installed game: an older export
lacks newer armor and weapons, which then render neutral. The three coating libraries (Spartan pieces,
weapons, first person) record a short stamp of the export in their `index.json`; when the
export changes, `serve` moves the stale library aside at its next start (or right after Set
up coatings wrote a new export), rebuilds it, and removes the old copy once the rebuild
succeeds. With no export set, existing libraries are
kept. The viewer shows a quiet notice in its top bar when the export is missing or invalid
("Coatings off") or when some materials are absent from it ("Coatings incomplete: N pieces
are missing from the Ekur export"); when everything is fine it shows nothing.

| Command | What it builds | Key flags |
|---|---|---|
| `build-mesh` | one map's world mesh (geometry, sun, light probes, placed lights) to a GLB; a Forge map (`--mvar`) is its canvas framed on the variant's objectives, its objects left to the variant layer | `--map <module-key or Forge map asset id>`, `--out <file.glb>`, `--game <deploy-root>`, `--mvar <file.mvar>`, `--name <map name>` |
| `build-variant` | a map variant's object layer (the crates and cover a `.mvar` places) to its own GLB, each distinct model written once and placed by node transform | `--map <key> --mvar <file.mvar> --out <file.glb>` |
| `build-weapons` | the whole weapon model library (every installed `weap` tag, the grenades, the Spartan body) plus `index.json`; with an Ekur reference, the weapon coating files too | `--map <module-key>`, `--data <dir>` |
| `build-icons` | the weapon icon set (PNG set + `index.json`) and the HUD equipment/grenade icon set | `--data <dir>`, `--game <root>` |
| `build-sounds` | the announcer's voice lines (168 calls), every weapon's reload sounds, the interface sounds (the pre-game countdown tick and the followed Spartan's shield alarms) and every multiplayer map's ambient bed, repacked to Ogg Vorbis into `<data>/assets/sounds/halo_infinite/` with `announcer.json`, `reloads.json`, `ui.json` and `ambience.json` | `--lang en\|fr`, `--data <dir>` |
| `build-firstperson-library` | the whole first-person rig library (one rig per first-person-capable weapon, shared texture depot, `index.json`) | `--data <dir>`, `--map <module-key>` |
| `build-spartan` | the Spartan body with its game animations, to one GLB | `--map <module-key>`, `--out <file.glb>` |
| `build-piece` | one Spartan armor piece (a region's permutation) to one GLB | `--region <hex-id> --permutation <hex-id> --map <key> --out <file.glb>` |
| `build-firstperson` | one weapon's first-person rig to one GLB | `--weapon <hex-id> --map <key> --out <file.glb>`, `--no-arms` |
| `build-weapon` | one weapon's static third-person model to one GLB | `--weapon <hex-id> --map <key> --out <file.glb>` |
| `setup-coatings` | the Ekur coating reference at `<data>/ekur`: reads the coating data straight from the game install (about 52,000 small files, 109 MB, about 20 to 25 seconds on a Steam install); the next `serve` start rebuilds the coating libraries | `--data <dir>`, `--game <deploy-root>` |

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
  `GET /api/remote/matches?count=N[&gamertag=GT]` (the signed-in account's history, or
  any player's by gamertag; 404 `gamertag not found`), `POST /api/matches/{id}/fetch`,
  `GET /api/matches/{id}/fetch/state`.
- Weapon library: `GET /api/weapons` (index + coating files), `GET /api/weapons/{file}`
  (one model GLB, range-capable), `POST /api/weapons/build`, `GET /api/weapons/state`.
- First-person library: `GET /api/first-person/index.json`, `bras.json`, `state`;
  `POST /api/first-person/build`; `GET /api/first-person/{file}` (a rig or texture).
- Spartan piece library: `GET /api/spartan-pieces/{file}`, `POST /api/spartan-pieces/build`,
  `GET /api/spartan-pieces/state`.
- Announcer, reload and ambience sounds: `GET /api/announcer/state` (the job state plus `built`
  and `stale`, true when all three manifests are there and when any is of an older format, which
  is rebuilt), `POST /api/announcer/build` (one job extracts all three).
  `GET /api/matches/{id}/ambience.ogg` is the match's map bed (range-capable), a JSON `404`
  `ambience_not_built` when the map has none yet.
- `GET /api/matches/{id}/callouts`: the named areas of the match's map (the place name the HUD
  shows under the motion tracker), `{version, source, zones: [{en, fr, polygon, zBottom, zTop}]}`
  in game world meters, read at runtime from the installed game (a native map's level tag, a
  Forge map's variant) and cached under `<data>/assets/callouts`; a JSON `404`
  `callouts_unavailable` with a `reason` when the map cannot be read.
- `GET /api/coatings/status`: whether the Ekur export is `ok`, `not_set` or `invalid`, and
  per coating library whether it is built, stale, and how many of its materials the export
  does not know (`materials_missing`), plus `override` (true when `IT3D_EKUR_DIR` names the
  export). It never carries a path or an environment value.
- Coatings setup: `POST /api/coatings/setup` starts the one setup job (202, or 409 while one
  runs; the server starts it on its own at startup when no valid `<data>/ekur` is present and
  `IT3D_EKUR_DIR` is unset), `GET /api/coatings/setup/state` reports its `state` (`idle`,
  `extracting`, `validating`, `queuing`, `ready` or `failed` with an `error` message).
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

The same command extracts every multiplayer map's ambient bed (its "room tone"). A map's level
tag (`levl`) holds a palette of background sounds, one per acoustic zone (1 or 2 on the Forge
maps, 9 to 45 on the native ones); each names a looping sound tag (`lsnd`) whose Wwise play
event plays one quad loop of 8 to 78 s. The build keeps, per map, the loop the most zones name
and writes it as `ambience_<media id>.ogg` (34 files, about 65 MB, for the 31 maps of the
install), with `ambience.json`. The viewer loops the bed quietly under the replay while it plays,
with sound on, through the same volume and mute as every other sound; the pause fades it out and
the resume picks it up where it stopped. It is one non-positional bed per map: the game also
switches beds between zones and places positional emitters, which the viewer does not play.

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
Replay sounds above); the Ekur export is built from your game install at first start (or by
hand with `setup-coatings`), so it is not in the zip; pass `--data <dir>` and
`--game <deploy-root>` if the defaults do not apply.

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

## Credits

- **[JGtm](https://github.com/JGtm)**: [LevelUp](https://github.com/JGtm/LevelUp) and its
  published modules this project vendors and builds on:
  [halo-infinite-film-decoder](https://github.com/JGtm/halo-infinite-film-decoder),
  [halo-infinite-map-images](https://github.com/JGtm/halo-infinite-map-images), and
  [halo-infinite-files-reader](https://github.com/JGtm/halo-infinite-files-reader) (AGPL-3.0;
  `files-reader`'s vendored `ooz` decompressor is GPL-3.0), plus
  [halo-api](https://github.com/JGtm/halo-api) (used directly as a Go module, not vendored).
  See [third_party/README.md](third_party/README.md) for versions and the changes made here.
- **[TheHaloArchive](https://github.com/TheHaloArchive)**: [ekur](https://github.com/TheHaloArchive/ekur)
  (Copyright (c) 2026 The Halo Archive, GPL-3.0-or-later), the coating reference for armor,
  weapon and first-person coatings: `internal/ekurport` translates parts of Ekur 1.3.1 to
  build the export straight from the game (the ported files keep Ekur's copyright line) and
  follows the tag reading approach of infinite-rs 0.13.2 (Surasia, Unlicense OR MIT).
  GPL-3.0-or-later can be combined with this project's AGPL-3.0; the ReclaimerFiles lists are
  no longer used (see "Coatings" in First run).
- **[Den Delimarsky](https://github.com/dend)**: [OpenSpartan](https://github.com/OpenSpartan)'s
  libfilmshell (MIT), the Rust decoder of the match film format whose vocabulary the vendored
  `film-decoder` maps to (`third_party/film-decoder/GLOSSARY.md`). No libfilmshell code is
  included.
- **[Gravemind2401](https://github.com/Gravemind2401)**: [Reclaimer](https://github.com/Gravemind2401/Reclaimer)
  (GPL-3.0): several tag layouts and rules in the vendored `map-images` module were first
  read from Reclaimer's sources, then independently re-measured on game files and
  reimplemented in Go. No Reclaimer code is included; see
  `third_party/map-images/NOTICE.md`.
- **[hcs](https://github.com/hcs64)**: [ww2ogg](https://github.com/hcs64/ww2ogg): the basis
  for `internal/wwvorbis`'s Go port that repacks the game's Wwise Vorbis voice lines to Ogg.
