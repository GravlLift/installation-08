# Changelog

## 0.1.1-test.6

Changes since 0.1.1-test.5.

- The weapon name tag no longer pushes the rest of the weapon corner up when it appears: it hangs below the ammo row. It is smaller, as in the game, and sits on a dark plate that fades with it, in the viewer and the video export.

## 0.1.1-test.5

Changes since 0.1.1-test.4.

- Sounds in the world (gunfire, footsteps, impacts, engines, shields) now reverberate like the zone the camera is in. Each zone of a map names one of the game's reverb presets (Streets and Live Fire share four), and the viewer applies that preset's decay, tone and wet level from your install. It crossfades to the next zone's reverb when the camera moves. The game's exact recorded reverb is not decoded yet, so each preset is rebuilt from its measured energy over time and frequency. The announcer, the music and the ambient loops stay dry. The first start after updating extracts the reverbs once. Video export has no reverb yet.
- The video export draws the new HUD weapon corner too: the weapon put away, the one grenade slot, the fading weapon name tag, and the equipment box, which the export used to leave out.

## 0.1.1-test.4

Changes since 0.1.0.

- The ambient sound now follows the map's own sound zones: the viewer plays the background loop of the zone the camera is in and crossfades when the camera moves into another one. Outside every zone, and in the 2D view, it plays the map's main loop. Before, every map played one loop everywhere, and on Live Fire that was the wrong one. The first start after updating extracts the extra loops once.
- Each ambient loop now plays at the game's own volume for it (its Wwise volume, summed with the groups above it) instead of one level for every loop. Ambience is quieter overall, and differs by map as in the game: Live Fire's main bed is 12 dB below Streets'.
- The pre-game screen fits its window: on a short window the roster shrinks to fit and the page scrolls, so the button below it stays reachable. Big-team rosters use tighter rows.
- The window has a minimum size (1024 x 640 at 100 % scale) and a maximum size of 5120 x 2160. A remembered size smaller than the minimum opens at the default size instead.
- The window opens at 1920 x 1080 (at 100 % scale; was 1600 x 900) the first time, shrunk to fit a smaller screen.
- F11 full screen works. Before, it never entered full screen.

- Moving the window to a monitor with a different display scale now redraws the 3D view at that monitor's sharpness. Before, it kept the scale it opened at: moved from a 150 % monitor to a 100 % one, it drew about 2.25 times the pixels the screen needed.
- A match whose Forge objects (crates, props, weapon pads) were built by an older version of the app now rebuilds them when it opens, showing their build progress. Before, the viewer silently left them out until they were rebuilt by hand.
- While the window is being resized (or rescaled by a monitor move), the 3D view now rebuilds its full-screen drawing buffers once, after the size settles, instead of for every intermediate size. For that moment the picture stretches slightly. This takes a burst of graphics-memory allocations off a machine that is already busy.
- The HUD's weapon corner matches the game more closely. The weapon that is put away now shows as a small dimmed icon beside the grenade, and it trades places with the weapon in hand on a swap. The name of the weapon just taken out appears under the ammo and fades out over 2 seconds. Only the selected grenade type shows, with its count, where before every type carried had its own box. The equipment box sits at the far right.

## 0.1.0-test.22

Changes since 0.1.0-test.21.

- The main menu credits the projects the app builds on in its bottom-left corner: LevelUp (JGtm), OpenSpartan (Den Delimarsky), Ekur (The Halo Archive) and SPNKr (Andy Curtis), with a link to the full credits. The links open in your browser.
- Nine more sounds are now built from your Halo install instead of shipping with the app: active camo ending, the shroud screen's deploy, the grappling hook (three takes), the repulsor (three takes) and the equipment pickup. They are rebuilt once on the next start.
- The app no longer ships the eight French end-of-match and round-over voice lines, which it never played.

## 0.1.0-test.21

Changes since 0.1.0-test.20.

- A match that stops loading no longer spins forever. If nothing makes progress for three minutes, the loading screen says which step stopped and to press Ctrl+R. The Forge object build, which runs on the server, is exempt.
- Errors in the app's pages are now written to `server.log` as "viewer error" lines with their details: uncaught errors, unhandled failures, a map that failed to load, and a stalled load. Sending the log is now enough to see what went wrong in the window.

## 0.1.0-test.20

Changes since 0.1.0-test.19.

- Fixed: every match hung on "Decoding materials…" in the packaged app (test.18 and test.19). The geometry decoder's background worker broke when the release build was minified; geometry now decodes on the page itself. On the test machine Vacancy's map decodes in about 1.9 s and an Absolution match is playing in about 16 s.

## 0.1.0-test.19

Changes since 0.1.0-test.18.

Highlights:
- The first start is much shorter: the weapon, first-person and Spartan libraries build on every core, and a bar at the top shows their progress.
- The main menu shows the Installation 08 wordmark.

- On first start the weapon, first-person and Spartan-piece libraries build on all of the machine's cores instead of one item at a time. A weapon in a match you open while they build moves to the front of the queue. A bar at the top of every page shows the progress ("Weapons 84/190") with the note "Optimizing assets. Playback may be less smooth until this finishes." and disappears when the work is done. A clean first start on the 20-core test machine took about 11 minutes.
- The main menu shows the Installation 08 wordmark.
- 24 objective, pad, repair-field and weapon pickup/drop sounds and one end-of-match voice line ("Defeat") are now built from your Halo install, like the announcer and reloads, instead of shipping with the app.
- `server.log` records when each library build starts and finishes and how long it took.
- The film decoder's log and error messages are in English.
- Fixed: the packaged exe was missing the browser-tab icon and other small web files.
- Fixed: after an update the app window could keep showing the previous version's pages until a reload.

