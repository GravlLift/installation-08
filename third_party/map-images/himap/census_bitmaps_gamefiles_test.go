// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

// LOCAL-CHANGE (infinite-theater-3d): The Library's bitmap census (2026-11-21), ported with the
// bitmap decoder fixes; the object viewer's decoder it also counted for is not part of this repo.
//
// census_bitmaps_gamefiles_test.go — the census of the bitmaps (`bitm`) of the whole installation
// (census_scope_gamefiles_test.go: default and Forge modules plus every other module, each tag read
// once by GlobalID). For every bitmap the records of its `bitmaps` block are read (type, format,
// size, depth, mip count, record count) and tallied; where its pixels live is checked (inline after
// the tag data, or resource entries of its own module); then its first image is decoded by
// LitBitmap (bitmap.go), the decoder the viewer's textures are read with, at its top mip, one
// bitmap at a time, the pixels dropped at once. Read-only; no map is loaded or rendered.
//
// WHICH COPY. The scope keeps the first copy of a GlobalID in the order pc, then any, then ds
// (censusVariants), so a bitmap is read from its `pc` or `any` copy whenever it has one: that is
// the copy a PC viewer draws. The `ds` (dedicated server) copies are stripped twins; a bitmap whose
// only copies are `ds` is counted apart, outside the unknowns ratchet.
//
// RECORD LAYOUT (40 bytes, Z-15/Halo-Infinite-Tag-Editor `Tag_Structures/bitm.xml`, cited not
// vendored; width, height, depth and format already read by bitmap.go): width u16 +0x00, height u16
// +0x02, depth u16 +0x04, type u8 +0x06 (2D, 3D, cube map, array), format u16 +0x08, flags u16
// +0x0A, mipmap count u8 +0x0C, curve u8 +0x0D, streaming scale f32 +0x10, source width and height
// u16 +0x14 / +0x16, resource handle +0x18.
//
// A bitmap decoded only at a smaller mip than its header's size is an unknown: the viewer draws it
// at reduced resolution. LitBitmap decodes through ../bitmapdecode (one format table; BC6H through
// bcn's half-float API, tone mapped; resource levels de-pitched from their 256-byte rows), so the
// format checks here are that package's.
//
// DECODE SCOPE. By default every bitmap is decoded at its top mip. CENSUS_BITMAPS_SAMPLE=<n>
// decodes only the first n bitmaps of each (format, type) pair, in scope order, for a quick run;
// the header and pixel location checks still cover every bitmap.
package himap

import (
	"cmp"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
	"github.com/JGtm/halo-infinite-map-images/bitmapdecode"
)

// Census numbers recorded on 2026-11-21 (whole installation of the installed build), the same on
// The Library's copy and on this one.
const (
	// censusBitmTotal is the number of distinct `bitm` GlobalIDs in all modules: 29302 with a copy
	// in the default and Forge modules, 17349 only in other modules.
	censusBitmTotal = 46651
	// censusBitmDSOnly is the number of those whose only copies are in `ds` modules (none: every
	// `ds` bitmap has a `pc` or `any` twin). Held exactly so a change of the installed build shows.
	censusBitmDSOnly = 0
	// censusBitmUnknownsMax is today's count of unknowns among the pc/any bitmaps (a header that
	// does not read, a type or format the decoder does not read, pixels that do not resolve, a
	// decode error, a top mip that does not decode). It may only go down.
	censusBitmUnknownsMax = 20
)

const (
	bitmapOffType = 0x06
	bitmapOffMips = 0x0C
)

// bitmapTypeNames are the values of the record's type enum.
var bitmapTypeNames = []string{"2D", "3D", "cube", "array"}

