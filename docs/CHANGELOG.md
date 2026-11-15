# Changelog

## 0.1.0-test.10

Changes since 0.1.0-test.9.

Highlights:
- Forge maps now show their real colors and lighting.
- The game's shield bar and shield sounds.
- Callouts for the area you are in.
- Scope overlays per weapon.
- Floating equipment and weapon pads.
- Darker, more dramatic lighting.
- Smooth 60 fps grenades.
- 60 fps video exports with the full first-person HUD.
- Shared match links.

### Video export
- 3D exports are encoded at 60 frames per second (30 only if the browser refuses 60, and the dialog says so).
- Fixed: a 3D export could repeat one early frame for the whole clip when the tab was in the background. Each frame is now read straight from the renderer.
- The exported first-person HUD now matches the live one: the weapon reticle (red over an enemy), the zoomed scope overlays, the area name, and the new shield bar.

### First-person HUD and sound
- The shield bar looks like the game's: a glass bar that drains from both ends and refills smoothly, with low, broken and recharging states.
- Shield sounds for the followed player: the low-shield beeping, the shield break and its alarm, and the recharge.
- The name of the area the player is standing in shows bottom-left, as in game (for example "OVERHANG").
- Scope overlays redrawn from in-game captures for each weapon. The Skewer's first-person model hides while zoomed.
- The camera zooms for the Shock Rifle and both Bandits (it stayed at 1x before).
- Countdown beeps before the match starts. Each map's ambient sound plays under the replay.

### Look of the maps
- Lighting: dark areas are dark again and skylight shadow patterns show on the ground. Recharge's roof over the overhang is dark instead of clear glass.
- Forge maps now look like the game, with their real colors:
  - Every piece is drawn with its own Forge style in the game's Forge palette, so the maps are no longer washed out and grey. That includes the fixed red and blue banners, wood, moss, sand and stonework.
  - Each map uses its own sun and sky settings instead of its base map's, so Fortress is warm and sunny.
  - Foliage cutouts are correct.

### Weapons, pads and racks
- Weapon racks hold their weapon in the right orientation, where the game holds it.
- Equipment pads show their item (Repulsor, Threat Sensor, Drop Wall, Grappleshot, Thruster and others) floating upright, spinning, with a faint glow.
- Weapons on pads and racks are painted with their default coating and no longer cast a stray shadow on the floor.
- Grenades and other projectiles fly and bounce smoothly at the film's own rate.
- Kill feed icons for every kill, solid and pointing at the victim. The followed player's kills are highlighted.

### Playback
- Playback starts a second before the first player moves, skipping the empty pre-match time.
- An honest loading bar that finishes before the countdown.
- Space pauses reliably. Optional FPS counter in the settings.

### Scoreboard and 2D map
- Mode-aware scoreboard columns with personal score, live captures and ball time from the film. Score bars fill in zone modes and use dark team colors.
- The 2D map: a stable picture without foliage or decals, shaded by height, flat even light, level arrows on every marker. Equipment pads are named.
- The minimap's orientation can be locked. Clicking it opens the 2D view.

### Finding and fetching matches
- Search any player's recent matches by gamertag, and open their match following that player.
- A shared match link opens on any install: if the match isn't there yet, the page offers to fetch it and shows the progress.
- Fetches queue instead of refusing a second one.
- Map pictures for the recent-matches list download up front.

### Performance
- The static map renders into the sun's shadow map once. Forge object layers draw in batches. The minimap's map image renders once per scene.
