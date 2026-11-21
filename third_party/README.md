# Upstream modules

- `film-decoder/replay/map_weapon_pads.go` (LOCAL-CHANGE): publish the local scale of a directly placed Forge weapon in the served map-pad overlay.
- `map-images/himap/armes.go`, `premiere_personne_rig.go` and `premiere_personne_gamefiles_test.go` (LOCAL-CHANGE): weapon world and first-person models select the weapon tag's default model variant; zero leaves the render model's first permutations selected.
- `map-images/himap/bandit_strings_gamefiles_test.go` (LOCAL-CHANGE): checks the game's English and French Bandit names in the global localized strings.

The source files below are as of 2026-11-13, with the documented changes noted per module. Each retains its own `go.mod`, license and notices. The listed h1 values are the Go module zip hashes, before the documented omissions. To compare against a future tag, download its module zip with `go mod download`, extract it outside this repository, and compare its module directory with the matching directory here, accounting for these omissions.

| Directory | Upstream | Version | Zip hash | License |
| --- | --- | --- | --- | --- |
| film-decoder | https://github.com/JGtm/halo-infinite-film-decoder | v1.3.6 | `h1:CP7zIqapzMcHHam2aKBMsXAsaNgJCzjTWk27petIpxc=` | AGPL-3.0 |
| map-images | https://github.com/JGtm/halo-infinite-map-images | v1.0.1 | `h1:Op1TrnECQKrCxOjWkI2Cb9WGf+S5nOikyap5eGZdPA=` | AGPL-3.0 |
| files-reader | https://github.com/JGtm/halo-infinite-files-reader | v1.0.1 | `h1:sqD4leKw4x9yC+JdXWAVHOio6LOqF+VzKgcWZ5SL688=` | GPL-3.0-only (the whole module, `ooz` included) |
| webview_go | https://github.com/webview/webview_go | v0.0.0-20240831120633-6173450d4dd6 | `h1:VQpB2SpK88C6B5lPHTuSZKb2Qee1QWwiFlC5CKY4AW0=` | MIT (webview.h and the Go bindings; `libs/mswebview2/include/WebView2.h` is Microsoft's own SDK header, 3-Clause BSD, see `libs/mswebview2/LICENSE`) |

`files-reader/ooz` uses cgo and requires a C/C++ toolchain.

`webview_go` uses cgo (a C++ toolchain) on every platform; the app window needs it on Windows
only. Replaced `jchv/go-webview2` (a hand-written Go COM binding to WebView2): making the app
window per-monitor DPI aware (manifest `dpiAwareness` or a runtime
`SetProcessDpiAwarenessContext` call) crashed that binding's controller-creation callback with a
nil `*ICoreWebView2Controller` despite a success HRESULT (`pkg/edge/chromium.go`'s
`CreateCoreWebView2ControllerCompleted`, 7 launches of 7); reading its vtable thunk and callback
registration found no small, provable fix, so the window now goes through this official library
instead, which declares PerMonitorV2 itself and handles `WM_DPICHANGED`/`WM_GETDPISCALEDSIZE`.

- `libs/webview/include/webview.h` (LOCAL-CHANGE): `win32_edge_engine::embed` reads
  `WEBVIEW2_USER_DATA_FOLDER` (via `GetEnvironmentVariableW`) and uses it verbatim when the host
  process set it, instead of always computing a folder from `CSIDL_APPDATA` plus the running
  exe's own file name. Upstream's computed folder is a brand-new WebView2 (Chromium) profile for
  any exe name or location this library has not been run from before, and a first-time profile on
  this project's build machine makes a Windows blank-password logon check that must never run
  against an unplanned folder (see the global operating rules). The app sets
  `WEBVIEW2_USER_DATA_FOLDER` itself (`cmd/infinite-theater-3d/window_windows.go`) to its one
  fixed folder before creating the window; this change only makes the library honor it.
- `libs/webview/include/webview.h` (LOCAL-CHANGE): `webview2_com_handler` also handles
  `ProcessFailed` (a constexpr `IID_ICoreWebView2ProcessFailedEventHandler`, its `QueryInterface`
  case, `add_ProcessFailed`, and the handler). When the page's render process exits (out of
  memory on a large map, 2026-11-18), the window navigates to its address without the fragment,
  the app's match list, instead of staying blank and frozen until a restart. A plain `Reload`
  would reopen the route that crashed; an unresponsive renderer is left alone.
- `webview.cc` (LOCAL-CHANGE): a revision comment for `webview.h`. Go's build cache hashes only
  this package's own folder, so an edit to the header alone silently reuses the stale compiled
  object: bump the revision line with every local edit of `webview.h`.
- Everything else is unmodified: `go.sum` is empty upstream (no dependencies) and is copied as
  such; `examples/`, `webview_test.go`, `CHANGELOG.md`, `README.md`, `.github/` and `.gitignore`
  are omitted (not needed to build).

`basisu/` holds Binomial's Basis Universal encoder and transcoder (https://github.com/BinomialLLC/basis_universal,
commit `99f52d63aa6799cbdaecfe977111dc5ec3b31d47` of 2026-09-01, Go proxy pseudo-version
`v0.0.0-20260901040812-99f52d63aa67`, zip hash `h1:A+TqLPfBibFIO6wxZyjb3rYlCk/Rzu+En46WIXQhExA=`,
Apache-2.0; bundled Zstandard under its BSD license, see `basisu/zstd/LICENSE` and `basisu/LICENSES/`).
It is not a Go module: `internal/basisu` compiles its translation units with cgo (one `u_*.cpp`
per upstream `.cpp`, each a single `#include`) and wraps them in a small C surface. Only these
upstream paths are kept, unmodified: `encoder/`, `transcoder/`, `zstd/zstd.c`, `zstd/zstd.h`,
`zstd/zstd_errors.h`, `zstd/LICENSE`, `LICENSE`, `NOTICE`, `LICENSES/`, `README.md`. Omitted: the
command-line tool, examples, the WebGL/WASM and Python builds, OpenCL kernels' build files, test
images and `zstd/zstddeclib.c`.

`meshoptimizer/` holds Arseny Kapoulkine's meshoptimizer (https://github.com/zeux/meshoptimizer,
tag `v1.3`, commit `9e1f07b159d3cb777f1c67ed31fc11fd117986f4` of 2026-09-25, MIT), taken from the
release's source archive `https://github.com/zeux/meshoptimizer/archive/refs/tags/v1.3.tar.gz`
(SHA-256 `ca4f47d451201593904b9e3067fa54b65db94bc34ab5173864950862b748a145`). It is not a Go
module: `internal/meshopt` compiles its translation units with cgo (one `u_*.cpp` per upstream
`.cpp`, each a single `#include`), and `internal/geocompress` uses them to write
`EXT_meshopt_compression`. Only these upstream paths are kept, unmodified: `src/meshoptimizer.h`,
`src/allocator.cpp`, `src/vertexcodec.cpp`, `src/indexcodec.cpp`, `src/vertexfilter.cpp`,
`LICENSE.md`, `README.md`. Omitted: the rest of `src/` (simplifier, clusterizer, optimizers), the
`gltf/` packer, the JavaScript decoders (the viewer uses the copy three.js ships), `js/`, `demo/`,
`tools/`, `extern/` and the build files.

