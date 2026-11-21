// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// hud.go — the HUD equipment and grenade icon set.
//
// Build the game's grenade and equipment HUD glyphs from their pinned atlases. Every
// pixel path goes through the shared bitmap decoder, with the format the bitmap's own
// header declares (never a format assumed by the caller).

package weaponicons

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
	"github.com/JGtm/halo-infinite-map-images/bitmapdecode"
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
// that shows the bearing of an incoming threat. Its pixels sit inside the tag's own
// bytes (after the header and the tag data, mip 0 first), unlike the HUD icon atlases,
// whose pixels live in the entry's resources. The CUI damage indicator screen `cusc`
// 0583f411 references this bitmap.
const damageArcTag = 0x41d89be1

// shieldChaseTag is the `bitm` tag id of the HUD's shield chase bitmap: the band the
// shield screen (`cusc` 9299c419, component `shield_chase`) draws over the shield just
// lost, in the bar's own shape. R = 255, G = 0, B = a left-to-right position ramp 0..255
// across the bar (the meter reveals by it), A = the band's shape. Its pixels are NOT
// inside the tag: they are an uncompressed resource (the format is the bitmap header's,
// read from the tag) in the entry's resources, and only the `pc` variant carries it
// (the `ds` variant's entry declares no resource).
const shieldChaseTag = 0x1a61d06e

// shieldQuadTag is the `bitm` tag id of the shield bar's main quad: the shape the shield
// screen (`cusc` 9299c419) draws the meter with. Its pixels are NOT inside the tag: they
// are in the entry's resources, mip 0 in the FIRST resource. The declared width is 940
// while it is stored 960 wide (columns 940..959 empty, one sample; reason unknown), so
// the image is written cropped to 940x80.
const shieldQuadTag = 0x1a9b2c75

// shieldQuadStoreW is the stored (padded) width of the quad bitmap; shieldQuadW and
// shieldQuadH are the dimensions written.
const (
	shieldQuadStoreW = 960
	shieldQuadW      = 940
	shieldQuadH      = 80
)

// teamEmblemTag is the `bitm` tag id of the team emblem set: nine 64x64 emblems, one per
// resource, white glyph on transparent alpha. Its `pc` entry owns the nine resources
// (k = 0..8), each the whole mip chain of its emblem (mip 0 at 64x64 first, then 32x32,
// 16x16, ...). The score bar screen (`cusc` 21a7dab4) shows it with prop_sprite_frame
// bound to `teamindex`, so resource k is the team index — inferred from the eagle/cobra
// order, not proven.
const (
	teamEmblemTag   = 0x7df5eede
	teamEmblemSize  = 64
	teamEmblemCount = 9
)

// scoreMeterTag is the `bitm` tag id of the score bar's meter: the meter on the center
// scoreboard screen (`cusc` fb8c6614, a fui_meter_two_tone_quad_widget, 404x60, its meter
// value bound to the score). The tag declares 800x64 while the pixels are stored at
// twice that (one sample; reason unknown). Its pixels are a channel-packed mask, NOT
// colors: R is constant (104), B is the bar's rounded-rectangle shape, G is a striped
// left-to-right ramp the meter value is compared against, and A is 255. The pixels are
// kept exactly as decoded (no tint, no channel changes): the web code reads B and G.
const scoreMeterTag = 0x128bc424

// scoreMeterW and scoreMeterH are the score meter bitmap's declared dimensions.
const (
	scoreMeterW = 800
	scoreMeterH = 64
)

