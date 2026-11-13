// hud.go — the HUD equipment and grenade icon set.
//
// The game draws each piece of equipment (Overshield, Drop Wall, Grappleshot, ...) and
// each grenade (Frag, Plasma, Spike, Dynamo) as a white glyph on a transparent
// background, in the HUD and on the loadout screen. The glyphs live in a `bitm` atlas of
// the install (tag 7dcd396a, 21 images at 128×128), one image per equipment.
//
// Unlike the kill feed atlas (killfeed.go), this atlas has no `bitd` naming table. The
// index-to-equipment mapping was established visually against the game's HUD: each of the
// 21 decoded images was compared against the 15 public HUD stems. Two images (the "NO
// ICON" placeholder at index 18 and the duplicate at 16) have no public stem.
//
// BuildHud decodes the pinned atlas, crops each glyph to its opaque bounding box, scales
// it to fit 96×96 preserving aspect ratio (the longest edge becomes 96 px, the glyph is
// centered), and writes one PNG per named image under HudOutDir(dataDir).

package weaponicons

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"sort"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// hudAtlasTag is the `bitm` atlas that holds the HUD equipment and grenade glyphs.
// Confirmed by visual decoding: all 15 public stems appear among its 21 images.
const hudAtlasTag = 0x7dcd396a

// hudIconSize is the output canvas size in pixels, matching LevelUp's committed set.
const hudIconSize = 96

// hudStemByIndex maps an atlas image index to the public HUD file stem. The mapping was
// established by decoding the atlas, cropping each glyph to its opaque bounding box, and
// matching the resulting aspect ratio against LevelUp's reference PNGs (which preserve the
// source aspect ratio). Each of the 15 stems maps to a unique index; the remaining indices
// (1, 3, 4, 8, 10, 14, 18) have no public stem.
var hudStemByIndex = map[int]string{
	1:  "ThreatSeeker",
	2:  "Repulsor",
	3:  "RepairField",
	4:  "Dynamo",
	5:  "DropWall",
	6:  "ThreatSensor",
	7:  "Plasma",
	8:  "QuantumTranslocator",
	9:  "Frag",
	12: "Grappleshot",
	13: "ActiveCamouflage",
	15: "Overshield",
	16: "Thruster",
	17: "ShroudScreen",
	20: "Spike",
}

// HudOutDir is the HUD icon set's folder below the data directory.
func HudOutDir(dataDir string) string {
	return filepath.Join(dataDir, "assets", "weapons-icons", "halo_infinite", "hud")
}

// HudFileNames returns the sorted stems of the HUD icon files the build writes (one per
// piece of equipment and grenade, in LevelUp's public file names). The route serves only
// these names, so the list is the surface of the set.
func HudFileNames() []string {
	out := make([]string, 0, len(hudStemByIndex))
	seen := map[string]bool{}
	for _, stem := range hudStemByIndex {
		if !seen[stem] {
			seen[stem] = true
			out = append(out, stem)
		}
	}
	sort.Strings(out)
	return out
}

// HudSetReady says whether the HUD icon set is built: index.json is present in the output
// folder.
func HudSetReady(dataDir string) bool {
	_, err := os.Stat(filepath.Join(HudOutDir(dataDir), "index.json"))
	return err == nil
}

// hudName is one named image of the HUD atlas.
type hudName struct {
	Index int    // the image's position in the atlas
	File  string // the file name written (Frag.png, ...)
	Game  string // the internal name ("" when not mapped)
}

// BuildHud decodes the HUD equipment/grenade icon atlas from the install at gameRoot
// (empty auto-detects) and writes one PNG per named image into HudOutDir(dataDir).
// Returns the number of files written, the number of cracked names, and total bytes.
func BuildHud(ctx context.Context, gameRoot, dataDir string) (files, named, bytes int, err error) {
	root := moduleRoot(gameRoot)
	if root == "" {
		return 0, 0, 0, fmt.Errorf("game install not found: pass --game or set %s", himap.DeployRootEnv)
	}
	out := HudOutDir(dataDir)
	if err := os.MkdirAll(out, 0o750); err != nil {
		return 0, 0, 0, fmt.Errorf("create output folder: %w", err)
	}
	slog.InfoContext(ctx, "hud icon build", "archives", root, "out", out)

	ix := buildIndex("")
	slog.InfoContext(ctx, "module index built", "archives", ix.nMods, "entries", ix.nEntry)

	a, err := atlasOf(ix, hudAtlasTag)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("hud atlas %08x: %w", hudAtlasTag, err)
	}
	slog.InfoContext(ctx, "hud atlas loaded", "images", len(a.imgs))

	// Collect the entries: only indices that have a public stem.
	var entries []hudName
	seen := map[string]bool{}
	for idx, stem := range hudStemByIndex {
		if idx >= len(a.imgs) {
			continue
		}
		// Deduplicate: if two indices map to the same stem, keep the first.
		if seen[stem] {
			continue
		}
		seen[stem] = true
		entries = append(entries, hudName{Index: idx, File: stem + ".png", Game: stem})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Index < entries[j].Index })
	slog.InfoContext(ctx, "hud entries resolved", "count", len(entries))

	total, written, decoded, err := writeHudAtlas(ctx, ix, entries, out)
	if err != nil {
		return 0, 0, 0, err
	}
	if err := writeHudIndex(out, entries, decoded); err != nil {
		return 0, 0, 0, err
	}
	if fi, err := os.Stat(filepath.Join(out, "index.json")); err == nil {
		total += int(fi.Size())
	}
	slog.InfoContext(ctx, "hud icon set built", "files", written, "named", len(entries),
		"bytes", total, "out", out)
	return written, len(entries), total, nil
}

