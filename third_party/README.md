# Upstream modules

The source files below are as of 2026-11-13, with the documented changes noted per module. Each retains its own `go.mod`, license and notices. The listed h1 values are the Go module zip hashes, before the documented omissions. To compare against a future tag, download its module zip with `go mod download`, extract it outside this repository, and compare its module directory with the matching directory here, accounting for these omissions.

| Directory | Upstream | Version | Zip hash | License |
| --- | --- | --- | --- | --- |
| film-decoder | https://github.com/JGtm/halo-infinite-film-decoder | v1.3.6 | `h1:CP7zIqapzMcHHam2aKBMsXAsaNgJCzjTWk27petIpxc=` | AGPL-3.0 |
| map-images | https://github.com/JGtm/halo-infinite-map-images | v1.0.1 | `h1:Op1TrnECQKrCxOjWkI2Cb9WGf+S5nOikyap5eGZdPA=` | AGPL-3.0 |
| files-reader | https://github.com/JGtm/halo-infinite-files-reader | v1.0.1 | `h1:sqD4leKw4x9yC+JdXWAVHOio6LOqF+VzKgcWZ5SL688=` | AGPL-3.0; `ooz` GPL-3.0 |

`files-reader/ooz` uses cgo and requires a C/C++ toolchain.

`ww2ogg/` holds no code: only the license text and the notice of ww2ogg by hcs
(https://github.com/hcs64/ww2ogg, commit `14ed9b0`, BSD-3-Clause style), which
`internal/wwvorbis` ports to Go to repack the announcer's Wwise Vorbis voice lines into Ogg,
and whose aoTuV packed codebook library it embeds unmodified. See
[ww2ogg/NOTICE.md](ww2ogg/NOTICE.md).

## Changes from upstream v1.3.6 (film-decoder)

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

These two modules are modified copies. The changes come from the LevelUp 3D replay work
(three-way merge against the LevelUp fork point, no conflicts):

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
    its export. Decal modes (19, 23, 68, 69) and alpha-blended materials with layers keep the
    opaque layered drawing they had, and the GLB writes `melange` 0 for them; on Aquarius only
    the `diffuse_emissive` glow materials change. Covered by `himap/materiaux_melange_test.go` (new).
  - `himap/emissif.go`, `himap/materiaux.go`, `himap/textures_monde.go`, `himap/glb.go`,
    `himap/glb_couches.go` (LOCAL-CHANGE): `diffuse_emissive` materials carry their
    self-illumination texture (slot 244, from Ekur) as the glTF `emissiveTexture` on the color
    map's coordinates, so the light shows only where the game masks it (the pads' thin strips).
    A texture absent from the modules (an engine default) leaves the light uniform. Covered by
    `himap/emissif_texture_test.go` (new).
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
    Covered by `himap/styles_forge_test.go`, `representation_test.go` (modified),
    `styles_forge_gamefiles_test.go` (new) and `representation_gamefiles_test.go` (modified).
  - `files-reader/mapvar/mapvar.go` (LOCAL-CHANGE): `Variant.Lighting` reads the variant's
    "Lights & Atmosphere" options at root[1][39]: field 0 the Sunlight intensity (Recharge: 9,
    its scenario sun's; Fortress: 25 over its canvas's 5), field 1 the Sunlight color override
    (a Forge globals color index) and field 18 its switch (1 on, inferred from the maps that
    carry a warm sun color there). Covered by `mapvar/lighting_test.go` (new).
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

Tests: `map-images` passes. `files-reader/hinavmesh` fails before and after the merge
because its game-derived fixtures are not shipped here.
