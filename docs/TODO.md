# To do

Two lists. **Migration** is the work that still stands between this app and a full port of
the reference replay page. **After migration** is the owner's queue, in order, for work that
only makes sense once the migration is done. Parity gaps that are already tracked per mode
are in [PARITY.md](PARITY.md).

## Migration (still open)

- Real scoreboard: the context route serves the scoreboard rows and the match header shows
  the score; the on-screen scoreboard component is removed and not yet re-added (`d53ab5d`).
- Transport bar: match time in the transport, film export, and the 16:9 player frame with
  the fullscreen button (in progress).
- Weapon coatings on screen (in progress; pipeline in [WEAPON-COATINGS.md](WEAPON-COATINGS.md)).
- English translation pass of the lifted French comments and strings.
- Packaging and an installer.

## After migration (owner's queue, in this order)

1. Reload sounds are inconsistent between weapons.
2. Announcer (the in-game voice calls).
3. Equipment animations and effects.
4. Weapon pads (new): the pads the game places should render as pads.
5. Red reticle (new): the hit reticle should turn red on a valid target.
6. Two ground pads that should not render: object #214, type -877512201, materials
   `mat_b3dcd79c`, shader `6eb5a1b6`.
7. Map builder: zero-color gradient layers (shaders `47b5f7e5`, `2aaf6012`, `377bfad9`,
   `ff2a209d`). Fixing these also lets the glass workaround go.
8. CTF flags are a primitive pole and triangle (same as in the reference); they should use
   the game's flag model and stand.

## Parked until the migration is done

Visual work that waits for the migration to finish (do not restart before it): Live Fire
grass, palms, Aquarius table sides, lighting. Also parked: compressed textures and a
lower-detail map build (the map GLBs are 600 to 900 MB today, mostly texture data), and
checking whether Live Fire's three extra structures are ever visible (they add 266 MB).
