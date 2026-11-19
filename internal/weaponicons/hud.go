// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

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
	"strings"

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

// damageArcTag is the `bitm` tag id of the HUD's directional damage indicator: the arc
// that shows the bearing of an incoming threat. Its pixels sit inside the tag's own bytes
// (mip 0 at HeaderSize + DataSize of the `ucsh` header), unlike the HUD icon atlases, whose
// pixels live in the module's resource table. The CUI damage indicator screen `cusc`
// 0583f411 references this bitmap.
const damageArcTag = 0x41d89be1

// damageArcW and damageArcH are the damage-arc bitmap's dimensions.
const (
	damageArcW = 720
	damageArcH = 390
)

// shieldChaseTag is the `bitm` tag id of the HUD's shield chase bitmap: the band the shield
// screen (`cusc` 9299c419, component `shield_chase`) draws over the shield just lost, in the
// bar's own shape. R = 255, G = 0, B = a left-to-right position ramp 0..255 across the bar
// (the meter reveals by it), A = the band's shape. Its pixels are NOT inside the tag:
// they are an uncompressed b8g8r8a8_unorm resource (4 bytes per pixel, byte order B, G,
// R, A, straight alpha, one mip) in the module's resource table, and only the `pc`
// variant carries it (the `ds` variant's entry declares no resource).
const shieldChaseTag = 0x1a61d06e

// shieldChaseW and shieldChaseH are the shield-chase bitmap's dimensions.
const (
	shieldChaseW = 940
	shieldChaseH = 64
)

// HudOutDir is the HUD icon set's folder below the data directory.
func HudOutDir(dataDir string) string {
	return filepath.Join(dataDir, "assets", "weapons-icons", "halo_infinite", "hud")
}

// HudFileNames returns the sorted stems of the HUD icon files the build writes (one per
// piece of equipment and grenade, in LevelUp's public file names, plus the damage arc
// and the shield chase). The route serves only these names, so the list is the surface
// of the set.
func HudFileNames() []string {
	out := make([]string, 0, len(hudSources)+2)
	for stem := range hudSources {
		out = append(out, stem)
	}
	out = append(out, "DamageArc", "ShieldChase")
	sort.Strings(out)
	return out
}

// HudSetReady says whether the HUD icon set is built: index.json, DamageArc.png,
// ShieldChase.png AND the HUD's default font are all present in the output folder. A set
// built before one of those was added is missing it, so it is not ready and gets rebuilt
// once.
func HudSetReady(dataDir string) bool {
	dir := HudOutDir(dataDir)
	for _, name := range []string{"index.json", "DamageArc.png", "ShieldChase.png", hudFontRequired} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			return false
		}
	}
	return true
}

// inlineBC7Image decodes mip 0 of a `ucsh` tag whose pixels sit inside the tag's own bytes
// (mip 0 at HeaderSize + DataSize of the header), w x h, full color. It refuses a tag that
// is not `ucsh` and one whose mip 0 does not fit.
func inlineBC7Image(tag []byte, w, h int) (*image.NRGBA, error) {
	hdr, ok := parseTagHeader(tag)
	if !ok {
		return nil, fmt.Errorf("not a ucsh tag")
	}
	off := int(hdr.HeaderSize) + int(hdr.DataSize)
	need := ((w + 3) / 4) * ((h + 3) / 4) * 16
	if off < 0 || off+need > len(tag) {
		return nil, fmt.Errorf("mip 0 of %dx%d needs %d bytes at offset %d, tag is %d", w, h, need, off, len(tag))
	}
	img, _, _, _ := decodeBC7(tag[off:off+need], w, h, nil)
	return img, nil
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
	arcFiles, arcBytes, err := buildDamageArc(ctx, ix, out)
	if err != nil {
		return 0, 0, 0, err
	}
	written += arcFiles
	total += arcBytes
	chaseFiles, chaseBytes, err := buildShieldChase(ctx, ix, out)
	if err != nil {
		return 0, 0, 0, err
	}
	written += chaseFiles
	total += chaseBytes
	fontFiles, fontBytes, err := buildHudFonts(ctx, ix, out)
	if err != nil {
		return 0, 0, 0, err
	}
	written += fontFiles
	total += fontBytes
	slog.InfoContext(ctx, "hud icon set built", "files", written, "named", len(entries),
		"bytes", total, "out", out)
	return written, len(entries), total, nil
}

// buildDamageArc writes DamageArc.png, the directional damage indicator bitmap, from its
// tag (damageArcTag) into out. It returns the number of files written (0 or 1) and the
// file's byte count.
func buildDamageArc(ctx context.Context, ix *tagIndex, out string) (written, bytes int, err error) {
	if err := ctx.Err(); err != nil {
		return 0, 0, err
	}
	ref, ok := pickRef(ix.byID[damageArcTag])
	if !ok {
		return 0, 0, fmt.Errorf("damage arc tag %08x not found in the install", damageArcTag)
	}
	tag, err := ix.extract(ref)
	if err != nil {
		return 0, 0, fmt.Errorf("damage arc tag %08x: %w", damageArcTag, err)
	}
	img, err := inlineBC7Image(tag, damageArcW, damageArcH)
	if err != nil {
		return 0, 0, fmt.Errorf("damage arc tag %08x: %w", damageArcTag, err)
	}
	path := filepath.Join(out, "DamageArc.png")
	if err := writePNG(path, img); err != nil {
		return 0, 0, fmt.Errorf("write DamageArc.png: %w", err)
	}
	fi, err := os.Stat(path)
	if err != nil {
		return 0, 0, err
	}
	return 1, int(fi.Size()), nil
}

