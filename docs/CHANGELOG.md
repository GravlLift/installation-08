# Changelog

## Unreleased

Changes since 0.1.0-test.12.

- Texture quality setting (Standard / High) in the replay settings. High builds a separate, sharper map file the first time it is chosen.
- Map and Forge variant textures are GPU-compressed (KTX2 / Basis Universal): about a quarter of the graphics memory. Maps built before keep working; rebuilding one compresses it. Map builds take longer (Streets: about 2 minutes Standard, 7 minutes High).
- At High, armor, arms and weapons no longer lose their textures (they ran out of memory behind the uncompressed map).
- Long video exports no longer fail at the end with a size error: the file is written in pieces instead of one block of memory.
- Switching the texture quality during a replay no longer blanks the page; a map not yet built at that quality shows its build button in the viewer.
- The held weapon (and with it the first-person arms and ammo counter) no longer vanishes when the film's weapon readings leave the slot unnamed: picked-up weapons, a single carried weapon, the spawn weapon and weapons named only by their shots are now kept. Across the stored test matches, empty-hand time fell from 7537 frames to 943 (about 0.2% of time alive); what remains is where the film itself says the hands are empty or says nothing.
- Weapons a player only picked up are named (painted, with their icon and ammo counter).
- The Stalker Rifle placed on maps such as Streets (a second weapon id) is recognized: painted, with its scope and ammo counter.
- Spartans, corpses and the first-person arms and weapon are lit by the map's lamps, like the floor they stand on. On night maps such as Streets they read near black on a lamp-lit street before.
- Bloom: lamps and other self-lit surfaces glow (setting "Bloom", on by default).
- Weapon light strips and ammo screens glow (BR75, Commando, Bandit, Plasma Pistol, Pulse Carbine, Stalker Rifle, Shock Rifle, Needler and others), in third and first person. They drew as black glass before. Takes effect once the weapon and first-person libraries are rebuilt.
- Sharper weapons: weapon textures are read at twice the size (four times for the first-person weapon and arms) and GPU-compressed, so they still take less graphics memory than before. The first-person library on disk shrinks to about 40% of its size. Takes effect once the weapon and first-person libraries are rebuilt.
- Forge maps: the sun comes from the map's own Sun Direction, not its base map's, and a weak declared sun no longer turns a daylight map toward night. Origin (sun intensity 2) was dark blue-grey and shadowless; Fortress, Vacancy and Origin take effect once their map is rebuilt. Native maps whose sun is between 2 and 8 (Outlook, Breaker, Forbidden and others) also draw at full daylight now.

## 0.1.0-test.12

Changes since 0.1.0-test.11.

- The export dialog's start and end times now match the playback bar (they counted from gameplay start, so they disagreed by the pre-game length).
- The first-person weapon keeps its paint when the arms are repainted, for example after zooming and reloading. It could show plain grey for a moment before.

## 0.1.0-test.11

Changes since 0.1.0-test.10.

### Video export
- Much sharper video. Exports are encoded at constant quality, so moving the camera, other players moving and shooting, and explosions no longer turn the picture into blocks. Files are larger as a result. Browsers that refuse constant quality fall back to a higher bitrate than before.
- Shield sounds are in the exported audio: the low-shield beeping, the shield break and its alarm, and the recharge, for the player followed in first person.
- A finished export now waits in the dialog with a **Save video** button instead of downloading by itself. Chrome no longer blocks the file as an unrequested download, and if a save fails (for example the file is open in a video player) you can click Save again.

### First person
- The first-person arms no longer drop to a floating gun while their paint, armor pieces or arm parts are still loading. They keep the previous look until the new one is ready.
- A coating that finishes loading while the arms are being built is no longer lost.

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
- Fixed: a first-person export started from the 2D view showed the player's own body and the map markers. The export now renders the 3D view and returns to 2D when it ends.
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
- Reopening a map is faster: the browser keeps map and Forge variant files and only downloads them again after a rebuild.
- The static map renders into the sun's shadow map once. Forge object layers draw in batches. The minimap's map image renders once per scene.
