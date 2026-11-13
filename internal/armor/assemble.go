// assemble.go — a player's armor manifest, a pure function of their
// customization and the resolved item files.
//
// SELECTION RULE (one permutation per model region; a region nothing names
// draws nothing):
//  1. the theme's base regions (CoreRegionData.BaseRegionData);
//  2. each equipped piece, in the order helmet, gloves, knee pads, left
//     shoulder pad, right shoulder pad: its RegionData replaces the
//     permutation of each of its regions;
//  3. the body-size replacements (Small/Large), then the per-limb prosthetic
//     replacements (Full, Half, Extremity): they replace what came before,
//     pieces included. A hand prosthetic replaces the gloves (both name the
//     same hand region).
//
// Accessories (ocad tag, placed at a marker) are not regions: the manifest
// carries their identity (path, tag, mesh, marker), without geometry.

package armor

import (
	"cmp"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
)

// Files are the resolved item files of an armor. Items is indexed by the
// inventory path as the customization gives it; an absent path is an
// unresolved item.
type Files struct {
	Theme *haloapi.ArmorThemeDTO
	Items map[string]*haloapi.ArmorItemDTO
}

// ErrThemeMissing: no resolved theme, no base regions, no manifest.
var ErrThemeMissing = errors.New("armor: theme not resolved")

// Selection steps that are not pieces (Region.Source).
const (
	sourceTheme      = "theme"
	sourceBodyType   = "body_type"
	sourceProsthetic = "prosthetic_"
	bodyPrefix       = "body."
	versionHash      = "v1"
)

// slot is one item slot of the customization.
type slot struct {
	name string
	path string
}

// pieces are the slots whose RegionData enters the selection, in order.
func pieces(c *haloapi.ArmorCustomizationDTO) []slot {
	return []slot{
		{"helmet", c.HelmetPath}, {"gloves", c.GlovesPath}, {"knee_pads", c.KneePadsPath},
		{"left_shoulder_pad", c.LeftShoulderPadPath}, {"right_shoulder_pad", c.RightShoulderPadPath},
	}
}

// accessories are the slots that place an ocad tag (the shoulder pads are
// both).
func accessories(c *haloapi.ArmorCustomizationDTO) []slot {
	return []slot{
		{"helmet_attachment", c.HelmetAttachmentPath}, {"chest_attachment", c.ChestAttachmentPath},
		{"wrist_attachment", c.WristAttachmentPath}, {"hip_attachment", c.HipAttachmentPath},
		{"left_shoulder_pad", c.LeftShoulderPadPath}, {"right_shoulder_pad", c.RightShoulderPadPath},
	}
}

// Assemble builds the armor manifest (rule at the top of the file). It
// returns ErrThemeMissing for a nil customization or a missing theme.
func Assemble(c *haloapi.ArmorCustomizationDTO, f Files) (Manifest, error) {
	if c == nil || f.Theme == nil {
		return Manifest{}, ErrThemeMissing
	}
	th := f.Theme
	m := Manifest{
		CoreID: c.CoreID, ThemePath: c.ThemePath, ThemeID: th.ID, ThemeTagID: th.TagID,
		VariantID: int32(th.VariantID), IsKit: th.IsKit,
		Body: Body{BodyType: c.Body.BodyType, LeftArm: c.Body.LeftArm,
			RightArm: c.Body.RightArm, LeftLeg: c.Body.LeftLeg, RightLeg: c.Body.RightLeg},
		Emblems: emblems(c.Emblems),
	}
	for _, p := range haloapi.ArmorItemPaths(c) {
		if f.Items[p] == nil {
			m.Unresolved = append(m.Unresolved, p)
		}
	}
	sel := selection{}
	sel.place(th.Base, sourceTheme)
	for _, s := range pieces(c) {
		if it := f.Items[s.path]; s.path != "" && it != nil {
			sel.place(it.RegionData, s.name)
		}
	}
	m.Unresolved = append(m.Unresolved, applyBody(&sel, th, c.Body)...)
	m.Regions = sel.sorted()
	m.Attachments = attachmentsOf(c, f.Items)
	m.Coating = coatingOf(c.CoatingPath, f.Items)
	m.Visor = visorOf(c.VisorPath, f.Items)
	m.ConfigHash = GeometryHash(m)
	return m, nil
}

// selection is the permutation kept per region, and the step that set it.
type selection map[haloapi.StringID]Region

// place replaces the permutation of each region named in regions.
func (s selection) place(regions []haloapi.ArmorRegionDTO, source string) {
	for _, r := range regions {
		s[r.RegionID] = Region{
			Region: int32(r.RegionID), Permutation: int32(r.PermutationID),
			RegionKey: r.RegionID.Hex(), PermutationKey: r.PermutationID.Hex(), Source: source,
		}
	}
}

// sorted returns the selection sorted by region key (32 bits unsigned): a
// stable order.
func (s selection) sorted() []Region {
	out := make([]Region, 0, len(s))
	for _, r := range s {
		out = append(out, r)
	}
	slices.SortFunc(out, func(a, b Region) int {
		return cmp.Compare(uint32(a.Region), uint32(b.Region))
	})
	return out
}

// prostheticLimb is one limb of the SpartanBody block and its replacements
// in the theme.
type prostheticLimb struct {
	name    string
	value   string
	options haloapi.ProstheticOverridesDTO
}

