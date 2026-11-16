# Weapon coatings pipeline

Each player's equipped weapons are painted with that player's weapon coating, in both views. The
pipeline reuses the Spartan armor coating work end to end: the same file contract on disk, the same
`CoatingWork` reference paint on the build side, the same `paintMaterials` core on the web side.

## Data source

- **Player side** — the player's public customization view. `haloapi.DecodeWeaponCores`
  (`internal/haloapi/weapon.go`) decodes `WeaponCores[].Themes[]` and keeps the equipped theme's
  `ThemePath` and `CoatingPath` (GameCMS inventory paths). `fetch.go` persists the raw customization
  in `matches/<id>/customization/<xuid>.json` and fetches those GameCMS files once into the shared
  gamecms cache (the armor definition cache path).
- **Model side** — the weapon library GLBs. The build paints each weapon from its raw surface
  images (`extras.surfaceBrute`) and its style (`extras.style`), against the Ekur coating reference
  (`spartanpieces.CoatingWork`, read from `IT3D_EKUR_DIR`).

## Build

`build-weapons` (`cmd/infinite-theater-3d/buildweapons.go`, `internal/weapons`) builds the weapon
GLBs and, when an Ekur reference is found, writes beside them:

- `coatings.json` — the common table (per-list default style, styles, swatches);
- one `coating-<style>.json` per named style of the lists the weapon materials name (keyed by
  the style id the players' `style_key` carries; its `lists` maps each list to the style's
  reference);
- one `swatch-<gradient>.png` per gradient image.

`index.json` carries the coatings section. Without an Ekur reference the build warns
("weapon library without coatings: no ekur reference") and the weapons keep their neutral paint.

`index.json` also carries `reticle_ranges` (`internal/weapons/reticle.go`): per weapon key, the
red-reticle range read from the weapon's `weap` tag (`weaponicons.ReadAimAssist`), in world
units: `unscoped` (the autoaim range) and `zoomed` (one entry per zoom level the tag declares,
the autoaim range times that level's magnification). A weapon whose tag has no autoaim range is
absent and its reticle never turns red. An index without the field is stale: the library is
reported stale by `/api/coatings/status` and rebuilt in place by the normal build job.

## Route

- `GET /api/weapons/...` (`serve_weapons.go`) serves the weapon library: model GLBs, `index.json`,
  and the coating files (`weapons.CoatingFile`: `coatings.json`, `coating-[0-9a-f]{8}.json`,
  `swatch-[0-9a-f]{8}.png`) with the spartanpieces content types.
- `GET /api/matches/{id}/spartans` (`serve_spartans.go`) extends each player with
  `weapon_coatings`: one entry per equipped weapon core, in API order, each with
  `core_id`, `model_key` (the weapon library key of the weapon the core's equipped theme names,
  resolved through the weapon name tables) and `style_key` (the coating GameCMS file's `StyleID`,
  as a hex identifier). A core whose equipped theme is not in the cache, or whose weapon name the
  tables do not know, is left out (logged once); a core whose coating file was not read, or that
  names no style, keeps its model key with an empty style; no equipped core gives nil.

## Web

- `web/src/lib/replay/spartanArmor.ts` — the `WeaponCoating` type and
  `ReplaySpartan.weapon_coatings`.
- `Replay3DView.tsx` passes `weaponsPath` (`/api/weapons` from `MatchViewScreen.tsx`) to
  `SpartanArmory` alongside the armor library.
- **Third person** — `replayScene3d.ts` asks `armory.peindreArme(xuid, modelKey, model)` once per
  player and model (background, cached) and passes `armory.coatArme(...)` to
  `avatar3d.showWeapon`; `avatar3d` paints the held model's raw-mask materials as copies
  (`armorMaterial3d`) and disposes them on coat change, model change and `releaseWeapon`.
- **First person** — `peintureRig3d.ts` (the followed player's arms rig) calls
  `armory.peindreBras(xuid, habit, materiaux, cleArme)`; `separerArme` splits arm-rig materials from
  weapon materials by the armor table (a style list absent from the armor table's `default_styles`
  is a weapon material), and the weapon materials are painted by
  `weaponCoat3d.construirePeintureArme` against the weapons library.
- `weaponCoat3d.ts` reuses `armorCoat3d.paintMaterials` on the weapons library's table and coating
  files, without a visor. Fallbacks are named and reported once to the console (`reportArme`):
  table unreadable (all neutral), coating absent from the library (per-list default style), list
  not named by the coating, list unknown to the table (neutral), missing gradient image (neutral
  gradient), plus `armorCoating3d`'s own.
- Self-lit paint: a swatch's `emissive` amount lights its zone (zone color x amount), blended by the
  zone's mask like the other properties (`armorMaterial3d`). The Shock Rifle's coil is lit this
  way and by nothing else: material c56eb325 (layered shader, no self-light of its own) names
  intention 46ec02bd on its seventh zone (mask 1 blue), which the default style 328bf027 resolves
  through the common region to a blue swatch at emission 6; its mask is a soft 0.1 to 0.8 falloff
  per coil turn (`internal/spartanpieces/shockcoil_gamefiles_test.go`). A coating whose style does
  not name 46ec02bd falls to the global layer (grey, emission 1.5) and the coil barely glows.

## What is missing

- Weapon cores whose equipped theme is not in the GameCMS cache, or whose weapon name the tables
  do not know, are left out of `weapon_coatings` (logged once); their weapons wear the default
  style of each of their style lists, not the player's coating.
- Weapons the game gives no core (the Fuel Rod, the Skewer, the Energy Sword: no customization
  carries one) never have a `weapon_coatings` entry; the view paints them with the default style
  of each list (`weaponCoat3d.construirePeintureArme` with no style key), which is the weapon's own
  look in the game (the Standard Issue coating picks the same styles).
- An empty `style_key` (coating file absent from the gamecms cache, unreadable, or naming no style)
  paints the model with those same default styles; the match data itself is unchanged.
- Energy fields (the Energy Sword's blade: alpha blended, untextured, not glass; its shader's
  parameters are read by neither the reader nor Ekur) are drawn as a self-lit additive field
  (`energyField3d.ts`) lit in the brightest emissive swatch of the weapon's own paint (the sword's
  default style: blue, emission 16). Unpainted (ground models, no coating table), they keep the
  GLB's tint.
- Weapons on the ground (pads, drops) are drawn from the raw model and never painted.
- A weapons library built without an Ekur reference has no `coatings.json`: every weapon material
  falls back neutral (`coatings_unavailable`, named in the report).
- Weapon materials without raw masks (no `userData.armorMaps` after load) are not painted.
- First-person coating covers only the followed player's rig; other players are third person only.
- No visor for weapons (visor painting is armor-only).
