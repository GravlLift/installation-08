# LevelUp hosting: Installation 08 inside LevelUp (design, 2026-11-19)

Status: agreed in outline with JGtm (2026-11-19, Discord); nothing built yet. Branch `feat/levelup-host`.

## Shape

LevelUp ships `installation-08.exe` inside its install and starts it as a background process. LevelUp keeps its own match list. For a match with a 3D replay, it opens our replay page in a webview pointed at the viewer's local server. The viewer reads LevelUp's own match cache, so LevelUp hands over nothing but a match id. It is one codebase and one exe: the embedded viewer is a launch mode of the standalone app, never a fork or a long-lived branch.

What LevelUp shows from us: the replay view (`#/matches/<id>`) with its controls, and the loading screen while the map and the film load. What it never shows: our home page, match list, sign-in, settings pages or app chrome.

## Launch (embedded mode)

`installation-08.exe serve --embed --addr 127.0.0.1:0 --data <LevelUp-chosen dir> --levelup-cache <LevelUp's cache dir>`

- `--embed`: no window and no browser launch (`--ui` is ignored). No sign-in or remote fetch routes. The web app drops everything but the replay view and its loading screen.
- `--addr 127.0.0.1:0`: the OS picks a free port. The viewer prints one JSON line on stdout once it listens: `{"ready":true,"url":"http://127.0.0.1:<port>","version":"...","contract":1}`. That line is the handshake. LevelUp reads it instead of guessing a port.
- `--data`: our own store (built maps, imported films), kept apart from LevelUp's data.
- `--levelup-cache`: read-only. The viewer never writes there.

## API (contract 1)

| Call | Answer |
|---|---|
| `GET /api/health` | exists today (`serve.go:314`): `ok`, `version`, `viewer`; adds `contract` |
| `POST /api/levelup/availability` `{ "matches": ["<id>", ...] }` | per id: `available` (bool) and `reason` when not (`no_game_install`, `map_unsupported`, `film_not_cached`) |
| `POST /api/levelup/open` `{ "match": "<id>" }` | `{ "url": "http://127.0.0.1:<port>/?embed=1#/matches/<id>" }`, at once. Importing from LevelUp's cache and building the map happen behind the page's loading screen. |

`contract` changes only when one of these calls or the launch arguments change. Viewer features never move it.

Availability is local and cheap. The checks are whether LevelUp holds the film, whether the game install is present, and whether the map is one the viewer can build (or has built). There is no network call, so a page of about 50 ids answers in one call.

## Updates

LevelUp checks this repo's GitHub releases (public, `llampwall/installation-08`). It downloads the newer exe, verifies it against the release's `SHA256SUMS.txt`, and swaps it in before launch. It installs a release only when its `contract` is one LevelUp supports. LevelUp also reads a pinned version from its own repo. If a release is not right for LevelUp, JGtm holds users on the last good one without shipping a LevelUp release. Taste differences between the two products become viewer settings that LevelUp passes at launch, not forks.

## Open

- LevelUp's cache format, read from its source (`P:\software\LevelUp`). A shipped config names `data/cache/replays/{slug}/{id}.json` (its replay artifact) and `data/cache/film_chunks/{id}/` (raw film chunks), keyed by the short 8-hex match id (`title.FilmShortMatchID`). Not observed live: this machine's LevelUp has no cached matches yet. The likely input is the raw film chunks, decoded by our own decoder, which keeps us independent of LevelUp's artifact schema.
- Which id LevelUp passes (the short id or the match GUID), and where its data dir lives at runtime.
- Whether `--embed` also implies `--read-only` (inferred to be enough, since the embedded page only reads once the import is done).
