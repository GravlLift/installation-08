// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// ekur.go — the Ekur reference of the coatings, read at the build of the
// library (LevelUp's internal/mapmesh revetements_ekur.go, AGPL-3.0, JGtm):
// the JSON output of the community Ekur tool (Blender add-on for Halo
// Infinite import, The Halo Archive, GPL-3.0) serves as the table of coating
// parameters. Only its data are read; no line of its code is reused. Its
// identifiers are SIGNED 32-bit integers in decimal, its file keys too
// (styles/-177284589.json); everything comes out in Identifier.
//
// Shapes read (Ekur json_definitions.py): materials/<id>.json (CommonMaterial:
// textures and style_info), stylelists/<id>.json (CommonStyleList: style name
// -> reference), styles/<reference>.json (CommonCoating), globals.json
// (CoatingGlobalEntries), visor_data.json (visor patterns and colors).
package spartanpieces

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// EkurEntries are the entries of a valid Ekur folder: the first three are
// directories, the last two files. A candidate that does not carry all five,
// of the expected kinds, is not a reference.
var EkurEntries = []struct {
	Name  string
	IsDir bool
}{
	{"materials", true}, {"stylelists", true}, {"styles", true},
	{"globals.json", false}, {"visor_data.json", false},
}

// EkurValid says whether folder carries the five entries of the Ekur contract,
// of the expected kinds.
func EkurValid(folder string) bool {
	return len(EkurMissing(folder)) == 0
}

// DataEkurDir is the app's own Ekur export folder in the data directory: where
// the coatings setup (ekursetup) writes its dump, and the candidate EkurDir
// uses when EkurEnv is unset.
func DataEkurDir(dataDir string) string {
	return filepath.Join(dataDir, "ekur")
}

// EkurCandidate is the one place that decides which folder is the Ekur
// reference candidate: the EkurEnv variable (full path) when it is set, which
// always wins (even when it names an invalid folder), else DataEkurDir.
// override says the candidate came from the variable.
func EkurCandidate(dataDir string) (folder string, override bool) {
	if env := os.Getenv(EkurEnv); env != "" {
		return env, true
	}
	return DataEkurDir(dataDir), false
}

// EkurDir resolves the Ekur reference folder: the EkurCandidate when it is
// valid, empty otherwise. Every reader of the reference goes through it.
func EkurDir(dataDir string) string {
	candidate, _ := EkurCandidate(dataDir)
	if EkurValid(candidate) {
		return candidate
	}
	return ""
}

// EkurMissing names the contract entries folder lacks (or carries as the wrong
// kind), in contract order; empty when EkurValid(folder).
func EkurMissing(folder string) []string {
	var missing []string
	for _, e := range EkurEntries {
		info, err := os.Stat(filepath.Join(folder, e.Name))
		if err != nil || info.IsDir() != e.IsDir {
			missing = append(missing, e.Name)
		}
	}
	return missing
}

// EkurStamp is a short hex digest of an Ekur reference folder: it changes when
// the export changes (a file added to or removed from one of the three
// directories, or the size or mod time of globals.json or visor_data.json) and
// stays the same otherwise. It reads file names and the two stat pairs only —
// never file contents — so it is fast on a full export (tens of thousands of
// material files). Empty string for an empty folder argument, and an error
// (with no stamp) when a directory cannot be read.
func EkurStamp(folder string) (string, error) {
	if folder == "" {
		return "", nil
	}
	sum := sha256.New()
	for _, name := range []string{"materials", "stylelists", "styles"} {
		// The entry must be a directory: a file where one is expected is a broken export.
		info, err := os.Stat(filepath.Join(folder, name))
		if err != nil || !info.IsDir() {
			return "", fmt.Errorf("ekur stamp: %s: %v", name, err)
		}
		entries, err := os.ReadDir(filepath.Join(folder, name))
		if err != nil {
			return "", err
		}
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			names = append(names, e.Name())
		}
		sort.Strings(names)
		for _, n := range names {
			fmt.Fprintf(sum, "%s/%s\n", name, n)
		}
	}
	for _, name := range []string{"globals.json", "visor_data.json"} {
		info, err := os.Stat(filepath.Join(folder, name))
		if err != nil {
			return "", err
		}
		fmt.Fprintf(sum, "%s|%d|%d\n", name, info.Size(), info.ModTime().UnixNano())
	}
	return hex.EncodeToString(sum.Sum(nil)[:8]), nil
}

// ekurLayer is one coating layer (CommonLayer).
type ekurLayer struct {
	Index             int        `json:"index"`
	Disabled          bool       `json:"disabled"`
	GradientTransform [2]float32 `json:"gradient_transform"`
	GradientBitmap    int32      `json:"gradient_bitmap"`
	Roughness         float32    `json:"roughness"`
	RoughnessWhite    float32    `json:"roughness_white"`
	RoughnessBlack    float32    `json:"roughness_black"`
	Metallic          float32    `json:"metallic"`
	EmissiveAmount    float32    `json:"emissive_amount"`
	TopColor          [3]float32 `json:"top_color"`
	MidColor          [3]float32 `json:"mid_color"`
	BotColor          [3]float32 `json:"bot_color"`
	ScratchRoughness  float32    `json:"scratch_roughness"`
	ScratchMetallic   float32    `json:"scratch_metallic"`
	ScratchColor      [3]float32 `json:"scratch_color"`
}