// The shield screen (`cusc` 9299c419) draws three more pieces from these bitmaps, all
// measured 2026-11-19 (probe data/probe/shieldart):
//
//   - shieldGlowTag: the red glow over the frame while the shield is empty, two 1080x256
//     quads, the second mirrored, under a container tinted ARGB (1, 1, 0.224, 0.224). Its
//     pixels are inline in the tag. It is a channel-packed mask: R is 255, G is 0, A is
//     the glow (the left half of the frame's outline, the bitmap's right edge at the
//     screen's center), B a ramp from about 243 at the top to 3 at the bottom (the
//     two-tone quad's gradient coordinate, inferred).
//   - shieldBurstTag: the shield-break burst, a quad that scales out and fades in 766 ms
//     when the shield empties. Gray (R = G = B, at most 127) on A = 255: an arc of light,
//     drawn additively (inferred from the black background).
//   - healthBarTag: the health bar under the shield, 606x64 stored 640 wide. R is 255,
//     G is 0, A is the bar's shape (a thin strip with tick marks, rows about 24 to 40),
//     B a left-to-right ramp (the meter coordinate, inferred).
const (
	shieldGlowTag  = 0xf47d743f
	shieldGlowW    = 512
	shieldGlowH    = 256
	shieldBurstTag = 0x7139ad8e
	shieldBurstW   = 512
	shieldBurstH   = 256
	healthBarTag   = 0x30099cc7
	healthBarW     = 606
	healthBarH     = 64
	// healthBarStoreW is the health bar's stored (padded) width.
	healthBarStoreW = 640
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
	out := make([]string, 0, len(hudSources)+7+teamEmblemCount)
	for stem := range hudSources {
		out = append(out, stem)
	}
	out = append(out, "DamageArc", "ShieldChase", "ShieldQuad", "ScoreMeter", "ShieldGlow", "ShieldBurst", "HealthBar",
		"NavpointFill", "NavpointOutline", "NavpointArrow", "NavpointGlyph-weapon", "NavpointGlyph-equipment")
	for k := 0; k < teamEmblemCount; k++ {
		out = append(out, fmt.Sprintf("TeamEmblem%d", k))
	}
	sort.Strings(out)
	return out
}

// HudSetReady says whether the HUD icon set is built: index.json, DamageArc.png,
// ShieldChase.png, ShieldQuad.png, ScoreMeter.png, ShieldGlow.png, ShieldBurst.png,
// HealthBar.png, the last team emblem (TeamEmblem8.png), AND the HUD's default font are all
// present in the output folder. A set built before one of those was added is missing it,
// so it is not ready and gets rebuilt once.
func HudSetReady(dataDir string) bool {
	dir := HudOutDir(dataDir)
	for _, name := range []string{"index.json", "pad-navpoint.json", "hud-colors.json", "NavpointFill.png", "NavpointGlyph-weapon.png","DamageArc.png", "ShieldChase.png", "ShieldQuad.png", "ScoreMeter.png", "ShieldGlow.png", "ShieldBurst.png", "HealthBar.png", "TeamEmblem8.png", hudFontRequired} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			return false
		}
	}
	return true
}

// decodeBitmapTag decodes a `bitm` tag's first image, mip 0, through the shared bitmap
// decoder, with the format the tag's own bitmap header declares. The pixels are the tag's
// inline levels (after the header and the tag data, tight rows) when the entry carries them,
// the largest mip level of the tag's resources otherwise (its rows 256-byte pitched, the
// way a resource level is stored); the dimensions are the header's. It is the single-image
// read the HUD bitmaps need (the damage arc, the shield pieces, the score meter, the health
// bar): one image whose mip levels, when resource-backed, are the entry's resources.
func decodeBitmapTag(m *himodule.Module, f himodule.File) (*image.NRGBA, error) {
	data, err := m.Extract(f)
	if err != nil {
		return nil, err
	}
	body := data
	if n := f.HeaderSize + f.TagDataSize; n > 0 && n <= len(data) {
		body = data[:n]
	}
	e, err := readBitmHdr(body)
	if err != nil {
		return nil, err
	}
	fm, ok := bitmapdecode.Lookup(e.format)
	if !ok {
		return nil, fmt.Errorf("unsupported bitmap format %d", e.format)
	}
	if f.ActualResourceSize > 0 {
		// Inline: mip 0 follows the header and the tag data, tight rows.
		return fm.Decode(f.Donnees(data), e.w, e.h, bitmapdecode.Tight)
	}
	// Resource-backed: the mip levels are the entry's resources, smallest to largest; mip 0
	// is the largest. Decode it with its own row layout (256-byte pitched when the level
	// holds the padded size), the read himap's level reader makes.
	res, err := m.Ressources(f)
	if err != nil || len(res) == 0 {
		return nil, fmt.Errorf("entry owns no resource")
	}
	var best himodule.File
	for _, r := range res {
		if best.UncompSize == 0 || r.UncompSize > best.UncompSize {
			best = r
		}
	}
	octets, err := m.Extract(best)
	if err != nil {
		return nil, err
	}
	px := best.Donnees(octets)
	return fm.Decode(px, e.w, e.h, fm.ResourceLayout(len(px), e.w, e.h))
}

