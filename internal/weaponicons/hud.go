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

// shieldQuadTag is the `bitm` tag id of the shield bar's main quad: the shape the shield
// screen (`cusc` 9299c419) draws the meter with. Its pixels are NOT inside the tag: they
// are in the module's resource table, and the `pc` variant's entry owns the resources
// from its +0x10 index to (not including) the NEXT entry's +0x10 — on the real install,
// resources 9958 (25600 bytes) and 9959 (76800 bytes). Resource 9959 is mip 0, BC7,
// stored 960x80 (240x20 blocks x 16 = 76800 exactly); it decodes at 960x80 to the clean
// bar. The declared width is 940 and columns 940..959 are empty, so the image is written
// cropped to 940x80. The stored-width padding is from one sample; reason unknown.
const shieldQuadTag = 0x1a9b2c75

// shieldQuadStoreW is the stored (padded) width of the quad bitmap; shieldQuadW and
// shieldQuadH are the dimensions written.
const (
	shieldQuadStoreW = 960
	shieldQuadW      = 940
	shieldQuadH      = 80
)

// teamEmblemTag is the `bitm` tag id of the team emblem set: nine 64x64 BC7 emblems, one
// per resource, white glyph on transparent alpha. Its `pc` entry owns the nine resources
// (k = 0..8); each payload is the whole mip chain (mip 0 at 64x64 first, then 32x32,
// 16x16, ...). The score bar screen (`cusc` 21a7dab4) shows it with prop_sprite_frame
// bound to `teamindex`, so resource k is the team index — inferred from the eagle/cobra
// order, not proven. Decoding mip 0 without a guide leaves gray mode-7 blocks, so the
// decode passes mipGuide as the witness (as AtlasImage does).
const (
	teamEmblemTag   = 0x7df5eede
	teamEmblemSize  = 64
	teamEmblemCount = 9
)

// scoreMeterTag is the `bitm` tag id of the score bar's meter: the meter on the center
// scoreboard screen (`cusc` fb8c6614, a fui_meter_two_tone_quad_widget, 404x60, its meter
// value bound to the score). Its `pc` entry owns three resources; the one whose payload is
// exactly 409600 bytes is mip 0, BC7, stored 1600x256 (400x64 blocks x 16 = 409600), and it
// decodes cleanly at 1600x256 with decodeBC7 and no guide. The tag declares 800x64; why it
// is stored at twice that is not known (one sample).
//
// Its pixels are a channel-packed mask, NOT colors: R is constant (104), B is the bar's
// rounded-rectangle shape, G is a striped left-to-right ramp the meter value is compared
// against, and A is 255. The pixels are kept exactly as decoded (no tint, no channel
// changes): the web code reads B and G.
const scoreMeterTag = 0x128bc424

// scoreMeterW and scoreMeterH are the score meter bitmap's stored dimensions.
const (
	scoreMeterW = 1600
	scoreMeterH = 256
)

// HudOutDir is the HUD icon set's folder below the data directory.
func HudOutDir(dataDir string) string {
	return filepath.Join(dataDir, "assets", "weapons-icons", "halo_infinite", "hud")
}

// HudFileNames returns the sorted stems of the HUD icon files the build writes (one per
// piece of equipment and grenade, in LevelUp's public file names, plus the damage arc,
// the shield chase, the shield quad, the score meter, and the nine team emblems). The
// route serves only these names, so the list is the surface of the set.
func HudFileNames() []string {
	out := make([]string, 0, len(hudSources)+4+teamEmblemCount)
	for stem := range hudSources {
		out = append(out, stem)
	}
	out = append(out, "DamageArc", "ShieldChase", "ShieldQuad", "ScoreMeter")
	for k := 0; k < teamEmblemCount; k++ {
		out = append(out, fmt.Sprintf("TeamEmblem%d", k))
	}
	sort.Strings(out)
	return out
}

