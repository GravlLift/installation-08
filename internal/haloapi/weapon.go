// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// weapon.go — the weapon definitions the weapon coating reads: the equipped
// weapon themes (from the player's public customization view) and the GameCMS
// coating file its inventory path points to.
package haloapi

import (
	"encoding/json"
	"errors"
)

// WeaponThemeDTO is a weapon core and its equipped theme. The paths are
// GameCMS inventory paths as the API gives them; an empty slot is "".
type WeaponThemeDTO struct {
	CoreID      string
	CorePath    string
	CoreType    string // the weapon kind (WeaponBR, WeaponAR, WeaponSidekick, ...)
	ThemePath   string
	CoatingPath string
}

// WeaponItemPaths are the inventory paths a weapon's coating reads from its
// equipped theme: the coating and the theme. A path shared by two slots is
// listed once.
func WeaponItemPaths(c *WeaponThemeDTO) []string {
	seen := map[string]bool{}
	var out []string
	for _, p := range []string{c.CoatingPath, c.ThemePath} {
		if p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out
}

// WeaponCoatingDTO is the part of a weapon coating file that names its style;
// StyleID is nil when the file carries none.
type WeaponCoatingDTO struct {
	ID      string
	Type    string
	StyleID *StringID
}

type weaponThemeJSON struct {
	IsEquipped  bool   `json:"IsEquipped"`
	ThemePath   string `json:"ThemePath"`
	CoatingPath string `json:"CoatingPath"`
}

type weaponCoreJSON struct {
	CoreID   string            `json:"CoreId"`
	CorePath string            `json:"CorePath"`
	CoreType string            `json:"CoreType"`
	Themes   []weaponThemeJSON `json:"Themes"`
}

type customizationWeaponJSON struct {
	WeaponCores struct {
		WeaponCores []weaponCoreJSON `json:"WeaponCores"`
	} `json:"WeaponCores"`
}

// DecodeWeaponCores reads each weapon core with an equipped theme from a
// customization body, in the order the API lists them; a core without an
// equipped theme is skipped.
func DecodeWeaponCores(body []byte) ([]WeaponThemeDTO, error) {
	var p customizationWeaponJSON
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, err
	}
	var out []WeaponThemeDTO
	for _, core := range p.WeaponCores.WeaponCores {
		for _, th := range core.Themes {
			if !th.IsEquipped {
				continue
			}
			out = append(out, WeaponThemeDTO{
				CoreID: core.CoreID, CorePath: core.CorePath, CoreType: core.CoreType,
				ThemePath: th.ThemePath, CoatingPath: th.CoatingPath,
			})
			break
		}
	}
	return out, nil
}

type weaponCoatingFile struct {
	CommonData armorCommonData `json:"CommonData"`
	StyleID    *StringID       `json:"StyleId"`
}

// DecodeWeaponCoating reads a weapon coating file.
func DecodeWeaponCoating(body []byte) (*WeaponCoatingDTO, error) {
	var f weaponCoatingFile
	if err := json.Unmarshal(body, &f); err != nil {
		return nil, err
	}
	return &WeaponCoatingDTO{ID: f.CommonData.ID, Type: f.CommonData.Type, StyleID: f.StyleID}, nil
}

// WeaponThemeDef is the part of a weapon theme file that names its weapon: the
// weapon's display name (the CommonData title) and the core that owns it
// (ParentPaths, a single WeaponCore entry).
type WeaponThemeDef struct {
	// WeaponName is the CommonData.Title.value of the theme file: the weapon's
	// display name ("BR75 Battle Rifle"), "" when the file carries no title.
	WeaponName string
	// CorePath is the theme's ParentPaths[0], a WeaponCore; "" when the file
	// names no parent.
	CorePath string
}

// ErrNoWeaponTheme: the file is not a weapon theme (no CommonData.Title).
var ErrNoWeaponTheme = errors.New("haloapi: not a weapon theme (no title)")

type weaponThemeFile struct {
	CommonData struct {
		ID    string `json:"Id"`
		Type  string `json:"Type"`
		Title *struct {
			Value string `json:"value"`
		} `json:"Title"`
	} `json:"CommonData"`
	ParentPaths []struct {
		Path string `json:"Path"`
		Type string `json:"Type"`
	} `json:"ParentPaths"`
}

// DecodeWeaponTheme reads a weapon theme file.
func DecodeWeaponTheme(body []byte) (*WeaponThemeDef, error) {
	var f weaponThemeFile
	if err := json.Unmarshal(body, &f); err != nil {
		return nil, err
	}
	if f.CommonData.Title == nil || f.CommonData.Title.Value == "" {
		return nil, ErrNoWeaponTheme
	}
	out := &WeaponThemeDef{WeaponName: f.CommonData.Title.Value}
	if len(f.ParentPaths) > 0 {
		out.CorePath = f.ParentPaths[0].Path
	}
	return out, nil
}