// applyBody places the body-size then prosthetic replacements; it returns
// the unrecognized values ("body.<field>=<value>"), which place nothing.
func applyBody(sel *selection, th *haloapi.ArmorThemeDTO, body haloapi.SpartanBodyDTO) []string {
	var unknown []string
	switch strings.ToLower(strings.TrimSpace(body.BodyType)) {
	case "small":
		sel.place(th.BodySmall, sourceBodyType)
	case "large":
		sel.place(th.BodyLarge, sourceBodyType)
	case "", "medium":
	default:
		unknown = append(unknown, bodyPrefix+"body_type="+body.BodyType)
	}
	for _, l := range []prostheticLimb{
		{"left_arm", body.LeftArm, th.LeftArm}, {"right_arm", body.RightArm, th.RightArm},
		{"left_leg", body.LeftLeg, th.LeftLeg}, {"right_leg", body.RightLeg, th.RightLeg},
	} {
		regions, ok := prostheticDegree(l.value, l.options)
		if !ok {
			unknown = append(unknown, bodyPrefix+l.name+"="+l.value)
			continue
		}
		sel.place(regions, sourceProsthetic+l.name)
	}
	return unknown
}

// prostheticDegree returns the replacements of degree value; false for an
// unrecognized value. The theme's degree names (Full, Half, Extremity) and
// the Ekur reference's names (Transhumeral, Transfemoral, Transradial, Hand)
// are recognized, case-insensitively.
func prostheticDegree(value string, o haloapi.ProstheticOverridesDTO) ([]haloapi.ArmorRegionDTO, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "none":
		return nil, true
	case "full", "transhumeral", "transfemoral":
		return o.Full, true
	case "half", "transradial":
		return o.Half, true
	case "extremity", "hand":
		return o.Extremity, true
	}
	return nil, false
}

// hasTag says whether an item names an accessory tag (-1 and 0: none).
func hasTag(tag int32) bool { return tag != -1 && tag != 0 }

// attachmentsOf returns the equipped accessories. An unresolved item stays
// listed (path only, Resolved false); a resolved item without a tag (a purely
// regional shoulder pad) is not an accessory.
func attachmentsOf(c *haloapi.ArmorCustomizationDTO, items map[string]*haloapi.ArmorItemDTO) []Attachment {
	out := []Attachment{}
	for _, s := range accessories(c) {
		if s.path == "" {
			continue
		}
		a := Attachment{Slot: s.name, Path: s.path}
		it := items[s.path]
		if it == nil {
			out = append(out, a)
			continue
		}
		if !hasTag(it.TagID) {
			continue
		}
		tag := it.TagID
		a.Resolved, a.ItemID, a.TagID, a.TagKey, a.MeshIndex = true, it.ID, &tag, haloapi.StringID(tag).Hex(), it.MeshIndex
		if it.Marker != nil {
			name, variant := int32(it.Marker.MarkerName), int32(it.Marker.VariantID)
			a.MarkerName, a.MarkerVariant = &name, &variant
		}
		out = append(out, a)
	}
	return out
}

// coatingOf returns the coating (style read when its file is resolved); nil
// without a path.
func coatingOf(path string, items map[string]*haloapi.ArmorItemDTO) *Coating {
	if path == "" {
		return nil
	}
	out := &Coating{Path: path}
	if it := items[path]; it != nil && it.StyleID != nil && *it.StyleID != haloapi.NoStringID {
		style := int32(*it.StyleID)
		out.StyleID, out.StyleKey = &style, it.StyleID.Hex()
	}
	return out
}

// visorOf returns the visor (pattern and color read when its file is
// resolved); nil without a path.
func visorOf(path string, items map[string]*haloapi.ArmorItemDTO) *Visor {
	if path == "" {
		return nil
	}
	out := &Visor{Path: path}
	if it := items[path]; it != nil {
		if it.VisorID != nil {
			id := int32(*it.VisorID)
			out.VisorID = &id
		}
		if it.ColorVariant != nil {
			color := int32(*it.ColorVariant)
			out.ColorVariant = &color
		}
	}
	return out
}

// emblems copies the emblems; never nil (an empty list).
func emblems(in []haloapi.ArmorEmblemDTO) []Emblem {
	out := make([]Emblem, 0, len(in))
	for _, e := range in {
		out = append(out, Emblem{Path: e.Path, LocationID: e.LocationID, ConfigurationID: e.ConfigurationID})
	}
	return out
}

// GeometryHash returns the geometry fingerprint of a manifest: the theme's
// bipd, each region's permutation, and the accessories (slot, tag, mesh,
// marker; the path for an unresolved accessory). Coating, visor, emblems and
// body do not enter it (the body acts through the regions). Order-insensitive
// for regions and accessories: 32 hex digits (128 bits of SHA-256).
func GeometryHash(m Manifest) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s|bipd:%d", versionHash, m.ThemeTagID)
	regions := slices.Clone(m.Regions)
	slices.SortFunc(regions, func(a, b Region) int {
		return cmp.Compare(uint32(a.Region), uint32(b.Region))
	})
	for _, r := range regions {
		fmt.Fprintf(&b, "|r:%d=%d", r.Region, r.Permutation)
	}
	lines := make([]string, 0, len(m.Attachments))
	for _, a := range m.Attachments {
		lines = append(lines, attachmentLine(a))
	}
	slices.Sort(lines)
	for _, l := range lines {
		b.WriteString("|a:" + l)
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:16])
}

// attachmentLine is one accessory's part in the fingerprint.
func attachmentLine(a Attachment) string {
	if !a.Resolved || a.TagID == nil {
		return a.Slot + ":?" + strings.ToLower(a.Path)
	}
	l := fmt.Sprintf("%s:%d", a.Slot, *a.TagID)
	if a.MeshIndex != nil {
		l += fmt.Sprintf(":m%d", *a.MeshIndex)
	}
	if a.MarkerName != nil && a.MarkerVariant != nil {
		l += fmt.Sprintf(":k%d/%d", *a.MarkerName, *a.MarkerVariant)
	}
	return l
}