// bitmapFormatNames are the values of the record's format enum (bitm.xml), the names shortened.
var bitmapFormatNames = []string{
	"a8_unorm", "r8_unorm_rrr1", "r8_unorm_rrrr", "r8g8_unorm_rrrg", "unused1", "unused2",
	"b5g6r5_unorm", "unused3", "b5g6r5a1_unorm", "b4g4r4a4_unorm", "b8g8r8x8_unorm",
	"b8g8r8a8_unorm", "unused4", "dxt5_bias_alpha", "bc1_unorm", "bc2_unorm", "bc3_unorm",
	"a4r4g4b4_font", "unused7", "unused8", "rgbfp32", "unused9", "r8g8_snorm", "g8b8",
	"r32g32b32a32_float", "r16g16b16a16_float", "r16_float_rrr1", "r16_float_r000",
	"r8g8b8a8_snorm", "r10g10b10a2_unorm", "r16g16b16a16_unorm", "r16g16_snorm", "r16_unorm_rrr0",
	"r16g16_unorm", "r16g16b16a16_snorm", "dxt3a", "bc4_unorm_rrrr", "bc4_snorm_rrrr", "dxt3a_1111",
	"bc5_snorm", "ctx1", "dxt3a_alpha_only", "dxt3a_monochrome_only", "bc4_unorm_000r",
	"bc4_unorm_rrr1", "bc5_unorm_rrrg", "bc5_snorm_rrrg", "bc6h_uf16", "bc6h_sf16", "bc7_unorm",
	"d24_unorm_s8_uint", "r11g11b10_float", "r16g16_float",
}

// formatLabel names format value v as "<value> <name>".
func formatLabel(v int) string { return strconv.Itoa(v) + " " + enumLabel(bitmapFormatNames, v) }

// errNoBitmapRecord is readBitmRecords' error for a tag whose root reads but whose `bitmaps`
// block holds no record.
var errNoBitmapRecord = errors.New("the bitmaps block holds no record")

// bitmRecord is one record of a bitmap's `bitmaps` block.
type bitmRecord struct{ width, height, depth, kind, format, mips int }

// readBitmRecords reads every record of the `bitmaps` block of tag (header and tag data only, the
// inline pixels cut off), the way litEnteteBitmap finds the block.
func readBitmRecords(tag []byte) ([]bitmRecord, error) {
	rootRead := false
	for _, ti := range tagCandidates(tag) {
		rb, err := ti.rootBlockIndex()
		if err != nil {
			continue
		}
		rootRead = true
		c := ti.subBlockTarget(rb, bitmOffBitmaps)
		if c < 0 || c >= ti.dataBlocks {
			continue
		}
		abs, size := ti.blockAbs(c)
		if abs < 0 || size < bitmapStride || abs+size > len(tag) {
			continue
		}
		if size%bitmapStride != 0 {
			return nil, fmt.Errorf("bitmaps block of %d bytes, not a multiple of %d", size, bitmapStride)
		}
		out := make([]bitmRecord, size/bitmapStride)
		for k := range out {
			o := abs + k*bitmapStride
			out[k] = bitmRecord{width: int(u16(tag, o+bitmapOffLarg)), height: int(u16(tag, o+bitmapOffHaut)),
				depth: int(u16(tag, o+bitmapOffProf)), kind: int(tag[o+bitmapOffType]),
				format: int(u16(tag, o+bitmapOffFormat)), mips: int(tag[o+bitmapOffMips])}
		}
		return out, nil
	}
	if rootRead {
		return nil, errNoBitmapRecord
	}
	return nil, errors.New("no header candidate with a readable root")
}

// bitmResult is what the census learned of one bitmap. reason is "" when its first image decoded
// at its top mip, or when it was left out of the decode sample with nothing wrong before it.
type bitmResult struct {
	id      uint32
	recs    []bitmRecord
	pixels  string // "inline", "resources", or "" when not reached
	levels  int    // resource entries of the first image (mip levels), 0 for inline pixels
	decoded bool   // LitBitmap was called
	reason  string
	detail  string
	// thirdAt0C: the full tag (inline pixels included) is headerSize + dataSize + the u32 at +0x0c
	// from that pair, the shape tagCandidates does not scan (it reads the third size at +0x08).
	thirdAt0C bool
	// topHd1 names the `_hd1` companion that served the top level of a bitmap decoded at full size,
	// "" when its top level is not in one.
	topHd1 string
}

// thirdSectionAt0C reports whether tag's size is a (headerSize, dataSize) pair of the header scan
// window plus the u32 at +0x0c from it, with 0 at +0x08 (the effect owners census's finding).
func thirdSectionAt0C(tag []byte) bool {
	for h := tagHeaderScanFrom; h <= tagHeaderScanTo && h+0x10 <= len(tag); h += 4 {
		hs, ds, rs := u32(tag, h), u32(tag, h+4), u32(tag, h+0x0c)
		if hs > 0 && ds > 0 && rs > 0 && u32(tag, h+8) == 0 && hs+ds+rs == len(tag) {
			return true
		}
	}
	return false
}

