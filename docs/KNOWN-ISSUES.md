# Known issues

What a user may notice at this release. See [docs/TODO.md](TODO.md) for the full
engineering backlog; this page keeps only the user-visible parts of it.

## Forge maps

- Pads and racks show the item they hold, but not the incoming-weapon hologram, the refill
  timer bar, the glow color for their current state, or rack doors opening.
- Forge object colors follow the game's own styles. How a style's color and intensity blend
  with its material is our own rule (Ekur does not draw them), so a few pieces can read
  slightly paler or darker than in game. Scratches are not drawn yet. A few surfaces
  (zero-color gradient layers on some shaders) render as a plain color instead of their
  gradient texture.
- Live Fire's horizon is missing the distant snowy mountains the game shows, and its clouds
  read flatter than in-game. It is unclear whether three of Live Fire's extra structures (266
  MB) are ever visible to a player; they have not yet been removed or thinned.
- Terrain material blending, its hole mask, and the Aquarius table's side color still don't
  match the game exactly.
- Map files are large: up to about 850 MB per map at Standard and 1.4 GB at High (Streets),
  mostly texture data. The first build of a large map takes minutes (Streets: about 2 minutes
  Standard, 8 minutes High), and the first start after an update rebuilds the weapon and
  first-person libraries in the background.
- Origin: its surrounding hills draw snowy where the game shows brown rock and green hills.
- Signs, screens and holograms are lit but still: their scanlines, flicker and scrolling are
  not drawn. One Streets sign (BUENA) still draws nothing.
- A stored match built before a recent fix may still show the old (incorrect) version of a
  map or variant; rebuilding it picks up the fix.

## Sounds

- Weapon reload sounds are extracted from your own game install and timed to each weapon's
  reload animation, but the loudness target across weapons is an estimated guess, not yet
  checked by ear in a real match. Shell-loading weapons (Cindershot, Heatwave, Hydra) play
  one loading sound per reload regardless of how many shells are loaded; the battery weapons'
  vent sound is silent.
- Footsteps all use the game's default surface (no grass, metal or water variants yet), and
  their step rate is estimated from speed. The slide's exit whoosh is silent.
- The Shock Rifle's blue electric arcs around its open shroud are not drawn.
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

- The 2D map view is one fixed picture of the whole map, cut over its highest walked floor:
  interiors under a walked roof are hidden (players there show as markers over the roof).
  It leaves out foliage, coarse decor, decals and every see-through surface (glass
  included). Its flat light and height shading were tuned on a few maps, not all.
- The HUD's bottom strip (score, kill feed, ammo) can sit under the control bar while the bar
  is showing; only the shield indicator currently avoids this.
- The home screen does not yet have Settings or Quit rows, gamepad input, or live 3D
  backdrops.
- Fullscreen could not be checked by automated browser testing (the browser refused the
  synthetic click); it is covered only by unit tests and code review, not by seeing it run.

## Coatings

- After a successful setup the coating libraries rebuild in the background; the open match
  keeps its neutral paint until it is reopened once they finish.

## Export

- A 3D export renders every frame in full, so a long match at 1080p 60 fps can take somewhat
  longer than the match itself.
- Cancel during "Preparing" takes effect once the sound mix finishes rather than immediately.
## Packaging

- The packaged installer (`tools\package.ps1 -Installer`) builds, but the installed-app path
  has not been walked through end to end on a clean machine yet.