// writeHudAtlas decodes each named image, scales it to hudIconSize×hudIconSize, and
// writes the PNG. Returns the byte count, file count, and decoded descriptors.
func writeHudAtlas(ctx context.Context, ix *tagIndex, entries []hudName, out string) (total, written int, decoded map[int]bitmImg, err error) {
	decoded = map[int]bitmImg{}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return 0, 0, nil, err
		}
		cropped, _, im, err := decodeAlphaGlyph(ix, hudAtlasTag, e.Index)
		if err != nil {
			return 0, 0, nil, fmt.Errorf("hud icon %s (index %d): %w", e.File, e.Index, err)
		}
		scaled := scaleToFit(cropped, hudIconSize)
		if err := writePNG(filepath.Join(out, e.File), scaled); err != nil {
			return 0, 0, nil, fmt.Errorf("write %s: %w", e.File, err)
		}
		fi, err := os.Stat(filepath.Join(out, e.File))
		if err != nil {
			return 0, 0, nil, err
		}
		decoded[e.Index] = im
		total += int(fi.Size())
		written++
	}
	return total, written, decoded, nil
}

// scaleToFit scales src to fit within size×size preserving aspect ratio, centered on the
// canvas. The longest edge becomes size pixels; the other edge scales proportionally.
// Nearest-neighbor (the glyphs are flat white on transparent; no anti-aliasing is needed).
func scaleToFit(src *image.NRGBA, size int) *image.NRGBA {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	if sw == 0 || sh == 0 {
		return image.NewNRGBA(image.Rect(0, 0, size, size))
	}
	// Scale so the longer edge fits exactly in size.
	scale := float64(size) / float64(max(sw, sh))
	dw, dh := int(math.Round(float64(sw)*scale)), int(math.Round(float64(sh)*scale))
	dst := image.NewNRGBA(image.Rect(0, 0, size, size))
	ox, oy := (size-dw)/2, (size-dh)/2
	for y := 0; y < dh; y++ {
		sy := y * sh / dh
		for x := 0; x < dw; x++ {
			sx := x * sw / dw
			s := src.PixOffset(b.Min.X+sx, b.Min.Y+sy)
			o := dst.PixOffset(ox+x, oy+y)
			copy(dst.Pix[o:o+4], src.Pix[s:s+4])
		}
	}
	return dst
}

// hudIndexEntry is one index.json line of the HUD set.
type hudIndexEntry struct {
	Index    int    `json:"index"`
	File     string `json:"file"`
	GameName string `json:"game_name,omitempty"`
	Source   string `json:"source_tag"`
	SourceW  int    `json:"source_w"`
	SourceH  int    `json:"source_h"`
}

// writeHudIndex writes the HUD set's index.json.
func writeHudIndex(out string, entries []hudName, decoded map[int]bitmImg) error {
	outs := make([]hudIndexEntry, 0, len(entries))
	for _, e := range entries {
		im, ok := decoded[e.Index]
		if !ok {
			continue
		}
		outs = append(outs, hudIndexEntry{
			Index: e.Index, File: e.File, GameName: e.Game,
			Source:  fmt.Sprintf("%08x", hudAtlasTag),
			SourceW: im.W, SourceH: im.H,
		})
	}
	blob, err := json.MarshalIndent(outs, "", " ")
	if err != nil {
		return fmt.Errorf("index.json: %w", err)
	}
	return os.WriteFile(filepath.Join(out, "index.json"), append(blob, '\n'), 0o600)
}