// fail records reason and detail unless an earlier reason is already recorded.
func (r *bitmResult) fail(reason, detail string) {
	if r.reason == "" {
		r.reason, r.detail = reason, detail
	}
}

// first returns the first record (the image the decoder reads), zero when none was read.
func (r bitmResult) first() bitmRecord {
	if len(r.recs) == 0 {
		return bitmRecord{kind: -1, format: -1}
	}
	return r.recs[0]
}

// checkHeader reads the records of f and sets r.reason when its first record cannot be decoded
// whatever its pixels: unknown type, a format the decoder does not read, a zero size.
func checkHeader(m *himodule.Module, f himodule.File, r *bitmResult) {
	brut, err := m.Extract(f)
	if err != nil {
		r.reason, r.detail = "tag does not extract", err.Error()
		return
	}
	r.thirdAt0C = thirdSectionAt0C(brut)
	tag := brut
	if n := f.HeaderSize + f.TagDataSize; n > 0 && n <= len(brut) {
		tag = brut[:n]
	}
	if r.recs, err = readBitmRecords(tag); err != nil {
		r.reason, r.detail = "header unreadable", err.Error()
		if errors.Is(err, errNoBitmapRecord) {
			r.reason, r.detail = "no bitmap record (empty bitmaps block)", ""
		} else if thirdSectionAt0C(tag) {
			r.reason = "header unreadable: third section at +0x0c, not scanned by tagCandidates"
		}
		return
	}
	h := r.recs[0]
	_, ok := bitmapdecode.Lookup(h.format)
	switch {
	case h.kind >= len(bitmapTypeNames):
		r.reason = "type not in the layout"
	case !ok:
		r.reason = "format not decoded"
	case h.width <= 0 || h.height <= 0:
		r.reason, r.detail = "zero size", fmt.Sprintf("%dx%d", h.width, h.height)
	}
}

// checkPixels finds where f's pixels live and fails r when there are none: inline after the
// tag data, or the resource entries of f's first image, as LitBitmap reads them (niveauxBitmap).
func checkPixels(m *himodule.Module, f himodule.File, r *bitmResult) {
	if f.ActualResourceSize > 0 {
		r.pixels = "inline"
		return
	}
	res, err := niveauxBitmap(m, f, len(r.recs))
	if err != nil {
		r.fail("resources do not resolve", err.Error())
		return
	}
	if len(res) == 0 {
		r.fail("no pixel data (no inline data, no resource)", "")
		return
	}
	r.pixels, r.levels = "resources", len(res)
}

// decodeReason sorts a LitBitmap error into a census reason.
func decodeReason(err error) string {
	s := err.Error()
	switch {
	case errors.Is(err, ErrFormatBitmap):
		return "format not decoded"
	case errors.Is(err, bitmapdecode.ErrShortData):
		return "decode error: fewer bytes than the level needs"
	case strings.Contains(s, "hd1"):
		return "pixels in an _hd1 companion that does not open"
	case strings.Contains(s, "himap: decode "):
		return "decode error"
	}
	return "pixel data unreadable"
}

// inspectBitmap reads the header of f and, when its records read, checks where its pixels live
// (also for a bitmap the decoder already refuses, so the census knows whether it has pixels),
// without decoding them. The first reason found is kept.
func inspectBitmap(m *himodule.Module, f himodule.File) bitmResult {
	r := bitmResult{id: f.GlobalID}
	if checkHeader(m, f, &r); len(r.recs) > 0 {
		checkPixels(m, f, &r)
	}
	return r
}

// decodeBitmap decodes the first image of an inspected bitmap at its top mip through LitBitmap
// over idx, and sets r.reason when it does not decode at that size; the image is dropped on
// return.
func decodeBitmap(idx *ModuleIndex, r bitmResult) bitmResult {
	r.decoded = true
	tex, err := LitBitmap(idx, r.id, math.MaxInt)
	if err != nil {
		r.reason, r.detail = decodeReason(err), err.Error()
		return r
	}
	h := r.first()
	if w, ht := tex.Image.Rect.Dx(), tex.Image.Rect.Dy(); w != h.width || ht != h.height {
		reason, state := topLevelState(idx, r)
		r.fail(reason, fmt.Sprintf("%dx%d decoded for %dx%d; top level: %s", w, ht, h.width, h.height, state))
	} else if _, top, err := topLevelEntry(idx, r); err == nil && top.UseHd1() {
		r.topHd1 = filepath.Base(idx.chemins[idx.parID[r.id].module]) + "_hd1"
	}
	return r
}