// decodeBitmapLayer decodes layer `layer` of the FIRST image of a `bitm` tag — a texture
// array where the first record's `depth` is the number of layers (each a frame) and the
// inline (or resource) pixels hold them one after another, each its mip 0 (tight rows).
// The format is the record's own, through the shared decoder. This is the read the
// navpoint badge's frames need (one frame per layer of its sprite).
func decodeBitmapLayer(m *himodule.Module, f himodule.File, layer int) (*image.NRGBA, error) {
	data, err := m.Extract(f)
	if err != nil {
		return nil, err
	}
	body := data
	if n := f.HeaderSize + f.TagDataSize; n > 0 && n <= len(data) {
		body = data[:n]
	}
	e, err := readBitmHdr(body)
	if err != nil {
		return nil, err
	}
	if e.count <= 0 {
		return nil, fmt.Errorf("bitm: no image declared")
	}
	// The first record's `depth` (the u16 at +0x04) is the number of layers.
	depth := int(binary.LittleEndian.Uint16(body[e.off+4:]))
	if depth <= 0 {
		depth = 1
	}
	if layer < 0 || layer >= depth {
		return nil, fmt.Errorf("layer %d outside the %d layers", layer, depth)
	}
	fm, ok := bitmapdecode.Lookup(e.format)
	if !ok {
		return nil, fmt.Errorf("unsupported bitmap format %d", e.format)
	}
	var flat []byte
	if f.ActualResourceSize > 0 {
		flat = f.Donnees(data)
	} else {
		res, err := m.Ressources(f)
		if err != nil {
			return nil, err
		}
		for k := len(res) - 1; k >= 0; k-- {
			octets, err := m.Extract(res[k])
			if err != nil {
				continue
			}
			flat = append(flat, res[k].Donnees(octets)...)
		}
	}
	level := fm.LevelSize(e.w, e.h)
	off := layer * level
	if off+level > len(flat) {
		return nil, fmt.Errorf("layer %d outside the %d pixel bytes", layer, len(flat))
	}
	return fm.Decode(flat[off:off+level], e.w, e.h, bitmapdecode.Tight)
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
	ref, ok := pickRef(ix.byID[0x259f5148])
	if !ok {
		return 0, 0, 0, fmt.Errorf("navpoint tag 259f5148 not found")
	}
	tag, err := ix.extract(ref)
	if err != nil {
		return 0, 0, 0, err
	}
	navpoint, err := ReadPadNavpoint(tag)
	if err != nil {
		return 0, 0, 0, err
	}
	badge, badgeFiles, badgeBytes, err := buildNavpointBadge(ix, tag, out)
	if err != nil {
		return 0, 0, 0, err
	}
	navJSON, err := json.Marshal(struct {
		PadNavpoint
		Badge NavpointBadge `json:"badge"`
	}{navpoint, badge})
	if err != nil {
		return 0, 0, 0, err
	}

	var entries []hudName
	for stem, source := range hudSources {
		entries = append(entries, hudName{Index: source.index, Atlas: source.atlas, File: stem + ".png", Game: stem})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].File < entries[j].File })

	total, written, decoded, err := writeHudAtlas(ctx, ix, entries, out)
	if err != nil {
		return 0, 0, 0, err
	}
	colorFiles, colorBytes, err := buildHudColors(ix, out)
	if err != nil {
		return 0, 0, 0, err
	}
	written += 1 + badgeFiles + colorFiles
	total += len(navJSON) + 1 + badgeBytes + colorBytes
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
	for _, build := range []func(context.Context, *tagIndex, string) (int, int, error){buildShieldGlow, buildShieldBurst, buildHealthBar} {
		n, b, err := build(ctx, ix, out)
		if err != nil {
			return 0, 0, 0, err
		}
		written += n
		total += b
	}
	fontFiles, fontBytes, err := buildHudFonts(ctx, ix, out)
	if err != nil {
		return 0, 0, 0, err
	}
	written += fontFiles
	total += fontBytes
	if err := os.WriteFile(filepath.Join(out, "pad-navpoint.json"), append(navJSON, '\n'), 0o600); err != nil {
		return 0, 0, 0, err
	}
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
	m, err := ix.open(ref.Module)
	if err != nil {
		return 0, 0, fmt.Errorf("damage arc tag %08x: %w", damageArcTag, err)
	}
	f, ok := ix.byEntry[ref.Module][ref.Entry]
	if !ok {
		return 0, 0, fmt.Errorf("damage arc tag %08x: entry %d out of range", damageArcTag, ref.Entry)
	}
	img, err := decodeBitmapTag(m, f)
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

