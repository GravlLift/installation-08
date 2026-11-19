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

## Top center: shield and damage

- Present today: the shield bar.
- Missing: the red damage indicator above the shield (the red glow and band over the shield frame
  in both frames).
- Present since 2026-11-19: the directional damage arc around the reticle, a red arc pointing
  toward where the player was hit from (the arc left of the reticle in frame 2). See Plan item 5.

## Left: kill feed and pings

- Present today: the kill feed.
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
- Team emblems: not found. The one `embl` tag (a47c83f7) is a property table, not a bitmap
  atlas. Sampled UI tags reference no `bitm` tag directly.
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

**Phase 4: pings (decoder research, open-ended).**
9. Find out whether the film carries pings at all. The only lead is the unexported `managed-navpoint`
   object grammar. If the film carries them, decode them, then add feed rows ("Enemy at
   <callout>") and in-world markers.
