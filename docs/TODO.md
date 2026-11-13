# To do

Open work that is not a parity gap with the LevelUp replay page (those are in
[PARITY.md](PARITY.md)). One line per item; remove a line when it is done.

## Map file weight

- Compressed textures in the map files (GPU-compressed, for example KTX2/Basis). Most of
  each file is texture data; files are 600 to 900 MB today.
- A lower-detail build option: smaller textures and coarser geometry for weaker machines.
- Live Fire: check whether the three extra structures its scenario names are ever visible.
  They add 266 MB (617 MB to 883 MB). Drop or thin them by a general rule if they are not.

## Map fidelity

- Terrain: blend the terrain's material layers (Live Fire should be mostly grass) and
  honor its hole mask.
- Cut-out materials: a material that declares a cut-out mask is drawn textured and
  alpha-cut whatever its blend field says (Streets palm trunks and fronds are ghosts).
- Aquarius table sides: one material shows yellow or blue depending on the side.
- Stronger light and shadow contrast, closer to the game.

## Not yet ported from LevelUp

- Armor coatings and armor accessories.
- Per-weapon reload and fire animation selection.
- Whole-library builds (all weapons, all armor pieces in one run).
- Fetching films from the Halo API (sign-in and download).

## Decoder

- Rebase the vendored film decoder onto upstream v1.3.4 and renumber our schema steps
  after its 113.
- Offer our decoder changes upstream as pull requests, smallest first (shot aim fix, then
  the control-view reader for crouch, slide and jump).

## Housekeeping

- Translate the lifted scene code's French comments and names to English.
- Packaging and an installer.
