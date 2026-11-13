// Package weaponicons builds the game's weapon and kill-feed icons from the installed
// Halo Infinite archives, the way the weapon library build reads the install.
//
// Ported from LevelUp's cmd/weapon-icons-build. The builder reads the game's .module
// archives read-only (entry tables only, never whole archives), decodes the icon atlas
// bitmaps (BC7) and writes one white-on-transparent PNG per icon plus an index.json,
// into a folder of the data directory. The PNGs are game-derived and are never committed:
// this package only ever writes below the data directory.
//
// What is established on pieces (nothing is postulated):
//
//  1. All weapon tags reference the same two icon bitmaps (0xbc17adf1, 0xe39747c8). The
//     third bitmap varies but is shared per weapon group: it is a reticle, not an icon.
//     The two common bitmaps declare images of all different sizes: one icon set.
//
//  2. The tag-to-pixels link: a .module entry carries, at +0x10, an index into the module's
//     resource table (0 in the `ds/` variant, which lacks the pixels; non-zero in `pc/`).
//     The resources following that index correspond one to one to the declared images.
//
//  3. The format: an exact arithmetic check. For the 333x117 image, the resource weighs
//     53372 bytes = 212 header + 72 data + 53088, and 53088 = 40320 + 10080 + 2688, the
//     mip0+mip1+mip2 4x4 blocks of 16 bytes. Exact to the byte, on every image.
//
//  4. The content: R is constant 255, G constant 0, B is a vertical tint ramp applied to
//     the render, A is the DRAWING. Only the alpha is kept, rendered white on a
//     transparent background.
//
//  5. Which image names which weapon: the `sprite index` field of the `UI display info`
//     block of the weapon's `weap` tag (weapui.go), self-validated. Files keep their atlas
//     INDEX names; the weapon key is carried by index.json, so no file is renamed per
//     content update.
//
//  6. The "sandbox" atlas is the KILL FEED's, and the `bitd` tag carries its naming table
//     (StringID + index) (killfeed.go).
//
// Names come out of a hash equality against strings harvested from the game binary (plus
// a curated vocabulary), never of a resemblance: a name is published only when its
// murmur3 x86_32 (seed 0) hash equals the tag's StringID. Conflicts are published, not
// arbitrated; an unverified name keeps its marker in index.json.
package weaponicons