// topLevelEntry returns the module and resource entry holding the top level of the first image of
// a bitmap read from resources (the last level, as LitBitmap orders them).
func topLevelEntry(idx *ModuleIndex, r bitmResult) (*himodule.Module, himodule.File, error) {
	e, ok := idx.parID[r.id]
	if !ok || r.pixels != "resources" {
		return nil, himodule.File{}, errors.New("pixels not from resources")
	}
	m := idx.modules[e.module]
	res, err := niveauxBitmap(m, e.fichier, len(r.recs))
	if err == nil && len(res) == 0 {
		err = errors.New("no level")
	}
	if err != nil {
		return nil, himodule.File{}, fmt.Errorf("levels unreadable: %w", err)
	}
	return m, res[len(res)-1], nil
}

// topLevelState names why the top level of a bitmap that decoded only at a smaller mip did not
// decode, as a census reason and a detail: its resource entry lives in the module's `_hd1`
// companion and that file is not installed, or is installed but the entry does not read from it;
// or the entry does not extract for another cause; or it extracts and its bytes do not decode.
func topLevelState(idx *ModuleIndex, r bitmResult) (reason, detail string) {
	const prefix = "top mip does not decode (a smaller mip does): "
	m, top, err := topLevelEntry(idx, r)
	if err != nil {
		return prefix + err.Error(), ""
	}
	_, err = m.Extract(top)
	switch {
	case err == nil:
		return prefix + "its bytes do not decode", fmt.Sprintf("entry %d", top.Index)
	case !top.UseHd1():
		return prefix + "entry does not extract", err.Error()
	}
	companion := idx.chemins[idx.parID[r.id].module] + "_hd1"
	if _, serr := os.Stat(companion); serr != nil {
		return prefix + "in an _hd1 companion that is not installed", filepath.Base(companion)
	}
	return prefix + "in an _hd1 companion the entry does not read from", filepath.Base(companion)
}

// eachBitmapEntry hands fn every bitmap of the scope once, by GlobalID, in scope.eachTag order:
// the base copies through the base index, then the bitmaps with no base copy module by module,
// each through a one-module index over its open module (the adapter LitBitmap needs).
func eachBitmapEntry(t *testing.T, s *censusScope, fn func(idx *ModuleIndex, m *himodule.Module, f himodule.File, area string)) {
	t.Helper()
	ids := s.base.EntreesDuGroupe(GroupeBitmap)
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		m, f, _ := s.base.entree(id)
		fn(s.base, m, f, s.area(0))
	}
	byModule := map[int]map[uint32]bool{}
	for id, e := range s.tags {
		if e.module >= s.nBase && e.groups[0] == GroupeBitmap {
			if byModule[e.module] == nil {
				byModule[e.module] = map[uint32]bool{}
			}
			byModule[e.module][id] = true
		}
	}
	for i := s.nBase; i < len(s.modules); i++ {
		want := byModule[i]
		if len(want) == 0 {
			continue
		}
		s.withModule(t, i, func(m *himodule.Module) {
			idx := &ModuleIndex{modules: []*himodule.Module{m}, chemins: []string{s.modules[i]}, parID: map[uint32]refEntree{}}
			var files []himodule.File
			for _, f := range m.Files(GroupeBitmap) {
				if want[f.GlobalID] {
					delete(want, f.GlobalID)
					idx.parID[f.GlobalID] = refEntree{module: 0, fichier: f}
					files = append(files, f)
				}
			}
			for _, f := range files {
				fn(idx, m, f, s.area(i))
			}
		})
	}
}

// bitmTally is the tallies of one population (the pc/any bitmaps, or the ds-only ones).
type bitmTally struct {
	seen, decoded, sampledOut                    int
	kinds, formats, records, sides, pixels, mips map[string]int
	// third counts the bitmaps by pixel location and whether their full tag carries the third
	// section at +0x0c (thirdSectionAt0C).
	third map[string]int
	// hd1Served counts, per `_hd1` companion, the bitmaps decoded at full size from it.
	hd1Served map[string]int
	unknowns  []bitmResult
}

