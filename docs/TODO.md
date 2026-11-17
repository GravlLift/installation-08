# To do

Two lists. **Migration** is the work that still stands between this app and a full port of
the reference replay page. **After migration** is the owner's queue, in order, for work that
only makes sense once the migration is done. Parity gaps that are already tracked per mode
are in [PARITY.md](PARITY.md).

## Migration (still open)

- Film export: not checked since the UI redesign (the transport bar itself is done).
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

1. Reload sounds are inconsistent between weapons. DONE: every weapon's reload is extracted
   from the installed game, timed by its reload animation, cancelled with the reload, and
   brought to one level. Not yet heard in a match; the level target is a measured guess.
   Shell-loading weapons (Cindershot, Heatwave, Hydra) play one loading step per reload
   action, whatever the number of shells; the battery weapons' vent is silent.
2. Announcer (the in-game voice calls). DONE: lines repacked from the installed game in
   pure Go. Objective calls (flag, bomb, hill) not yet checked in a match.
3. Equipment animations and effects. DONE for grapple, repulsor and shroud screen. Thruster
   and drop wall are built but not yet seen on screen (no stored match has a drop wall);
   the shroud has no ground band, no animation, and an opaque inside view.
4. Weapon pads (new): the pads the game places should render as pads. DONE: the variant
   layer draws each pad's Forge kit (weapon, power-up, equipment and grenade pads, wall
   rack); the viewer's stand-in disc is gone. Pad state stays the film's (full, uncertain,
   empty weapon). Not done: the pad's hologram while a weapon is incoming and the glow color
   per state (kit properties `previewAsHologramFull`, `itemShouldRotateFull`).
5. Red reticle (new): the hit reticle should turn red on a valid target. DONE: fixed red,
   per-weapon range from the weapon tags. The zoomed range (unscoped times magnification)
   is inferred.
6. Two ground pads that should not render: object #214, type -877512201, materials
   `mat_b3dcd79c`, shader `6eb5a1b6`. DONE: they are mode zone markers (Land Grab here);
   the variant layer now keeps only objects the match's mode includes. Stored variants need
   a rebuild to pick it up.
7. Map builder: zero-color gradient layers (shaders `47b5f7e5`, `2aaf6012`, `377bfad9`,
   `ff2a209d`). Fixing these also lets the glass workaround go.
8. CTF flags are a primitive pole and triangle (same as in the reference); they should use
   the game's flag model and stand. DONE for the model (weap `2a392328`): on its stand at
   home, in hand in third and first person, upright where it was dropped. DONE for the team
   banner: the per-team effects the flag attaches (one per team permutation) are single
   long-lived particle quads; the viewer draws their cloth (first image of the waving sheet)
   and the team's emblem layer, statically. The effects' color is a white constant and the game
   applies the team color at runtime, so the cloth takes the viewer's side ink for the flag's
   team (the emblem stays white). Not done: the banner
   on the first-person rig (the rig is a separate model with no marker read for it), the
   cloth flutter (flipbook rate not read), the remaining effect layers (glow strips, grids,
   lens and light), and the dropped flag's tilt (the film carries no rotation for it).

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

## App window and load speed (owner's queue, 2026-11-17)

- Window shell: DONE for the menu bar, version resource, remembered placement, F11, Ctrl+R,
  the export close guard, and per-monitor DPI awareness (fix/window-dpi, 2026-11-17: go-webview2
  crashed WebView2 controller creation under any DPI-aware state with no small fix found in its
  vtable/callback code; switched the window to webview/webview_go, vendored in
  third_party/webview_go with one local change to honor the app's fixed WEBVIEW2_USER_DATA_FOLDER;
  app.manifest now declares dpiAwareness PerMonitorV2, embedded into packaged builds by
  tools/package.ps1). The switch exposed a pre-existing bug, present since the menu bar's first
  commit under either binding: `gwlWndProc` was `^uintptr(23)` (-24, not a real GWL/GWLP index),
  so the menu/close-save subclass was never actually installed — every menu click did nothing,
  and the placement was never saved on close. Fixed to `^uintptr(3)` (-4, the real
  GWL_WNDPROC/GWLP_WNDPROC), with the previously-ignored SetWindowLongPtrW/GetWindowLongPtrW
  failures now logged. Also DONE: the default window size (no remembered placement) is now the
  client area at exactly 16:9 (1600x900 DIPs scaled to the monitor's DPI, outer size via
  AdjustWindowRectExForDpi including the menu, shrunk keeping 16:9 and centered if it would not
  fit the work area), and a remembered placement now carries the DPI it was captured at, rescaled
  on restore if the target monitor's DPI differs. DONE 2026-11-17: the display name is
  Installation 08 with its icon (exe, title bar, taskbar, favicon); the exe name, repo and data
  folder keep the old name.
- Serve the viewer's files to the window in-process (WebView2 resource interception) instead
  of over HTTP, measured against HTTP.
- Compiled shaders: they persist across launches in the window's fixed profile with the
  webview_go window (measured 2026-11-17: `Default\GPUCache` grew 544 KB to 7.8 MB in one
  session and kept growing over two real restarts; Streets loaded in 39.5 s on the first
  launch, about 20 s on each later one). The earlier 544 KB reading came from the go-webview2
  builds and did not reproduce. Open: the first-launch Streets load in the window (39.5 s) is
  about twice Chrome's cold load; not yet explained.
- DONE: one renderer and a capped session cache (1.5 GB) keep the map, variant layer and
  model libraries between matches. Measured 2026-11-17: a revisited Outlook loads in 5.6 to
  7.2 s (11 s cold), a revisited Streets in 7.1 to 8.4 s (18 to 20 s cold). Open: what remains
  is per-match work, mostly transcoding this match's armor and weapon textures (322 KTX2
  transcodes on Streets) and the warmup for its players; caching decoded armor and weapon
  textures across matches is the next gain. The armor and weapon library entries count 0
  bytes against the cap.
- DONE: each map's and variant's collision index is saved beside its build on first open
  (`.bvh` sidecar) and loaded after that: Streets 71 ms instead of about 1.9 s. Still open:
  merging a map's small static pieces at build time (Streets has about 2,000).
- Update checker (GitHub releases), once the repo is public.

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

## Final pass (do last, after everything above)

- English translation of every French comment, identifier, log line, test name and
  user-facing string, across `cmd/`, `internal/`, `web/` and the vendored `third_party/`
  code we changed (the upstream text itself stays as shipped). Do it last: agents keep
  adding French while they work in lifted code, so an earlier pass would not hold. Finish
  with a repo-wide search for French words and accented letters that comes back empty
  outside upstream files.
