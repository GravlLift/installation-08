// hud.go — the HUD equipment and grenade icon set.
//
// Build the game's grenade and equipment HUD glyphs from their pinned atlases.

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

// HUD sources are pinned to the game atlas and index used by LevelUp's extractor.
type hudSource struct {
	atlas uint32
	index int
}

var hudSources = map[string]hudSource{
	"ActiveCamouflage":    {0xc6b7ad41, 5},
	"DropWall":            {0xc6b7ad41, 2},
	"Dynamo":              {0xa2dcd69e, 3},
	"Frag":                {0xa2dcd69e, 0},
	"Grappleshot":         {0xc6b7ad41, 1},
	"Overshield":          {0xc6b7ad41, 6},
	"Plasma":              {0xa2dcd69e, 1},
	"QuantumTranslocator": {0xc6b7ad41, 15},
	"RepairField":         {0xc6b7ad41, 17},
	"Repulsor":            {0xc6b7ad41, 4},
	"ShroudScreen":        {0xc6b7ad41, 9},
	"Spike":               {0xa2dcd69e, 2},
	"ThreatSeeker":        {0xc6b7ad41, 16},
	"ThreatSensor":        {0xc6b7ad41, 3},
	"Thruster":            {0xc6b7ad41, 0},
}

const hudIconSize = 96

// HudOutDir is the HUD icon set's folder below the data directory.
func HudOutDir(dataDir string) string {
	return filepath.Join(dataDir, "assets", "weapons-icons", "halo_infinite", "hud")
}

// HudFileNames returns the sorted stems of the HUD icon files the build writes (one per
// piece of equipment and grenade, in LevelUp's public file names). The route serves only
// these names, so the list is the surface of the set.
func HudFileNames() []string {
	out := make([]string, 0, len(hudSources))
	for stem := range hudSources {
		out = append(out, stem)
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
	Index int // the image's position in the atlas
	Atlas uint32
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

	var entries []hudName
	for stem, source := range hudSources {
		entries = append(entries, hudName{Index: source.index, Atlas: source.atlas, File: stem + ".png", Game: stem})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].File < entries[j].File })

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
func writeHudAtlas(ctx context.Context, ix *tagIndex, entries []hudName, out string) (total, written int, decoded map[string]bitmImg, err error) {
	decoded = map[string]bitmImg{}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return 0, 0, nil, err
		}
		cropped, _, im, err := decodeAlphaGlyph(ix, e.Atlas, e.Index)
		if err != nil {
			return 0, 0, nil, fmt.Errorf("hud icon %s (index %d): %w", e.File, e.Index, err)
		}
		if !imageVerified(ix, e.Atlas, e.Index) || cropped.Bounds().Dx() < 2 || cropped.Bounds().Dy() < 2 {
			return 0, 0, nil, fmt.Errorf("hud icon %s: unverified or empty source", e.File)
		}
		scaled := scaleToFit(cropped, hudIconSize)
		if err := writePNG(filepath.Join(out, e.File), scaled); err != nil {
			return 0, 0, nil, fmt.Errorf("write %s: %w", e.File, err)
		}
		fi, err := os.Stat(filepath.Join(out, e.File))
		if err != nil {
			return 0, 0, nil, err
		}
		decoded[e.File] = im
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
func writeHudIndex(out string, entries []hudName, decoded map[string]bitmImg) error {
	outs := make([]hudIndexEntry, 0, len(entries))
	for _, e := range entries {
		im, ok := decoded[e.File]
		if !ok {
			continue
		}
		outs = append(outs, hudIndexEntry{
			Index: e.Index, File: e.File, GameName: e.Game,
			Source:  fmt.Sprintf("%08x", e.Atlas),
			SourceW: im.W, SourceH: im.H,
		})
	}
	blob, err := json.MarshalIndent(outs, "", " ")
	if err != nil {
		return fmt.Errorf("index.json: %w", err)
	}
	return os.WriteFile(filepath.Join(out, "index.json"), append(blob, '\n'), 0o600)
}