func newBitmTally() *bitmTally {
	return &bitmTally{kinds: map[string]int{}, formats: map[string]int{}, records: map[string]int{},
		sides: map[string]int{}, pixels: map[string]int{}, mips: map[string]int{}, third: map[string]int{},
		hd1Served: map[string]int{}}
}

// sideBucket names the size class of a bitmap's largest side.
func sideBucket(s int) string {
	for _, b := range []int{1, 16, 64, 256, 1024, 2048, 4096} {
		if s <= b {
			return fmt.Sprintf("<=%d", b)
		}
	}
	return ">4096"
}

// add counts one bitmap's header, pixel location and outcome.
func (c *bitmTally) add(r bitmResult) {
	c.seen++
	if r.topHd1 != "" {
		c.hd1Served[r.topHd1]++
	}
	if r.thirdAt0C {
		c.third["third section at +0x0c, pixels "+cmp.Or(r.pixels, "not reached")]++
	}
	if r.decoded {
		c.decoded++
	} else if r.reason == "" {
		c.sampledOut++
	}
	if r.reason != "" {
		c.unknowns = append(c.unknowns, r)
	}
	if len(r.recs) == 0 {
		return
	}
	h := r.first()
	c.kinds[enumLabel(bitmapTypeNames, h.kind)]++
	c.formats[formatLabel(h.format)]++
	c.records[recordsBucket(len(r.recs), h.depth)]++
	c.sides[sideBucket(max(h.width, h.height))]++
	switch {
	case r.pixels == "inline":
		c.pixels["inline"]++
	case r.pixels == "resources":
		c.pixels["resources"]++
		c.mips[mipRelation(h.mips, r.levels)]++
	}
}

// recordsBucket names a bitmap's image count: its records, and the depth of its first one.
func recordsBucket(records, depth int) string {
	rec := "1 record"
	if records > 1 {
		rec = "2+ records"
	}
	if depth > 1 {
		return rec + ", depth 2+"
	}
	return rec + ", depth 1"
}

// mipRelation compares the mip count of the first record with the resource levels found.
func mipRelation(mips, levels int) string {
	switch {
	case levels == mips:
		return "levels = mip count"
	case levels == mips+1:
		return "levels = mip count + 1"
	case levels < mips:
		return "levels < mip count"
	}
	return "levels > mip count + 1"
}

// bitmUnknownGroups groups unknowns by reason and format of their first record, with the ids.
func bitmUnknownGroups(us []bitmResult) map[string][]bitmResult {
	g := map[string][]bitmResult{}
	for _, u := range us {
		k := u.reason
		if f := u.first().format; f >= 0 {
			k += " | format " + formatLabel(f)
		}
		g[k] = append(g[k], u)
	}
	return g
}

// logBitmUnknowns logs the unknowns grouped by reason and format, up to 8 ids and one detail each.
func logBitmUnknowns(t *testing.T, label string, us []bitmResult) {
	t.Helper()
	g := bitmUnknownGroups(us)
	keys := make([]string, 0, len(g))
	for k := range g {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if len(g[keys[i]]) != len(g[keys[j]]) {
			return len(g[keys[i]]) > len(g[keys[j]])
		}
		return keys[i] < keys[j]
	})
	var b strings.Builder
	for _, k := range keys {
		fmt.Fprintf(&b, "\n  %5d  %s:", len(g[k]), k)
		for i, u := range g[k] {
			if i == 8 {
				fmt.Fprintf(&b, " ...")
				break
			}
			fmt.Fprintf(&b, " %08x", u.id)
		}
		if d := g[k][0].detail; d != "" {
			fmt.Fprintf(&b, " (first: %s)", d)
		}
	}
	t.Logf("%s unknowns: %d, by reason and format:%s", label, len(us), b.String())
}

