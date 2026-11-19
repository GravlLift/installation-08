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

## Playback (LevelUp drives)

LevelUp has its own 2D map and timeline, and switches between its 2D view and our 3D view as Installation 08 does. LevelUp's timeline is therefore the one clock: in embedded mode our scrubber and transport controls are hidden, and the page takes commands and reports events over the webview's page messaging (no network).

- Commands: `seek` (match ms), `play`, `pause`, `speed`, `follow` (player).
- Events: `loading` (progress), `ready`, `time` (match ms, throttled), `state` (playing, paused, ended).
- Switching views: LevelUp keeps the webview alive and paused while 2D shows, then seeks it to the current time and plays when 3D shows. The map and film stay loaded, so the switch is instant.
- Inferred, to confirm on one of his matches: LevelUp's match ms and ours share a basis (our replay code descends from LevelUp's decoder).

## Updates

LevelUp checks this repo's GitHub releases (public, `llampwall/installation-08`). It downloads the newer exe, verifies it against the release's `SHA256SUMS.txt`, and swaps it in before launch. It installs a release only when its `contract` is one LevelUp supports. LevelUp also reads a pinned version from its own repo. If a release is not right for LevelUp, JGtm holds users on the last good one without shipping a LevelUp release. Taste differences between the two products become viewer settings that LevelUp passes at launch, not forks.

## What LevelUp's source says (read 2026-11-19, `P:\software\LevelUp\apps\go-api`)

- **Data dir:** install-relative. It walks up from the exe to the folder holding `db_profiles.example.json`, and `LEVELUP_REPO_ROOT` overrides it (`internal/config/config.go:602-628`). The cache is `data/cache` (`internal/domain/title/registry.go:824`).
- **Film cache:** `film_manifests/<short8>.json` plus `film_chunks/<short8>/chunk_NN.bin` (`film/filmcache/filmcache.go`). Its Go side reads this as a legacy cache (`sync/haloclient/local_film_cache.go:3`). Inferred: current LevelUp does not keep raw chunks for every match, so the cache cannot be counted on for the film.
- **Map, game variant, players and start time:** held in LevelUp's per-title DuckDB (`shared_matches_v2.duckdb`, `sync/transforms.go:70-81`). The viewer must not open it: DuckDB allows no reader while LevelUp holds it for writing.
- **Ids:** LevelUp's UI and routes use the full match GUID. The cache key is its first 8 hex digits (`domain/title/film_id.go:46-86`), which do not lead back to the GUID. LevelUp passes the GUID.
- **Timeline:** LevelUp's replay document (schema 104, `film/replay/document.go:50-104`) counts frames from the film's first position packet (`FrameIntervalMS`). `OriginMs` and `T0FilmMs` tie that to the kill-feed clock and the kickoff, and frame 0 trails the kickoff by 3.6 to 39.8 s. Commands and events use that film-relative ms. Ours is to be checked against it.
- **Shell:** no WebView2, Wails or Electron in the repo. LevelUp is a local Go API plus a Vite web app in a browser tab (inferred from a repo-wide search; the installed launcher was not read). The "webview" is an iframe in LevelUp's page, the channel is `window.postMessage` with origin checks both ways, and our server must allow framing by LevelUp's origin.

## What our import needs, and the real dependency

`fetchPipeline` (`cmd/infinite-theater-3d/fetch.go:151`) downloads, from the Halo services: the film manifest and chunks, the full match stats, context metadata, the map variant (`.mvar`), and each player's customization with its armor and weapon definitions. Those are authenticated calls, and in embedded mode there is no sign-in of our own. So the viewer needs LevelUp's Halo access. Two ways:

1. **LevelUp lends its token:** the `open` call (or a separate `auth` call) carries the Spartan token and clearance. The viewer keeps them in memory only, never on disk or in logs, and asks again when they expire. This is the least work for LevelUp.
2. **LevelUp proxies:** LevelUp exposes the few Halo endpoints we call on its local server, and the viewer's client points at it. No token crosses, but LevelUp gains code to maintain.

Recommended: 1. With it, the film and match data come over our existing pipeline into our own store. LevelUp's cache is only a shortcut when it happens to hold the chunks, and availability needs no film check. A match LevelUp shows a 2D replay for has a film; what remains is whether the game install is present and the map is supported, answered from the map ids LevelUp passes.

## Open

- JGtm's call: lend the token (1) or proxy (2).
- Whether current LevelUp still writes `film_chunks` for new matches (to confirm with JGtm). If it does, the open call reads them before downloading.
- Whether LevelUp's installed launcher hosts pages some other way than a browser tab.
- Whether `--embed` also implies `--read-only` (inferred to be enough, since the embedded page only reads once the import is done).