// errNoResource names a ref whose entry owns no resource: the `ds` variant does this
// for every pixel-carrying tag, so the readers skip it for the `pc` one.
var errNoResource = fmt.Errorf("entry owns no resource")

// firstResourceBlob returns the full extracted bytes (ucsh header included) of the
// entry's FIRST resource, through the entry's resource index (+0x10) into the module's
// resource table. The font reader parses the resource's own header, so it needs the whole
// blob, not the payload past it.
func firstResourceBlob(ix *tagIndex, r tagRef) ([]byte, error) {
	m, err := ix.open(r.Module)
	if err != nil {
		return nil, err
	}
	f, ok := ix.byEntry[r.Module][r.Entry]
	if !ok {
		return nil, fmt.Errorf("entry %d out of range in %s", r.Entry, r.Module)
	}
	res, err := m.Ressources(f)
	if err != nil || len(res) == 0 {
		return nil, errNoResource
	}
	return m.Extract(res[0])
}

// ownedResources returns the resource entries owned by the tag id's entry, in the
// module's resource-table order: from the entry's own +0x10 index to (not including) the
// next entry's (see himodule.Ressources). The `pc` variant carries the pixels, so its
// refs are tried first; entries that own no resource (the `ds` variant) are skipped. It
// returns the first resource-carrying variant's resources and errors when the tag is
// absent or no variant carries one.
func ownedResourcesWithRef(ctx context.Context, ix *tagIndex, id uint32) (tagRef, []himodule.File, error) {
	// A copy: the sort below must not reorder the shared index's slice.
	refs := append([]tagRef(nil), ix.byID[id]...)
	if len(refs) == 0 {
		return tagRef{}, nil, fmt.Errorf("tag 0x%08x not found in the install", id)
	}
	sort.SliceStable(refs, func(i, j int) bool {
		return strings.Contains(filepath.ToSlash(refs[i].Module), "/pc/") &&
			!strings.Contains(filepath.ToSlash(refs[j].Module), "/pc/")
	})
	for _, r := range refs {
		if err := ctx.Err(); err != nil {
			return tagRef{}, nil, err
		}
		m, err := ix.open(r.Module)
		if err != nil {
			return tagRef{}, nil, fmt.Errorf("tag 0x%08x: %w", id, err)
		}
		f, ok := ix.byEntry[r.Module][r.Entry]
		if !ok {
			return tagRef{}, nil, fmt.Errorf("tag 0x%08x: entry %d out of range", id, r.Entry)
		}
		res, err := m.Ressources(f)
		if err != nil {
			return tagRef{}, nil, fmt.Errorf("tag 0x%08x: %w", id, err)
		}
		if len(res) == 0 {
			continue // the entry owns no resource (the `ds` variant)
		}
		return r, res, nil
	}
	return tagRef{}, nil, fmt.Errorf("tag 0x%08x: no variant carries its pixel resources", id)
}

func ownedResources(ctx context.Context, ix *tagIndex, id uint32) ([]himodule.File, error) {
	_, res, err := ownedResourcesWithRef(ctx, ix, id)
	return res, err
}