### Notes on the parallel library builds

- The weapon, first-person and Spartan-piece libraries now build on all of the machine's
  logical cores at once instead of one weapon/rig/piece at a time, and a weapon the viewer
  actually asks for (a match you open while the library is still building) moves to the front
  of the queue.
  Measured on a 20-core / 64 GB machine, timing a fixed 20-weapon subset of the first-person
  library (a full ~190-weapon run was too long to time twice for this change): 297.2 s wall,
  3.70 GB peak working set before this change, vs. 190.1 s wall, 6.72 GB peak after (about
  1.6x on this small, geometry-read-dominated subset; the per-rig write/compress step itself —
  the real cost at full roster size — went from fully sequential to running all 20 at once).
  Peak memory per worker (~340 MB) stayed well inside a typical 16 GB machine's budget even at
  this machine's full 20-way concurrency, so the default stays every logical core, uncapped.

## 0.1.0-test.18

Changes since 0.1.0-test.17.

Highlights:
- The app is now called Installation 08, with its own icon. The exe is `installation-08.exe`.
- Opening a second match on a map you already visited is much faster.
- The window is sharp on high-DPI screens, and its menus work.

- The app's name is Installation 08, with a new icon on the exe, the title bar, the taskbar and the browser tab. The exe is now `installation-08.exe`; delete the old `infinite-theater-3d.exe` after updating. Your matches, maps and settings stay where they were (`%LOCALAPPDATA%\infinite-theater-3d`).
- Going back to a map you already opened in the same session reuses it: on the test machine a revisited Outlook loads in about 6 to 7 s (11 s the first time) and a revisited Streets in about 7 to 8 s (18 to 20 s the first time). The cache holds up to 3 GB of maps, objects and weapon models.
- Each map's collision index is saved beside it the first time it opens and loaded after that (Streets: under 0.1 s instead of about 2 s).
- The window is sharp at any display scaling and on mixed-DPI monitors.
- The window has a menu bar (File, View, Help) with F11 for full screen and Ctrl+R to reload. It remembers its size and position, opens at 16:9 the first time, and asks before closing while a video export is running.
- Fixed: a weapon rack could vanish after switching matches.

## 0.1.0-test.17

Changes since 0.1.0-test.16.

Highlights:
- The app opens in its own window, with no console.
- Matches open much faster (Outlook about 27 s to 11 s on the test machine).
- Exported videos are about half the size.

- Double-clicking the exe opens the app in its own window (the Microsoft Edge WebView2 Runtime that comes with Windows 10 and 11) instead of a browser tab, and no console window stays open. Closing the window stops the app. Links to other sites, such as the Microsoft sign-in, open in your normal browser. `serve --ui browser` keeps the old behavior, and the app falls back to the browser if the window cannot start. Without a console, the server log is written to `logs\server.log` in the data folder.
- Loading a match is faster: texture decoding uses more of the machine, only the gun on screen holds the loading screen, the other first-person guns load after the first frame, the map's collision index builds faster, armor, weapon and first-person files download in a few bundled requests instead of about 1,400, and the first frame is set up without wasted draws. On the test machine Outlook went from about 27 s to about 11 s and Streets from about 27 s to about 18 to 21 s.
- Map geometry is compressed (meshoptimizer), so map files are about 40% smaller. Maps already built are converted automatically when the app starts, and High texture maps built before this version update correctly.
- Exported videos use a smaller H.264 setting by default, about 45% of the old size at nearly the same quality.
- Exporting a video works in Firefox.
- The Heatwave shows its vent and magazine feed, and its reload sounds play in stages.
- The weapon library's Textures switch sits beside the title.

## 0.1.0-test.16

Changes since 0.1.0-test.15.

Highlights:
- Sticky grenades ride the player they hit.

- A plasma or spike grenade stuck to a player rides on the part of the body it hit (a foot, the torso, the helmet, a hand) until it explodes, instead of staying where it hit. Takes effect once the match is rebuilt.

## 0.1.0-test.15

Changes since 0.1.0-test.14.

Highlights:
- Shock Rifle electricity from the game's own effect.
- Sounds land on time in busy fights.
- Slide-exit sound.

After updating, the weapon and first-person libraries and the footstep sounds rebuild themselves at the first start.

- Shock Rifle: blue electricity crackles inside its barrel housing while it is held, in third and first person, read from the game's own particle effect (its arcs, glowing shell and bolts, textures and blue palette). It goes out while scoped and during a reload. The invented shroud arcs of test.14 are gone. Takes effect once the weapon and first-person libraries rebuild, which happens by itself at the first start after updating.
- A player whose team the match recording leaves unnamed is placed on their team from the match stats; one stored Origin match showed a 4v4 as 5v3.
- Slides end with the game's slide-exit sound (it was silent). The footstep sounds re-extract themselves at the first start after updating.
- Sounds no longer come out late or bunched together when the view is busy: they are scheduled slightly ahead and start on their own moment. In crowded fights, the followed player's own sounds and other players' shots now keep priority over distant footsteps.

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
