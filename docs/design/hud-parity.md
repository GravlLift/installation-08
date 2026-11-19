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
- Small button glyphs (LB / RB) sit above the grenade and equipment boxes in the game.

## Bottom center: score and clock

- Present today: both team bars with their scores and the clock.
- Missing: the gradient effect behind the center, and the team emblems (the eagle at the left
  end, the cobra at the right).

## Top center: shield and damage

- Present today: the shield bar.
- Missing: the red damage indicator above the shield (the red glow and band over the shield frame
  in both frames).
- Missing: the directional damage arc around the reticle. It is a red arc pointing toward where
  the player was hit from (the arc left of the reticle in frame 2).

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

**Phase 1: the weapon corner (data is ready, UI only).**
1. Weapon in hand and weapon away: the away weapon's icon goes small and dimmed at the left of the
   upper row, the in-hand row keeps mag | reserve and its icon. Both read the loadout row, so a swap
   trades them on the selector flip.
2. Weapon name tag: shown under the in-hand row on each change of the weapon in hand (by
   `drawnWeapons`, and by a pickup that replaces the weapon in hand), naming the weapon taken out,
   fading out over 2 s. A seek does not replay it: only a change crossed while playing shows it.
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
6. The red damage indicator above the shield: drawn on damage taken and from the `hp` health
   reading. Its exact look and rule must come from the game's HUD tags (to research before
   building, not tuned by eye).

**Phase 3: game art (extraction work first).**
7. Score bar: the center gradient and the team emblems, extracted from the game's HUD bitmaps
   through the weapon-icon pipeline, gitignored and served.
8. Game font: find the HUD typeface in the install, extract it to the gitignored data folder, and
   serve it as a web font, with Bahnschrift as the fallback. Then the kill feed, the medals and
   the corner all use it.

**Phase 4: pings (decoder research, open-ended).**
9. Find out whether the film carries pings at all. The only lead is the unexported `managed-navpoint`
   object grammar. If the film carries them, decode them, then add feed rows ("Enemy at
   <callout>") and in-world markers.
