// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// weaplayout.go — THE `weap` TAG LAYOUT THE READERS USE, as a table of numbers.
//
// The readers of this package need a few dozen facts about the layout of the game's `weap` tag:
// the offsets of the root's 58 block fields (the run matching of runShift uses their spacing),
// where the aim-assist fields sit between them, and, for each of the four blocks read, the
// element size and the offsets of the fields read in an element. That is all this table holds.
// The numbers were first worked out from a community description of the tag's fields and are
// kept here as plain offsets of the game's file format, under this repository's own names.
//
// NOTHING HERE IS TRUSTED BLINDLY. Every reader checks the table against the live tag: a block
// field is found from the tag's own struct table through the spacing of the block fields around
// it (one matching run, or an error), an element size must divide the live block's size, and the
// `UI display info` block is identified by its content (its `sprite` must name a known atlas).
// A patch that moved any of these is reported as an error, never read as a value. Confirmed on
// the installed game 2026-11-19: the readers return the same values over all 194 installed
// `weap` tags as they did when the layout was walked from that description.

package weaponicons

import "fmt"

// weapRootBlockFields: the offsets, in the reference layout of the `weap` root, of the root's
// block fields, in order. The live root has grown since (fields added before some of them), so
// these are matched by their SPACING, never used as absolute offsets.
var weapRootBlockFields = []int{
	92, 268, 448, 468, 492, 512, 532, 556, 584, 604, // ... functions (468), attachments (584)
	624, 644, 664, 684, 704, 724, 800, 820, 1096, 1156,
	1176, 1196, 1224, 1280, 1328, 1352, 1400, 1420, 1512, 1548,
	1568, 1592, 1616, 1636, 1656, 1676, 1696, 1840, 1860,
	2456, // melee damage parameters
	2548, // aim assist modes
	2692, // target tracking
	2712, 2928, 2956, 2984,
	3104, // UI display info
	3152, // magazines
	3200, 3220, 3512, 3568, 3888, 3972, 4032, 4288, 4396, 4416,
}

// weapRootFields: the reference-layout offsets of the root's scalar fields read (aimassist.go).
var weapRootFields = map[string]int{
	pathMagLevels:   2504,
	pathMagRange:    2508,
	pathAimFlags:    2568,
	pathAutoaimBase: 2596,
	pathAutoaimBnds: 2600,
}

// Root block fields read, by this package's names.
const (
	pathUIDisplayInfo = "UI display info"
	fieldSprite       = "sprite"
	fieldSpriteIndex  = "sprite index"
	fieldName         = "name"
)

// weapBlockDef: a root block field read: its reference-layout offset in the root, the size of
// one element, and the offsets in an element of the fields read.
type weapBlockDef struct {
	field  int
	stride int
	at     map[string]int
}

var weapBlocks = map[string]weapBlockDef{
	pathFunctions: {field: 468, stride: 88, at: map[string]int{
		fieldFlags: 0, fieldImport: 4, fieldNoImport: 8, fieldExport: 12, fieldTurnOffWith: 16, fieldMapping: 32,
	}},
	pathAttachments: {field: 584, stride: 208, at: map[string]int{
		fieldAttachType: 4, fieldMarker: 192, fieldPrimaryScale: 200, fieldSecondaryScale: 204,
	}},
	pathUIDisplayInfo: {field: 3104, stride: 116, at: map[string]int{
		fieldName: 0, fieldSprite: 20, fieldSpriteIndex: 48,
	}},
	pathMagazines: {field: 3152, stride: 160, at: map[string]int{
		fieldRoundsLoadedMax: 10,
	}},
}

// uiBlockOffsets returns the offsets, in one `UI display info` element, of its `sprite`,
// `sprite index` and `name` fields.
func uiBlockOffsets() (offSprite, offIndex, offName int) {
	at := weapBlocks[pathUIDisplayInfo].at
	return at[fieldSprite], at[fieldSpriteIndex], at[fieldName]
}

// weapBlockLayout returns the layout of the root block field `path` (see blockLayout).
func weapBlockLayout(path string) (*blockLayout, error) {
	def, ok := weapBlocks[path]
	if !ok {
		return nil, fmt.Errorf("`%s` is not a block of the weap layout table", path)
	}
	rank := -1
	for i, off := range weapRootBlockFields {
		if off == def.field {
			rank = i
		}
	}
	if rank <= 0 || rank+1 >= len(weapRootBlockFields) {
		return nil, fmt.Errorf("`%s` at %d is not bracketed by root block fields", path, def.field)
	}
	at := make(map[string]int, len(def.at))
	for k, v := range def.at {
		at[k] = v
	}
	return &blockLayout{blocks: weapRootBlockFields, rank: rank, field: def.field, stride: def.stride, at: at}, nil
}
