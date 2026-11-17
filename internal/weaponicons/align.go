// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// align.go — image descriptor <-> pixel resource pairing, and the per-tag cache.
//
// Kept apart from extract.go (the 500-line limit): this file carries only the question
// "which resource holds the pixels of which declared image", where the risk of a silent
// error is highest.

package weaponicons

import "fmt"

// bcSize: the weight of an image in 4x4 blocks of 16 bytes.
func bcSize(w, h int) int { return ((w + 3) / 4) * ((h + 3) / 4) * 16 }

// expectedSizes: the ADMISSIBLE payload weights of a resource for a given image — the
// cumulative sums of the mip chain, from mip0 alone up to the full chain. An exact check,
// not an interval: a resource is accepted if it weighs EXACTLY one of these values.
//
// The number of levels actually stored is not postulated. The `mips` field of the
// descriptor gives it for the weapon atlas (333x117 mips=2 -> 40320+10080+2688 = 53088, to
// the byte), but requiring it would reject 9 of the same atlas's 39 images: other entries
// store a shorter chain. Any truncation of the chain is accepted, which stays an exact
// equality — it is not a tolerance.
func expectedSizes(im bitmImg) []int {
	var out []int
	total, w, h := 0, im.W, im.H
	for lvl := 0; lvl < 14; lvl++ {
		total += bcSize(w, h)
		out = append(out, total)
		if w == 1 && h == 1 {
			break
		}
		w, h = max1(w/2), max1(h/2)
	}
	return out
}

func max1(v int) int {
	if v < 1 {
		return 1
	}
	return v
}

// alignImages pairs the image descriptors to the resources by ARITHMETIC CHECK, not by
// rank alone.
//
// WHY. Rank alone (resource[base+i] for descriptor i) drifted on the sandbox atlas: the
// descriptor census was then heuristic and its false positives consumed resources,
// shifting everything after — hence the striped images at the tail of the atlas. THE CAUSE
// IS HANDLED AT THE SOURCE since (scanImgs reads the declared array instead of hunting a
// signature) and no image drifts anymore.
//
// The check stays as a NET, and it is not decorative: a silent shift would serve one
// entry's icon for another, exactly the kind of fault that is never seen.
//
// HOW. Rank remains the starting point, but every pairing is CHECKED: the resource's
// payload must weigh exactly one cumulative sum of the mip chain. If it does not fit, a
// short forward probe re-aligns on the first resource that fits.
//
// If none fits, the rank pairing is KEPT but marked unverified (`align_verified=false`):
// rejecting it would lose icons that are correct to the eye. The doubt is reported in
// index.json, never swallowed.
// probeWindow: the probe depth of the re-alignment. Adjustable to measure its effect.
var probeWindow = 6

func alignImages(m *hmod, tab []uint32, base int, imgs []bitmImg) (slots []int, verified []bool) {
	window := probeWindow
	out := make([]int, len(imgs))
	okFlags := make([]bool, len(imgs))
	cur := base
	for i, im := range imgs {
		out[i] = -1
		want := expectedSizes(im)
		for probe := cur; probe < cur+window && probe < len(tab); probe++ {
			fi := int(tab[probe])
			if fi < 0 || fi >= m.hdr.FileCount {
				continue
			}
			blob, err := m.extract(m.file(fi))
			if err != nil {
				continue
			}
			rh, ok := parseTagHeader(blob)
			if !ok {
				continue
			}
			px := int(rh.HeaderSize) + int(rh.DataSize)
			if px < 0 || px > len(blob) {
				continue
			}
			payload := len(blob) - px
			match := false
			for _, w := range want {
				if payload == w {
					match = true
					break
				}
			}
			if !match {
				continue
			}
			out[i] = probe
			okFlags[i] = true
			cur = probe + 1
			break
		}
		if out[i] < 0 {
			// No resource fits exactly. Keep the rank and mark the doubt — BUT only if the
			// resource at rank can at least CONTAIN the mip0: otherwise the descriptor is a
			// false positive of the census, and keeping it would shift everything after (this
			// is what derailed the sandbox atlas after 41).
			if cur < len(tab) && resourcePayload(m, tab, cur) >= bcSize(im.W, im.H) {
				out[i] = cur
				cur++
			}
		}
	}
	return out, okFlags
}