// logBitmTally logs one population's tallies and its unknowns.
func logBitmTally(t *testing.T, label string, c *bitmTally) {
	t.Helper()
	t.Logf("%s: %d bitmaps, %d decoded, %d left out of the decode sample, %d unknowns", label, c.seen, c.decoded, c.sampledOut, len(c.unknowns))
	t.Logf("%s types (first record): %s", label, countsByKey(c.kinds))
	t.Logf("%s formats (first record): %s", label, countsByKey(c.formats))
	t.Logf("%s images: %s", label, countsByKey(c.records))
	t.Logf("%s largest side: %s", label, countsByKey(c.sides))
	t.Logf("%s pixels: %s; resource levels vs mip count: %s", label, countsByKey(c.pixels), countsByKey(c.mips))
	t.Logf("%s full tags with a third section at +0x0c: %s", label, countsByKey(c.third))
	logBitmUnknowns(t, label, c.unknowns)
	unsupported, companions := map[string]int{}, map[string]int{}
	for _, u := range c.unknowns {
		if strings.HasPrefix(u.reason, "format not decoded") {
			unsupported[formatLabel(u.first().format)]++
		}
		if strings.Contains(u.reason, "_hd1 companion") {
			companions[u.detail[strings.LastIndex(u.detail, ": ")+2:]]++
		}
	}
	t.Logf("%s formats the decoder does not read: %s", label, countsByKey(unsupported))
	t.Logf("%s top mips in an _hd1 companion that does not open, per companion: %s", label, countsByKey(companions))
	t.Logf("%s top mips decoded from an _hd1 companion, per companion: %s", label, countsByKey(c.hd1Served))
}

// decodeSample returns the per-(format, type) decode cap from CENSUS_BITMAPS_SAMPLE, 0 for all.
func decodeSample(t *testing.T) int {
	v := os.Getenv("CENSUS_BITMAPS_SAMPLE")
	if v == "" {
		return 0
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		t.Fatalf("CENSUS_BITMAPS_SAMPLE=%q: a positive count expected", v)
	}
	return n
}

// TestCensusBitmaps is the census of the bitmaps (see the file header).
func TestCensusBitmaps(t *testing.T) {
	start := time.Now()
	s := openWholeScope(t)
	t.Logf("scope opened in %s", time.Since(start).Round(time.Second))
	sample := decodeSample(t)
	viewer, ds := newBitmTally(), newBitmTally()
	inBase, perPair, n := 0, map[string]int{}, 0
	eachBitmapEntry(t, s, func(idx *ModuleIndex, m *himodule.Module, f himodule.File, area string) {
		r := inspectBitmap(m, f)
		key := fmt.Sprintf("%d/%d", r.first().format, r.first().kind)
		perPair[key]++
		if r.reason == "" && (sample == 0 || perPair[key] <= sample) {
			r = decodeBitmap(idx, r)
		}
		if area == "default+Forge" {
			inBase++
		}
		if strings.HasPrefix(area, "ds/") {
			ds.add(r)
		} else {
			viewer.add(r)
		}
		if n++; n%5000 == 0 {
			t.Logf("%d bitmaps read, %s", n, time.Since(start).Round(time.Second))
		}
	})
	t.Logf("bitm: %d distinct (%d in default+Forge, %d only in other modules, of which %d only in ds), %d other-module openings, %s",
		n, inBase, n-inBase, ds.seen, s.opened, time.Since(start).Round(time.Second))
	logBitmTally(t, "pc/any", viewer)
	logBitmTally(t, "ds-only", ds)
	if n != censusBitmTotal || n != s.groupCount(GroupeBitmap) {
		t.Errorf("bitm total %d (scope %d), %d recorded", n, s.groupCount(GroupeBitmap), censusBitmTotal)
	}
	if ds.seen != censusBitmDSOnly {
		t.Errorf("ds-only bitmaps %d, %d recorded", ds.seen, censusBitmDSOnly)
	}
	if len(viewer.unknowns) > censusBitmUnknownsMax {
		t.Errorf("unknowns %d, more than the %d recorded", len(viewer.unknowns), censusBitmUnknownsMax)
	}
}

// enumLabel names value v of an enum from names, or gives it as a number past them.
func enumLabel(names []string, v int) string {
	if v >= 0 && v < len(names) {
		return names[v]
	}
	return fmt.Sprintf("value %d", v)
}

// countsByKey renders m as "key n" pairs, largest count first.
func countsByKey(m map[string]int) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if m[keys[i]] != m[keys[j]] {
			return m[keys[i]] > m[keys[j]]
		}
		return keys[i] < keys[j]
	})
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s %d", k, m[k]))
	}
	return strings.Join(parts, ", ")
}
