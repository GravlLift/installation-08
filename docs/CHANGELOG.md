# Changelog

## Unreleased

Changes since 0.1.0-test.14.

- The Shock Rifle's shroud arcs added in test.14 are withdrawn: they drew as a pale cloud of flat shards in front of the muzzle instead of arcs on the shroud.

## 0.1.0-test.14

Changes since 0.1.0-test.13.

Highlights:
- Streets' signs, screens and neon animate as in game (switch "Animated lights").
- Shock Rifle: electric arcs on the shroud and three-beam shots.
- Sound: other players' sounds come from where they are; vents; CTF announcer calls.
- Texture quality chosen once, on the matches page or at a map's first build.
- Better exports: name tags as on screen.

After updating, the sounds and the weapon and first-person libraries rebuild themselves at the first start. To see the animated signs, the Origin pad fix or the Sentinel Beam glow on a map or Forge layer you already built, rebuild it.

### Look
- The map's self-lit surfaces move as the game animates them: Streets' holographic signs scroll, flicker and change tint, its screens scroll and flicker, and its neon pulses, at the game's own rates, on match time so exports match the screen. A new "Animated lights" switch next to Bloom turns it off. Takes effect once the map is rebuilt.
- Shock Rifle: blue electric arcs flicker around its open barrel shroud while it is held (third and first person), and each shot fires three jagged electric beams to where it lands instead of one straight line.
- The Sentinel Beam's energy parts glow, in third and first person.
- Origin's spawn-end pads no longer carry round sand-colored stacks rising half a meter above them: the Forge cylinders under each pad are sized about their center, as the game does, and now form the pad's stepped top where players stand. The same fix lowers two floor blocks on Outlook and a few cylinders on Solitude to the surface players walk on. Takes effect once the Forge layer is rebuilt.

### Sound
- Other players' sounds come from where they are and fade with distance: grenade throws, weapon and equipment pickups, thruster, grapple, repulsor, translocation, equipment use, wall placement and weapon pad spawns played at full volume everywhere before. Your own player's sounds stay full and centered.
- Other players' gunshots sit clearly below your own: they were as loud as yours up close. Your own reloads no longer move around with the camera.
- Heat weapons (Stalker Rifle, Plasma Pistol, Pulse Carbine, Ravager and others) sound their vent, timed to the vent animation.
- CTF announcer: "Flag taken" for both teams and the enemy's flag capture are called, and flag captures and returns land at the right moment (Fortress CTF: 9 calls instead of 4). An enemy stronghold capture has its line ("Stronghold lost").

### Viewer and export
- Texture quality is a Standard / High switch in the matches page's top bar, and a map's first build asks which quality to build, with the rough time and size of each, so you no longer wait for a Standard build and then a second one for High.
- Exported videos name the same players as the screen, with the same fade at distance, and the name tags take the same share of the picture as on screen instead of drawing too large.

## 0.1.0-test.13

Changes since 0.1.0-test.12.

Highlights:
- Footsteps, slides and landings, from the game's own sounds.
- Night maps light up: signs, billboards, neon, screens and holograms.
- Bloom, and Spartans lit by the map's lamps.
- Glowing weapon light strips and ammo screens, and sharper weapons.
- Origin and other Forge maps: sunlight, backdrop and Forerunner metal as in game.
- A High texture quality setting, with GPU-compressed textures at a quarter of the memory.
- Weapons stay in the players' hands.

After updating, the weapon and first-person libraries and the sounds rebuild themselves in the background at the first start. A map or Forge layer built by an earlier version shows as outdated with a rebuild button, and its build shows its progress; a large map can take several minutes.

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
- Night maps light up: holographic signs and billboards show their picture, neon signs and light strips glow in their color, screens are lit, and the NMPD hologram on Streets is a see-through blue emblem instead of a bright blob (Streets: 257 self-lit materials instead of 35; also a few on Recharge, Live Fire and Aquarius). Signs stay readable rather than glowing white. Their scanlines, flicker and scrolling are not drawn yet. Takes effect once the map is rebuilt.
- Sharper weapons: weapon textures are read at twice the size (four times for the first-person weapon and arms) and GPU-compressed, so they still take less graphics memory than before. The first-person library on disk shrinks to about 40% of its size. Takes effect once the weapon and first-person libraries are rebuilt.
- Footsteps: every Spartan's steps (walk, run, sprint), slides and landings, from the game's own sounds extracted from your install at the server's next start. The followed player's in first person, other players' placed in the world. In the live replay and in video exports. Steps use the game's default surface for now; the step rate is estimated from speed (the film does not record footfalls).
- Forge maps: the sun comes from the map's own Sun Direction, not its base map's, and a weak declared sun no longer turns a daylight map toward night. Origin (sun intensity 2) was dark blue-grey and shadowless; Fortress, Vacancy and Origin take effect once their map is rebuilt. Native maps whose sun is between 2 and 8 (Outlook, Breaker, Forbidden and others) also draw at full daylight now.
- Forge maps: the sunlight takes the map's own sun color (Origin's warm orange), and the map's own backdrop (cliffs, hills) is no longer buried in a dark blue haze past a few dozen meters. Native maps keep their haze.
- Forge maps: Forerunner pieces (hex pillars, supports, platforms, beams) draw their blue-grey Forerunner metal with its panel lines instead of sand-colored stone. On Origin this was about a third of the map. Takes effect once the map's Forge layer is rebuilt.

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
