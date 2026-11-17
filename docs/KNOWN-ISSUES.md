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
  Standard, 8 minutes High), and the first start after an update rebuilds the weapon,
  first-person and Spartan-piece libraries in the background, now on all of the machine's
  cores at once (see docs/CHANGELOG.md "Unreleased" for the measurement) instead of one weapon
  or rig at a time. A thin bar at the top of every page shows the overall progress and the
  current step while this runs; a match opened mid-build plays right away, its own weapons
  built first, with any weapon not yet ready shown as a plain placeholder until its file
  appears.
- Origin: its surrounding hills draw snowy where the game shows brown rock and green hills.
- Signs, screens and neon animate with the game's own rates, but their scanline, noise and
  parallax layers and the holograms' noise and edge glow are not drawn. One Streets sign
  (BUENA) still draws nothing.
- A stored match built before a recent fix may still show the old (incorrect) version of a
  map or variant; rebuilding it picks up the fix.

## Sounds

- Weapon reload sounds are extracted from your own game install and timed to each weapon's
  reload animation, but the loudness target across weapons is an estimated guess, not yet
  checked by ear in a real match. Shell-loading weapons (Cindershot, Heatwave, Hydra) play
  one loading sound per reload regardless of how many shells are loaded.
- Footsteps all use the game's default surface (no grass, metal or water variants yet), and
  their step rate is estimated from speed.
- The Shock Rifle's housing electricity comes from the game's own effect, but a few of its
  details (how the effect loops, how particles spread from their emitters) are read as
  closely as the data allows rather than exactly. Its three-beam shots are drawn by the
  viewer, not from the game's own effect. Other
  weapons' particle effects (the Ravager's and Disruptor's glow, plasma impacts) are not
  drawn.
- The Heatwave's vent glow on its fins and its ready glow come from the game's own effects.
  The vent shows while the film says the player reloads, scaled by the value the weapon's own
  reload animation sets (read from the game), while the magazine is not full (full at spawn,
  the film's last magazine reading less the shots since, plus one round per stage the reload
  plays). The first-person reload sounds of the
  Heatwave, Cindershot and Hydra (fins opening, each round, the closing) play for the followed
  player only, on top of the Spartan's reload sound, and are not yet checked by ear. Seen from outside, a weapon's own moving parts (the Heatwave's
  fins, slides, barrels) do not move: weapons are drawn as one rigid piece in third person.
- Weapon effects drawn as small 3D models (the Heatwave's vent and ready glow, the Shock Rifle's
  electric shell, the Cindershot's glow) are drawn at their size only. The game also gives each a
  width and length stretch (the particle's "scale x" and "scale y", offsets 664 and 700 of its
  properties), and which axes of the model these stretch is not known: neither the tag layouts
  nor any published documentation says. Read along the model's own long axis, the Heatwave's
  ready glow would be a 26 cm streak along the barrel; read across it, as the flat effects use
  them, an 11.5 cm wide disc. Until this is known, the part of the ready glow seen in first person
  is not drawn (drawn at its size alone, it showed as a round disc beside the gun).
- Vehicle engine and destruction sounds are not yet placed in the world (they play at the
  same level everywhere), and other players' shield alarms are not played.
- How much quieter other players' guns are than your own (4 dB, plus distance) is an
  estimate, not yet matched by ear to the game.
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
- A grenade stuck to a player rides the part of his body it hit, but can sit a few inches off it:
  his animation is the viewer's reconstruction, not the game's. One stuck to something other than a
  player (a lift, a weapon, a Forge object) still stays where it hit until it explodes. In first person,
  a grenade stuck to your own body is not shown unless it is on your arms or hands.
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
