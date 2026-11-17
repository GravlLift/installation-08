// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Ported from Ekur's ekur_coating (GPL-3.0-or-later, Copyright (c) 2026 The Halo
// Archive): common_coating.rs process_coating_global, common_styles.rs process_styles,
// runtime_coating.rs process_runtime_coatings, and material_coating.rs
// process_material_coatings.
//
// Piece 4a of the Ekur port: the builders that turn piece 3 raw layouts into the values
// Ekur writes to globals.json, stylelists/, and styles/. String ids print as signed
// decimal; a name's display string comes from the strings map when present, else the id
// itself.
package ekurport

import (
	"fmt"
	"strconv"
)

// CoatingGlobalEntry is one globals.json entry (common_coating.rs
// CoatingGlobalEntry): the fallback intention string id and the layer.
type CoatingGlobalEntry struct {
	Fallback int32       `json:"fallback"`
	Layer    CommonLayer `json:"layer"`
}

// CoatingGlobalEntries is the export of globals.json: name string id -> entry.
type CoatingGlobalEntries struct {
	Entries map[int32]CoatingGlobalEntry `json:"entries"`
}

// ProcessCoatingGlobals is process_coating_global (common_coating.rs:201-219): one entry
// per global shader lookup row, keyed by the row's name string id, layer index = row
// index.
func ProcessCoatingGlobals(lay *CoatingGlobalsLayout, swatches map[int32]*CoatingSwatchLayout) (CoatingGlobalEntries, error) {
	out := CoatingGlobalEntries{Entries: make(map[int32]CoatingGlobalEntry, len(lay.Entries))}
	for i, def := range lay.Entries {
		layer, err := layerFromRuntime(def.Info, swatches, int32(i))
		if err != nil {
			return CoatingGlobalEntries{}, err
		}
		out.Entries[def.Name] = CoatingGlobalEntry{Fallback: def.Fallback, Layer: layer}
	}
	return out, nil
}

// CommonStyleListEntry is one named style of a style list: reference is the style tag id
// as a signed decimal, or "<tag id>_<style name id>" for a material style.
type CommonStyleListEntry struct {
	Reference string `json:"reference"`
	Name      string `json:"name"`
}

// CommonStyleList is the export of one stylelists/<id>.json (default_style first, then
// styles: name string id -> entry).
type CommonStyleList struct {
	DefaultStyle CommonStyleListEntry           `json:"default_style"`
	Styles       map[int32]CommonStyleListEntry `json:"styles"`
}

// CommonRegion is one region of a styles/ file: intention name string id -> layer.
type CommonRegion struct {
	Layers map[int32]CommonLayer `json:"layers"`
}

// CommonCoating is the export of one styles/<name>.json (grime fields first, then
// regions: region name string id -> region).
type CommonCoating struct {
	GrimeAmount   float32                `json:"grime_amount"`
	ScratchAmount float32                `json:"scratch_amount"`
	GrimeSwatch   CommonLayer            `json:"grime_swatch"`
	Regions       map[int32]CommonRegion `json:"regions"`
}

// styleListEntry resolves the display name for a style list entry: the strings map when
// it has the id, else the id as a signed decimal (common_styles.rs:30-34).
func styleListEntry(reference string, name int32, strings map[int32]string) CommonStyleListEntry {
	display := strconv.FormatInt(int64(name), 10)
	if s, ok := strings[name]; ok {
		display = s
	}
	return CommonStyleListEntry{Reference: reference, Name: display}
}

// ProcessRuntimeCoatingStyles is process_styles (common_styles.rs:9-44): one entry per
// style reference, keyed by the reference's name string id; the default is the entry at
// default_style_index, left empty when the index is out of range.
func ProcessRuntimeCoatingStyles(lay *RuntimeCoatingStylesLayout, strings map[int32]string) CommonStyleList {
	out := CommonStyleList{Styles: make(map[int32]CommonStyleListEntry, len(lay.Styles))}
	for _, ref := range lay.Styles {
		out.Styles[ref.Name] = styleListEntry(strconv.FormatInt(int64(ref.StyleRef), 10), ref.Name, strings)
	}
	if i := int(lay.DefaultStyleIndex); i >= 0 && i < len(lay.Styles) {
		def := lay.Styles[i]
		out.DefaultStyle = styleListEntry(strconv.FormatInt(int64(def.StyleRef), 10), def.Name, strings)
	}
	return out
}