// HudSetReady says whether the HUD icon set is built: index.json, DamageArc.png,
// ShieldChase.png, ShieldQuad.png, ScoreMeter.png, the last team emblem (TeamEmblem8.png),
// AND the HUD's default font are all present in the output folder. A set built before one
// of those was added is missing it, so it is not ready and gets rebuilt once.
func HudSetReady(dataDir string) bool {
	dir := HudOutDir(dataDir)
	for _, name := range []string{"index.json", "DamageArc.png", "ShieldChase.png", "ShieldQuad.png", "ScoreMeter.png", "TeamEmblem8.png", hudFontRequired} {
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
	quadFiles, quadBytes, err := buildShieldQuad(ctx, ix, out)
	if err != nil {
		return 0, 0, 0, err
	}
	written += quadFiles
	total += quadBytes
	emblemFiles, emblemBytes, err := buildTeamEmblems(ctx, ix, out)
	if err != nil {
		return 0, 0, 0, err
	}
	written += emblemFiles
	total += emblemBytes
	meterFiles, meterBytes, err := buildScoreMeter(ctx, ix, out)
	if err != nil {
		return 0, 0, 0, err
	}
	written += meterFiles
	total += meterBytes
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

// resourceBlobAt returns the whole blob (ucsh header included) of the k-th resource
// OWNED by the entry, through entryResourceRange: k = 0 is the entry's own +0x10 index.
// It refuses a k outside the owned range.
func resourceBlobAt(ix *tagIndex, r tagRef, k int) ([]byte, error) {
	m, err := ix.open(r.Module)
	if err != nil {
		return nil, err
	}
	first, end := entryResourceRange(m, r.Entry)
	if k < 0 || k >= end-first {
		return nil, fmt.Errorf("resource %d outside the entry's owned range [%d, %d)", k, first, end)
	}
	tab, err := resourceTable(m)
	if err != nil {
		return nil, err
	}
	ixRes := first + k
	if ixRes >= len(tab) {
		return nil, fmt.Errorf("resource index %d out of table (%d)", ixRes, len(tab))
	}
	return m.extract(m.file(int(tab[ixRes])))
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

// shieldQuadBytes is the byte count of the quad's stored mip 0: 240x20 BC7 blocks.
const shieldQuadBytes = ((shieldQuadStoreW + 3) / 4) * ((shieldQuadH + 3) / 4) * 16

// resourcePayloadBytes returns a resource blob's pixel payload: the blob itself when it
// is a raw image, the bytes after the `ucsh` header when it carries one (the same rule
// as resourcePayloadOf, which requires the header — the shield-quad resources are raw).
// It returns nil when the header is present but its payload offset is out of range.
func resourcePayloadBytes(blob []byte) []byte {
	hdr, ok := parseTagHeader(blob)
	if !ok {
		return blob
	}
	off := int(hdr.HeaderSize) + int(hdr.DataSize)
	if off < 0 || off > len(blob) {
		return nil
	}
	return blob[off:]
}

// pickPayloadOfLen selects, among the entry's owned resource payloads, the one that is
// exactly n bytes long. It returns -1 when none fits.
func pickPayloadOfLen(payloads [][]byte, n int) int {
	for k, p := range payloads {
		if len(p) == n {
			return k
		}
	}
	return -1
}

// cropNRGBALeft crops a full-canvas NRGBA image to w x h, keeping the left edge (the
// quad's stored width carries empty columns past the declared width).
func cropNRGBALeft(src *image.NRGBA, w, h int) *image.NRGBA {
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		s := src.PixOffset(0, y)
		d := dst.PixOffset(0, y)
		copy(dst.Pix[d:d+w*4], src.Pix[s:s+w*4])
	}
	return dst
}

// ownedPayloads returns the pixel payloads of every resource the tag id's entry owns, in
// the module's resource-table order. Ownership: an entry's u32 at +0x10 is its FIRST
// resource index, and it owns resources up to (not including) the NEXT entry's +0x10 (see
// entryResourceRange). Each payload is one owned resource after resourcePayloadBytes (a
// raw image, or the bytes after its `ucsh` header). The `pc` variant carries the pixels,
// so its refs are tried first; entries that declare no resource (first == 0, the `ds`
// variant) are skipped. It returns the first resource-carrying variant's payloads and
// errors when the tag is absent or no variant carries a resource.
func ownedPayloads(ctx context.Context, ix *tagIndex, id uint32) ([][]byte, error) {
	// A copy: the sort below must not reorder the shared index's slice.
	refs := append([]tagRef(nil), ix.byID[id]...)
	if len(refs) == 0 {
		return nil, fmt.Errorf("tag 0x%08x not found in the install", id)
	}
	// The `pc` variant carries the resources; try its refs first so the read is
	// deterministic (the `ds` ones declare no resource and are skipped).
	sort.SliceStable(refs, func(i, j int) bool {
		return strings.Contains(filepath.ToSlash(refs[i].Module), "/pc/") &&
			!strings.Contains(filepath.ToSlash(refs[j].Module), "/pc/")
	})
	for _, r := range refs {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		m, err := ix.open(r.Module)
		if err != nil {
			return nil, fmt.Errorf("tag 0x%08x: %w", id, err)
		}
		first, end := entryResourceRange(m, r.Entry)
		if first == 0 {
			continue // the entry declares no resource (the `ds` variant)
		}
		payloads := make([][]byte, 0, end-first)
		for k := 0; k < end-first; k++ {
			blob, err := resourceBlobAt(ix, r, k)
			if err != nil {
				return nil, fmt.Errorf("tag 0x%08x: %w", id, err)
			}
			payloads = append(payloads, resourcePayloadBytes(blob))
		}
		return payloads, nil
	}
	return nil, fmt.Errorf("tag 0x%08x: no variant carries its pixel resources", id)
}

// buildShieldQuad writes ShieldQuad.png, the shield bar's main quad, from its tag
// (shieldQuadTag) into out: among the `pc` variant's owned resources (the entry's +0x10
// index to the next entry's), the one whose payload is exactly the stored 960x80 BC7
// size; it is decoded at 960x80 and cropped to 940x80. Returns the number of files
// written (0 or 1) and the file's byte count.
func buildShieldQuad(ctx context.Context, ix *tagIndex, out string) (written, bytes int, err error) {
	payloads, err := ownedPayloads(ctx, ix, shieldQuadTag)
	if err != nil {
		return 0, 0, err
	}
	k := pickPayloadOfLen(payloads, shieldQuadBytes)
	if k < 0 {
		return 0, 0, fmt.Errorf("shield quad tag %08x: no owned resource of the stored BC7 size", shieldQuadTag)
	}
	img, _, _, _ := decodeBC7(payloads[k], shieldQuadStoreW, shieldQuadH, nil)
	img = cropNRGBALeft(img, shieldQuadW, shieldQuadH)
	path := filepath.Join(out, "ShieldQuad.png")
	if err := writePNG(path, img); err != nil {
		return 0, 0, fmt.Errorf("write ShieldQuad.png: %w", err)
	}
	fi, err := os.Stat(path)
	if err != nil {
		return 0, 0, err
	}
	return 1, int(fi.Size()), nil
}

// decodeTeamEmblem decodes one team emblem payload's mip 0 (a 64x64 BC7 image) to a
// straight-alpha NRGBA. It refuses a payload shorter than mip 0 and decodes with
// mipGuide as the mode-7 witness, so the emblem's alpha is not lost to a flat fill.
func decodeTeamEmblem(payload []byte) (*image.NRGBA, error) {
	need := bcSize(teamEmblemSize, teamEmblemSize)
	if len(payload) < need {
		return nil, fmt.Errorf("team emblem payload is %d bytes, want at least %d for a %dx%d mip 0",
			len(payload), need, teamEmblemSize, teamEmblemSize)
	}
	img, _, _, _ := decodeBC7(payload, teamEmblemSize, teamEmblemSize, mipGuide(payload, 0, teamEmblemSize, teamEmblemSize))
	return img, nil
}

// buildTeamEmblems writes TeamEmblem0.png .. TeamEmblem8.png, the nine team emblems, from
// their tag (teamEmblemTag) into out: the tag's nine owned resources, each decoded at
// 64x64 and written unscaled. It refuses a tag that owns fewer than nine resources.
// Returns the number of files written (0 or 9) and total bytes.
func buildTeamEmblems(ctx context.Context, ix *tagIndex, out string) (written, bytes int, err error) {
	if err := ctx.Err(); err != nil {
		return 0, 0, err
	}
	payloads, err := ownedPayloads(ctx, ix, teamEmblemTag)
	if err != nil {
		return 0, 0, err
	}
	if len(payloads) < teamEmblemCount {
		return 0, 0, fmt.Errorf("team emblem tag %08x owns %d resources, want %d", teamEmblemTag, len(payloads), teamEmblemCount)
	}
	for k := 0; k < teamEmblemCount; k++ {
		img, err := decodeTeamEmblem(payloads[k])
		if err != nil {
			return 0, 0, fmt.Errorf("team emblem %d: %w", k, err)
		}
		name := fmt.Sprintf("TeamEmblem%d.png", k)
		path := filepath.Join(out, name)
		if err := writePNG(path, img); err != nil {
			return 0, 0, fmt.Errorf("write %s: %w", name, err)
		}
		fi, err := os.Stat(path)
		if err != nil {
			return 0, 0, err
		}
		written++
		bytes += int(fi.Size())
	}
	return written, bytes, nil
}

// scoreMeterBytes is the byte count of the meter's stored mip 0: 400x64 BC7 blocks.
const scoreMeterBytes = ((scoreMeterW + 3) / 4) * ((scoreMeterH + 3) / 4) * 16

// buildScoreMeter writes ScoreMeter.png, the score bar's meter bitmap, from its tag
// (scoreMeterTag) into out: among the `pc` variant's owned resources (the entry's +0x10
// index to the next entry's), the one whose payload is exactly the stored 1600x256 BC7
// size (scoreMeterBytes); it is decoded at 1600x256 and written as-is. Returns the number
// of files written (0 or 1) and the file's byte count.
func buildScoreMeter(ctx context.Context, ix *tagIndex, out string) (written, bytes int, err error) {
	payloads, err := ownedPayloads(ctx, ix, scoreMeterTag)
	if err != nil {
		return 0, 0, err
	}
	k := pickPayloadOfLen(payloads, scoreMeterBytes)
	if k < 0 {
		return 0, 0, fmt.Errorf("score meter tag %08x: no owned resource of the stored BC7 size", scoreMeterTag)
	}
	img, _, _, _ := decodeBC7(payloads[k], scoreMeterW, scoreMeterH, nil)
	path := filepath.Join(out, "ScoreMeter.png")
	if err := writePNG(path, img); err != nil {
		return 0, 0, fmt.Errorf("write ScoreMeter.png: %w", err)
	}
	fi, err := os.Stat(path)
	if err != nil {
		return 0, 0, err
	}
	return 1, int(fi.Size()), nil
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
