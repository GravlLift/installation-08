// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
)

// The HUD's named colors live in CUI resource tags (`cure`): a block of 24-byte records, each a
// name (string id), a resource name, then A, R, G, B floats. `cure` b1241e79 is the HUD's own
// table (its names include hud_warning, hud_critical and hud_overshield); `cure` fa443766 is the
// navpoints' (navpoint_white, navpoint_waypoint, ... and the power weapon gold cb2b3e43 that the
// pad navpoint's icon fill names).
const (
	hudColorTable      = 0xb1241e79
	navpointColorTable = 0xfa443766
	cureColorRecord    = 24
)

// hudPrimaryColor is the HUD's main ink: the name 32 of the HUD's CUI screens (`cusc`) reference,
// far more than any other color of the table (its string is not known; the count was taken over
// every tag of the install on 2026-11-21).
const hudPrimaryColor = 0x835c0245

// HudColors are the HUD colors the view uses, as CSS hex strings.
type HudColors struct {
	Primary    string `json:"primary"`
	Warning    string `json:"warning"`
	Critical   string `json:"critical"`
	Overshield string `json:"overshield"`
	Power      string `json:"power"`
	Waypoint   string `json:"waypoint"`
}

// readCureColors reads every color record of a `cure` tag: name -> #rrggbb (alpha dropped).
func readCureColors(tag []byte) (map[uint32]string, error) {
	w, err := openWeapTag(tag)
	if err != nil {
		return nil, err
	}
	out := map[uint32]string{}
	for blk := 0; blk < w.blocks; blk++ {
		a, s := w.blockAbs(blk)
		if a < 0 || s == 0 || s%cureColorRecord != 0 || a+s > len(tag) {
			continue
		}
		for x := a; x+cureColorRecord <= a+s; x += cureColorRecord {
			var c [4]float64
			ok := true
			for k := range c {
				c[k] = float64(math.Float32frombits(binary.LittleEndian.Uint32(tag[x+8+4*k:])))
				if !(c[k] >= 0 && c[k] <= 1) {
					ok = false
				}
			}
			if ok {
				b := func(v float64) int { return int(v*255 + 0.5) }
				out[binary.LittleEndian.Uint32(tag[x:])] = fmt.Sprintf("#%02x%02x%02x", b(c[1]), b(c[2]), b(c[3]))
			}
		}
	}
	return out, nil
}

// ReadHudColors picks the HUD's colors out of the HUD and navpoint color tables.
func ReadHudColors(hud, navpoint []byte) (HudColors, error) {
	h, err := readCureColors(hud)
	if err != nil {
		return HudColors{}, err
	}
	n, err := readCureColors(navpoint)
	if err != nil {
		return HudColors{}, err
	}
	c := HudColors{
		Primary:    h[hudPrimaryColor],
		Warning:    h[0x38a4496f], // hud_warning
		Critical:   h[0xed8d76c7], // hud_critical
		Overshield: h[0xabfaa2fd], // hud_overshield
		Power:      n[0xcb2b3e43],
		Waypoint:   n[0x4599a222], // navpoint_waypoint
	}
	for name, v := range map[string]string{"primary": c.Primary, "warning": c.Warning, "critical": c.Critical, "overshield": c.Overshield, "power": c.Power, "waypoint": c.Waypoint} {
		if v == "" {
			return c, fmt.Errorf("hud colors: %s not in its table", name)
		}
	}
	return c, nil
}

// buildHudColors writes hud-colors.json in the HUD set.
func buildHudColors(ix *tagIndex, out string) (int, int, error) {
	var tags [2][]byte
	for i, id := range []uint32{hudColorTable, navpointColorTable} {
		ref, ok := pickRef(ix.byID[id])
		if !ok {
			return 0, 0, fmt.Errorf("hud color table %08x not found", id)
		}
		t, err := ix.extract(ref)
		if err != nil {
			return 0, 0, err
		}
		tags[i] = t
	}
	c, err := ReadHudColors(tags[0], tags[1])
	if err != nil {
		return 0, 0, err
	}
	blob, err := json.Marshal(c)
	if err != nil {
		return 0, 0, err
	}
	blob = append(blob, '\n')
	if err := os.WriteFile(filepath.Join(out, "hud-colors.json"), blob, 0o600); err != nil {
		return 0, 0, err
	}
	return 1, len(blob), nil
}
