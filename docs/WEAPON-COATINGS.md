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
- one `coating-<style>.json` per style list the weapon materials name;
- one `swatch-<gradient>.png` per gradient image.

`index.json` carries the coatings section. Without an Ekur reference the build warns
("weapon library without coatings: no ekur reference") and the weapons keep their neutral paint.

## Route

- `GET /api/weapons/...` (`serve_weapons.go`) serves the weapon library: model GLBs, `index.json`,
  and the coating files (`weapons.CoatingFile`: `coatings.json`, `coating-[0-9a-f]{8}.json`,
  `swatch-[0-9a-f]{8}.png`) with the spartanpieces content types.
- `GET /api/matches/{id}/spartans` (`serve_spartans.go`) extends each player with
  `weapon_coatings`: one entry per equipped weapon core, in API order, each with
  `core_id`, `model_key` (`weapons.CoreKey` of the core's inventory path) and `style_key` (the
  coating GameCMS file's `StyleID`, as a hex identifier). A core whose coating file was not read, or
  that names no style, keeps its model key with an empty style; a core with no weapon model key is
  skipped; no equipped core gives nil.

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

## What is missing

- Weapon cores whose inventory path names no model key in the weapons library index are skipped;
  their weapons stay neutral.
- An empty `style_key` (coating file absent from the gamecms cache, unreadable, or naming no style)
  paints the model neutral; the match data itself is unchanged.
- A weapons library built without an Ekur reference has no `coatings.json`: every weapon material
  falls back neutral (`coatings_unavailable`, named in the report).
- Weapon materials without raw masks (no `userData.armorMaps` after load) are not painted.
- First-person coating covers only the followed player's rig; other players are third person only.
- No visor for weapons (visor painting is armor-only).