`ww2ogg/` holds no code: only the license text and the notice of ww2ogg by hcs
(https://github.com/hcs64/ww2ogg, commit `14ed9b0`, BSD-3-Clause style), which
`internal/wwvorbis` ports to Go to repack the announcer's Wwise Vorbis voice lines into Ogg,
and whose aoTuV packed codebook library it embeds unmodified. See
[ww2ogg/NOTICE.md](ww2ogg/NOTICE.md).

## Changes from upstream v1.3.6 (film-decoder)

- `internal/grammar/score_keyframe_probe_test.go` (LOCAL-CHANGE): an opt-in probe of the score components in a local test film.

The film-decoder module carries the LevelUp `feat/replay-3d` port on upstream v1.3.6.
Document schema 125, facts schema 23. Local steps 113–122 were renumbered 116–125
after upstream schema 115; see [the rebase inventory](REBASE-v1.3.6.md). Kept capabilities:

- Full-rate tracks (`FullRateTrack`, `Track.FullRate`) with absolute-millisecond times,
  independent of the 33 ms document grid.
- Shot direction from the shooter's aim (`shots_visee.go`, `Shot.P`).
- Aim-only samples for records without a position (`VehicleScan.Aims`).
- Move stick readings from the control view.
- Control-view stances: crouch, slide, jump derived from vertical velocity.
- Shooter identification by control place.
- Drawn weapon per slot (`DrawnWeapons`).
- Damage events per slot (`Damages`).
- Kill cause attribution (`KillCauses`).
- Player gestures: reload, grenade throw, punch (`Actions` / `PlayerAction`).
- Carried ammo reads per life and weapon slot (`AmmoReads`).
- Sub-frame shot offset inside the document frame (`Shot.O`, computed against the
  actual frame interval).
- Blob codec `REPLAYINPUTS30` (upstream v1.3.6 ships `REPLAYINPUTS29`).
- `filmcache` additions for a decode tool that receives an explicit manifest path outside
  the cache layout: `ParseManifest` (renders the entries of a manifest file by its bytes,
  the same `manifestJSON` shape as `Open`) and `NewSource` (a `Source` whose chunks read
  from a caller-given folder, via a `direct` field on `Source` that `Chunk` consults before
  the cache path). These serve `infinite-theater-3d decode --manifest <file>`; `Open` and
  `OpenChunkDir` keep reconstructing the path from the cache layout and are unchanged.
- `decfilm.LoadMapQuantCatalogBytes` (new file `decfilm/catalog_bytes.go`) reads the map
  quantization catalog from its bytes, not a file path: the standalone embeds its reference
  catalog in the binary (`go:embed`, `internal/refdata`). It lives in the facade so the
  `profile` layer, whose sources are fingerprinted, stays identical to upstream.
- `replay/projectiles.go` (LOCAL-CHANGE): `Projectile.Z` publishes the height of each
  flight point (`projectiles[].z`, parallel to `p`), which the decoded sample always carried;
  the 3D viewer draws grenade arcs and bounces through it. `SchemaVersion` 125 -> 126 with its
  chronicle entry (`replay/document_chronicle.go`), the `structure_test.go` reason, the
  regenerated `replay/testdata/document_shape.golden`, and the two size caps it moves in
  `internal/depottest/taille_test.go`.
- `replay/projectiles.go` (LOCAL-CHANGE): `Projectile.FullRate` publishes the flight AT THE
  FILM'S RATE — every raw sample at its own instant, differential integer columns (the projectile
  twin of `tracks[].fullRate`, schema 118) — so the 3D viewer interpolates grenade motion at
  ~60 Hz instead of the 33 ms grid. `SchemaVersion` 126 -> 127 with its chronicle entry, the
  `structure_test.go` reason, and the regenerated `replay/testdata/document_shape.golden`.
  Covered by `replay/projectiles_plein_debit_test.go` (new).