// atlas: one icon `bitm` tag, its paired descriptors, and its archive's resource table.
// The pairing is costly (it decompresses to check the sizes): it is done ONCE per tag,
// then cached.
type atlas struct {
	mod   *hmod
	tab   []uint32
	imgs  []bitmImg // kept descriptors, in order
	verif []bool    // pairing confirmed by the arithmetic check
	slots []int     // resource index of each kept descriptor
}

// atlasOf pairs a tag's images to their resources once and for all.
func atlasOf(ix *tagIndex, id uint32) (*atlas, error) {
	if a, ok := ix.atlases[id]; ok {
		if a == nil {
			return nil, fmt.Errorf("tag %08x not usable", id)
		}
		return a, nil
	}
	build := func() (*atlas, error) {
		r, ok := pickRef(ix.byID[id])
		if !ok {
			return nil, fmt.Errorf("tag %08x absent from the archives", id)
		}
		m, err := ix.open(r.Module)
		if err != nil {
			return nil, err
		}
		tab, err := resourceTable(m)
		if err != nil {
			return nil, err
		}
		data, err := ix.extract(r)
		if err != nil {
			return nil, err
		}
		h, ok := parseTagHeader(data)
		if !ok {
			return nil, fmt.Errorf("tag %08x without a ucsh header", id)
		}
		all := scanImgs(data[h.HeaderSize:])
		slots, verif := alignImages(m, tab, entryResourceIndex(m, r.Entry), all)
		a := &atlas{mod: m, tab: tab}
		for i, s := range slots {
			if s >= 0 {
				a.imgs = append(a.imgs, all[i])
				a.slots = append(a.slots, s)
				a.verif = append(a.verif, verif[i])
			}
		}
		return a, nil
	}
	a, err := build()
	ix.atlases[id] = a
	return a, err
}

// resBlob returns the content of the resource paired to image idx, and the offset of its
// pixels. The resource is itself a blob with a `ucsh` header: the pixels start after
// headerSize + dataSize (checked to the byte, cf. the packet header).
func resBlob(ix *tagIndex, id uint32, idx int) (blob []byte, px int, im bitmImg, err error) {
	a, err := atlasOf(ix, id)
	if err != nil {
		return nil, 0, im, err
	}
	if idx < 0 || idx >= len(a.imgs) {
		return nil, 0, im, fmt.Errorf("index %d out of range (%d paired images)", idx, len(a.imgs))
	}
	blob, err = a.mod.extract(a.mod.file(int(a.tab[a.slots[idx]])))
	if err != nil {
		return nil, 0, im, err
	}
	rh, ok := parseTagHeader(blob)
	if !ok {
		return nil, 0, im, fmt.Errorf("resource %d without a ucsh header", a.slots[idx])
	}
	return blob, int(rh.HeaderSize) + int(rh.DataSize), a.imgs[idx], nil
}

// imageVerified says whether image idx's pairing was confirmed by the arithmetic check
// (exact weight of a mip chain) or only deduced from the rank.
func imageVerified(ix *tagIndex, id uint32, idx int) bool {
	a, err := atlasOf(ix, id)
	if err != nil || idx < 0 || idx >= len(a.verif) {
		return false
	}
	return a.verif[idx]
}

// resourcePayload returns the weight of a resource's payload (everything after its `ucsh`
// header), or -1 if it is not readable.
func resourcePayload(m *hmod, tab []uint32, slot int) int {
	if slot < 0 || slot >= len(tab) {
		return -1
	}
	fi := int(tab[slot])
	if fi < 0 || fi >= m.hdr.FileCount {
		return -1
	}
	blob, err := m.extract(m.file(fi))
	if err != nil {
		return -1
	}
	rh, ok := parseTagHeader(blob)
	if !ok {
		return -1
	}
	px := int(rh.HeaderSize) + int(rh.DataSize)
	if px < 0 || px > len(blob) {
		return -1
	}
	return len(blob) - px
}
