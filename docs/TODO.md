# To do

Two lists. **Migration** is the work that still stands between this app and a full port of
the reference replay page. **After migration** is the owner's queue, in order, for work that
only makes sense once the migration is done. Parity gaps that are already tracked per mode
are in [PARITY.md](PARITY.md).

## Migration (still open)

- Transport bar: the full transport (the reference's `ReplayTransport`) and film export.
  The match-time readout, the 16:9 player and the fullscreen button are done.
- English translation pass of the lifted French comments and strings.
- Packaging and an installer.

## Other open work

- Map file weight: compressed textures (for example KTX2/Basis; files are 600 to 900 MB
  today, mostly texture data) and a lower-detail build option for weaker machines.
- Live Fire: check whether the three extra structures its scenario names are ever visible
  (they add 266 MB); drop or thin them by a general rule if not. They may be the distant
  vista: the game shows snowy mountains on Live Fire's horizon and the viewer shows none.
- Live Fire sky: the clouds barely read compared with the game (after the map materials).
- Map fidelity: terrain material-layer blending and its hole mask; cut-out materials drawn
  alpha-cut whatever their blend field says; the Aquarius table side color; stronger light
  and shadow contrast.
- Decoder upstreaming: the shot aim fix is open upstream; the control-view reader (crouch,
  slide, jump) is next.

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

## Ideas for later

- Programmed camera for film export: a timeline with automation lanes for the camera, so a
  user can direct a clip the game's theater never allowed. Lanes for camera keyframes with
  easing, built-in acrobatic moves (orbits, fly-bys, whip pans), target lock and switching
  between players, overlay and filter toggles, and kill effects. The export renders that
  directed camera view. Builds on the film export and the transport bar.

## Parked until the migration is done

Visual work that waits for the migration to finish (do not restart before it): Live Fire
grass, palms, Aquarius table sides, lighting. Also parked: compressed textures and a
lower-detail map build (the map GLBs are 600 to 900 MB today, mostly texture data), and
checking whether Live Fire's three extra structures are ever visible (they add 266 MB).
