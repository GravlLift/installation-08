// coatings.go holds the coating shapes of the Spartan piece library (LevelUp's
// meshproto revetements.go, AGPL-3.0, JGtm): the table distilled at build time
// from the community Ekur reference (styles, style lists, coating globals,
// visors) that the viewer reads to paint a player's armor. The server never
// reads the reference: it serves these files like the other library files. The
// images (the pieces' masks, the swatches' gradients) come from the game files
// through the vendored reader.
//
// Identifiers: all in Identifier (8 hex digits of the unsigned 32 bits), like
// the manifests (style_key; visor_id and color_variant are signed there, to be
// converted the same way).
//
// Painting a piece material (the viewer's contract):
//  1. The material carries ExtrasStyleMaterial (the GLB extras.style): style
//     list, style region, seven intentions (base zone, then R, G, B of mask 0,
//     then of mask 1), zone count (4 or 7), texel density and offset. Without
//     style: neutral render.
//  2. Style: coating-<style_key>.json (FileCoating) gives, per list, the style
//     reference of that coating; a list absent from the file, a file that is
//     absent, or a player without a coating takes the list's default style
//     (CoatingsTable.Defaults).
//  3. Zone k: the swatch of intention k in the material's region, else in the
//     common region (RegionCommon), else in the globals (when the global has a
//     non-empty fallback and the style is not old system, look the fallback up
//     the same way; else the global's layer). Old system
//     (CoatingStyle.OldSystem): an intention missing from the regions takes the
//     layer of the same rank in the material's region.
//  4. Visor: a material in region RegionVisor has its base zone replaced by the
//     player's visor (pattern visor_id, colors color_variant).
package spartanpieces

// Coating is one coating (FileCoating): its style's reference per list and
// those styles.
type Coating struct {
	Style  string                  `json:"style"`
	Lists  map[string]string       `json:"lists"`
	Styles map[string]CoatingStyle `json:"styles"`
}

// CoatingTable is the common table, read once per session.
type CoatingTable struct {
	Schema int `json:"schema"`
	// Globals: the coating globals' intentions, per intention.
	Globals map[string]CoatingGlobal `json:"globals"`
	// Defaults: each list's default style; Styles: those styles.
	Defaults map[string]string       `json:"default_styles"`
	Styles   map[string]CoatingStyle `json:"styles"`
	Visors   CoatingVisors           `json:"visors"`
}

// CoatingGlobal is one global intention, its fallback (empty: none) and its layer.
type CoatingGlobal struct {
	Fallback string `json:"fallback,omitempty"`
	Layer    Swatch `json:"layer"`
}

// CoatingStyle is one style (Ekur CommonCoating).
type CoatingStyle struct {
	// OldSystem: style of the old system (reference list_name at Ekur).
	OldSystem bool    `json:"old_system,omitempty"`
	Grime     float32 `json:"grime_amount"`
	Scratches float32 `json:"scratch_amount"`
	// GrimeSwatch: the grime swatch; nil when disabled.
	GrimeSwatch *Swatch `json:"grime_swatch,omitempty"`
	// Regions: per style region, the swatches per intention.
	Regions map[string]map[string]Swatch `json:"regions"`
}

// Swatch is one coating layer (Ekur CommonLayer). The colors are linear.
type Swatch struct {
	Index    int  `json:"index"`
	Disabled bool `json:"disabled,omitempty"`
	// Gradient: the gradient bitmap (FileSwatch), empty without an image; R
	// picks low (0), mid (0.5), high (1); B blends the black roughness into the
	// white one.
	Gradient      string     `json:"gradient,omitempty"`
	GradientScale [2]float32 `json:"gradient_scale"`
	// Roughness: the exponent (4 = neutral); RoughWhite / RoughBlack: the two
	// bounds.
	Rough            float32    `json:"roughness"`
	RoughWhite       float32    `json:"roughness_white"`
	RoughBlack       float32    `json:"roughness_black"`
	Metal            float32    `json:"metallic"`
	Emissive         float32    `json:"emissive"`
	Top              [3]float32 `json:"top"`
	Mid              [3]float32 `json:"mid"`
	Bot              [3]float32 `json:"bot"`
	ScratchColor     [3]float32 `json:"scratch_color"`
	ScratchRoughness float32    `json:"scratch_roughness"`
	ScratchMetal     float32    `json:"scratch_metallic"`
}

// CoatingVisors is the visor patterns and colors, per identifier.
type CoatingVisors struct {
	Patterns map[string]VisorPattern `json:"patterns"`
	Colors   map[string]VisorColor   `json:"colors"`
}

// VisorPattern is one visor pattern (visor_id).
type VisorPattern struct {
	Gradient         string     `json:"gradient,omitempty"`
	GradientScale    [2]float32 `json:"gradient_scale"`
	RoughWhite       float32    `json:"roughness_white"`
	RoughBlack       float32    `json:"roughness_black"`
	Metal            float32    `json:"metallic"`
	ScratchColor     [3]float32 `json:"scratch_color"`
	ScratchRoughness float32    `json:"scratch_roughness"`
	ScratchMetal     float32    `json:"scratch_metallic"`
}

// VisorColor is one visor color (color_variant).
type VisorColor struct {
	Top [3]float32 `json:"top"`
	Mid [3]float32 `json:"mid"`
	Bot [3]float32 `json:"bot"`
}

// CoatingsIndex is what the build distilled (Index.Coatings).
type CoatingsIndex struct {
	// Source: the name of the reference folder read (not its path).
	Source string `json:"source"`
	// Materials: the piece materials annotated with their style; WithoutStyle:
	// known to the reference without one; Missing: unknown to the reference.
	Materials    int `json:"materials"`
	WithoutStyle int `json:"materials_without_style"`
	Missing      int `json:"materials_missing"`
	// MasksAgree / MasksDisagree: materials whose mask bitmaps read by the
	// reader are (or are not) the ones the reference names.
	MasksAgree      int   `json:"masks_agree"`
	MasksDisagree   int   `json:"masks_disagree"`
	Lists           int   `json:"stylelists"`
	Styles          int   `json:"styles"`
	Coatings        int   `json:"coatings"`
	Swatches        int   `json:"swatches"`
	SwatchesMissing int   `json:"swatches_missing"`
	Bytes           int64 `json:"bytes"`
}

// ExtrasStyleMaterial is a piece material's style, as the GLB carries it.
type ExtrasStyleMaterial struct {
	List       string     `json:"stylelist"`
	Region     string     `json:"region"`
	Intentions [7]string  `json:"intentions"`
	LayerCount int        `json:"layers"`
	Density    [2]float32 `json:"texel_density"`
	Offset     [2]float32 `json:"offset"`
}