- `replay.ScoreTarget` (new file `replay/score_target_table.go`, LOCAL-CHANGE):
  the `[score_target]` table of LevelUp's `regulation.toml`, measured per variant, ported
  verbatim. The LevelUp application injects the table into `ScoreInput.TargetScore`; the
  standalone has no config file, so the values live in this module and
  `internal/build` sets the input from the match variant. An absent variant returns no
  target (the timeline's safe fallback).
- `replay.MapWeaponPadDTO.Forward` / `.Up` (`replay/map_weapon_pads.go`, LOCAL-CHANGE): the
  spawner's own axes, optional, filled at request time by the standalone from the match's
  `map.mvar`. The viewer holds a `rack` spawner's weapon still in that orientation. The field
  sits in a request-time layer, so the baked fingerprint and `SchemaVersion` do not move; the
  shape golden (`replay/testdata/document_shape.golden`) was regenerated for the stored shape.
- Equipment pads (`replay/powerup_pads.go`, `ground_weapon_pads.go`, `build_ground_weapons.go`,
  `catalog.go`, LOCAL-CHANGE): the `ti=37` pad lane kept only `powerup_*` families, so a pad
  holding a carried equipment (Repulsor, Translocator, Drop Wall...) was never published. The
  rule now keeps every manifest family except grenades and the objects the manifest marks
  `deployed` (new `LabelCatalog.DeployedEquipment`, set by `internal/refdata`). Such a pad
  publishes its family in `weaponPads[].weapon` (`repulsor`), with presence, cycle and dated
  `padPickups` from the same machinery as power-up pads. The document shape and `SchemaVersion`
  do not change; a stored document gains its equipment pads when it is rebuilt.
- `filmshell/catalogue.go` (LOCAL-CHANGE): a second Stalker Rifle family id `0xadb78225`
  (the standard Stalker Rifle, per the owner's 2026-11-15 correction) joins the weapon
  catalogue as a second family per weapon, exactly like the Shock Rifle `0x1a22fee6`:
  its own entry (`Stalker Rifle (standard)`; the bare name stays with `0xdaf193c7`),
  the Stalker's timing (900/300), and a fusion to the base `Stalker Rifle`, so the
  FormulaA canon (`weaponv3.knownWeaponHigh32`) recognizes its high-32. The model
  library already serves `adb78225.glb` (built from the game's own `weap` tags), so
  no model-key alias is needed.
- `internal/grammar/projectile_attaches.go` (new, LOCAL-CHANGE), `recuperations.go` (one
  field) and `movement_states.go` (one channel on the shared walk): `ScanProjectileAttaches`
  returns the raw attach reads of the projectiles that stick (a ti=41 delta record whose
  `object-parent-state` i10 opens the attached gate: parent handle, node, 3 x R(16) pose,
  orientation, byte), read by the frame walk, which locates the record list after an event
  list where the projectile bit scan cannot see it. Covered by
  `internal/grammar/projectile_attaches_test.go` (the ti=41 i3 width and the i10 read on two
  captured records) and the research instruments `stick_marche_research_test.go` and
  `stick_i3_largeur_research_test.go` (`research` tag).
- Stuck projectiles published (schema 128, facts schema 24): `replay/projectiles_attache.go`
  (new) sets `Projectile.Attach` (`projectiles[].attach`: `fromFrame`, `parentSlot`, `node`,
  `pose`) from the first attach read of each published flight, the pose dequantized as Halo
  axes of the parent's node over [-2, 2] u (midpoint convention, range measured on 36 stuck
  grenades in the viewer's animated skeleton; `web/.../attachCalibration.research.test.ts`).
  The reads enter `FilmInputs`/`Options` (`ProjectileAttaches`, scanned in `film_scan_pont.go`,
  observe step `projectileAttaches`) and the facts file (`filmfacts_attaches.go`). To keep
  files under the 500-line cap, the section-1 complement codec moved unchanged to
  `filmfacts_complement.go` and the `Options` defaults to `options_defauts.go`. Chronicle
  v128, `structure_test.go` reason, regenerated `document_shape.golden`; covered by
  `replay/projectiles_attache_test.go` (new) and `projectiles_attaches_research_test.go`
  (`research` tag, also exports the cases the viewer harness reads).
- The detonation of a throw without a published flight (schema 129, facts schema 25): a
  point-blank stick replicates fewer than three positions, so no `Projectile` is published, the
  throw has no `proj`, and its explosion was lost although the film writes it.
  `internal/grammar/grenade_events.go` (LOCAL-CHANGE): `GrenadeThrow.Life`/`HasLife`, the handle
  of the projectile the throw creates, read from the header of its NEW record (where
  `scanGrenadeThrowsJusqua` already reads the slot); one more import (`types`), frozen in
  `revision/ordre_imports_test.go`, and the grammar fingerprint re-pinned at constant revision
  `grammar-2026-11-13.2` (`internal/grammar/testdata/grammar_rev.golden`). Covered by
  `internal/grammar/grenade_life_test.go` (new). `replay/grenades_detonation.go` (new) sets
  `Grenade.Deto` (`grenades[].deto`: `t`, `x`, `y`, `z`) on a throw without `proj` from the
  detonation message naming that handle (reference + 0x400 = the projectile's slot, same
  generation; measured 3,791 of 3,793 linked throws and 153 of 153 flights on 20 stored matches);
  `buildGrenades` became a wrapper of `buildGrenadesEtDetonations`. The lives enter the facts
  file in the section-1 complement (`filmfacts_lancers.go`). Chronicle v129, `structure_test.go`
  reason, regenerated `document_shape.golden`, and the two size caps of
  `internal/depottest/taille_test.go` (stale since schema 127); covered by
  `replay/grenades_detonation_test.go` (new, the 9220185c game-winning stick).
- `replay/ground_weapon_pads.go` (LOCAL-CHANGE): `ReplayDocument.PadCandidates`
  (`padCandidates`, schema 130) publishes the single-apparition clusters the "a pad is a
  recurrence" rule sets aside (`gwPadCandidates`): an item the map placed at rest that nobody took
  never reappears and was dropped (the grapple, repulsor and thruster pads of match 0ace97d0).
  They are not pads; the server promotes the ones a map pad or equipment spawn point confirms
  (`promotePadCandidates`, `cmd/infinite-theater-3d/serve_weapons_doc.go`). `buildWeaponPads` is
  unchanged and wraps `buildWeaponPadsAndCandidates`; the layer entry in `replay/layers.go`, chronicle
  v130, `structure_test.go` reason, regenerated `document_shape.golden`, and the two size caps of
  `internal/depottest/taille_test.go`; covered by `ground_weapon_pads_test.go`.
- Log and error message text and slog attribute keys translated from French to English (files marked LOCAL-CHANGE); identifiers, comments and research/ unchanged. Second pass: remaining French slog attribute keys and values (coverage logging call sites the first pass missed), plus `diag.Signaler` diagnostic `Message`/`Attrs` text in `internal/grammar`, `internal/facts/fallback` and `internal/facts/objectives`. Left untranslated and documented in the pass's report: the `repli_*` fallback names (`internal/facts/fallback` registries) — they are published into `coverage.fallbacks[]`, referenced by golden test data and `FORMAT.md`, and renaming them is a wire-format change out of this pass's scope; and `Diagnostic.Code` constants (e.g. `grammar.grenade_couverture`) — structured codes compared in code, not prose. Third pass: the `repli_*` registry names still reached server.log as-is through `replay/fallbacks_publication.go`'s "fallback" attribute; `internal/facts/fallback/english_names.go` adds an English snake_case name per registry entry (checked exhaustively by `TestEveryRegistryEntryHasAnEnglishName`) and the log line, plus the "fallback triggered outside the registry" diagnostic, now use it, falling back to the raw name. `coverage.fallbacks[]` and the registry names themselves are unchanged.
## Omitted upstream files

The upstream notices identify the following as game imagery or Forge assets. They are excluded under this project's no game-derived assets policy, regardless of corpus size:

- `map-images/himap/testdata/carte_validee_v1.png`
- `files-reader/mapvar/testdata/cliffhanger_map.mvar`
- `files-reader/mapvar/testdata/cliffhanger_ridgeline.mvar`
- `files-reader/mapvar/testdata/vagabond_fo08_wetland.mvar`
- `files-reader/hinavmesh/testdata/01af558d-53ab-4f05-ba68-92d805fc6260.navmesh.blob`
- `files-reader/hinavmesh/testdata/df7dbf08-b8de-4ade-9d7f-1947128c9ae4.navmesh.blob`

All module testdata totals are below 50 MiB. The decoder includes pseudonymized match recordings and derived fixtures, plus identifier and label tables and measured map bounds; its NOTICE documents their provenance, including identifiers read from installation headers. These are data and observations, not game meshes, textures, sounds or scripts. The upstream notices describe the omitted Forge files as public UGC downloads, not installation extracts; the reference image is Microsoft game imagery.

## Changes from upstream (map-images v1.0.1, files-reader v1.0.1)

- `map-images/himap/grenades.go`: export the grenade projectiles by rank (`ProjectilesDeGrenade`) so the weapons library reads the effects a thrown grenade carries (LOCAL-CHANGE).
- `map-images/himap/effet_arme.go`: add the flow-mapped billboard particle shader 0461c4a7 (the plasma grenade's flight effect) to the read layouts, from its DXIL reflection (LOCAL-CHANGE).
- `map-images/himap/armes.go`: expose the existing object-model extraction for vehicle tags to the replay model library (LOCAL-CHANGE).
- `map-images/himap/couches.go`: read the inferred base gradient of Breaker's frigate shader; its additional atlas masks remain undecoded (LOCAL-CHANGE).

These two modules are modified copies. The changes come from the LevelUp 3D replay work
(three-way merge against the LevelUp fork point, no conflicts):

- `himap`: log messages, slog attribute keys, and error/panic strings translated from French
  to English (LOCAL-CHANGE, ~75 call sites across 24 files: the slog log lines in full, plus a
  smaller set of error strings in the same files). Comments and Go identifiers are unchanged.
  The bulk of `himap`'s `fmt.Errorf`-wrapped internal error strings (several hundred, spread
  across most of the package's ~100 non-test files) were NOT translated in this pass; see the
  session report for the full list of untouched files.
- `files-reader`: all user-visible error strings (`errors.New`/`fmt.Errorf` messages) in `ooz`,
  `mapvar` (`cb2.go`, `containment.go`, `mapvar.go`), `hinavmesh` (`conteneur.go`,
  `typetable.go`, `tagfile.go`, `enveloppe.go`, `navmesh.go`, `resynchronisation.go`) and
  `himodule` (`module.go`, `resources.go`, `projection*.go`) translated from French to English
  (LOCAL-CHANGE). No slog calls exist in this module. Two test assertions in
  `hinavmesh/conteneur_test.go` that matched on the old French substrings were updated to match
  the new English wording; sentinel errors compared with `errors.Is` needed no test changes.
- `files-reader`: module reader additions needed by the world mesh build (10 files).
- `map-images`: world mesh collection and GLB export for the 3D viewer: structure, decor
  and placed objects, layered materials and height blend, cut-out materials, baked light
  probes and lamps, sun and sky, terrain heightfields, weapons, armor pieces (117 new files,
  15 modified). New dependency: `github.com/woozymasta/bcn` v0.7.0.
  - `himap/couches_noms.go` (LOCAL-CHANGE): surface recognition by names now refuses to
    classify a color-map family on its secondary control map, which is shared with other
    shader families; only rohg forms (control map as primary) match on it. A shader of a
    color-map family whose color map is absent was misread as a zero-colored gradient layer
    (dark walls on Live Fire, materials of shaders `2aaf6012`/`25144b6b`). Covered by the
    synthetic test `himap/couches_noms_surface_test.go` (new).
  - `himap/arsenal_roster.go` (new, LOCAL-CHANGE): `Arsenal.RosterArmes` enumerates every
    weapon's `weap` GlobalID in the installed modules (the weapon-settings group does not
    exist in the game; the `weap` tags themselves are the roster). It reads the unexported
    geometry index through an `Arsenal` method because no external package can, mirroring the
    existing `Grenade` pattern. Serves the standalone weapon-library build
    (`cmd/infinite-theater-3d build-weapons`).
  - `himap/premiere_personne_actions.go`, `himap/premiere_personne_rig.go` (LOCAL-CHANGE): the
    first-person rig also bakes the fifth equipment set's `equipment_activate` (drop wall and
    repair field), named by its StringID form `#6132b1e2` because no dictionary has found its text
    (`JeuMurDeploye`); `ClipsDeLActionDuJeu` accepts a label in that form
    (`EtiquetteCherchee`). Covered by `himap/premiere_personne_actions_test.go` (new) and
    `himap/premiere_personne_jeux_gamefiles_test.go` (new), which reads each family A ability's
    item set field (eqip root +0x904, word +0x338).
  - `himap/terrain_melange.go`, `himap/terrain_melange_bake.go` (new, LOCAL-CHANGE) and
    `terrain_collecte.go`, `terrain_maillage.go`, `maillage_monde.go` (modified): an `rtrn`
    terrain now publishes its palette blend instead of one palette color. Each node's weight
    programs (a small stack machine over the node's BC1/BC3 input textures) are evaluated per
    cell, the palette is grouped by color into the four layers the viewer draws, and the
    sequential weights are baked into a mask atlas on UV set 1. Entries without a color map
    (Live Fire's grass) draw the three-color gradient of the Material Layer Data indexed by
    their packed map's alpha. Adds `tagInfo.cibleDonnees` (data reference table lookup).
    Covered by `himap/terrain_melange_test.go` (new).
  - `himap/decorateurs.go`, `himap/decorateurs_pose.go`, `himap/glb_decorateurs.go` (new,
    LOCAL-CHANGE) and `terrain_collecte.go`, `maillage_monde.go`, `glb.go` (modified): a
    terrain's scattered decorators (Live Fire's grass clumps). Reads the `dcrt` meshes (10-bit
    positions, buffers in the tag's resource section), runs each placement description's density
    program on the nodes of every quadtree level under the tiles read, scatters clumps with a
    seeded generator (thinned per kind to a budget), and writes one node per mesh with
    `EXT_mesh_gpu_instancing`. `couches_noms.go` and `decoupe.go` (modified) give the clump
    shaders (`bd7bb1c4`, `d313108e`) a gradient surface and an alpha cutout; that form applies
    only when the shader declares its gradient colors. Covered by `himap/decorateurs_test.go` (new).
  - `himap/couches.go`, `himap/couches_noms.go`, `himap/glb_couches.go` (LOCAL-CHANGE): a level
    shader may skip a template layer (Live Fire's boulder shader `804d3276` declares layers 1, 2
    and 4). Each layer keeps its template rank (`Couche.Rang`), and the GLB writes it as `rang`
    when it differs from the layer's position, so a reader takes the macro mask channel and the
    height blend index of the template layer. Before this, layer 4 read layer 3's mask channel
    (empty on those boulders) and the dirt never showed. Covered by
    `himap/couches_rang_test.go` (new).
  - `himap/materiaux.go`, `himap/glb.go` (LOCAL-CHANGE): the blend mode is the byte at +84 of the
    postprocess record. The +60 read before is the element count of its `function parameters`
    block, so a material with an animated parameter (the weapon pads' glow) read as additive and
    drew as translucent blue. The byte matches Ekur's `alpha_blend_mode` on all 47,832 materials of
    its export. Decal modes (19, 23, 68, 69) keep the opaque layered drawing they had, and the GLB
    writes `melange` 0 for them; on Aquarius only the `diffuse_emissive` glow materials change.
    Alpha-blended materials that carry layers draw with their layers like an opaque material
    unless they are glass (`Materiau.Vitre`, 2026-11-19): drawing all of them see-through
    whitened Streets' wet roads and floors, drawing all of them opaque turned Recharge's attic
    windows into solid slabs.
    Covered by `himap/materiaux_melange_test.go` (new).
  - `himap/emissif.go`, `himap/materiaux.go`, `himap/textures_monde.go`, `himap/glb.go`,
    `himap/glb_couches.go` (LOCAL-CHANGE): `diffuse_emissive` materials carry their
    self-illumination texture (slot 244, from Ekur) as the glTF `emissiveTexture` on the color
    map's coordinates, so the light shows only where the game masks it (the pads' thin strips).
    A texture absent from the modules (an engine default) leaves the light uniform. Covered by
    `himap/emissif_texture_test.go` (new).
  - `himap/emissif.go` (LOCAL-CHANGE): the `illum` shader (0xfb43df97, Ekur's `handle_illum`)
    joins the self-lit table: color at constant +32, intensity at +44, its color map (slot 0) as
    the `emissiveTexture`. It draws the weapons' light strips and ammo screens. Covered by
    `himap/emissif_test.go` and `himap/emissif_illum_gamefiles_test.go` (new, checks three weapon
    materials against Ekur's export).
  - `himap/emissif.go` (LOCAL-CHANGE): the energy shader (0xb202b443, the Sentinel Beam's energy
    parts) joins the self-lit table with `couleurCarte`: its light color is not a constant, it is
    the one-pixel tint map it binds at texture slot 68 (a white color, the force alone gates the
    light), and its force is the intensity at its declared `emissive_intensity` (+92). It emits in
    third and first person alike. Covered by `himap/emissif_test.go` and
    `himap/emissif_energie_gamefiles_test.go` (new, checks the Sentinel's five energy materials
    and its tint map's pixel).
  - `himap/emissif_ravager_disruptor_gamefiles_test.go` (new, gamefiles): pins the reading that
    the Ravager's and the Disruptor's materials are not self-lit. Measured on the game's own
    parameters: all twelve weapon materials (plus the six shared first-person arm materials) are
    opaque layered hard-surface materials of shaders `4dac018a`/`a12c98fe`, which declare no
    emissive parameter, carry no emissive constant (their only non-default values are shared by
    every material of the shader, glow weapons included) and which Ekur's export classifies as
    Layered/Opaque with no `illum_info`. The glow the game shows on these weapons is baked diffuse
    brightness plus engine bloom and particle effects, not a material emission; nothing is added
    to the reading.
  - `himap/emissif.go`, `himap/materiaux.go`, `himap/glb.go`, `himap/glb_couches.go`
    (LOCAL-CHANGE): shaders outside the fixed table emit when their declared parameter NAMES
    match a form of `formesEmissives` (names resolved by hashing candidate texts): holographic
    signs (color_tint x intensity x opacity on the emissive map), hologram projectors (base_tint x
    base_tint_intensity x diffuse_map_intensity on the diffuse map), screens
    (base_emissive_color_tint x intensity x amount on base_emissive_map), neon and light strips
    (the color before base_emissive_intensity, on base_emissive_detail_map) and the emissive_*
    block of other shaders. A texture's slot is the byte of the sampler entry declared before it.
    `Emissif` gains the texture transform (written as KHR_texture_transform) and `Image` (a
    picture, written as `extras.emissionImage`); a see-through emitter's texture has its alpha
    folded into its color. On Streets, 257 materials emit instead of 35. Covered by
    `himap/emissif_test.go`, `himap/emissif_noms_gamefiles_test.go` (new, eight Streets materials)
    and the probe `himap/sonde_emissifs_carte_research_test.go` (new, `gamefiles research`).
  - `himap/emissif_fonctions.go` (new), `himap/emissif.go`, `himap/decoupe.go`,
    `himap/materiaux.go`, `himap/glb.go`, `himap/sbsp.go` (LOCAL-CHANGE): a material's animated
    parameters (postprocess function block at +24, routing at +44, each function's bytes through
    the tag's data-reference table, whose count `tagInfo.dataRefs` now keeps) are read, and the
    time-driven periodic ones that move the light (its intensity, amount or opacity, the
    transform of its texture's register, its color gradient) are written as
    `extras.emissionAnim`. Object-driven inputs, constant and spline functions, and functions on
    the light's other textures (scanlines, noise) are left out. Covered by
    `himap/emissif_fonctions_test.go` and `himap/emissif_fonctions_gamefiles_test.go` (new, six
    Streets materials); the probe gains a block dump and a survey of the animated parameters.
  - `himap/bitmap_images.go` (new), `himap/emissif.go`, `himap/emissif_fonctions.go`,
    `himap/materiaux.go`, `himap/maillage_monde.go`, `himap/textures_monde.go`, `himap/glb.go`
    (LOCAL-CHANGE): a light whose frame index an object input picks (`ImagesEmissives`: the BR75's,
    Bandit's and Commando's ammo counter digits read `primary_ammunition_tens` and
    `primary_ammunition_ones`) has every image of its multi-image bitmap read into one strip
    (`LitBitmapImages`, 128 px per image), written scaled to the first image, with the input,
    range and image count as `extras.emissionImages`. Covered by `himap/bitmap_images_test.go` (new).
  - `himap/refs_typees.go` (new, LOCAL-CHANGE) and `cuisson_forge.go` (modified): a Forge object
    type's model is looked up through typed tag references only (a GlobalID followed at +0xC by
    its group's fourCC). The untyped byte scan read the integer 121 in spawner properties as the
    global `scen 00000079`, so the weapon rack, power weapon pad, equipment pad and grenade pad
    drew a 114-triangle placeholder box. Across the 4,235 Forge foods the typed rule changes
    exactly those four types.
  - `himap/kits_forge.go` (new, LOCAL-CHANGE) and `maillage_variante.go` (modified): a Forge
    type without its own model whose food names a Forge object kit (`foki`) with at least one
    machine poses the kit's objects (reference, position, yaw/pitch/roll, per-axis scale), as the
    game does for the weapon, power-up, equipment and grenade pads and the weapon rack. Kits
    without a machine (cameras, podiums, mannequins, capture-zone setups) pose nothing.
  - `himap/arsenal_equipements.go` (new, LOCAL-CHANGE): `Arsenal.Equipement` reads the model of
    an equipment object (`eqip`) the way `Arme` reads a weapon's, so the weapon library can build
    the pickup model a power-up pad holds.
  - `himap/filtres_mode.go` (new, LOCAL-CHANGE) and `maillage_variante.go` (modified): the
    variant layer keeps only the objects the match's mode creates (`<mode>_include` labels
    OR'ed, `<mode>_exclude` labels removing), replacing the Infection-only rule
    (`OptionsVariante.Filtres`, `BilanVariante.HorsMode`). Zone markers, flag stands, oddball
    spawns of other modes no longer draw. Covered by `himap/filtres_mode_test.go`,
    `himap/kits_forge_test.go` and `himap/kits_forge_gamefiles_test.go` (new).
  - `himap/origine_forge.go` (new, LOCAL-CHANGE) with `maillage_variante.go`,
    `maillage_variante_representation.go` and `kits_forge.go` (modified): a Forge object drawn
    from an `rtgo` is offset by its own `mode`'s box corner minus the `rtgo`'s (the `rtgo` is the
    same geometry re-centred), instead of being lifted onto its base. Rock columns and terrain
    pieces are centre-pivot, many props corner-pivot. A type whose `mode` is missing or has
    another box keeps the base rule. Covered by `himap/origine_forge_test.go` (new) and
    `himap/maillage_variante_test.go` (modified).
  - `himap/origine_forge.go`, `maillage_variante_representation.go` and `kits_forge.go`
    (LOCAL-CHANGE): the `mode` an `rtgo` representation is measured against draws that
    representation's own permutation (the sections whose permutation, else region, carries the
    representation name), the rule of Ekur's Forge map import (TheHaloArchive,
    GPL-3.0-or-later). Fortress's type -960331706 keeps a 2.29 m default and a 2.20 m "forge"
    permutation; its "forge" `rtgo` was compared with the default, failed the same-box test and
    sat 1 m off in X and Y (721 player samples inside it, 3 now). Covered by
    `himap/origine_forge_test.go` (modified).
  - `himap/origine_forge.go`, `maillage_variante.go`, `maillage_variante_representation.go` and
    `kits_forge.go` (LOCAL-CHANGE): an `rtgo` is measured against the first `mode` of its own
    size among those its definition reaches (one per `bloc`/`scen`/`mach`), not only the first
    one. Origin's rock type -1241957150 has Small, Medium and Large `bloc`s (4.3, 21.5 and
    34.5 m) and Medium-sized `rtgo`s: held against Small, it kept the base rule and sat half its
    scaled height off its centre pivot, through a base (4 308 player samples inside object
    #1221's box, 6 now). Covered by `himap/origine_forge_test.go` (modified).
  - `himap/maillage_variante_representation.go` (LOCAL-CHANGE): a Forge object's dynamic
    representation (the food's +0x34 block: the `bloc`/`scen`/`mach` it spawns as) draws the
    model variant its record names (StringID at +0x04) through its `hlmt`, not every region's
    permutation 0 (`variantesRepresentations`). On AIMBOTZ V2 the dynamic floor rectangles,
    switches and screens drew a fixed orange or a default material where the game draws the
    style material their Forge style repaints (green rectangles, colored switch frames).
    Covered by `himap/representation_variante_gamefiles_test.go` (new).
  - `files-reader/mapvar/mapvar.go` (LOCAL-CHANGE): `Object.ModeForge` reads the object's Forge
    mode at `#8/24[0]/0` (3: telescoping, `ModeForgeTelescopique`).
  - `files-reader/mapvar/socles.go` (LOCAL-CHANGE): `PadSpot.Forward` and `PadSpot.Up` carry
    the representative object's own axes, so the served `mapWeaponPads` can pose a weapon rack's
    weapon in the rack's orientation.
  - `himap/telescopage_forge.go` (new, LOCAL-CHANGE) and `maillage_variante.go` (modified): a
    telescoping Forge object leaves its scale at 1 on the axes where every size of its type
    has the same extent. Outlook's ring plates (all sizes 0.41 m thick) stored 5.09 there and
    stood 2.09 m tall through the floor; the base door frames (all 0.41 m deep) stored 15.4 and
    made a 6.2 m tunnel (10,893 player samples inside both, 0 now). Ekur does not handle
    telescoping. Covered by `himap/telescopage_forge_test.go` (new).
  - `himap/premiere_personne.go` (LOCAL-CHANGE): `SourcesArme` falls back to the one indexed
    `jmad` of the weapon's dependency table when no couple of inline references resolves and
    the inline graph's GlobalID is indexed by no module. The Vestige Carbine (weap 3e070217)
    names 78912884, which no installed map indexes; its dependency table carries d7292132, its
    real FP graph. It had no first-person rig and its gun floated without arms; no other
    weapon changes (91 to 92 rigs). Covered by
    `himap/premiere_personne_dependances_gamefiles_test.go` (new).
  - `himap/couches_style.go` (new, LOCAL-CHANGE) and `materiaux.go` (modified): a material of a
    layered shader (`0xdb8cbebb` and family) binds no color map; its look comes from the
    `style_info` block of its `mat ` tag, resolved through the game's style tables (mwsy style
    list, default style; palette mwpl; region and base intention; swatch mwsw) the way Ekur's
    `material_coating.rs` does. The base layer carries the gradient color map and the chosen
    variant's colors. Before this, those materials had no layers and no surface and drew a flat
    tint (the tan, brown and yellow walls of Forge maps). Covered by
    `himap/couches_style_test.go` (new, gamefiles).
  - `himap/telescopage_forge.go` and `maillage_variante.go` (LOCAL-CHANGE, modified): a
    telescoping object's stored scale multiplies its type's reference dimensions (`food` root
    +0xE4), not the extent of the model drawn for it, and where that reference resizes the
    model the stretch is centred on the model's box. Outlook's I-beams (type -1722685555,
    reference half their 0.4 x 0.4 x 0.8 model) were drawn twice the game's length from one
    end: an 8.4 m girder ran 5.9 m out of a base's front and a beam ran along its floor like a
    curb. Ekur scales by the stored scale too and draws them the same way. Covered by
    `himap/telescopage_forge_test.go` (modified).
  - `himap/telescopage_forge.go` (LOCAL-CHANGE, modified): a type that telescopes on every axis
    (no axis on which all its sizes agree, `telescopage.libre`) is stretched about its model's
    box centre on every axis, the reference resizing the model or not. Origin's pad cylinders
    (type 1720205523) rose 0.5 m through the pads from their foot; centred, their tops are the
    surfaces players stand on. Measured with `internal/meshbuild/solids_gamefiles_test.go`
    (players inside placed solids, 15 stored matches): Origin 948 / 150 feet / torso samples
    -> 12 / 94, Outlook 1861 / 1 -> 3 / 1, Solitude 47 / 100 -> 44 / 96, no map higher.
    Covered by `himap/telescopage_forge_test.go` (modified).
  - `himap/maillage_variante.go` (LOCAL-CHANGE, modified): `CollecteSolidesVariante` places a
    variant's objects without resolving materials or textures (shared with
    `CollecteMaillageVariante` through `poseGeometrieVariante`), for that measurement.
  - Forge style materials drawn as Ekur's HIMS shader does (`hims.py`, `layered_shader.py`,
    `infinite_masking_sorter.py`, `forge_map_operator.py`; TheHaloArchive, GPL-3.0-or-later):
    - `himap/couches_style.go` (modified), `couches.go`, `materiaux.go`: every zone of a style
      material, not only its base: zones 2 to 4 weighted by Mask0 R, G, B (zones 5 to 7 by
      Mask1), the style's grime by clamp(ASG.B + amount - 1), the material's own normal map and
      ASG occlusion on each zone (`Couche.NormaleObjet`, `Couche.ControleASG`), and a
      transparent base intention cut where the ASG alpha is low (the alpha is the opacity)
      when the ASG has an alpha (`Decoupe.AlphaSeul`). Fortress's 7705398e decals drew as a
      near-black slab. The cut was first written as 1 - ASG alpha, which drew Fortress's ivy
      and plant clumps as dark sheets with leaf-shaped holes; their ASG alpha is high on the
      leaves (`glb_couches.go` `composeMasqueStyle`).
    - `himap/styles_forge.go` (new), `files-reader/mapvar/mapvar.go` (`Variant.StyleGrimes`,
      style fields 8 and 10), `maillage_variante.go`, `maillage_variante_poses.go`,
      `maillage_monde.go`, `forge_teintes.go`: an object's own Forge material (`.mvar` root
      field 8) repaints the zones it names, from the embedded catalog of Ekur layers, and
      replaces the grime. Each (material, style) pair gets its own GLB material; before this a
      layered material dropped the object's style and drew its default colors (flat white
      walls, flat yellow sandbags). The style's color moves the swatch colors toward it by its
      intensity; Ekur reads these but never draws them, so that rule is ours.
    - `himap/glb_couches.go`, `glb.go`, `glb_masques.go`, `textures_monde.go`: Ekur's Forge
      import makes UV1 the active map, which the HIMS masks, ASG and normal read, while the
      swatches read UV0. The composed mask (`MasqueStyle`) is written on UV1, the layers flag
      the normal and control maps laid there (`normaleMacro`, `controleMacro`), and a cut lives
      in the mask's alpha (`decoupeMasque`). Read on UV0 they streaked across scaled blocks.
      Swatches only a style draws are read at 256 (`coteEchantillon`).
    - `himap/glb_poses.go` and `himap/maillage_variante_poses.go`: optional diagnostic
      node names include the original Forge object index and type; disabled by default.
    - `himap/maillage_variante_poses.go` (`avecJeuMacro`): a Forge object's mesh without UV1
      reads its UV0 there, as Ekur keeps the active map when UV1 is missing. Foliage cards have
      no UV1; zero-filled, their cut, ASG and normal read one texel.
    - `himap/glb.go`, `glb_masques.go` (`alphaTranche`): an alpha-only cut whose alpha never
      crosses the threshold leaves the material opaque. Fortress's Forge walls carry an ASG
      alpha of 0 to 4, which the coverage reading above would otherwise cut away entirely.
    Covered by `himap/styles_forge_test.go` (new), `himap/decoupe_feuillage_test.go` (new) and
    `himap/couches_style_test.go` (modified, gamefiles).
  - Forge styles and representation palettes from the game's own tags:
    - `himap/styles_forge.go`, `forge_teintes.go`, `maillage_variante.go` (`OptionsVariante`
      `StylesMvar`, `SaletesMvar`, `CatalogueForge`), and `internal/mapmesh/variant.go`: an
      object's Forge material resolves its swatches in the game's Forge palette (mwpl
      0x4FD73754, Ekur's FORGE_PALETTE) through the material-style swatch reader
      (`echantillonBrut`), the embedded catalog only filling swatches the game does not name.
      The catalog is Ekur's export of that palette keyed by each entry's notes string, so
      entries sharing one overwrite each other (324 entries, 318 kept). Fortress's sandstone
      (-1773215225, 136 style layers) and moss (-422696516, 77) swatches were among the lost,
      and the Human Brutalist walls naming them drew their default pale concrete (visible
      triangles with a pale low-chroma base layer: 16.0% before, 2.2% after). Flat tints gain
      the styles the game resolves (`completeTeintesForge`).
    - `himap/maillage_variante_representation.go` (`palettesRepresentations`,
      `paletteDeRepresentation`), `maillage_variante_palette.go`
      (`listeMateriauxPaletteTrous`): an `rtgo` representation draws the palette its food
      record names (+0x44), not the first palette after its `rtgo`; an empty slot keeps the
      default palette's material. Eroded Terrain E's ten representations share one `rtgo` and
      name eight palettes; Fortress's choice (-437051236) drew the "Default" one.
    - `himap/couches_style.go` (`ZonesStyle.premiereZone`, `couches`): an object's Forge style
      layers start at the material's first lit zone. Forge's cloth and decal planes (shader
      0x7705398e: Fortress's team banners, moss and stain planes) have an empty base zone and
      draw their surface on Mask0 R; the style's red or blue landed on the empty base, under the
      material's own brown Mask0 R swatch.
    - `himap/styles_forge.go` (`coucheUnie`), `couches_style.go` (`ZonesStyle.unie`): a style
      layer naming the empty swatch (Forge's "Blank", -656357566) with a color draws that color
      flat on its zone, with the zone's own maps (or the first lit zone's). It used to resolve to
      nothing and leave the zone to the material: Fortress's Forerunner Platform panels in the
      blue tower name Blank in near-black brown on Mask0 R and drew the material's pale
      blue-grey there. A Blank layer without a color still leaves the zone to the material.
    Covered by `himap/styles_forge_test.go`, `representation_test.go` (modified),
    `styles_forge_gamefiles_test.go` (new) and `representation_gamefiles_test.go` (modified).
  - `files-reader/mapvar/mapvar.go` (LOCAL-CHANGE): `Variant.Lighting` reads the variant's
    "Lights & Atmosphere" options at root[1][39]: field 0 the Sunlight intensity (Recharge: 9,
    its scenario sun's; Fortress: 25 over its canvas's 5), field 1 the Sunlight color override
    (a Forge globals color index) and field 18 its switch (1 on, inferred from the maps that
    carry a warm sun color there). Covered by `mapvar/lighting_test.go` (new).
    `Lighting.SunDirection` (and the `SunDirection` type) reads field 2, the Sun Direction
    {0: yaw, 1: pitch}: the level `dwsg` sun's azimuth and latitude (native variants store their
    scenario's: Recharge 250/28, Live Fire 138/52, Streets 220/22, Aquarius 60/40). Covered by
    `TestReadSunDirection`.
  - Foliage atlas cuts, `himap/decoupe.go` (`decoupeAtlasFeuillage`), `materiaux.go`: a shader
    that binds a leaf atlas color map (`0xca775400`, or 669c3e5e's slot 4) is cut by that map's
    alpha, the leaves' coverage. Fortress's pine clusters, bushes, firs and root clusters drew as
    dark angular cards (the atlas's dilated padding) because their shaders are not in the cutout
    table. Covered by `himap/decoupe_feuillage_test.go` (new).
  - `himap/vitres_sombres.go` (new, LOCAL-CHANGE), `maillage_monde.go` and `glb.go` (modified):
    a glass pane the game shows dark is drawn as a dark grey opaque material, keyed by the
    pane's geometry (`rtgo`) because its glass material also draws real windows. Recharge's
    roof pane over the batteries (rtgo `1a27c1cf`, glass `0x4faa9c4f`, 230 triangles) drew as
    the clear glass placeholder and showed bright sky through the girder lattice, where the
    game shows dark grey; the long hall's windows (rtgo `43ec8b62`, same glass) stay glass.
    The stand-in material carries `extras.vitreSombre` (the glass GlobalID) and `teinte`.
    Covered by `himap/vitres_sombres_test.go` (new).
  - `himap/textures_monde.go` (new, LOCAL-CHANGE) and `cuisson.go`, `maillage_monde.go`,
    `maillage_variante.go`, `terrain_collecte.go`, `terrain_melange_bake.go`,
    `decorateurs_pose.go` (modified): the four map texture side constants become a per-build
    `TextureCaps` value (`OptionsCuisson.TextureCaps` / `OptionsVariante.TextureCaps`, zero =
    `CapsStandard` 512/512/256/256, the pre-change output; `CapsHigh` doubles each side)
    threaded through the world mesh and terrain texture reads. `coteSurface` (hard-surface,
    256) is outside the choice. Covered by `himap/textures_monde_test.go` (new).
  - `himap/maillage_monde.go` (a `surfaceCote` field), `himap/textures_monde.go` (the
    `coteSurfaceDure` reader), `himap/armes.go` (an `Arsenal.surfaceCote` field and
    `Arsenal.SurfaceCote` setter, copied onto each `Arme`/`Grenade`/`Equipement` mesh in
    `objet`), and `himap/premiere_personne_rig.go` (copied onto the first-person rig's
    `Maillage`) (all LOCAL-CHANGE): the hard-surface side a weapon-library or first-person-rig
    build reads its textures at, set per arsenal. A map build leaves it zero and reads
    `coteSurface` (256, the pre-change output); the weapon library sets 512 and the
    first-person library sets 1024, so their sharpened hard surfaces stay the map build's
    unchanged. Covered by `himap/textures_monde_test.go` (`TestCoteSurfaceDure`).
  - `himap/couches_forerunner.go` (new, LOCAL-CHANGE) and `couches_noms.go` (modified): the
    Forerunner level shaders of Forge's "MP" pieces (9e8651c8, 55e97350, 71c12c90 and five
    others on Origin) declare the template's layers 2 to 4 but name their base outside it: a
    control map (0x8fd3629f), a normal map (0xfe080e52) and three blue-grey colors (0x0a1b7f9b,
    0xaf44c1b5, 0x16855291). Without that base the next layer, a 31.6% sand dust, covered the
    whole surface: 35% of Origin's layered triangles drew as sand stone where the game shows
    Forerunner metal. The colors' order and the red index are inferred. Covered by
    `himap/couches_forerunner_test.go` (new).
  - `himap/effet_arme.go` and `himap/modele_particule.go` (new, LOCAL-CHANGE): a weapon's idle
    particle effect, read down to the values a viewer simulates (the Shock Rifle's electricity,
    effect 1e471031). `Arsenal.EffetDeParticules` reads an effect's first level of detail: its
    locations (marker names), events (flags, duration) and particle systems (particle, location,
    coordinate system, camera mode, flags), each emitter's shape, axis scale, direction, billboard
    and its 28 properties as mapping functions with their inputs (the multi-spline, type 8,
    decoded piece by piece: line or cubic pieces, the bytes consumed exactly, else refused), and
    each particle's shader, bound textures (checked against their slots), blend mode, named shader
    constants and mesh. The constants' layouts are those of the shaders' DXIL reflection
    (`dispositionsParticules`, two particle shaders), cross-checked against the shaders' declared
    parameters. A `pmdf` particle mesh reuses the render-model geometry reader at its own root
    offsets (Sections +40, bounds +80, resource groups +172), its vertex buffers read from the
    tag's own data references, a triangle list without an index buffer. `MarqueursDuModele`,
    `ModeleDeLArme`, `TagArme`, `EmplacementsDesEffets`, `BitmapParticule` and `EspaceBitmap` (a
    bitmap's curve byte at +13 of its bitmaps record, sRGB = 5, and whether its format is signed)
    serve the weapon and first-person libraries. Covered by `himap/effet_arme_test.go` (new) and
    `himap/effet_arme_gamefiles_test.go` (new: the twelve systems, the shader layouts, the three
    meshes, the markers). `DecodeMappingFunction` (LOCAL-CHANGE) exposes the same function decoder for
    a weapon object function's `default function` bytes (the Heatwave's `fx_camo_off` maps `camo`
    through 1 - x). `MarqueurArme.Model` (LOCAL-CHANGE) is the marker's model-space frame at the
    rest pose (`NodeModelTransform` of its node, then its translation and rotation): the Heatwave's
    fin markers turn a quarter about up. A particle property may be a periodic function (type 3,
    LOCAL-CHANGE): `FonctionParticule.Periodic` carries its sub-functions (one, two when ranged),
    decoded by the emissive functions' `Periodique` reader and refused when their count does not
    match the ranged flag (the Shock Rifle projectile's jittering sprite, the systems some idle
    effects had left out). Covered by `TestProprietePeriodique`.
  - `himap/animation_functions.go` (new, LOCAL-CHANGE), `animations.go` (modified: a member keeps
    its function list): `GrapheAnimation.Functions` decodes the functions an animation sets (the
    member's list at +216, its curves in blob section 16) and `Arsenal.ReloadFunctions`
    those a weapon's own graph sets through its `reload_1` animations (the Heatwave's
    `animation_event_function_variant_switch`, 1). Covered by `himap/animation_functions_test.go`.
  - `himap/cuisson.go`, `maillage_monde.go`, `glb.go` (LOCAL-CHANGE): `OptionsCuisson.AccepteSansStructure`
    (carried as `MaillageMonde.SansStructure`) lets `CollecteMaillageMonde` and the GLB writer
    produce a world mesh with no structure or terrain triangle (only its sky and sun) instead of
    failing. A Forge map on the blank canvas (`fo11_blank`, Empyrean) has its whole world in the
    variant layer; the app sets it for Forge canvases only.
  - `himap/geometry_normales.go` (new, LOCAL-CHANGE), `geometry.go` (`Mesh.Normales`),
    `maillage_monde.go` (`GroupeMaillage.ajoute` places them, `MaillageMonde.avecNormales`),
    `placements_scenario.go` (`poseModele`), `armes.go`, `accessoires_armure.go`, `spartan.go`
    and `premiere_personne_rig.go` (modified): the game's own vertex normals, the LOD's buffer
    slot 5 (format 15: three unsigned 10-bit fields, each v / 1023 * 2 - 1, a direction that is
    normalized; the 2-bit field is not read), are read for the Spartan, its pieces and
    attachments, the first-person rig and the objects `Arsenal.objet` reads (weapons, grenades,
    equipment, vehicles), placed by the inverse transpose of the instance, and written as the GLB
    `NORMAL` (`ajouteNormalesGLB`). Before this those GLBs carried no normal and the view shaded
    them per face: visible triangle facets on lit close-ups. A group keeps normals only while
    every mesh it holds has them. Map geometry is unchanged (it reads none). Measured on the
    Spartan's `mode` (2.46 M vertices) against the triangles' own normals: mean dot 0.86, 73%
    within 30 degrees, the rest authored bends. Covered by `himap/geometry_normales_test.go`
    (new) and `himap/geometry_normales_gamefiles_test.go` (new: the Spartan's default armor and
    the BR75).

Tests: `map-images` passes. `files-reader/hinavmesh` fails before and after the merge
because its game-derived fixtures are not shipped here.
