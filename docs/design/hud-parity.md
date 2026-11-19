# In-view HUD parity with the game

What the game's in-view HUD shows, compared with what the viewer draws today. Source: owner's
notes of 2026-11-18 on two consecutive frames of a first-person Halo Infinite clip (Live Fire,
TOP NEST), the second taken just after the player swapped weapons. The screenshots are local
reference only, gitignored: `data/reference/hud/infinite-hud-weapons-killfeed.png` and
`data/reference/hud/infinite-hud-after-weapon-swap.png`.

## Bottom-right weapon corner

- The player carries two weapons, and neither one is primary. The large bottom-right slot holds the
  weapon **in hand**: the magazine count, a divider, the reserve count, then the weapon's icon.
  The weapon **away** sits small and dimmed above it, at the left of the row. When the player swaps,
  the two trade places (frame 1: Bandit Evo in hand and the sniper away; frame 2: the S7 Sniper
  in hand and the Bandit away).
  - Today: only the weapon in hand is drawn. The weapon away is missing.
- **The weapon name tag** under the in-hand row (for example "BANDIT EVO" or "S7 SNIPER", shown with
  the weapon's small glyph) appears only when the weapon in hand changes. It names the weapon
  just taken out and fades out over about 2 seconds.
  - Today: missing.
- **Grenade slot**: one grenade type is active at a time, like the weapon in hand, and the player
  swaps to use another. The slot shows the active type's icon and its count, with a small
  badge.
  - Today: wrong. The viewer draws one box per grenade type side by side.
- **Equipment** is the rightmost small box on that row, right of the grenade slot.
  - Today: drawn left of the grenades.
- Small button glyphs (LB / RB) sit above the grenade and equipment boxes in the game. The viewer
  leaves them out on purpose (owner's call): they are controller prompts.

## Bottom center: score and clock

- Present today: both team bars with their scores and the clock.
- Missing: the gradient effect behind the center, and the team emblems (the eagle at the left
  end, the cobra at the right).
- Since 2026-11-19 (owner's call on "the gradient": the bar's brighter middle band): each bar's
  body is a dim team color with a brighter band through its middle (`model/scoreBarBand.ts`),
  the band's place measured in the item screen's bitmap 8bec9da9 (alpha 255 in rows 27..36 of
  the 12..51 body), its brightness measured on the owner's frames. The emblems take their
  team's color, as the owner's frames show (the item screen sets no color, so the tint comes
  from its parent).
- Found 2026-11-19: the center scoreboard screen (`cusc` fb8c6614) references only four bitmaps
  (0041107b and f09bdfde, 36x36 BC7 declared; 128bc424, 800x64; ddcfa2a6, 1x1) and no emblem;
  its property names include no emblem or team icon either. The emblems are bound at run time
  from somewhere else (not found yet). 128bc424 owns resources 11602 to 11604; 11604 (409600
  bytes) decodes as BC7 1600x256 into a blue-to-cyan striped bar with rounded corners, likely
  the score meter's ramp (inferred; the declared 800x64 does not match its storage).
- Found later on 2026-11-19 (corrects the line above): the emblems are bitmap `7df5eede`, nine
  64x64 BC7 resources owned by its `pc` entry, white on transparent: 0 eagle, 1 cobra, then seven
  more team emblems. They are drawn by the score bar ITEM screen (`cusc` 21a7dab4,
  `scorebaritem`), not by the center scoreboard, with `prop_sprite_frame` bound to `teamindex`
  (so resource k = team index, inferred from the eagle/cobra order). The item (confirmed from
  the dump): a 390x50 stacked layout; a 256-wide meter area over a 430x39 gray polygon at 0.65
  opacity, filled by three two-tone gradient quads of bitmap `8bec9da9` (256x64, pixels inline,
  a red-to-magenta channel-packed ramp, inferred); then a 44x40 emblem slot (margin left 2,
  right 40) holding the 62x62 emblem, right-aligned with margin right -27, opacity 0.7, untinted
  (tint blend alpha 0). Mode-7 BC7 blocks need the next mip as a witness (`mipGuide`), or they
  decode as gray squares. Built into the HUD set as `TeamEmblem0.png` .. `TeamEmblem8.png`.

## Top center: shield and damage

- Present today: the shield bar.
- Present since 2026-11-19: the red empty-shield alert (the glow over the frame, the bar's red
  outline, the break burst) and the orange health strip inside the bar. See Plan item 6.
- Present since 2026-11-19: the full-screen team-colored flood when the shield breaks, first
  person only (`model/shieldFlood.ts`). Traced in the tags: the Spartan model `hlmt` 09ab2219's
  shield section's instant response plays `effe` 85659616, whose screen effect `sefc` 8c2ba62e
  has three first-person layers: "flash" (0.35 s, exposure boost 2, team-color filter), "grid"
  (0.5 s, team-color filter and a shader material, not drawn) and "blur" (0.2 s radial blur, not
  drawn), each fading on a cubic stored in the tag. Inferred: the response is the depletion, the
  filter is a multiply by lerp(white, team color, strength), the exposure boost is in stops.
- Present since 2026-11-19: the directional damage arc around the reticle, a red arc pointing
  toward where the player was hit from (the arc left of the reticle in frame 2). See Plan item 5.

- Since 2026-11-19 the bar carries the shield screen's bloom (`uibloom`, `model/shieldBloom.ts`):
  ambient 0.35, highlight 3 above 0.3, layers 0.5 / 0.35 / 0.2, global 0.8, from 1.5 to 0.8 over
  2633 ms after a refill (confirmed from the dump). Inferred: the curve, Gaussian layers, their
  sizes (4 / 12 / 32 quad units), the linear fall, and summing in linear light. The tint names the
  undecoded `hud_wires` color and is not applied. It is the only HUD screen with a bloom widget
  (the other two `uieffectbloom` users are menus).

## Aim and weapon corner brightness (2026-11-19)

Measured on the owner's 1450x819 capture of the Bandit Evo at 1.6x and the saved reference
frames. The Bandit overlay (`ReplayHudScope3d` `Bandit`) is redrawn from the capture: the shade
outside the window is 0.7 (the scene keeps 0.3 of its light), the blue housing has thick corner
pieces and a thin edge, three light bars run outside, the MAG/AMMO tabs are filled, and the reticle
is a ring with four arcs on the diagonals. The weapon corner's inks are measured: the magazine
count is #e8f8ff, and the reserve and icon are #c7ebfa, at full opacity. The hip reticle gets the
dark halo the ADS reticles have. The CUI has a `weaponsightdc` / `weaponzoomdc` screen family not
yet read, which may hold the overlays themselves.

## Left: kill feed and pings

- Present today: the kill feed. Since 2026-11-19 it hangs from 52.4% of the height and grows down,
  newest last (`KILL_FEED_TOP_SHARE`): the feed screen aligns its list to the top, its rows are 45
  plus 6 + 6 margins on the 2160 reference (2.6% pitch, matching ours), and the start is measured
  on the two reference frames.
- Missing: pings, which the kill feed shows as rows such as "Enemy at Engine" and "Enemy at Catwalk", with
  the pinging player's name and a ping glyph. The followed player's own rows are highlighted.
- Wrong: the font.

## Medal popup

- Present today, close to the game ("100", then the medal names stacked with their icons, and a
  "Killed <name>" tag).
- Wrong: the font.

## Bottom left: location name

- Present today ("TOP NEST").

## Fonts

The font is wrong across the kill feed, medals and HUD text. The game's HUD typeface needs to
come from the installed game (the same rule as icons: game data only, nothing invented).

**Found 2026-11-19: the fonts are whole TrueType files in the module's resources.** Each of the
104 `font` tags in `any/globals/globals-rtx-new.module` (508 bytes, no glyphs of its own) points by
its entry's resource index (+0x10) to one resource whose ucsh data, after the 180-byte header and
24 bytes of padding, is a complete TrueType file (sfnt 0x00010000, 19 tables, `glyf` outlines).
Confirmed by extracting all 104 and reading their `name` tables (probe `data/probe/resprobe fonts`,
output gitignored). The Latin faces: Normative Pro (Light, Regular, Medium, Bold, with italics),
Normative Lt (Thin to Bold), Industry (Thin, Light, Book, Medium, Demi, Bold), Baksheesh (Thin,
Regular, Bold, and a "Gamertag" cut) and Consolas; the other tags merge a Latin face with a CJK
or other fallback (for example "Normative Pro+Malgun Gothic"). `maps/fonts/font_package.bin` is
not the HUD's: its 7 fonts are the pre-rendered `fixedsys-9` and six `subtitle` sizes.

Which face each HUD text uses, from the CUI screens (`prop_font_name`, `prop_text_font_weight`,
`prop_text_font_size`, sizes on the 2160-row reference):
- The center scoreboard (`cusc` fb8c6614, `centerscoreboarddc`, the score and clock) names
  Industry, weights 600 and 400. Confirmed.
- The kill feed (`eventfeeddc`, 49050c80) sets size 36 and the medal feed
  (`medalfeedandscorecombofeeddc`, c3e4d873) size 64, with no font name: they take the default
  face. The default is inferred to be Normative Pro (the `fntf` registry lists it first, and the
  photo mode screens name it explicitly); the registry's default field is not decoded.
- Only 22 text properties in all 602 screens name a font at all; the rest use the default.

## What the replay document carries (checked 2026-11-18)

| Item | Data | Where |
| --- | --- | --- |
| Weapon away | yes: the loadout row holds both weapon ids, `inventory.am[0..1]` holds both slots' ammo, `ammoReads.w` tracks per slot | `weaponInHand.ts:51`, `rosterLogic.ts` (`weapons`), `hud3d_logic.ts` (`trackAmmo`) |
| Swap moment | yes: `drawnWeapons` dates each selector flip, `weaponChanges` dates pickups and drops | `document_actions_joueur.go:19` |
| Active grenade | yes: the game's selector (component `i47`) as `inventory.gs`, resolved by `selectedGrenadeFrom` | `inventoryReading.ts:342` |
| Damage taken | partly: `damages[]` = `{t, slot (victim), by? (attacker), src? (jpt! source)}`, with no amount and no position | `document_actions_joueur.go:35` |
| Health under the shield | yes: track points carry `hp` beside `sh` | `rosterLogic.ts` (`PlayerState.health`) |
| Pings | no: nothing in the decoder or the document names a ping | |
| Team emblems | not extracted yet. The weapon icon pipeline (module archive, BC7, PNG, served) is the way to add them | `internal/weaponicons/doc.go` |
| Game font | not extracted. The HUD uses Bahnschrift, a Windows system font | `web/src/index.css:103`, `docs/UI-DESIGN.md` |

## Plan

The video export draws the same HUD (`export/exportHud.ts`), so each phase updates it too.

**Phase 1: the weapon corner (data is ready, UI only).** Live HUD done 2026-11-18 (`readHud`'s
`away`, `grenade`, `nameTag`; `weaponAway` and `handChangeAt` in `weaponInHand.ts`), checked in the
viewer on Live Fire 07157ce5 (pickup at frame 3458, swaps in life 596). Export done the same
day (`exportHud.ts` paints the same corner, equipment included), checked on painted frames
12900 to 12960 of that film.
1. Weapon in hand and weapon away: the away weapon's icon goes small and dimmed at the left of the
   upper row, the in-hand row keeps mag | reserve and its icon. Both read the loadout row, so a swap
   trades them on the selector flip.
2. Weapon name tag: shown under the in-hand row on each change of the weapon in hand (by
   `drawnWeapons`, and by a pickup that replaces the weapon in hand), naming the weapon taken out,
   fading out over 2 s. It is a function of the frame, so the export draws it too and a seek just
   after a swap shows it partly faded, as the game showed it at that moment. Not at spawn.
3. Grenade slot: one box with the selected type's icon and its count (`gs`). When the selection
   is indeterminate, it falls back to the only type carried, and to frag otherwise.
4. Equipment moves to the right of the grenade slot.

**Phase 2: damage (derived from data the document has).**
5. Directional damage arc around the reticle: for each `damages` entry where the followed player is
   the victim and `by` names another player, the bearing from the victim to the attacker's track
   position at that frame, taken relative to the victim's facing, drawn as a red arc that fades.
   Limits stated up front: there is no arc when the attacker is unknown, for self damage, or for falls. A
   grenade or splash hit points at the thrower and not at the blast. All hits look the same
   strength, because the document has no damage amount.
   Model done 2026-11-18: `damageArcsAt` in `model/damageArcs.ts` (bearing, age and attacker per
   live arc, one arc per attacker; `readHud` returns it as `damageArcs`).
   Drawn 2026-11-19 (live HUD and video export, `ui/damageArcPaint.ts`) with the game's art,
   geometry, reveal ramp, hit pulse and the 8-arc cap (see "The HUD's own data, decoded" below).
   Inferred, not measured: the 2 s lifetime is the `uihg` "damage indicator response duration";
   an attacker's hits less than 2 s apart form one arc; the meter (how much of the arc shows) is
   the vitality, (shield + health) / 2, the chain's hits took off, a life with no reading yet
   counting as full; the fade is linear. Checked in the viewer at frames 2400, 4899 and 11000.
6. The red damage indicator above the shield: drawn on damage taken and from the `hp` health
   reading. Its exact look and rule must come from the game's HUD tags (to research before
   building, not tuned by eye).
   Done 2026-11-19 (`model/shieldAlert.ts`, `ShieldBar3d`, the export through
   `ui/shieldAlertPaint.ts`) from the shield screen's glow (f47d743f), burst (7139ad8e) and health
   (30099cc7) bitmaps, built into the HUD set as `ShieldGlow.png`, `ShieldBurst.png` and
   `HealthBar.png`. Confirmed from the dump: the glow's two mirrored 1080x256 quads, tint
   (1, 0.224, 0.224), opacity 2, on while the shield is empty; the frame flash looping 0 -> 1 -> 0
   over 666 ms; the burst's 766 ms keyframes; the health strip's 800 width, shown when the shield
   is not full. Inferred and stated in `shieldAlert.ts`: the glow's vertical placement, drawing it
   fully lit (the game loops its meter value, whose effect on this bitmap is not settled), the
   flash drawn with the bar's own outline (its bitmap 6a4c867b streams), the burst's pivot and
   additive look, the strip's center drain and position. The strip's color rgb(240, 173, 66) is
   measured on the owner's frames because its named color (`hud_wires`) is not decoded. Checked in
   the viewer and on export frames 4878 to 4900.

**Phase 3: game art (extraction work first).**
7. Score bar: the center gradient and the team emblems, extracted from the game's HUD bitmaps
   through the weapon-icon pipeline, gitignored and served.
8. Game font: find the HUD typeface in the install, extract it to the gitignored data folder, and
   serve it as a web font, with Bahnschrift as the fallback. Then the kill feed, the medals and
   the corner all use it.

**Where the game keeps the HUD art (research, 2026-11-18).** A read-only scan of the Steam install
(`any/globals/globals-rtx-new.module` and the other readable modules, full tag-group census) by the
local worker; the probe and raw dumps stay in the gitignored `data/probe/`.
- No `chud` / `chdt` tag group exists. Infinite's HUD is data-driven UI: one `uigm` (d5acd3b9),
  62 `uiwi`, 738 `uslg` tags, whose body format no reader here decodes. The damage arc's geometry
  and lifetime and the red glow over the shield almost certainly live there (inferred). Decoding
  that format is the real cost behind items 5 (drawing), 6 and 7.
- Team emblems: not found in this first scan (the one `embl` tag, a47c83f7, is a property
  table). Found 2026-11-19 through the CUI screens: bitmap `7df5eede`, see "Bottom center".
- Font: found. 104 `font` tags plus the `fntf` registry (d35037d1) name the UI families: Normative
  Pro (Light to Bold, the primary family; inferred to be the HUD's), Industry, Baksheesh, Consolas.
  The glyphs are in `maps/fonts/font_package.bin` (344 KB, plus per-locale packages), a binary
  glyph format. The install has no ttf or otf file, and the BC7 icon reader does not apply.

**The HUD's own data, decoded (2026-11-19).** Infinite's HUD is CUI: `cusc` screen tags (602),
each a component tree with property values, bitmap references, keyframed animations, expressions
and data-context bindings, plus the `uihg` HUD globals (2 tags). `DumpTag` in
`internal/weaponicons/tagdump.go` walks any tag with a community layout plugin and checks every
block's live size against it. The layouts that match the installed game are Z-15's
Halo-Infinite-Tag-Editor `Tag_Structures` (March 2023): `uihg` 560 = 560 bytes, all 602 `cusc`
roots match (Gamergotten's December 2022 set is off by 256 and 16 bytes). Those layouts carry no
license, so they stay in the gitignored `data/probe/plugins/`, never in the repo. The probes are
`data/probe/uidump` (all `uihg` and `cusc`), `tagone` (one tag) and `bitminline` (a bitmap whose
BC7 pixels sit inside the tag, as the CUI bitmaps' do).
- `uihg` 0000397e (confirmed, every block and tag reference of the live root falls where the
  layout puts it): damage indicator response duration 2 s, shield bar recent damage duration 1 s,
  damage flash response duration 0.2 s, hit tick persist time 0.25 s. Also medal fanfare animation
  lifetime 2.5 s (in 0.25 s, out begins at 1.5 s), max medals on screen 5, medal score message
  lifetime 3 s, event feed lifetime 4.5 s. That the arc's lifetime is the "damage indicator response
  duration" is inferred from the name: the screen itself only sees a normalized lifetime.
- `cusc` 0583f411 is the directional damage indicator (`damageindicatordc`). Confirmed from the dump:
  a list of up to 8 `damageinstance` items in a 780x780 container on a 3840x2160 reference screen.
  Each item is rotated by the instance's `damagedegreeangle` and holds two 1024x512
  two-tone-gradient quads of bitmap `41d89be1`, pivoted at their bottom center. One is normal blend
  and one additive, the additive one starting at opacity 0. Bindings and animations:
  `normalizedaccumulateddamage` drives the quads' meter value from 0.15 to 1 over its range;
  `normalizedlifetimeduration` drives the item's opacity from 1 to 0. On spawn, the tint blend
  alpha goes from 0.5 to 0 in 100 ms, and the additive quad scales from 1 to 1.2 over 633 ms while
  its opacity goes from 0.5 to 0 over 300 ms.
- Bitmap `41d89be1` decodes (720x390, BC7, pixels inline after the tag's data): a red half ring,
  with blue varying along the arc. That blue is the ramp the meter value reveals: inferred from the
  two-tone meter widget, not yet confirmed.
- `cusc` 9299c419 is the shield bar (`shieldbardc`), read 2026-11-19 (line numbers are in the
  gitignored dump `data/probe/uidump/out/cusc/9299c419.txt`; summary beside it in
  `shield-screen-summary.md`). Confirmed from the dump:
  - `shield_chase` is the red band over the shield. It is a meter quad whose min and current values
    are bound to the live `shieldvitality` and whose max is bound to a number animator's output, so it
    covers the shield just lost, from the current fill up to a lagging value. It is drawn additively
    with tint ARGB (1, 1, 0.506, 0.506), a light red #FF8181, from bitmap `1a61d06e`, 940x64,
    whose pixels are not inside the tag (not decoded).
  - The animator (component 41af4bbd620acf4d) has initial value 1, animation mode 1, animation
    param 3 and animation start time 0.2 s. What mode 1 and param 3 mean is not in the tag. Reading
    them as "hold 0.2 s, then catch up within the 1 s recent-damage duration" is an inference.
  - `health_chase` is the same mechanism on `healthvitality`, additive, tint blend alpha 0.66. Its
    tint comes from a named color resource (0xed8d76c7), so the color stored in the tag is only a
    placeholder.
  - Shield full: the bloom's global intensity goes from 1.5 to 0.8 over 2633 ms. Shield empty
    (expression "a<=0 && b == 0"): a 766 ms burst scales a component 1 to 9 wide and 1 to 5 tall
    while it fades. Recharging: a bar sweeps across the meter every 666 ms, looping.
  - Nothing in the screen tints the shield fill itself red on a hit. The red comes from the chase
    band.
  - Drawn 2026-11-19 (`shieldChaseAt` in `model/shieldHud.ts`, `ShieldBar3d`, the export) as a flat
    #FF8181 band, additive, over our own bar; the game's chase bitmap is not decoded. Inferred:
    the band holds 0.2 s, then closes on the live value with a cubic ease-out, reaching it at 1 s.
    Checked in the viewer at frames 4878, 4888 (shield broken) and 4903. The health chase is not drawn:
    our bar shows no health, and its color comes from an undecoded named color resource.
  - Since 2026-11-19 the band draws the game's own chase bitmap (`ShieldChase.png`, built from tag
    1a61d06e, whose 940x64 b8g8r8a8 pixels are a resource in the `pc` variant), tinted
    rgb(255,129,129) at its own alpha, revealed by clipping to the band's x ranges (inferred
    equivalent of the bitmap's blue-ramp reveal, which is linear in x). The flat band remains the
    fallback when the image is not loaded.
  - Open gap, seen on export frames 4876 to 4895: the game's bar is shallower in the middle than at
    its ends, and the chase art covers only that upper region (rows 14 to 44 of 64 at the
    center). The mask (43cb4f34, 940x64, pixels inline in the `pc` tag) shows a separate lower
    strip there, likely the health display (inferred). Our hand-drawn fill covers the whole bar
    height, so the band sits in the top part of our fill. Matching it means shaping our fill
    like the game's shield quad (1a9b2c75, 940x80 BC7, whose resource is a 316-byte header with no
    pixels: not decoded yet).
  - Decoded 2026-11-19 (probe `data/probe/scoreart`, gitignored). A module entry's +0x10 is its
    FIRST resource index, and the entry owns the resources up to the next entry's +0x10
    (confirmed on the shield chase: 9957 to 9958, one resource, and the entry before it shares
    9957 and owns none). 1a9b2c75 owns 9958 (25600 bytes) and 9959 (76800 bytes); 9959 is mip 0
    as BC7 stored 960 wide: 240x20 blocks x 16 = 76800 exactly, and decoding it at 940 shears
    every row. At 960x80 it is the game's shield bar: hexagon pattern, angled ends, shallower in
    the middle than at the ends, transparent around the shape, the last 20 columns empty.
    Colors are magenta and red, so it is a channel-packed mask the material tints (inferred),
    not the final color. Why 940 is stored as 960 is not known (one sample).

**Phase 4: pings (decoder research, open-ended).**
9. Find out whether the film carries pings at all. The only lead is the unexported `managed-navpoint`
   object grammar. If the film carries them, decode them, then add feed rows ("Enemy at
   <callout>") and in-world markers.
   Census 2026-11-19 (Live Fire 07157ce5; patch and test kept in the gitignored
   `data/probe/pings/`, not applied to `third_party`): publishing ti=12's i0 sub-type, i8 group
   name, i9 text ids and i17 object marker through the navpoint hook. Of 115 keyframe records 114
   break before the end and 1 walks; of 616 delta records 567 walk. The 135 sub-type reads give
   113 distinct values that do not look like string ids (only one id, `name_text`, resolved), so
   the reads are misaligned or the records are not navpoints. Inconclusive: the film is not shown
   to carry pings, nor shown not to. Going further means fixing the ti=12 walk itself.
