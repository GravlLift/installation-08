# Known issues

What a user may notice at this release. See [docs/TODO.md](TODO.md) for the full
engineering backlog; this page keeps only the user-visible parts of it.

## Forge maps

Forge support is a work in progress.

- Weapon, power-up, equipment and grenade pads render the game's own pad kit, but a pad does
  not yet show the incoming-weapon hologram or the glow color for its current state.
- A few map surfaces (zero-color gradient layers on some shaders) still render as a plain
  color instead of their real gradient texture; the viewer's glass workaround covers some of
  these.
- Live Fire's horizon is missing the distant snowy mountains the game shows, and its clouds
  read flatter than in-game. It is unclear whether three of Live Fire's extra structures (266
  MB) are ever visible to a player; they have not yet been removed or thinned.
- Terrain material blending, its hole mask, and the Aquarius table's side color still don't
  match the game exactly, and light/shadow contrast is generally weaker than in-game.
- Map files are large: 600–900 MB per map, mostly texture data. There is no lower-detail
  build option yet.
- A stored match built before a recent fix may still show the old (incorrect) version of a
  map or variant; rebuilding it picks up the fix.

## Sounds

- Weapon reload sounds are extracted from your own game install and timed to each weapon's
  reload animation, but the loudness target across weapons is an estimated guess, not yet
  checked by ear in a real match. Shell-loading weapons (Cindershot, Heatwave, Hydra) play
  one loading sound per reload regardless of how many shells are loaded; the battery weapons'
  vent sound is silent.
- The announcer's objective calls (flag, bomb, hill) have not yet been checked in an actual
  match recording.

## Equipment and animations

- Grapple, repulsor and shroud screen are animated; thruster and drop wall are built but have
  not yet been seen on screen (no recorded match with a drop wall was available to check).
- The shroud screen has no ground band, no deploy/retract animation, and an opaque view from
  inside it.
- The capture-the-flag banner shows the flag's cloth and team emblem, but statically: it does
  not flutter, does not yet appear on the first-person carrying rig, and a dropped flag does
  not show its correct tilt (the match recording does not carry that data).

## Viewer

- The 2D map view cuts away floors above the followed player entirely (other players on
  those floors appear to float on black), overexposes skylight patches, sits partly under the
  header and control bar, and has no minimap yet.
- The HUD's bottom strip (score, kill feed, ammo) can sit under the control bar while the bar
  is showing; only the shield indicator currently avoids this.
- The home screen does not yet have Settings or Quit rows, gamepad input, or live 3D
  backdrops.
- Fullscreen could not be checked by automated browser testing (the browser refused the
  synthetic click); it is covered only by unit tests and code review, not by seeing it run.

## Coatings

- The button is offered only in the match viewer's top bar, not on the home screen.
- After a successful setup the coating libraries rebuild in the background; the open match
  keeps its neutral paint until it is reopened once they finish.

## Export

- Exporting a whole match with sound can sit in "Preparing" for several minutes; the longer
  mix does not report progress, and Cancel only takes effect once the mix finishes rather than
  immediately.
- Film export has not been rechecked since the transport bar's UI redesign, though the
  redesigned transport bar itself works.

## Packaging

- The packaged installer (`tools\package.ps1 -Installer`) builds, but the installed-app path
  has not been walked through end to end on a clean machine yet.
