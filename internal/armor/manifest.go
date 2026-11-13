// Package armor assembles a player's armor manifest from their equipped
// customization and the resolved GameCMS definition files, and defines the
// response served for a match's players.
//
// The manifest tells the browser which pieces to assemble on the single
// Spartan skeleton: one permutation per model region, the accessories placed
// at a marker, the coating, the visor, the emblems. The identifiers are the
// API's, as-is (32-bit StringID written as a SIGNED integer); each geometry
// identifier also carries its 8-digit hex key, the same 32 bits read
// unsigned, under which the game model names its regions, permutations and
// tags (-436735957 = "e5f7f02b").
package armor

import "time"

// Status: what the 3D replay draws for a player.
type Status string

const (
	// StatusArmor: the player's manifest is served.
	StatusArmor Status = "armor"
	// StatusDefault: the player wears the default armor; Reason says why.
	StatusDefault Status = "default"
)

// Reason: why a player wears the default armor.
type Reason string

const (
	ReasonBot               Reason = "bot"
	ReasonPrivate           Reason = "private"
	ReasonNoArmor           Reason = "no_armor"
	ReasonAPIError          Reason = "api_error"
	ReasonNoToken           Reason = "no_token"
	ReasonCapabilityMissing Reason = "capability_missing"
	ReasonUnknownPlayer     Reason = "unknown_player"
)

// Spartans is the armor of each player of a match.
type Spartans struct {
	MatchID string    `json:"match_id"`
	Players []Spartan `json:"players"`
}

// Spartan is one player's armor, or the reason for the default armor.
type Spartan struct {
	// XUID (decimal); empty for a bot.
	XUID      string     `json:"xuid,omitempty"`
	Status    Status     `json:"status"`
	Reason    Reason     `json:"reason,omitempty"`
	FetchedAt *time.Time `json:"fetched_at,omitempty"`
	Manifest  *Manifest  `json:"manifest,omitempty"`
}

// Manifest is a set of armor pieces, to assemble on a skeleton.
type Manifest struct {
	CoreID    string `json:"core_id"`
	ThemePath string `json:"theme_path"`
	ThemeID   string `json:"theme_id,omitempty"`
	// ThemeTagID is the bipd the theme dresses (signed GlobalID).
	ThemeTagID int32 `json:"theme_tag_id"`
	VariantID  int32 `json:"variant_id"`
	IsKit      bool  `json:"is_kit"`
	// ConfigHash fingerprints the geometry fields only (regions, accessories,
	// bipd); two armors of the same geometry share it, whatever their coating,
	// visor and emblems.
	ConfigHash  string       `json:"config_hash"`
	Regions     []Region     `json:"regions"`
	Attachments []Attachment `json:"attachments"`
	Coating     *Coating     `json:"coating,omitempty"`
	Visor       *Visor       `json:"visor,omitempty"`
	Emblems     []Emblem     `json:"emblems"`
	Body        Body         `json:"body"`
	// Unresolved lists the item paths not resolved (their region keeps the
	// earlier choice) and the unrecognized body values
	// ("body.<field>=<value>").
	Unresolved []string `json:"unresolved,omitempty"`
}

// Region is the permutation kept for a model region. Source names the step
// that set it last: "theme", a piece ("helmet", "gloves", "knee_pads",
// "left_shoulder_pad", "right_shoulder_pad"), "body_type" or a prosthetic
// ("prosthetic_left_arm"...).
type Region struct {
	Region         int32  `json:"region"`
	Permutation    int32  `json:"permutation"`
	RegionKey      string `json:"region_key"`
	PermutationKey string `json:"permutation_key"`
	Source         string `json:"source"`
}

// Attachment is an accessory (ocad tag), placed at a model marker. Its
// geometry is not resolved here: TagKey names the tag in the game. Resolved
// is false when the item file was not read (then only Path is known).
type Attachment struct {
	// Slot: helmet_attachment, chest_attachment, wrist_attachment,
	// hip_attachment, left_shoulder_pad, right_shoulder_pad.
	Slot          string `json:"slot"`
	Path          string `json:"path"`
	ItemID        string `json:"item_id,omitempty"`
	Resolved      bool   `json:"resolved"`
	TagID         *int32 `json:"tag_id,omitempty"`
	TagKey        string `json:"tag_key,omitempty"`
	MeshIndex     *int   `json:"mesh_index,omitempty"`
	MarkerName    *int32 `json:"marker_name,omitempty"`
	MarkerVariant *int32 `json:"marker_variant,omitempty"`
}

// Coating; StyleID nil when its file was not read.
type Coating struct {
	Path     string `json:"path"`
	StyleID  *int32 `json:"style_id,omitempty"`
	StyleKey string `json:"style_key,omitempty"`
}

// Visor (pattern and color); nil when its file was not read.
type Visor struct {
	Path         string `json:"path"`
	VisorID      *int32 `json:"visor_id,omitempty"`
	ColorVariant *int32 `json:"color_variant,omitempty"`
}

// Emblem, API identifiers as-is.
type Emblem struct {
	Path            string `json:"path"`
	LocationID      int64  `json:"location_id"`
	ConfigurationID int64  `json:"configuration_id"`
}

// Body, API values as-is (body type, prosthetic per limb).
type Body struct {
	BodyType string `json:"body_type"`
	LeftArm  string `json:"left_arm"`
	RightArm string `json:"right_arm"`
	LeftLeg  string `json:"left_leg"`
	RightLeg string `json:"right_leg"`
}
