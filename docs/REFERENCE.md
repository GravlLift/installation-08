# Reference

How Installation 08 works underneath: its commands, the one-time builds, the local
server's routes, where data lives, and how the sounds and coatings are extracted from the game.
For installing and using the app, see the [README](../README.md).

## Data directory

Every command takes `--data <dir>`, or reads `IT3D_DATA_DIR`. The default is the `data` folder
of the checkout the program runs from (gitignored; worktrees share the main checkout's), else
`%LOCALAPPDATA%\infinite-theater-3d\data` outside any checkout (the downloaded release).

`--game` is the game's `deploy` root. When omitted it is auto-detected: `LEVELUP_HALO_DEPLOY`
first, then the default Steam install, any Steam library `libraryfolders.vdf` declares, and an
Xbox app install (`<drive>:\XboxGames\Halo Infinite\Content\deploy`) on any drive letter. The
exact search order is in `third_party/map-images/himap/deploy_root.go`. Without a detected
install, map, weapon, icon and sound builds cannot run, but sign-in and fetching still work.

## Sign-in

The program uses this project's own public Microsoft app registration (no secret involved);
`--client-id` or `IT3D_CLIENT_ID` replaces it. Sign-in is Microsoft's device-code flow: the
server shows a short code and a link, you enter the code in your own browser, and the server
never sees your password. It asks only for Xbox Live sign-in and offline access (OAuth scopes
`Xboxlive.signin Xboxlive.offline_access`). Tokens are stored DPAPI-encrypted for the current
Windows user under `auth` in the data directory; `logout` removes them. No route ever returns a
token.

## Command line

The same steps the viewer takes are available without it:

```powershell
.\infinite-theater-3d.exe login
.\infinite-theater-3d.exe matches --count 10
.\infinite-theater-3d.exe fetch --match <match-id>
```

- `serve`: the local server and viewer (see [serve](#serve)). Running the exe with no
  arguments is `serve` plus opening the viewer in the default browser.
- `version`, `decode-info <chunk-dir>`.
- `decode --chunks <dir> --map <name> --out <doc.json> [--manifest <file>] [--stats <file>]
  [--catalog <file>]`: build a replay document from film chunks already on disk.
- `import --chunks <dir> --map <name> [--manifest <file>] [--stats <file>] [--mvar <file>]
  [--match <id>] [--catalog <file>] [--data <dir>]`: build and store a match from local files.
  `--mvar` and `--stats` add the map variant and the scoreboard rows.
- `rebuild <match-id> [--data <dir>]`: rebuild a stored match from its saved inputs, with no
  network request.
- `import-sounds --from <sounds-dir> [--data <dir>]`: see [Replay sounds](#replay-sounds).

Films expire on the service, and a film still being finalized must be tried again later.

## One-time builds

The heavy assets are built once from the local game installation into the data directory,
either at `serve` startup or by hand.

| Command | What it builds | Key flags |
|---|---|---|
| `build-mesh` | one map's world mesh (geometry, sun, light probes, placed lights) to a GLB; a Forge map (`--mvar`) is its canvas framed on the variant's objectives, its objects left to the variant layer | `--map <module-key or Forge map asset id>`, `--out <file.glb>`, `--game <deploy-root>`, `--mvar <file.mvar>`, `--name <map name>`, `--texture-quality <standard or high>`, `--textures <ktx2 or png>` (ktx2, the default: GPU-compressed Basis Universal textures, `KHR_texture_basisu`); the geometry is always written compressed (meshoptimizer, `EXT_meshopt_compression`, `internal/geocompress`) |
| `build-variant` | a map variant's object layer (the crates and cover a `.mvar` places) to its own GLB, each distinct model written once and placed by node transform | `--map <key> --mvar <file.mvar> --out <file.glb>`, `--texture-quality <standard or high>`, `--textures <ktx2 or png>` |
| `build-weapons` | the whole weapon model library (every installed `weap` tag, the grenades, the Spartan body) plus `index.json`; with a coating reference, the weapon coating files too | `--map <module-key>`, `--data <dir>` |
| `build-icons` | the weapon icon set (PNG set + `index.json`) and the HUD equipment/grenade icon set | `--data <dir>`, `--game <root>` |
| `build-sounds` | the announcer's voice lines, every weapon's reload sounds, the interface sounds and every multiplayer map's ambient bed (see [Replay sounds](#replay-sounds)) | `--lang en\|fr`, `--data <dir>` |
| `build-firstperson-library` | the whole first-person rig library (one rig per first-person-capable weapon, shared texture depot, `index.json`) | `--data <dir>`, `--map <module-key>` |
| `build-spartan` | the Spartan body with its game animations, to one GLB | `--map <module-key>`, `--out <file.glb>` |
| `build-piece` | one Spartan armor piece (a region's permutation) to one GLB | `--region <hex-id> --permutation <hex-id> --map <key> --out <file.glb>` |
| `build-firstperson` | one weapon's first-person rig to one GLB | `--weapon <hex-id> --map <key> --out <file.glb>`, `--no-arms` |
| `build-weapon` | one weapon's static third-person model to one GLB | `--weapon <hex-id> --map <key> --out <file.glb>` |
| `setup-coatings` | the coating reference at `<data>/ekur` (see [Coatings](#coatings)) | `--data <dir>`, `--game <deploy-root>` |

A map's module key is its folder name under `<deploy>/pc/levels/multi` (for example
`sgh_blueprint` for Recharge). The map's objective-anchor positions, name list and background
calibration come from reference data shipped inside the binary (`internal/mapref`), not from
the game install: see [NOTICE.md](../NOTICE.md).

When `serve` finds a game installation it queues every one-time build in the background: the
weapon icon set, the HUD icon set, the rank badge set, the announcer's voice lines and the
weapons' reload sounds, the weapon model library, the first-person library, the Spartan piece
library, and, for every stored match, its map mesh and variant layer. A build whose output is
already on disk is skipped, so a restart only builds what is still missing. The builds run one
at a time and never block the server from listening.

## Coatings

Armor, weapon and first-person paint coatings need a coating reference: the JSON tables
[TheHaloArchive/ekur](https://github.com/TheHaloArchive/ekur) extracts from the game, used
only as a lookup table. The app builds it itself; nothing is downloaded and no Ekur is run. It
reads the coating data straight from the installed game and writes the export to `<data>/ekur`
(the same five parts an Ekur export has: `materials/`, `stylelists/`, `styles/`,
`globals.json`, `visor_data.json`; about 52,000 small files, 109 MB, about 20 to 25 seconds on
a Steam install).

When `serve` starts with no valid `<data>/ekur` (and `IT3D_EKUR_DIR` unset), it builds the
export first, then the three coating libraries; no click needed. `setup-coatings` does the
same by hand. If you already have a full Ekur export, point `IT3D_EKUR_DIR` at it: the variable
always wins over `<data>/ekur`, and while it is set the app never writes its own. Use a full
export of the installed game: an older export lacks newer armor and weapons, which then render
neutral.

The three coating libraries (Spartan pieces, weapons, first person) record a short stamp of the
export in their `index.json`. When the export changes, `serve` moves the stale library aside at
its next start (or right after Set up coatings writes a new export), rebuilds it, and removes
the old copy once the rebuild succeeds. With no export set, existing libraries are kept.

Map and variant GLBs record their build format in `asset.extras.buildFormat`; one in an older
format is rebuilt by the normal build flow (at `serve` start for stored matches, Standard and any
High file already on disk, or when the match is opened; a High file is never built from nothing at
startup). Format 3 compresses the geometry (meshoptimizer, `EXT_meshopt_compression`:
positions and indices lossless, since the game's decals sit a fraction of a millimeter off their
walls; the other float attributes at the resolution of their largest value or within a float's
last bit), about 60% of the size of a format-2 map.
A format-2 GLB differs only by that encoding, so it is upgraded in place in seconds, without
reading the game.

The viewer's top bar shows a **Set up coatings** button only if the automatic step failed
(until it succeeds, coated materials render in a neutral color and the bar shows "Coatings
off"). With an export that is missing some materials, the bar shows "Coatings incomplete: N
pieces are missing from the Ekur export". When everything is fine it shows nothing. Nothing
else about the export reaches the viewer (no path, no environment value).

## Replay sounds

**Built-in set.** The match's sound set is built into the program: the viewer plays it from
`/static/sounds/halo_infinite/` on a fresh install, no setup needed. The set (183 `.ogg` files,
one per stem) cannot be rebuilt from a game installation: it was hand-produced for a replay
player (decoded, assembled and picked by ear) by JGtm's
[LevelUp](https://github.com/JGtm/LevelUp) and ships in `internal/sounds`, embedded in the
binary (see [NOTICE.md](../NOTICE.md)).

To replace individual files with your own versions, `import-sounds --from <sounds-dir>` copies
every `.ogg` file into the data directory (subfolders kept), skips files already present and
identical, and replaces a changed one. The route serves a file from
`<data>/assets/sounds/halo_infinite/` when it exists there, otherwise from the built-in set; a
name in neither set is a `404`.

**Announcer.** The announcer's calls (medals, objectives, mode name, time warnings) come from
your own game install, extracted once at startup or by hand with
`build-sounds [--lang en|fr] [--data <dir>] [--game <deploy-root>]`. The game stores the voice
as Wwise Vorbis. The program rebuilds each line's standard Ogg Vorbis headers and pages around
the game's own audio packets, without decoding or re-encoding (`internal/wwvorbis`, a port of
ww2ogg; no other program runs). The 168 lines are 168 `.ogg` files, about 5.4 MB of 48 kHz
stereo. A rebuild removes the take files of an earlier extraction that the new `announcer.json`
no longer lists. Without an extraction `announcer.json` is a `404` and only the built-in
round-over voice speaks.

**Reloads.** The game posts a reload's sounds from the Spartan's third-person reload animation
of the held weapon's type (`<stance>:<class>:<type>:reload_1`, standing and crouched). The
build reads each animation's sound events and their frames, follows each `snd!` tag to its
third-person Wwise event and writes every take as `reload_<media id>.ogg` (183 files, about
1.4 MB of 48 kHz mono, for 52 weapon tags), with `reloads.json`. A weapon type with no
`reload_1` animation (the battery weapons, which vent, and the melee weapons) gets no entry and
its reloads stay silent. The viewer plays each sound at its frame after the film's reload
action, cancels the rest of the reload at the player's death, weapon change, melee, throw, shot
or next reload, and brings every reload's loudest sound to one level
(`web/src/features/match-replay/sound/reloadLoudness.ts`).

**Map ambience.** A map's level tag (`levl`) holds a palette of background sounds, one per
acoustic zone (1 or 2 on the Forge maps, 9 to 45 on the native ones); each names a looping
sound tag (`lsnd`) whose Wwise play event plays one quad loop of 8 to 78 s. The build keeps, per
map, the loop the most zones name and writes it as `ambience_<media id>.ogg` (34 files, about
65 MB, for the 31 maps of the install), with `ambience.json`. The viewer loops the bed quietly
under the replay while it plays; pausing fades it out. It is one non-positional bed per map: the
game also switches beds between zones and places positional emitters, which the viewer does not
play.

**Interface sounds.** The pre-game countdown tick and the followed Spartan's shield alarms, in
`ui.json`.

## serve

```powershell
.\infinite-theater-3d.exe serve [--addr <host:port>] [--web <dir>] [--data <dir>] [--game <deploy-root>] [--map <module-key>] [--read-only]
```

- `--addr` is the listen address (loopback by default, `127.0.0.1:8177`).
- `--web` is a directory of static files to serve for non-API paths (the built web app).
- `--read-only` refuses every state-changing request (403): for a server shown to others
  through a tunnel, so a viewer cannot start a sign-in, a fetch or a build.
- `--data`, `--game` and `--map` are as above.

Routes (all under `/api` unless noted; state-changing routes accept loopback origins only):

- `GET /api/health` and `GET /api/matches` (summaries, newest first).
- `GET /api/matches/{id}/replay` (the built replay document, gzip as stored or decompressed)
  and `GET /api/matches/{id}/context` (header, scoreboard, regulation, kill and medal events,
  media; `?xuid=` for one player's perspective).
- `GET /api/matches/{id}/mesh.glb` / `mesh/state`; `POST .../mesh/build`; `POST .../mesh/cancel`.
- `GET /api/matches/{id}/variant.glb` / `variant/state`; `POST .../variant/build`.
- `GET /api/matches/{id}/spartans` (per-player armor manifests, including the equipped weapon
  coatings).
- Auth: `POST /api/auth/login`, `GET /api/auth/state`, `POST /api/auth/logout`,
  `GET /api/remote/matches?count=N[&gamertag=GT]` (the signed-in account's history, or any
  player's by gamertag; 404 `gamertag not found`), `POST /api/matches/{id}/fetch`,
  `GET /api/matches/{id}/fetch/state`.
- Weapon library: `GET /api/weapons` (index + coating files), `GET /api/weapons/{file}` (one
  model GLB, range-capable), `POST /api/weapons/build`, `GET /api/weapons/state`.
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
- `GET /api/coatings/status`: whether the coating export is `ok`, `not_set` or `invalid`, and per
  coating library whether it is built, stale, and how many of its materials the export does not
  know (`materials_missing`), plus `override` (true when `IT3D_EKUR_DIR` names the export). It
  never carries a path or an environment value.
- Coatings setup: `POST /api/coatings/setup` starts the one setup job (202, or 409 while one
  runs), `GET /api/coatings/setup/state` reports its `state` (`idle`, `extracting`,
  `validating`, `queuing`, `ready` or `failed` with an `error` message).
- Static assets: `GET /static/weapons-assets/halo_infinite/jeu/{file}` (weapon icons),
  `.../hud/{file}` (HUD equipment and grenade icons), `GET /static/ranks/halo_infinite/{file}`
  (rank badges), `GET /static/sounds/halo_infinite/{file}` (replay sounds).

## Packaging

`tools\package.ps1 -Version <version>` builds `web\` (`npm run build`; run `npm ci` in `web\`
first), stages `web\dist\index.html` and `web\dist\assets\` into `internal\webdist\files`,
builds the Go binary with the `embedweb` build tag, the `-ldflags` version, and a static MinGW
link (no `libwinpthread-1.dll` or other MinGW runtime DLLs on the target machine), and writes:

```
dist\infinite-theater-3d-<version>-windows-amd64\
    infinite-theater-3d.exe
    LICENSE
    NOTICE.md
    README.md
    third_party\...
dist\infinite-theater-3d-<version>-windows-amd64.zip
dist\SHA256SUMS.txt
```

`-OutDir <dir>` writes them somewhere other than `dist\`. `SHA256SUMS.txt` holds one SHA-256
per release file in standard `sha256sum` format (`<lowercase hex>  <file name>`).

With `-Installer` the script also compiles a Windows installer (Inno Setup 6) from
`tools\installer.iss` and writes `dist\infinite-theater-3d-<version>-setup.exe`. The installer
is per-user (no administrator prompt) and installs the release folder to
`%LOCALAPPDATA%\Programs\Installation 08`: it shows the license, offers a Start menu
shortcut (always) and a desktop shortcut (optional, off by default), and asks whether to launch
the program at the end. Uninstalling removes the installed files only; the data folder
(`%LOCALAPPDATA%\infinite-theater-3d`) is never touched. The script finds `ISCC.exe` on `PATH`
or in the usual Inno Setup 6 install locations and fails with a clear message when it is not
there.

A plain development build of the Go server, without the embedded viewer:

```powershell
$env:CGO_ENABLED = '1'
go build -o infinite-theater-3d.exe ./cmd/infinite-theater-3d
```

cgo is needed because the vendored files-reader includes the `ooz` decompressor, map textures
are compressed with the Basis Universal encoder (`internal/basisu`; its first compile takes about
a minute), and map geometry with meshoptimizer's codecs (`internal/meshopt`).

## Web viewer development

`web/` is a Vite + React + TypeScript app:

```powershell
cd web
npm ci
npm run dev   # http://localhost:5183, proxies /api to 127.0.0.1:8177
```

Run `serve` alongside it. For production, `npm run build` and point `serve` at the output with
`--web <dir>`, or use the packaged build, which embeds it. See [PARITY.md](PARITY.md) for what
the viewer covers and what is still open, and [TODO.md](TODO.md) for the engineering backlog.
