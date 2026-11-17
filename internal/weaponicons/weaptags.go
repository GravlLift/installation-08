// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// weaptags.go — THE UNIVERSAL KEY OF THE ICON: the `weap` tag, not a name, not a product
// key.
//
// THE TRUE KEY WAS ALREADY DOCUMENTED: the HIGH 32 BITS of a filmshell identifier are the
// `weap`'s global tag id. Verified on real data:
//
//	Mutilator        0xd7915565_42c9679f -> tag d7915565 -> index 37
//	Sandwich         0x880fe0bc_42c9679f -> tag 880fe0bc -> index 35
//	Mythic Sandwich  0xb7262ca1_c8fb11d0 -> tag b7262ca1 -> index 35
//	MA5K Avenger     0xf5c335df_e7232c0b -> tag f5c335df -> index 36
//
// It depends on no name, no registry, no product table: it covers the registered weapons,
// their variants, AND those that are not in the registry. Only the sentinels (weapon_id
// 0/1/2 = generic grenade / melee / vehicle) stay out of its reach — they are product
// concepts, not game tags.
//
// WHY ALL GROUPS. The `UI display info` block is not specific to `weap`: it is a shared
// structure of the tag system. So every group is scanned, the self-validation against the
// atlas serving as the filter — a block is kept only if its `sprite` field carries a known
// atlas. That scan is what surfaced the index 29 (claimed outside `weap`).

package weaponicons

import (
	"fmt"
	"sort"
)

// maxAtlasIndex bounds the kept indices: beyond it, the value read is not an atlas index
// but a field of a block that passed the filter by chance.
const maxAtlasIndex = 128

// weapTagsByIndex returns, per atlas index, the tags that claim it — sorted, deduplicated.
func weapTagsByIndex(ix *tagIndex) (map[int][]string, error) {
	fields, err := loadWeapPlugin()
	if err != nil {
		return nil, err
	}
	offSprite, offIndex, _, ok := uiBlockOffsets(fields)
	if !ok {
		return nil, fmt.Errorf("`sprite` / `sprite index` fields absent from the plugin")
	}
	vus := map[uint32]bool{}
	parIndex := map[int]map[string]bool{}
	for groupe, refs := range ix.byGroup {
		if groupe == "bitm" {
			continue // bitmaps carry no interface block
		}
		for _, r := range refs {
			if vus[r.ID] {
				continue
			}
			vus[r.ID] = true
			data, err := ix.extract(r)
			if err != nil {
				continue
			}
			wt, err := openWeapTag(data)
			if err != nil {
				continue
			}
			abs, _, _, found := findUIBlock(wt, data, offSprite)
			if !found {
				continue
			}
			idx := int(readU32LE(data, abs+offIndex))
			if idx < 0 || idx >= maxAtlasIndex {
				continue
			}
			if parIndex[idx] == nil {
				parIndex[idx] = map[string]bool{}
			}
			parIndex[idx][fmt.Sprintf("%08x", r.ID)] = true
		}
	}
	out := make(map[int][]string, len(parIndex))
	for idx, set := range parIndex {
		tags := make([]string, 0, len(set))
		for t := range set {
			tags = append(tags, t)
		}
		sort.Strings(tags)
		out[idx] = tags
	}
	return out, nil
}
