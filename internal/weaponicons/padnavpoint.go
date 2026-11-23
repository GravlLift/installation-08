// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

import (
	"encoding/binary"
	"fmt"
	"math"
)

// PadNavpoint describes fields of the pad navpoint nvpt 259f5148.
//
// Its group 2 (offset TimerOffsetY above the icon) is the text over a power weapon's hex: a text
// element bound to the string "name_text" in font "industry_demi" (the item's name, NameTextSize)
// and a number element in font "normative_pro_bold_italic" (TimerSize, format TimerFormat), which
// the game shows as the distance ("53.8m" over "SHOCK RIFLE" in Jordan's capture of 2026-11-22).
// The Timer* names predate that reading; they are kept so served sets stay readable.
type PadNavpoint struct {
	IconWidth           float32 `json:"iconWidth"`
	IconHeight          float32 `json:"iconHeight"`
	IconAlpha           float32 `json:"iconAlpha"`
	TimerSize           uint32  `json:"timerSize"`
	TimerOffsetY        float32 `json:"timerOffsetY"`
	TimerFormat         uint32  `json:"timerFormat"`
	PowerColor          uint32  `json:"powerColor"`
	NumericTimerSize    uint32  `json:"numericTimerSize"`
	NumericTimerOffsetY float32 `json:"numericTimerOffsetY"`
	// NameTextSize is the font size of the item's name in group 2.
	NameTextSize uint32 `json:"nameTextSize"`
}

// The string ids the text group is checked against (announcer.StringID of each name).
const (
	navNameText       = 0xc2a79d5a // "name_text"
	navFontName       = 0xf7e5726e // "industry_demi"
	navFontDistance   = 0x7d72cc3a // "normative_pro_bold_italic"
	navTextFontOffset = 0x40
)

// ReadPadNavpoint reads the candidate's icon and timer fields, checking their identities.
func ReadPadNavpoint(tag []byte) (PadNavpoint, error) {
	var result PadNavpoint
	w, err := openWeapTag(tag)
	if err != nil {
		return result, err
	}
	root, err := w.rootBlock()
	if err != nil {
		return result, err
	}
	groups := w.childBlock(root, 0x44)
	ga, gs := w.blockAbs(groups)
	if ga < 0 || gs != 5*0xa8 || ga+gs > len(tag) {
		return result, fmt.Errorf("unexpected navpoint groups")
	}
	images := w.childBlock(groups, 0x58)
	ia, is := w.blockAbs(images)
	numbers := w.childBlock(groups, 2*0xa8+0x44)
	na, ns := w.blockAbs(numbers)
	numeric := w.childBlock(groups, 4*0xa8+0x44)
	ta, ts := w.blockAbs(numeric)
	if ia < 0 || is != 4*0x5c || ia+is > len(tag) || na < 0 || ns != 0x5c || na+ns > len(tag) || ta < 0 || ts != 0x5c || ta+ts > len(tag) {
		return result, fmt.Errorf("unexpected navpoint elements")
	}
	u := func(i int) uint32 { return binary.LittleEndian.Uint32(tag[i:]) }
	f := func(i int) float32 { return math.Float32frombits(u(i)) }
	if u(ia) != 0xc6e3db3c || u(na) != 0x8b5e436e || u(ia+2*0x5c) != 0x40892f58 || u(ta+0x48) != 0x83f1ae1e {
		return result, fmt.Errorf("unexpected navpoint element identities")
	}
	texts := w.childBlock(groups, 2*0xa8+0x30)
	xa, xs := w.blockAbs(texts)
	if xa < 0 || xs != 0x58 || xa+xs > len(tag) {
		return result, fmt.Errorf("unexpected navpoint name text")
	}
	if u(xa+0x48) != navNameText || u(xa+navTextFontOffset) != navFontName || u(na+navTextFontOffset) != navFontDistance {
		return result, fmt.Errorf("unexpected navpoint text identities")
	}
	result = PadNavpoint{
		IconWidth:           f(ia + 0x10),
		IconHeight:          f(ia + 0x14),
		IconAlpha:           f(ia + 0x1c),
		TimerSize:           u(na + 0x44),
		TimerOffsetY:        f(ga + 2*0xa8 + 0x10),
		TimerFormat:         u(na + 0x58),
		PowerColor:          u(ia + 2*0x5c + 0x18),
		NumericTimerSize:    u(ta + 0x44),
		NumericTimerOffsetY: f(ga + 4*0xa8 + 0x10),
		NameTextSize:        u(xa + 0x44),
	}
	if math.IsNaN(float64(result.IconWidth)) || math.IsNaN(float64(result.IconHeight)) || result.IconWidth <= 0 || result.IconHeight <= 0 {
		return PadNavpoint{}, fmt.Errorf("invalid navpoint dimensions")
	}
	return result, nil
}