// ekurStyle is one style (CommonCoating).
type ekurStyle struct {
	GrimeAmount   float32   `json:"grime_amount"`
	ScratchAmount float32   `json:"scratch_amount"`
	GrimeSwatch   ekurLayer `json:"grime_swatch"`
	Regions       map[string]struct {
		Layers map[string]ekurLayer `json:"layers"`
	} `json:"regions"`
}

// ekurEntry is one style list entry.
type ekurEntry struct {
	Reference string `json:"reference"`
	Name      string `json:"name"`
}

// ekurList is one style list (CommonStyleList); keys are style names (the
// coating StyleIds).
type ekurList struct {
	DefaultStyle ekurEntry            `json:"default_style"`
	Styles       map[string]ekurEntry `json:"styles"`
}

// ekurStyleInfo is a material's style (StyleInfo).
type ekurStyleInfo struct {
	TexelDensity    [2]float32 `json:"texel_density"`
	MaterialOffset  [2]float32 `json:"material_offset"`
	Stylelist       int32      `json:"stylelist"`
	RegionName      int32      `json:"region_name"`
	Base            int32      `json:"base_intention"`
	Mask0Red        int32      `json:"mask0_red_intention"`
	Mask0Green      int32      `json:"mask0_green_intention"`
	Mask0Blue       int32      `json:"mask0_blue_intention"`
	Mask1Red        int32      `json:"mask1_red_intention"`
	Mask1Green      int32      `json:"mask1_green_intention"`
	Mask1Blue       int32      `json:"mask1_blue_intention"`
	SupportedLayers int        `json:"supported_layers"`
}

// ekurMaterial is one material (CommonMaterial), the fields read.
type ekurMaterial struct {
	Textures  map[string]int32 `json:"textures"`
	StyleInfo *ekurStyleInfo   `json:"style_info"`
}

// ekurGlobals is the coating globals (CoatingGlobalEntries).
type ekurGlobals struct {
	Entries map[string]struct {
		Fallback int32     `json:"fallback"`
		Layer    ekurLayer `json:"layer"`
	} `json:"entries"`
}

// ekurVisors is visor_data.json.
type ekurVisors struct {
	Patterns map[string]struct {
		Transform        [2]float32 `json:"color_and_roughness_transform"`
		ColorGradientMap int32      `json:"color_gradient_map"`
		RoughnessWhite   float32    `json:"roughness_white"`
		RoughnessBlack   float32    `json:"roughness_black"`
		Metallic         float32    `json:"metallic"`
		ScratchColor     [3]float32 `json:"scratch_color"`
		ScratchRoughness float32    `json:"scratch_roughness"`
		ScratchMetallic  float32    `json:"scratch_metallic"`
	} `json:"patterns"`
	Colors map[string]struct {
		TopColor [3]float32 `json:"top_color"`
		MidColor [3]float32 `json:"mid_color"`
		BotColor [3]float32 `json:"bot_color"`
	} `json:"colors"`
}

// ekurRef is one opened Ekur reference folder.
type ekurRef struct {
	folder string
}

// readJSON reads rel under the reference folder into v; os.ErrNotExist
// (wrapped) when it is missing.
func (r ekurRef) readJSON(rel string, v any) error {
	raw, err := os.ReadFile(filepath.Join(r.folder, rel))
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return fmt.Errorf("ekur reference %s: %w", rel, err)
	}
	return nil
}

// material reads the material id (GlobalID, unsigned).
func (r ekurRef) material(id uint32) (ekurMaterial, error) {
	var m ekurMaterial
	err := r.readJSON(filepath.Join("materials", strconv.Itoa(int(int32(id)))+".json"), &m)
	return m, err
}

// list reads the style list key (Identifier).
func (r ekurRef) list(key string) (ekurList, error) {
	var l ekurList
	n, err := signedFrom(key)
	if err != nil {
		return l, err
	}
	err = r.readJSON(filepath.Join("stylelists", strconv.Itoa(int(n))+".json"), &l)
	return l, err
}

// style reads the style of the Ekur reference ref (file name without extension).
func (r ekurRef) style(ref string) (ekurStyle, error) {
	var s ekurStyle
	if strings.ContainsAny(ref, `/\.`) {
		return s, fmt.Errorf("style reference %q invalid", ref)
	}
	err := r.readJSON(filepath.Join("styles", ref+".json"), &s)
	return s, err
}

// idFrom is the Identifier of a signed integer of the reference.
func idFrom(n int32) string { return Identifier(uint32(n)) }

// idFromText is the Identifier of a signed decimal key of the reference.
func idFromText(s string) (string, error) {
	n, err := strconv.ParseInt(s, 10, 32)
	if err != nil {
		return "", fmt.Errorf("identifier %q of the reference: %w", s, err)
	}
	return idFrom(int32(n)), nil
}

