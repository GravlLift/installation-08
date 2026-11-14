# To do

Two lists. **Migration** is the work that still stands between this app and a full port of
the reference replay page. **After migration** is the owner's queue, in order, for work that
only makes sense once the migration is done. Parity gaps that are already tracked per mode
are in [PARITY.md](PARITY.md).

## Migration (still open)

- Film export: not checked since the UI redesign (the transport bar itself is done).
- English translation pass of the lifted French comments and strings.
- Installer: the release package builds (`tools\package.ps1`); the installer path is unchecked.

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
2. Announcer (the in-game voice calls). DONE: lines repacked from the installed game in
   pure Go. Objective calls (flag, bomb, hill) not yet checked in a match.
3. Equipment animations and effects. DONE for grapple, repulsor and shroud screen. Thruster
   and drop wall are built but not yet seen on screen (no stored match has a drop wall);
   the shroud has no ground band, no animation, and an opaque inside view.
4. Weapon pads (new): the pads the game places should render as pads.
5. Red reticle (new): the hit reticle should turn red on a valid target. DONE: fixed red,
   per-weapon range from the weapon tags. The zoomed range (unscoped times magnification)
   is inferred.
6. Two ground pads that should not render: object #214, type -877512201, materials
   `mat_b3dcd79c`, shader `6eb5a1b6`.
7. Map builder: zero-color gradient layers (shaders `47b5f7e5`, `2aaf6012`, `377bfad9`,
   `ff2a209d`). Fixing these also lets the glass workaround go.
8. CTF flags are a primitive pole and triangle (same as in the reference); they should use
   the game's flag model and stand.

## Viewer UI (open)

- 2D view: floors above the followed player are cut away entirely (players there float over
  black; draw other floors faintly), skylight patches are overexposed, the map sits under
  the header and the control bar, and there is no corner minimap yet.
- The HUD's bottom strip (score, kill feed, ammo) sits under the control bar while the bar
  shows. The player publishes its safe insets (`--bc-chrome-top`, `--bc-chrome-bottom`);
  only the HUD's shield reads them so far, the bottom strip and the 2D map's framing do not.
- Film export of a whole match with sound stayed in "Preparing" for over six minutes on
  2026-11-14 (a 52 s range without sound encodes at once). The offline mix renders the
  whole range, likely once per sound family; Cancel takes effect only once the mix ends.
  Missing: progress for the mix, or a mix that can be interrupted.
- Fullscreen could not be checked by browser automation (Chrome refused the request from
  a synthetic click); the button label and the layout inside the player are tested only
  in unit tests and by code reading.
- Home screen: Settings and Quit rows, gamepad input, live 3D backdrops.

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
