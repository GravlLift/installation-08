// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// icons.go — resolve, for each registered weapon family, the index of its icon in the
// atlas, read from the game and self-validated.

package weaponicons

import (
	"encoding/binary"
	"fmt"
	"sort"
)

// weaponIcon: what the game declares for one registered weapon family.
type weaponIcon struct {
	Key      string `json:"arme"`
	WeapTag  string `json:"weap_tag"`
	Atlas    string `json:"atlas_tag"`
	Index    int    `json:"sprite_index"`
	NameSID  string `json:"name_string_id"`
	AltIndex int    `json:"alt_sprite_index"`
}

// resolveWeaponIcons reads, for each weapon family, the `UI display info` block of its
// `weap` tag and extracts the index of its icon in the atlas.
//
// Every line returned is SELF-VALIDATED: it exists only if the block's `sprite` field
// carries one of the two known atlases. A weapon whose walk fails is absent from the
// result rather than present with an arbitrary index — the inverse would be invisible and
// false.
func resolveWeaponIcons(ix *tagIndex) ([]weaponIcon, error) {
	fields, err := loadWeapPlugin()
	if err != nil {
		return nil, fmt.Errorf("weap plugin unreadable: %w", err)
	}
	offSprite, offIndex, offName, ok := uiBlockOffsets(fields)
	if !ok {
		return nil, fmt.Errorf("`UI display info` block or its fields absent from the plugin")
	}
	// `alt sprite index` follows `alt sprite` (28 bytes) which follows `sprite index` (4).
	offAlt := offIndex + 4 + 28
	var out []weaponIcon
	for _, wf := range weaponFamilies() {
		refs := ix.byID[wf.ID]
		if len(refs) == 0 {
			continue
		}
		data, err := ix.extract(refs[0])
		if err != nil {
			continue
		}
		wt, err := openWeapTag(data)
		if err != nil {
			continue
		}
		abs, _, atlas, found := findUIBlock(wt, data, offSprite)
		if !found || abs+offAlt+4 > len(data) {
			continue
		}
		w := weaponIcon{
			Key:      wf.Key,
			WeapTag:  fmt.Sprintf("%08x", wf.ID),
			Atlas:    fmt.Sprintf("%08x", atlas),
			Index:    int(binary.LittleEndian.Uint32(data[abs+offIndex:])),
			AltIndex: int(binary.LittleEndian.Uint32(data[abs+offAlt:])),
		}
		if offName >= 0 && abs+offName+4 <= len(data) {
			w.NameSID = fmt.Sprintf("%08x", binary.LittleEndian.Uint32(data[abs+offName:]))
		}
		out = append(out, w)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Index < out[j].Index })
	return out, nil
}