// signedFrom is the signed integer of an Identifier.
func signedFrom(key string) (int32, error) {
	n, err := strconv.ParseUint(key, 16, 32)
	if err != nil {
		return 0, fmt.Errorf("identifier %q: %w", key, err)
	}
	return int32(uint32(n)), nil
}

// referenceStyle is the key of a reference style (-177284589 -> f56ee213; old
// system list_name -> <list>_<name>) and whether it is old system.
func referenceStyle(ref string) (key string, old bool, err error) {
	parts := strings.Split(ref, "_")
	if len(parts) > 2 {
		return "", false, fmt.Errorf("style reference %q invalid", ref)
	}
	for i, p := range parts {
		h, err := idFromText(p)
		if err != nil {
			return "", false, err
		}
		parts[i] = h
	}
	return strings.Join(parts, "_"), len(parts) == 2, nil
}

// styleOf translates a material's style.
func styleOf(si ekurStyleInfo) ExtrasStyleMaterial {
	out := ExtrasStyleMaterial{List: idFrom(si.Stylelist), Region: idFrom(si.RegionName), LayerCount: si.SupportedLayers,
		Density: si.TexelDensity, Offset: si.MaterialOffset}
	for k, n := range []int32{si.Base, si.Mask0Red, si.Mask0Green, si.Mask0Blue, si.Mask1Red, si.Mask1Green, si.Mask1Blue} {
		out.Intentions[k] = idFrom(n)
	}
	return out
}

// swatchOf translates a layer; gradients receives its gradient bitmap when it has one.
func swatchOf(c ekurLayer, gradients map[uint32]bool) Swatch {
	n := Swatch{Index: c.Index, Disabled: c.Disabled, GradientScale: c.GradientTransform, Rough: c.Roughness,
		RoughWhite: c.RoughnessWhite, RoughBlack: c.RoughnessBlack, Metal: c.Metallic, Emissive: c.EmissiveAmount,
		Top: c.TopColor, Mid: c.MidColor, Bot: c.BotColor, ScratchColor: c.ScratchColor,
		ScratchRoughness: c.ScratchRoughness, ScratchMetal: c.ScratchMetallic}
	if c.GradientBitmap != 0 && !c.Disabled {
		n.Gradient = idFrom(c.GradientBitmap)
		gradients[uint32(c.GradientBitmap)] = true
	}
	return n
}

// coatingStyleOf distills one style.
func coatingStyleOf(s ekurStyle, old bool, gradients map[uint32]bool) (CoatingStyle, error) {
	out := CoatingStyle{OldSystem: old, Grime: s.GrimeAmount, Scratches: s.ScratchAmount,
		Regions: make(map[string]map[string]Swatch, len(s.Regions))}
	if !s.GrimeSwatch.Disabled {
		n := swatchOf(s.GrimeSwatch, gradients)
		out.GrimeSwatch = &n
	}
	for reg, r := range s.Regions {
		key, err := idFromText(reg)
		if err != nil {
			return out, err
		}
		layers := make(map[string]Swatch, len(r.Layers))
		for intention, c := range r.Layers {
			ci, err := idFromText(intention)
			if err != nil {
				return out, err
			}
			layers[ci] = swatchOf(c, gradients)
		}
		out.Regions[key] = layers
	}
	return out, nil
}

// globalsOf distills the coating globals.
func globalsOf(g ekurGlobals, gradients map[uint32]bool) (map[string]CoatingGlobal, error) {
	out := make(map[string]CoatingGlobal, len(g.Entries))
	for intention, e := range g.Entries {
		key, err := idFromText(intention)
		if err != nil {
			return nil, err
		}
		cg := CoatingGlobal{Layer: swatchOf(e.Layer, gradients)}
		if e.Fallback != 0 {
			cg.Fallback = idFrom(e.Fallback)
		}
		out[key] = cg
	}
	return out, nil
}

// visorsOf distills the visors.
func visorsOf(v ekurVisors, gradients map[uint32]bool) (CoatingVisors, error) {
	out := CoatingVisors{Patterns: map[string]VisorPattern{}, Colors: map[string]VisorColor{}}
	for id, p := range v.Patterns {
		key, err := idFromText(id)
		if err != nil {
			return out, err
		}
		m := VisorPattern{GradientScale: p.Transform, RoughWhite: p.RoughnessWhite, RoughBlack: p.RoughnessBlack,
			Metal: p.Metallic, ScratchColor: p.ScratchColor, ScratchRoughness: p.ScratchRoughness, ScratchMetal: p.ScratchMetallic}
		if p.ColorGradientMap != 0 {
			m.Gradient = idFrom(p.ColorGradientMap)
			gradients[uint32(p.ColorGradientMap)] = true
		}
		out.Patterns[key] = m
	}
	for id, c := range v.Colors {
		key, err := idFromText(id)
		if err != nil {
			return out, err
		}
		out.Colors[key] = VisorColor{Top: c.TopColor, Mid: c.MidColor, Bot: c.BotColor}
	}
	return out, nil
}