// errNoResource names a ref whose entry declares no resource: the `ds` variant does this
// for every pixel-carrying tag, so the reader skips it for the `pc` one.
var errNoResource = fmt.Errorf("entry declares no resource")

// resourcePayloadOf returns the pixel payload of the entry's FIRST resource: the bytes
// after the resource blob's `ucsh` header (HeaderSize + DataSize, the same rule as
// resBlob). It is the narrow reader for the uncompressed resources the block-compressed
// atlas pairing (alignImages) cannot pair — on the shield chase bitmap's tag, the entry's
// field at +0x10 is the index into the module's resource table.
func resourcePayloadOf(ix *tagIndex, r tagRef) ([]byte, error) {
	blob, err := resourceBlobOf(ix, r)
	if err != nil {
		return nil, err
	}
	hdr, ok := parseTagHeader(blob)
	if !ok {
		return nil, fmt.Errorf("resource of entry %d without a ucsh header", r.Entry)
	}
	off := int(hdr.HeaderSize) + int(hdr.DataSize)
	if off < 0 || off > len(blob) {
		return nil, fmt.Errorf("resource of entry %d: payload at offset %d out of range (%d bytes)", r.Entry, off, len(blob))
	}
	return blob[off:], nil
}

// resourceBlobOf returns the whole blob (ucsh header included) of the entry's FIRST
// resource, through the entry's resource index (+0x10) into the module's resource table.
func resourceBlobOf(ix *tagIndex, r tagRef) ([]byte, error) {
	m, err := ix.open(r.Module)
	if err != nil {
		return nil, err
	}
	resIdx := entryResourceIndex(m, r.Entry)
	if resIdx == 0 {
		return nil, errNoResource
	}
	tab, err := resourceTable(m)
	if err != nil {
		return nil, err
	}
	if resIdx >= len(tab) {
		return nil, fmt.Errorf("resource index %d out of table (%d)", resIdx, len(tab))
	}
	return m.extract(m.file(int(tab[resIdx])))
}

// bgraToNRGBA converts a flat b8g8r8a8_unorm payload (byte order B, G, R, A, straight
// alpha) to a straight-alpha NRGBA image of w x h. It refuses a payload that is not
// exactly w*h*4 bytes.
func bgraToNRGBA(payload []byte, w, h int) (*image.NRGBA, error) {
	need := w * h * 4
	if len(payload) != need {
		return nil, fmt.Errorf("payload is %d bytes, want exactly %d for a %dx%d b8g8r8a8 image", len(payload), need, w, h)
	}
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < w*h; i++ {
		b, g, r, a := payload[4*i], payload[4*i+1], payload[4*i+2], payload[4*i+3]
		img.Pix[4*i], img.Pix[4*i+1], img.Pix[4*i+2], img.Pix[4*i+3] = r, g, b, a
	}
	return img, nil
}

// buildShieldChase writes ShieldChase.png, the shield chase bitmap, from its tag
// (shieldChaseTag) into out: the tag's first resource, an uncompressed b8g8r8a8 payload
// in the `pc` variant. It returns the number of files written (0 or 1) and the file's
// byte count.
func buildShieldChase(ctx context.Context, ix *tagIndex, out string) (written, bytes int, err error) {
	// A copy: the sort below must not reorder the shared index's slice.
	refs := append([]tagRef(nil), ix.byID[shieldChaseTag]...)
	if len(refs) == 0 {
		return 0, 0, fmt.Errorf("shield chase tag %08x not found in the install", shieldChaseTag)
	}
	// The `pc` variant carries the pixels; try its refs first so the read is
	// deterministic (the `ds` ones declare no resource and are skipped).
	sort.SliceStable(refs, func(i, j int) bool {
		return strings.Contains(filepath.ToSlash(refs[i].Module), "/pc/") &&
			!strings.Contains(filepath.ToSlash(refs[j].Module), "/pc/")
	})
	for _, r := range refs {
		if err := ctx.Err(); err != nil {
			return 0, 0, err
		}
		payload, err := resourcePayloadOf(ix, r)
		if err == errNoResource {
			continue
		}
		if err != nil {
			return 0, 0, fmt.Errorf("shield chase tag %08x: %w", shieldChaseTag, err)
		}
		img, err := bgraToNRGBA(payload, shieldChaseW, shieldChaseH)
		if err != nil {
			return 0, 0, fmt.Errorf("shield chase tag %08x: %w", shieldChaseTag, err)
		}
		path := filepath.Join(out, "ShieldChase.png")
		if err := writePNG(path, img); err != nil {
			return 0, 0, fmt.Errorf("write ShieldChase.png: %w", err)
		}
		fi, err := os.Stat(path)
		if err != nil {
			return 0, 0, err
		}
		return 1, int(fi.Size()), nil
	}
	return 0, 0, fmt.Errorf("shield chase tag %08x: no variant carries its pixel resource", shieldChaseTag)
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