// ProcessRuntimeCoatings is process_runtime_coatings (runtime_coating.rs:9-35): the
// regions (layer index = intention index) and the grime swatch (layer index 0).
func ProcessRuntimeCoatings(lay *RuntimeCoatingStyleLayout, swatches map[int32]*CoatingSwatchLayout) (CommonCoating, error) {
	out := CommonCoating{Regions: make(map[int32]CommonRegion, len(lay.Regions))}
	for _, region := range lay.Regions {
		reg := CommonRegion{Layers: make(map[int32]CommonLayer, len(region.Intentions))}
		for i, it := range region.Intentions {
			layer, err := layerFromRuntime(it.Info, swatches, int32(i))
			if err != nil {
				return CommonCoating{}, err
			}
			reg.Layers[it.Name] = layer
		}
		out.Regions[region.Name] = reg
	}
	grime, err := layerFromRuntime(lay.GrimeSwatch, swatches, 0)
	if err != nil {
		return CommonCoating{}, err
	}
	out.GrimeSwatch = grime
	out.GrimeAmount = lay.GrimeAmount
	out.ScratchAmount = lay.ScratchAmount
	return out, nil
}

// defaultStyleNameID is the string id of the "default" style name in material styles
// (material_coating.rs:12).
const defaultStyleNameID = 1120495519

// findSwatchEntry is the first palette entry named name, or not found.
func findSwatchEntry(pal *MaterialPaletteLayout, name int32) (*MaterialSwatchEntry, bool) {
	for i := range pal.Swatches {
		if pal.Swatches[i].Name == name {
			return &pal.Swatches[i], true
		}
	}
	return nil, false
}

// findMaterialRegion is the first top-level region named name, or not found.
func findMaterialRegion(regions []MaterialRegion, name int32) (*MaterialRegion, bool) {
	for i := range regions {
		if regions[i].Name == name {
			return &regions[i], true
		}
	}
	return nil, false
}

// ProcessMaterialCoatings is process_material_coatings (material_coating.rs:14-115): the
// mwsy style list (keyed by the style's name string id, reference "<tag id>_<name id>")
// and one coating per style (keyed by the same reference). A style with no regions gets
// an enabled all-zero grime swatch; a missing grime swatch entry gets a disabled one.
func ProcessMaterialCoatings(id int32, lay *MaterialStylesLayout, palettes map[int32]*MaterialPaletteLayout, swatches map[int32]*MaterialSwatchLayout, strings map[int32]string) (CommonStyleList, map[string]CommonCoating, error) {
	if len(lay.Styles) == 0 {
		return CommonStyleList{}, nil, fmt.Errorf("ekurport: mwsy tag %d has no styles", id)
	}
	defaultIdx := 0
	for i := range lay.Styles {
		if lay.Styles[i].Name == defaultStyleNameID {
			defaultIdx = i
			break
		}
	}
	out := CommonStyleList{Styles: make(map[int32]CommonStyleListEntry, len(lay.Styles))}
	styles := make(map[string]CommonCoating, len(lay.Styles))
	for _, coating := range lay.Styles {
		ref := fmt.Sprintf("%d_%d", id, coating.Name)
		pal, ok := palettes[coating.Palette]
		if !ok {
			return CommonStyleList{}, nil, fmt.Errorf("ekurport: mwsy tag %d style %d: palette %d not found", id, coating.Name, coating.Palette)
		}
		co := CommonCoating{Regions: make(map[int32]CommonRegion)}
		for _, region := range coating.Regions {
			reg := CommonRegion{Layers: make(map[int32]CommonLayer)}
			for i, layer := range region.Layers {
				entry, ok := findSwatchEntry(pal, layer.Name)
				if !ok {
					continue
				}
				sw, ok := swatches[entry.Swatch]
				if !ok {
					continue
				}
				layerC := layerFromMaterial(sw, entry, int32(i))
				mreg, ok := findMaterialRegion(lay.Regions, region.Name)
				if !ok {
					continue
				}
				layerName := layer.Name
				if i < len(mreg.IntentionConversion) {
					layerName = mreg.IntentionConversion[i]
				}
				reg.Layers[layerName] = layerC
			}
			co.Regions[region.Name] = reg
			co.GrimeAmount = coating.GrimeAmount
			co.ScratchAmount = coating.ScratchAmount
			grimeEntry, ok := findSwatchEntry(pal, coating.GrimeType)
			if !ok {
				co.GrimeSwatch.Disabled = true
			} else {
				sw, ok := swatches[grimeEntry.Swatch]
				if !ok {
					return CommonStyleList{}, nil, fmt.Errorf("ekurport: mwsy tag %d style %d: grime swatch %d not found", id, coating.Name, grimeEntry.Swatch)
				}
				co.GrimeSwatch = layerFromMaterial(sw, grimeEntry, 0)
			}
		}
		styles[ref] = co
		out.Styles[coating.Name] = styleListEntry(ref, coating.Name, strings)
	}
	def := lay.Styles[defaultIdx]
	out.DefaultStyle = styleListEntry(fmt.Sprintf("%d_%d", id, def.Name), def.Name, strings)
	return out, styles, nil
}
