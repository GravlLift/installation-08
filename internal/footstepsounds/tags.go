package footstepsounds

import "encoding/binary"

// The tables below list the Spartan's foot and movement sound tags, name to the GlobalID the
// game's tagnames.txt records for it. tagnames.txt writes that id big-endian, while the module
// index addresses tags by the byte-swapped value, so the build swaps the bytes (tagID). The
// names are the last path segment of the tag's game path: the foot steps are
// `006_chs_un_spartan_feet_<surface>_<action>` under character_surface, the movement sounds
// `006_chm_un_spartan_<action>` under character_movement.
//
// The action vocabulary the game uses is walk, run, sprint, shuffle, slide, land and landhard.
// Two combinations do not exist in the game and are left out of the table: grasstall_slide and
// rock_slide. One movement tag is left out of movementIDs on purpose: it plays nothing in the
// installed game:
//   - 006_chm_un_spartan_slide (0x9E732DC4): both its events are empty no-ops in the installed
//     game; it plays nothing.
//
// 006_chm_un_spartan_slide_outof (0x2A52684E) is in the table: its event's sound actions target
// a random sequence container per take, and each container lives in a sibling bank of its own.
// The resolver follows those cross-bank containers (internal/wwise links the sibling's objects
// into the event's bank), so it resolves to its takes like the other movement sounds.

// feetIDs maps a surface to its foot step sounds, action to tag id.
var feetIDs = map[string]map[string]uint32{
	"default":     {walk: 0x5B8D6FC4, run: 0x343E5BA2, sprint: 0x47134041, shuffle: 0x32C64A31, slide: 0x184BCEA7, land: 0xB4EF141B, landhard: 0x77BF8B02},
	"dirt":        {walk: 0x9ACCE447, run: 0x9B32AB34, sprint: 0x3983A753, shuffle: 0x1DB88C30, slide: 0xBDAEA048, land: 0x8D0D1F97, landhard: 0x06734434},
	"sand":        {walk: 0x944A989F, run: 0x1D9C7F9C, sprint: 0x206B8BCF, shuffle: 0x7F88490A, slide: 0x31811EA6, land: 0x369DB46B, landhard: 0x9E9C3A12},
	"grass":       {walk: 0x6B257D69, run: 0xEA1EC7B9, sprint: 0xCC969019, shuffle: 0x7B805C8A, slide: 0xD03C0906, land: 0x5FE82914, landhard: 0x47A012EC},
	"grasstall":   {walk: 0x04E98888, run: 0x06A77BA7, sprint: 0xDAD3DDE7, shuffle: 0xABA2F6E7, land: 0xBF653CB0, landhard: 0x68E7EECE},
	"gravel":      {walk: 0x83C9AB6A, run: 0xFCF0DD37, sprint: 0xE3CEC12B, shuffle: 0x17ED4B75, slide: 0xAABE04D9, land: 0x214FC143, landhard: 0x8F4873FD},
	"rock":        {walk: 0xB0674617, run: 0x687604EA, sprint: 0x68B84917, shuffle: 0xF0DA370E, land: 0x620957AA, landhard: 0x7484BEC0},
	"wood":        {walk: 0x21C700CB, run: 0x00A6C27C, sprint: 0xB80D0E2E, shuffle: 0x7255B9E3, slide: 0x8EE94AEC, land: 0x02892C01, landhard: 0x3A7A0D44},
	"metal":       {walk: 0x12422C92, run: 0xF4ACFE20, sprint: 0x08B9FE84, shuffle: 0xCA037A63, slide: 0x34473E01, land: 0x6768CC0F, landhard: 0xE47B24A9},
	"metalgrate":  {walk: 0x1B5AA161, run: 0xB9C678DD, sprint: 0xC7DC36AA, shuffle: 0xDCB36744, slide: 0x3C4E628B, land: 0xF70B86D1, landhard: 0x13413502},
	"mud":         {walk: 0xB72ED03B, run: 0x02CE5ADC, sprint: 0x8B5A6835, shuffle: 0x2F0167DD, slide: 0x89ECD040, land: 0x6E153EFB, landhard: 0x9E6AC111},
	"snow":        {walk: 0x0856DCB4, run: 0x2D53EFD0, sprint: 0x8D95048E, shuffle: 0x9CC10A32, slide: 0xE9F841EE, land: 0xE9C7174E, landhard: 0x106C162F},
	"energy":      {walk: 0xD4D08A47, run: 0x3492ABC5, sprint: 0x748DFDBC, shuffle: 0x61988C29, slide: 0x89CE55AF, land: 0x02C5A70D, landhard: 0x71DF089E},
	"waterdeep":   {walk: 0x47B2918D, run: 0x94FADA33, sprint: 0x56E879F8, shuffle: 0xDADDA7EC, slide: 0x29BBD8DE, land: 0x7DCC1112, landhard: 0xD0F67EF4},
	"watershallow": {walk: 0x8AA16946, run: 0x349C1CE8, sprint: 0x9349BF54, shuffle: 0x0A7F4191, slide: 0x9657B122, land: 0x03154A20, landhard: 0x95B00923},
}

// movementIDs maps a movement sound to its tag id.
var movementIDs = map[string]uint32{
	land:       0x0929E52F,
	landhard:   0xE51D4EFE,
	slideInto:  0xDE97BC60,
	slideOutof: 0x2A52684E,
	jumpUp:     0xE329C6F6,
}

const (
	walk      = "walk"
	run       = "run"
	sprint    = "sprint"
	shuffle   = "shuffle"
	slide     = "slide"
	land      = "land"
	landhard  = "landhard"
	slideInto  = "slide_into"
	slideOutof = "slide_outof"
	jumpUp     = "jumpup"
)

// tagID swaps a tagnames.txt id (big-endian) to the module index's address (byte-swapped).
func tagID(be uint32) uint32 {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, be)
	return binary.LittleEndian.Uint32(b)
}