// buildShieldChase writes ShieldChase.png, the shield chase bitmap, from its tag
// (shieldChaseTag) into out: the tag's first resource, an uncompressed payload in the
// `pc` variant, decoded with the format the bitmap header declares. It returns the
// number of files written (0 or 1) and the file's byte count.
func buildShieldChase(ctx context.Context, ix *tagIndex, out string) (written, bytes int, err error) {
	// A copy: the sort below must not reorder the shared index's slice.
	refs := append([]tagRef(nil), ix.byID[shieldChaseTag]...)
	if len(refs) == 0 {
		return 0, 0, fmt.Errorf("shield chase tag %08x not found in the install", shieldChaseTag)
	}
	// The `pc` variant carries the pixels; try its refs first so the read is
	// deterministic (the `ds` ones own no resource and are skipped).
	sort.SliceStable(refs, func(i, j int) bool {
		return strings.Contains(filepath.ToSlash(refs[i].Module), "/pc/") &&
			!strings.Contains(filepath.ToSlash(refs[j].Module), "/pc/")
	})
	for _, r := range refs {
		if err := ctx.Err(); err != nil {
			return 0, 0, err
		}
		m, err := ix.open(r.Module)
		if err != nil {
			return 0, 0, fmt.Errorf("shield chase tag %08x: %w", shieldChaseTag, err)
		}
		f, ok := ix.byEntry[r.Module][r.Entry]
		if !ok {
			return 0, 0, fmt.Errorf("shield chase tag %08x: entry %d out of range", shieldChaseTag, r.Entry)
		}
		img, err := decodeBitmapTag(m, f)
		if err == errNoResource {
			continue
		}
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

// ownedBitmapEntry returns the entry of the tag id that carries its pixels: the `pc`
// variant's ref when it is found (it is the one that owns the resources), the first ref
// otherwise. It errors when the tag is absent from the install.
func ownedBitmapEntry(ix *tagIndex, id uint32) (tagRef, error) {
	refs := ix.byID[id]
	if len(refs) == 0 {
		return tagRef{}, fmt.Errorf("tag 0x%08x not found in the install", id)
	}
	r, ok := pickRef(refs)
	if !ok {
		return tagRef{}, fmt.Errorf("tag 0x%08x not found in the install", id)
	}
	return r, nil
}

// bitmapFormatOf returns the format the tag id's own bitmap header declares.
func bitmapFormatOf(ix *tagIndex, id uint32) (bitmapdecode.Format, error) {
	r, err := ownedBitmapEntry(ix, id)
	if err != nil {
		return bitmapdecode.Format{}, err
	}
	m, err := ix.open(r.Module)
	if err != nil {
		return bitmapdecode.Format{}, err
	}
	f, ok := ix.byEntry[r.Module][r.Entry]
	if !ok {
		return bitmapdecode.Format{}, fmt.Errorf("tag 0x%08x: entry %d out of range", id, r.Entry)
	}
	data, err := m.Extract(f)
	if err != nil {
		return bitmapdecode.Format{}, err
	}
	body := data
	if n := f.HeaderSize + f.TagDataSize; n > 0 && n <= len(data) {
		body = data[:n]
	}
	e, err := readBitmHdr(body)
	if err != nil {
		return bitmapdecode.Format{}, err
	}
	fm, ok := bitmapdecode.Lookup(e.format)
	if !ok {
		return bitmapdecode.Format{}, fmt.Errorf("tag 0x%08x: unsupported bitmap format %d", id, e.format)
	}
	return fm, nil
}

// decodeMip0 decodes a w x h mip 0 held at the start of px through the shared decoder,
// tight rows. It refuses a payload shorter than the level.
func decodeMip0(px []byte, fm bitmapdecode.Format, w, h int) (*image.NRGBA, error) {
	need := fm.LevelSize(w, h)
	if len(px) < need {
		return nil, fmt.Errorf("payload is %d bytes, want at least %d for a %dx%d mip 0", len(px), need, w, h)
	}
	return fm.Decode(px, w, h, bitmapdecode.Tight)
}

// buildShieldQuad writes ShieldQuad.png, the shield bar's main quad, from its tag
// (shieldQuadTag) into out: the pixels of its tag, cropped to the declared 940x80 (the
// stored width carries empty columns). Returns the number of files written (0 or 1) and
// the file's byte count.
func buildShieldQuad(ctx context.Context, ix *tagIndex, out string) (written, bytes int, err error) {
	ref, err := ownedBitmapEntry(ix, shieldQuadTag)
	if err != nil {
		return 0, 0, err
	}
	m, err := ix.open(ref.Module)
	if err != nil {
		return 0, 0, fmt.Errorf("shield quad tag %08x: %w", shieldQuadTag, err)
	}
	f, ok := ix.byEntry[ref.Module][ref.Entry]
	if !ok {
		return 0, 0, fmt.Errorf("shield quad tag %08x: entry %d out of range", shieldQuadTag, ref.Entry)
	}
	img, err := decodeBitmapTag(m, f)
	if err != nil {
		return 0, 0, fmt.Errorf("shield quad tag %08x: %w", shieldQuadTag, err)
	}
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

// max1 is a value clamped to at least 1 (the mip chain halves down to 1).
func max1(v int) int {
	if v < 1 {
		return 1
	}
	return v
}

// resourceLevelPayload returns the pixel payload of the k-th resource owned by the tag
// id's entry (the bytes past the resource's own `ucsh` header, when it carries one).
func resourceLevelPayload(m *himodule.Module, res []himodule.File, k int) ([]byte, error) {
	if k < 0 || k >= len(res) {
		return nil, fmt.Errorf("resource %d outside the entry's %d", k, len(res))
	}
	blob, err := m.Extract(res[k])
	if err != nil {
		return nil, err
	}
	return res[k].Donnees(blob), nil
}

// buildTeamEmblems writes TeamEmblem0.png .. TeamEmblem8.png, the nine team emblems, from
// their tag (teamEmblemTag) into out: the tag's nine owned resources, each decoded at
// 64x64 with the format the bitmap header declares, written unscaled. It refuses a tag
// that owns fewer than nine resources. Returns the number of files written (0 or 9) and
// total bytes.
func buildTeamEmblems(ctx context.Context, ix *tagIndex, out string) (written, bytes int, err error) {
	if err := ctx.Err(); err != nil {
		return 0, 0, err
	}
	ref, err := ownedBitmapEntry(ix, teamEmblemTag)
	if err != nil {
		return 0, 0, err
	}
	res, err := ownedResources(ctx, ix, teamEmblemTag)
	if err != nil {
		return 0, 0, err
	}
	if len(res) < teamEmblemCount {
		return 0, 0, fmt.Errorf("team emblem tag %08x owns %d resources, want %d", teamEmblemTag, len(res), teamEmblemCount)
	}
	fm, err := bitmapFormatOf(ix, teamEmblemTag)
	if err != nil {
		return 0, 0, err
	}
	m, err := ix.open(ref.Module)
	if err != nil {
		return 0, 0, err
	}
	for k := 0; k < teamEmblemCount; k++ {
		px, err := resourceLevelPayload(m, res, k)
		if err != nil {
			return 0, 0, fmt.Errorf("team emblem %d: %w", k, err)
		}
		img, err := decodeMip0(px, fm, teamEmblemSize, teamEmblemSize)
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

// buildScoreMeter writes ScoreMeter.png, the score bar's meter bitmap, from its tag
// (scoreMeterTag) into out, decoded at the dimensions its bitmap header declares.
// Returns the number of files written (0 or 1) and the file's byte count.
func buildScoreMeter(ctx context.Context, ix *tagIndex, out string) (written, bytes int, err error) {
	ref, err := ownedBitmapEntry(ix, scoreMeterTag)
	if err != nil {
		return 0, 0, err
	}
	m, err := ix.open(ref.Module)
	if err != nil {
		return 0, 0, err
	}
	f, ok := ix.byEntry[ref.Module][ref.Entry]
	if !ok {
		return 0, 0, fmt.Errorf("score meter tag %08x: entry %d out of range", scoreMeterTag, ref.Entry)
	}
	img, err := decodeBitmapTag(m, f)
	if err != nil {
		return 0, 0, fmt.Errorf("score meter tag %08x: %w", scoreMeterTag, err)
	}
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

// writeHudFile writes img as out/name and returns 1 and the file's byte count.
func writeHudFile(out, name string, img image.Image) (written, bytes int, err error) {
	path := filepath.Join(out, name)
	if err := writePNG(path, img); err != nil {
		return 0, 0, fmt.Errorf("write %s: %w", name, err)
	}
	fi, err := os.Stat(path)
	if err != nil {
		return 0, 0, err
	}
	return 1, int(fi.Size()), nil
}

// buildShieldGlow writes ShieldGlow.png, the empty-shield glow (shieldGlowTag), from the
// pixels of its tag, kept as decoded (the web code reads A).
func buildShieldGlow(ctx context.Context, ix *tagIndex, out string) (written, bytes int, err error) {
	if err := ctx.Err(); err != nil {
		return 0, 0, err
	}
	ref, err := ownedBitmapEntry(ix, shieldGlowTag)
	if err != nil {
		return 0, 0, err
	}
	m, err := ix.open(ref.Module)
	if err != nil {
		return 0, 0, fmt.Errorf("shield glow tag %08x: %w", shieldGlowTag, err)
	}
	f, ok := ix.byEntry[ref.Module][ref.Entry]
	if !ok {
		return 0, 0, fmt.Errorf("shield glow tag %08x: entry %d out of range", shieldGlowTag, ref.Entry)
	}
	img, err := decodeBitmapTag(m, f)
	if err != nil {
		return 0, 0, fmt.Errorf("shield glow tag %08x: %w", shieldGlowTag, err)
	}
	return writeHudFile(out, "ShieldGlow.png", img)
}

// buildShieldBurst writes ShieldBurst.png, the shield-break burst (shieldBurstTag), from
// the pixels of its tag.
func buildShieldBurst(ctx context.Context, ix *tagIndex, out string) (written, bytes int, err error) {
	ref, err := ownedBitmapEntry(ix, shieldBurstTag)
	if err != nil {
		return 0, 0, err
	}
	m, err := ix.open(ref.Module)
	if err != nil {
		return 0, 0, fmt.Errorf("shield burst tag %08x: %w", shieldBurstTag, err)
	}
	f, ok := ix.byEntry[ref.Module][ref.Entry]
	if !ok {
		return 0, 0, fmt.Errorf("shield burst tag %08x: entry %d out of range", shieldBurstTag, ref.Entry)
	}
	img, err := decodeBitmapTag(m, f)
	if err != nil {
		return 0, 0, fmt.Errorf("shield burst tag %08x: %w", shieldBurstTag, err)
	}
	return writeHudFile(out, "ShieldBurst.png", img)
}

// buildHealthBar writes HealthBar.png, the health bar (healthBarTag): the pixels of its
// tag, cropped to the declared 606x64 (the stored width carries empty columns).
func buildHealthBar(ctx context.Context, ix *tagIndex, out string) (written, bytes int, err error) {
	ref, err := ownedBitmapEntry(ix, healthBarTag)
	if err != nil {
		return 0, 0, err
	}
	m, err := ix.open(ref.Module)
	if err != nil {
		return 0, 0, fmt.Errorf("health bar tag %08x: %w", healthBarTag, err)
	}
	f, ok := ix.byEntry[ref.Module][ref.Entry]
	if !ok {
		return 0, 0, fmt.Errorf("health bar tag %08x: entry %d out of range", healthBarTag, ref.Entry)
	}
	img, err := decodeBitmapTag(m, f)
	if err != nil {
		return 0, 0, fmt.Errorf("health bar tag %08x: %w", healthBarTag, err)
	}
	return writeHudFile(out, "HealthBar.png", cropNRGBALeft(img, healthBarW, healthBarH))
}

// writeHudAtlas decodes each named image, scales it to hudIconSize×hudIconSize, and
// writes the PNG. Returns the byte count, file count, and decoded descriptors.
func writeHudAtlas(ctx context.Context, ix *tagIndex, entries []hudName, out string) (total, written int, decoded map[string]bitmImg, err error) {
	decoded = map[string]bitmImg{}
	for _, e := range entries {
		if err := ctx.Err(); err != nil {
			return 0, 0, nil, err
		}
		cropped, im, err := decodeAlphaGlyph(ix, e.Atlas, e.Index)
		if err != nil {
			return 0, 0, nil, fmt.Errorf("hud icon %s (index %d): %w", e.File, e.Index, err)
		}
		if cropped.Bounds().Dx() < 2 || cropped.Bounds().Dy() < 2 {
			return 0, 0, nil, fmt.Errorf("hud icon %s: empty source", e.File)
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

// fitDown halves src until its longest edge is at most size (the cote semantics: a frame
// smaller than the cote passes through at its own size, never upscaled). Nearest-neighbor.
func fitDown(src *image.NRGBA, size int) *image.NRGBA {
	img := src
	for max(img.Bounds().Dx(), img.Bounds().Dy()) > size && img.Bounds().Dx() > 1 && img.Bounds().Dy() > 1 {
		b := img.Bounds()
		dst := image.NewNRGBA(image.Rect(0, 0, b.Dx()/2, b.Dy()/2))
		for y := 0; y < b.Dy()/2; y++ {
			sy := 2*y + b.Min.Y
			so := src.PixOffset(b.Min.X, sy)
			do := dst.PixOffset(0, y)
			for x := 0; x < b.Dx()/2; x++ {
				copy(dst.Pix[do+x*4:do+x*4+4], src.Pix[so+(2*x)*4:so+(2*x)*4+4])
			}
		}
		img = dst
	}
	return img
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
