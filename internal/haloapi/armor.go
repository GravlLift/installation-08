// armor.go — the armor definitions the manifest assembly reads: the equipped
// customization block (from the player's public customization view) and the
// GameCMS item and theme files that its inventory paths point to.
package haloapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// StringID is a 32-bit hashed name as the API writes it (a signed integer). The
// game model stores the same 32 bits unsigned; Hex renders that form
// (-436735957 = "e5f7f02b").
type StringID int32

// NoStringID is the value the API writes for an absent name.
const NoStringID StringID = -1

// UnmarshalJSON reads the API form {"m_identifier": n}; null leaves the value
// zero.
func (s *StringID) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		return nil
	}
	var v struct {
		M int32 `json:"m_identifier"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*s = StringID(v.M)
	return nil
}

// Hex renders the 32 bits as 8 lowercase hex digits, the game model's form.
func (s StringID) Hex() string { return fmt.Sprintf("%08x", uint32(s)) }

// ArmorRegionDTO is one permutation choice for a region of the Spartan model.
type ArmorRegionDTO struct {
	RegionID      StringID `json:"RegionId"`
	PermutationID StringID `json:"PermutationId"`
}

// ArmorMarkerDTO is the marker an accessory attaches at, and its variant.
type ArmorMarkerDTO struct {
	MarkerName StringID `json:"MarkerName"`
	VariantID  StringID `json:"VariantId"`
}

// ArmorItemDTO is the part of an armor item file that names its geometry or
// material. A field a kind of item does not carry stays at its zero value.
type ArmorItemDTO struct {
	// ID and Type are CommonData.Id and CommonData.Type (ArmorHelmet,
	// ArmorChestAttachment, ...).
	ID   string
	Type string
	// TagID is the accessory tag (ocad) of an accessory or shoulder pad;
	// -1 or 0 means none.
	TagID      int32
	RegionData []ArmorRegionDTO
	// MeshIndex is an accessory's mesh index; nil when the file carries none.
	MeshIndex *int
	// Marker is an accessory's marker, when the file names one.
	Marker *ArmorMarkerDTO
	// StyleID is a coating's style; nil when the file carries none.
	StyleID *StringID
	// VisorID and ColorVariant are a visor's pattern and color.
	VisorID      *StringID
	ColorVariant *StringID
}

// ProstheticOverridesDTO are a prosthetic limb's replacements, by degree.
type ProstheticOverridesDTO struct {
	Full      []ArmorRegionDTO `json:"Full"`
	Half      []ArmorRegionDTO `json:"Half"`
	Extremity []ArmorRegionDTO `json:"Extremity"`
}

// ArmorThemeDTO is a core's theme. Base names the regions the core dresses;
// the body-size and prosthetic replacements apply to it.
type ArmorThemeDTO struct {
	ID        string
	TagID     int32 // the Spartan bipd the theme dresses (signed GlobalID)
	VariantID StringID
	IsKit     bool
	Base      []ArmorRegionDTO
	BodySmall []ArmorRegionDTO
	BodyLarge []ArmorRegionDTO
	// Prosthetics per limb.
	LeftArm  ProstheticOverridesDTO
	RightArm ProstheticOverridesDTO
	LeftLeg  ProstheticOverridesDTO
	RightLeg ProstheticOverridesDTO
}

// ArmorEmblemDTO is an emblem on the armor; the API's signed integers as-is.
type ArmorEmblemDTO struct {
	Path            string `json:"Path"`
	LocationID      int64  `json:"LocationId"`
	ConfigurationID int64  `json:"ConfigurationId"`
}

// SpartanBodyDTO is the SpartanBody block, the API's textual values as-is
// (body type Small/Medium/Large; prosthetic per limb, None when absent).
type SpartanBodyDTO struct {
	BodyType string `json:"BodyType"`
	LeftArm  string `json:"LeftArm"`
	RightArm string `json:"RightArm"`
	LeftLeg  string `json:"LeftLeg"`
	RightLeg string `json:"RightLeg"`
}

// ArmorCustomizationDTO is a player's equipped armor core and its equipped
// theme. The paths are GameCMS inventory paths as the API gives them; an empty
// slot is "".
type ArmorCustomizationDTO struct {
	CoreID   string
	CorePath string
	// ThemePath is the theme file, which carries the core's base regions.
	ThemePath            string
	CoatingPath          string
	VisorPath            string
	HelmetPath           string
	HelmetAttachmentPath string
	GlovesPath           string
	KneePadsPath         string
	LeftShoulderPadPath  string
	RightShoulderPadPath string
	ChestAttachmentPath  string
	WristAttachmentPath  string
	HipAttachmentPath    string
	ArmorFxPath          string
	MythicFxPath         string
	Emblems              []ArmorEmblemDTO
	Body                 SpartanBodyDTO
}

// ArmorItemPaths are the inventory paths of the item files a manifest needs
// from the equipped theme: the pieces, the attachments, the coating, the
// visor. An unequipped slot is skipped; a path shared by two slots (the
// shoulder pads) is listed once.
func ArmorItemPaths(c *ArmorCustomizationDTO) []string {
	seen := map[string]bool{}
	var out []string
	add := func(p string) {
		if p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	for _, p := range []string{
		c.HelmetPath, c.GlovesPath, c.KneePadsPath,
		c.LeftShoulderPadPath, c.RightShoulderPadPath,
		c.HelmetAttachmentPath, c.ChestAttachmentPath, c.WristAttachmentPath, c.HipAttachmentPath,
		c.CoatingPath, c.VisorPath,
	} {
		add(p)
	}
	return out
}

// ErrNoCoreRegionData: the file is not a core theme (no CoreRegionData).
var ErrNoCoreRegionData = errors.New("haloapi: theme file without CoreRegionData")

// ErrNoEquippedArmor: the customization carries no equipped armor core, or its
// equipped core has no equipped theme.
var ErrNoEquippedArmor = errors.New("haloapi: no equipped armor in customization")

// ProgressionFile downloads one GameCMS inventory file:
// GET {GameCMS}/progression/file/{path} (leading slashes trimmed), with the
// standard auth headers, body as-is. A file's content does not change: callers
// may keep it cached without an expiry.
func (c *Client) ProgressionFile(ctx context.Context, inventoryPath string) ([]byte, error) {
	p := strings.TrimLeft(strings.TrimSpace(inventoryPath), "/")
	if p == "" {
		return nil, errors.New("empty inventory path")
	}
	if c.endpoints.GameCMS == "" {
		return nil, errors.New("gamecms endpoint not configured")
	}
	return c.get(ctx, c.endpoints.GameCMS+"/progression/file/"+p, true)
}

type armorCommonData struct {
	ID   string `json:"Id"`
	Type string `json:"Type"`
}

type armorItemFile struct {
	CommonData   armorCommonData `json:"CommonData"`
	TagID        int32           `json:"TagId"`
	RegionData   []ArmorRegionDTO
	MeshIndex    *int            `json:"MeshIndex"`
	Marker       *ArmorMarkerDTO `json:"MarkerLocation"`
	StyleID      *StringID       `json:"StyleId"`
	VisorID      *StringID       `json:"VisorId"`
	ColorVariant *StringID       `json:"ColorVariant"`
}

type armorThemeFile struct {
	CommonData     armorCommonData `json:"CommonData"`
	TagID          int32           `json:"TagId"`
	VariantID      StringID        `json:"VariantId"`
	IsKit          bool            `json:"IsKit"`
	CoreRegionData *struct {
		Base      []ArmorRegionDTO       `json:"BaseRegionData"`
		BodySmall []ArmorRegionDTO       `json:"BodyTypeSmallOverrides"`
		BodyLarge []ArmorRegionDTO       `json:"BodyTypeLargeOverrides"`
		LeftArm   ProstheticOverridesDTO `json:"ProstheticLeftArmOverrides"`
		RightArm  ProstheticOverridesDTO `json:"ProstheticRightArmOverrides"`
		LeftLeg   ProstheticOverridesDTO `json:"ProstheticLeftLegOverrides"`
		RightLeg  ProstheticOverridesDTO `json:"ProstheticRightLegOverrides"`
	} `json:"CoreRegionData"`
}

// DecodeArmorItem reads an armor item file.
func DecodeArmorItem(body []byte) (*ArmorItemDTO, error) {
	var f armorItemFile
	if err := json.Unmarshal(body, &f); err != nil {
		return nil, err
	}
	return &ArmorItemDTO{
		ID: f.CommonData.ID, Type: f.CommonData.Type, TagID: f.TagID,
		RegionData: f.RegionData, MeshIndex: f.MeshIndex, Marker: f.Marker,
		StyleID: f.StyleID, VisorID: f.VisorID, ColorVariant: f.ColorVariant,
	}, nil
}

// DecodeArmorTheme reads a core theme file; it returns ErrNoCoreRegionData
// when the file carries no CoreRegionData.
func DecodeArmorTheme(body []byte) (*ArmorThemeDTO, error) {
	var f armorThemeFile
	if err := json.Unmarshal(body, &f); err != nil {
		return nil, err
	}
	if f.CoreRegionData == nil {
		return nil, ErrNoCoreRegionData
	}
	r := f.CoreRegionData
	return &ArmorThemeDTO{
		ID: f.CommonData.ID, TagID: f.TagID, VariantID: f.VariantID, IsKit: f.IsKit,
		Base: r.Base, BodySmall: r.BodySmall, BodyLarge: r.BodyLarge,
		LeftArm: r.LeftArm, RightArm: r.RightArm, LeftLeg: r.LeftLeg, RightLeg: r.RightLeg,
	}, nil
}

type equippedThemeJSON struct {
	IsEquipped           bool             `json:"IsEquipped"`
	ThemePath            string           `json:"ThemePath"`
	CoatingPath          string           `json:"CoatingPath"`
	VisorPath            string           `json:"VisorPath"`
	HelmetPath           string           `json:"HelmetPath"`
	HelmetAttachmentPath string           `json:"HelmetAttachmentPath"`
	GlovesPath           string           `json:"GlovePath"`
	KneePadsPath         string           `json:"KneePadPath"`
	LeftShoulderPadPath  string           `json:"LeftShoulderPadPath"`
	RightShoulderPadPath string           `json:"RightShoulderPadPath"`
	ChestAttachmentPath  string           `json:"ChestAttachmentPath"`
	WristAttachmentPath  string           `json:"WristAttachmentPath"`
	HipAttachmentPath    string           `json:"HipAttachmentPath"`
	ArmorFxPath          string           `json:"ArmorFxPath"`
	MythicFxPath         string           `json:"MythicFxPath"`
	Emblems              []ArmorEmblemDTO `json:"Emblems"`
}

type customizationArmorJSON struct {
	ArmorCores struct {
		ArmorCores []struct {
			CoreID     string `json:"CoreId"`
			CorePath   string `json:"CorePath"`
			IsEquipped bool   `json:"IsEquipped"`
			Themes     []equippedThemeJSON
		} `json:"ArmorCores"`
	} `json:"ArmorCores"`
	SpartanBody SpartanBodyDTO `json:"SpartanBody"`
}

// DecodeArmorCustomization reads the equipped core and its equipped theme
// from a customization body; it returns ErrNoEquippedArmor when there is none.
func DecodeArmorCustomization(body []byte) (*ArmorCustomizationDTO, error) {
	var p customizationArmorJSON
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, err
	}
	for _, core := range p.ArmorCores.ArmorCores {
		if !core.IsEquipped {
			continue
		}
		for _, th := range core.Themes {
			if !th.IsEquipped {
				continue
			}
			dto := &ArmorCustomizationDTO{
				ThemePath:            th.ThemePath,
				CoatingPath:          th.CoatingPath,
				VisorPath:            th.VisorPath,
				HelmetPath:           th.HelmetPath,
				HelmetAttachmentPath: th.HelmetAttachmentPath,
				GlovesPath:           th.GlovesPath,
				KneePadsPath:         th.KneePadsPath,
				LeftShoulderPadPath:  th.LeftShoulderPadPath,
				RightShoulderPadPath: th.RightShoulderPadPath,
				ChestAttachmentPath:  th.ChestAttachmentPath,
				WristAttachmentPath:  th.WristAttachmentPath,
				HipAttachmentPath:    th.HipAttachmentPath,
				ArmorFxPath:          th.ArmorFxPath,
				MythicFxPath:         th.MythicFxPath,
				Emblems:              th.Emblems,
			}
			dto.CoreID, dto.CorePath, dto.Body = core.CoreID, core.CorePath, p.SpartanBody
			return dto, nil
		}
		return nil, ErrNoEquippedArmor
	}
	return nil, ErrNoEquippedArmor
}
