//go:build gamefiles && research

package himap

// LOCAL-CHANGE (infinite-theater-3d): research probe for a map's self-lit materials. For every
// material a built GLB names (IT3D_SONDE_GLB), it dumps the shader, blend mode, bound textures by
// slot and the shader's declared parameters (name hash, resolved text when the dictionary below
// hashes to it, record type, byte) with the material's value at that byte. Output goes to
// IT3D_SONDE_OUT. The module is IT3D_SONDE_MODULE (deploy-relative or absolute).

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// sondeDicoShader: candidate texts for shader parameter names.
func sondeDicoShader() map[uint32]string {
	prefixes := []string{"", "si_", "self_illum_", "selfillum_", "illum_", "emissive_", "emission_", "hologram_", "holo_",
		"screen_", "neon_", "sign_", "base_", "surface_", "detail_", "scroll_", "alpha_", "color_", "glow_", "diffuse_",
		"overlay_", "noise_", "scanline_", "scan_", "flicker_", "fresnel_", "rim_", "edge_", "pulse_", "layer_", "mask_",
		"distortion_", "warp_", "bloom_", "light_", "lit_", "glass_", "window_", "interior_", "room_", "parallax_",
		"tint_", "flipbook_", "sprite_", "frame_", "uv_", "pan_", "panning_", "gradient_", "intensity_", "opacity_"}
	tokens := []string{"color", "colour", "map", "texture", "intensity", "amount", "tint", "scroll", "speed", "u", "v",
		"x", "y", "scale", "offset", "mask", "alpha", "opacity", "brightness", "power", "exponent", "fresnel", "scanline",
		"scanlines", "flicker", "frequency", "frames", "frame", "rate", "noise", "distortion", "self", "illum", "emissive",
		"emission", "glow", "hologram", "holo", "screen", "strength", "multiplier", "min", "max", "contrast", "bias",
		"time", "pulse", "rim", "edge", "width", "falloff", "fade", "depth", "parallax", "interior", "room", "window",
		"normal", "roughness", "metallic", "specular", "diffuse", "base", "top", "mid", "bottom", "detail", "tiling",
		"direction", "dir", "pan", "rotation", "angle", "count", "columns", "rows", "index", "amplitude", "phase",
		"wave", "lines", "line", "density", "sharpness", "softness", "threshold", "cutoff", "clip", "invert", "blend",
		"mode", "on", "off", "enable", "enabled", "use", "albedo", "lightmap", "light", "lit", "unlit", "additive",
		"high", "low", "range", "start", "end", "boost", "overlay", "gradient", "ramp", "lookup", "lut", "sprite",
		"flipbook", "sheet", "atlas", "uv", "channel", "red", "green", "blue", "r", "g", "b", "a", "0", "1", "2", "3",
		"primary", "secondary", "tertiary", "inner", "outer", "center", "vertex", "view", "camera", "distance", "near", "far",
		"sun", "sky", "env", "environment", "reflection", "cubemap", "refraction", "glass", "dirt", "grime", "wet",
		"control", "packed", "macro", "micro", "stencil", "decal", "sign", "neon", "tube", "bulb", "lamp", "billboard",
		"ad", "advert", "advertisement", "video", "display", "monitor", "pixel", "pixels", "grid", "dot", "dots", "jitter",
		"glitch", "static", "interference", "transparency", "translucency", "translucent", "emissivity", "luminance",
		"luminosity", "exposure", "hdr", "bloom", "flash", "blink", "on_time", "off_time", "animation", "anim"}
	out := map[uint32]string{}
	add := func(s string) { out[uint32(mapvar.LabelHash(s))] = s }
	for _, p := range prefixes {
		for _, a := range tokens {
			add(p + a)
			for _, b := range tokens {
				add(p + a + "_" + b)
			}
		}
	}
	return out
}

type sondeGLBMat struct {
	Name   string `json:"name"`
	Extras struct {
		ID     uint32 `json:"id"`
		Shader uint32 `json:"shader"`
	} `json:"extras"`
	Emissive []float32 `json:"emissiveFactor"`
}

func sondeLitGLB(t *testing.T, p string) []sondeGLBMat {
	f, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	h := make([]byte, 20)
	if _, err := f.Read(h); err != nil {
		t.Fatal(err)
	}
	js := make([]byte, binary.LittleEndian.Uint32(h[12:]))
	if _, err := f.ReadAt(js, 20); err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Materials []sondeGLBMat `json:"materials"`
	}
	if err := json.Unmarshal(js, &doc); err != nil {
		t.Fatal(err)
	}
	return doc.Materials
}

// sondeParamsBruts: the shader's declared parameter records, raw.
func sondeParamsBruts(tag []byte) [][]byte {
	for _, ti := range tagCandidates(tag) {
		offs, targets, err := ti.rootBlockRefs()
		if err != nil {
			continue
		}
		var out [][]byte
		for i, o := range offs {
			if o != shdvChampParametres || targets[i] < 0 || targets[i] >= ti.dataBlocks {
				continue
			}
			abs, size := ti.blockAbs(targets[i])
			if abs < 0 || abs+size > len(tag) || size%shdvStrideParametre != 0 {
				return nil
			}
			for k := 0; k < size; k += shdvStrideParametre {
				out = append(out, tag[abs+k:abs+k+shdvStrideParametre])
			}
		}
		return out
	}
	return nil
}

func TestSondeEmissifsCarte(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	glb, sortie := os.Getenv("IT3D_SONDE_GLB"), os.Getenv("IT3D_SONDE_OUT")
	mod := os.Getenv("IT3D_SONDE_MODULE")
	if glb == "" || sortie == "" || mod == "" {
		t.Skip("IT3D_SONDE_GLB, IT3D_SONDE_OUT, IT3D_SONDE_MODULE")
	}
	if !filepath.IsAbs(mod) {
		mod = filepath.Join(racine, mod)
	}
	filtre := map[uint32]bool{}
	for _, h := range strings.Split(os.Getenv("IT3D_SONDE_SHADERS"), ",") {
		var v uint32
		if _, err := fmt.Sscanf(strings.TrimSpace(h), "%x", &v); err == nil {
			filtre[v] = true
		}
	}
	mats, err := CheminsMateriaux(racine, mod)
	if err != nil {
		t.Fatal(err)
	}
	idxMat, err := NewModuleIndex(mats...)
	if err != nil {
		t.Fatal(err)
	}
	defer idxMat.Close()
	geo, err := GeometrySearchPathMonde(racine, mod)
	if err != nil {
		t.Fatal(err)
	}
	idxGeo, err := NewModuleIndex(geo...)
	if err != nil {
		t.Fatal(err)
	}
	defer idxGeo.Close()
	dico := sondeDicoShader()
	parShader := map[uint32][]sondeGLBMat{}
	for _, m := range sondeLitGLB(t, glb) {
		if len(filtre) > 0 && !filtre[m.Extras.Shader] {
			continue
		}
		parShader[m.Extras.Shader] = append(parShader[m.Extras.Shader], m)
	}
	shaders := make([]uint32, 0, len(parShader))
	for s := range parShader {
		shaders = append(shaders, s)
	}
	sort.Slice(shaders, func(i, j int) bool { return len(parShader[shaders[i]]) > len(parShader[shaders[j]]) })
	var b strings.Builder
	for _, s := range shaders {
		var params [][]byte
		if tag, err := idxGeo.Extract(s); err == nil {
			params = sondeParamsBruts(tag)
		}
		fmt.Fprintf(&b, "=== shader %08x : %d materials, %d params\n", s, len(parShader[s]), len(params))
		for _, r := range params {
			nom := binary.LittleEndian.Uint32(r)
			fmt.Fprintf(&b, "  param %08x %-34q type@4=%d @8=%d byte=%d raw=%x\n", nom, dico[nom],
				binary.LittleEndian.Uint32(r[4:]), binary.LittleEndian.Uint32(r[8:]), u16(r, shdvParamOffOctet), r[4:])
		}
		for _, gm := range parShader[s] {
			tag, err := idxMat.Extract(gm.Extras.ID)
			if err != nil {
				fmt.Fprintf(&b, " mat %08x: %v\n", gm.Extras.ID, err)
				continue
			}
			m, _ := LitMateriau(gm.Extras.ID, tag, lecteurShaders(idxGeo), nil)
			pp, nfonc := sondePostprocess(tag)
			fmt.Fprintf(&b, " mat %08x melange=%d passeT=%v emissif=%+v fonctions=%d glbEmissive=%v\n",
				gm.Extras.ID, m.Melange, m.PasseTransparente, m.Emissif, nfonc, gm.Emissive)
			slots := make([]int, 0, len(pp.textures))
			for o := range pp.textures {
				slots = append(slots, o)
			}
			sort.Ints(slots)
			for _, o := range slots {
				fmt.Fprintf(&b, "   tex slot %d = %08x (%d) transfo reg %d\n", o, pp.textures[o], int32(pp.textures[o]), pp.transfos[o])
			}
			c := lecteurConstantes(pp.constantes)
			for _, r := range params {
				nom := binary.LittleEndian.Uint32(r)
				o := int(u16(r, shdvParamOffOctet))
				if _, isTex := pp.textures[o]; isTex && binary.LittleEndian.Uint32(r[4:]) == 0 {
					continue
				}
				if o+16 <= len(pp.constantes) {
					fmt.Fprintf(&b, "   c %08x %-30q @%d = %g %g %g %g\n", nom, dico[nom], o, c.f(o), c.f(o+4), c.f(o+8), c.f(o+12))
				}
			}
			fmt.Fprintf(&b, "   constantes %d o\n", len(pp.constantes))
		}
	}
	if err := os.WriteFile(sortie, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestSondeBitmapsPNG writes the bitmaps IT3D_SONDE_BITMAPS (hex ids) as 256 px PNGs into the
// folder IT3D_SONDE_PNG, to look at what a material binds.
func TestSondeBitmapsPNG(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	dossier, mod := os.Getenv("IT3D_SONDE_PNG"), os.Getenv("IT3D_SONDE_MODULE")
	if dossier == "" || mod == "" {
		t.Skip("IT3D_SONDE_PNG, IT3D_SONDE_MODULE")
	}
	if !filepath.IsAbs(mod) {
		mod = filepath.Join(racine, mod)
	}
	geo, err := GeometrySearchPathMonde(racine, mod)
	if err != nil {
		t.Fatal(err)
	}
	idx, err := NewModuleIndex(geo...)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	// Contact sheets: RGB and alpha, 8 columns of 128 px cells in list order.
	const cell, cols = 128, 8
	ids := strings.Split(os.Getenv("IT3D_SONDE_BITMAPS"), ",")
	rows := (len(ids) + cols - 1) / cols
	rgb := image.NewNRGBA(image.Rect(0, 0, cols*cell, rows*cell))
	alpha := image.NewGray(image.Rect(0, 0, cols*cell, rows*cell))
	defer func() {
		for nom, img := range map[string]image.Image{"planche_rgb.png": rgb, "planche_a.png": alpha} {
			if f, err := os.Create(filepath.Join(dossier, nom)); err == nil {
				_ = png.Encode(f, img)
				_ = f.Close()
			}
		}
	}()
	for n, h := range ids {
		var v uint32
		if _, err := fmt.Sscanf(strings.TrimSpace(h), "%x", &v); err != nil {
			continue
		}
		tex, err := LitBitmap(idx, v, 256)
		if err != nil {
			t.Logf("%d %08x: %v", n, v, err)
			continue
		}
		b := tex.Image.Bounds()
		ox, oy := (n%cols)*cell, (n/cols)*cell
		for y := 0; y < cell-2; y++ {
			for x := 0; x < cell-2; x++ {
				sx, sy := b.Min.X+x*b.Dx()/(cell-2), b.Min.Y+y*b.Dy()/(cell-2)
				c := tex.Image.NRGBAAt(sx, sy)
				rgb.SetNRGBA(ox+x, oy+y, color.NRGBA{c.R, c.G, c.B, 255})
				alpha.Pix[(oy+y)*alpha.Stride+ox+x] = c.A
			}
		}
		t.Logf("%d %08x: %v mono=%v", n, v, b.Size(), tex.Monocanal)
		if os.Getenv("IT3D_SONDE_UN_PAR_UN") == "" {
			continue
		}
		f, err := os.Create(filepath.Join(dossier, fmt.Sprintf("%08x.png", v)))
		if err != nil {
			t.Fatal(err)
		}
		_ = png.Encode(f, tex.Image)
		_ = f.Close()
		// The alpha alone, as grey, beside it.
		a := image.NewGray(tex.Image.Bounds())
		for i := range a.Pix {
			a.Pix[i] = tex.Image.Pix[4*i+3]
		}
		if f, err := os.Create(filepath.Join(dossier, fmt.Sprintf("%08x_a.png", v))); err == nil {
			_ = png.Encode(f, a)
			_ = f.Close()
		}
	}
}

// TestSondePlacesGLB writes, for every material of a built GLB (IT3D_SONDE_GLB), the box of the
// vertices its primitives index (glTF axes, map units), one line per primitive, into
// IT3D_SONDE_OUT. Instanced decorators are skipped.
func TestSondePlacesGLB(t *testing.T) {
	glb, sortie := os.Getenv("IT3D_SONDE_GLB"), os.Getenv("IT3D_SONDE_OUT")
	if glb == "" || sortie == "" {
		t.Skip("IT3D_SONDE_GLB, IT3D_SONDE_OUT")
	}
	brut, err := os.ReadFile(glb)
	if err != nil {
		t.Fatal(err)
	}
	n := int(binary.LittleEndian.Uint32(brut[12:]))
	var doc struct {
		Materials []sondeGLBMat `json:"materials"`
		Meshes    []struct {
			Name       string `json:"name"`
			Primitives []struct {
				Attributes map[string]int `json:"attributes"`
				Indices    int            `json:"indices"`
				Material   int            `json:"material"`
			} `json:"primitives"`
		} `json:"meshes"`
		Nodes []struct {
			Name       string         `json:"name"`
			Mesh       *int           `json:"mesh"`
			Extensions map[string]any `json:"extensions"`
		} `json:"nodes"`
		Accessors []struct {
			BufferView, ByteOffset, ComponentType, Count int
		} `json:"accessors"`
		BufferViews []struct {
			ByteOffset, ByteLength int
		} `json:"bufferViews"`
	}
	if err := json.Unmarshal(brut[20:20+n], &doc); err != nil {
		t.Fatal(err)
	}
	bin := brut[20+n+8:]
	var b strings.Builder
	for _, nd := range doc.Nodes {
		if nd.Mesh == nil || nd.Extensions != nil {
			continue
		}
		for _, p := range doc.Meshes[*nd.Mesh].Primitives {
			pa, ia := doc.Accessors[p.Attributes["POSITION"]], doc.Accessors[p.Indices]
			pv, iv := doc.BufferViews[pa.BufferView], doc.BufferViews[ia.BufferView]
			lo := [3]float32{float32(math.Inf(1)), float32(math.Inf(1)), float32(math.Inf(1))}
			hi := [3]float32{float32(math.Inf(-1)), float32(math.Inf(-1)), float32(math.Inf(-1))}
			for k := 0; k < ia.Count; k++ {
				var v int
				o := iv.ByteOffset + ia.ByteOffset
				switch ia.ComponentType {
				case 5125:
					v = int(binary.LittleEndian.Uint32(bin[o+4*k:]))
				case 5123:
					v = int(binary.LittleEndian.Uint16(bin[o+2*k:]))
				default:
					v = int(bin[o+k])
				}
				q := pv.ByteOffset + pa.ByteOffset + 12*v
				for c := range 3 {
					f := math.Float32frombits(binary.LittleEndian.Uint32(bin[q+4*c:]))
					lo[c], hi[c] = min(lo[c], f), max(hi[c], f)
				}
			}
			m := doc.Materials[p.Material]
			if cible := os.Getenv("IT3D_SONDE_GRAPPES"); cible != "" && (cible == "*" || strings.Contains(cible, fmt.Sprintf("%08x", m.Extras.ID))) {
				// Triangles by 2-unit cell of their first vertex: where the material's copies stand.
				cellules := map[[3]int]int{}
				for k := 0; k < ia.Count; k += 3 {
					o := iv.ByteOffset + ia.ByteOffset
					var v int
					switch ia.ComponentType {
					case 5125:
						v = int(binary.LittleEndian.Uint32(bin[o+4*k:]))
					case 5123:
						v = int(binary.LittleEndian.Uint16(bin[o+2*k:]))
					default:
						v = int(bin[o+k])
					}
					q := pv.ByteOffset + pa.ByteOffset + 12*v
					var c [3]int
					for j := range 3 {
						c[j] = int(math.Floor(float64(math.Float32frombits(binary.LittleEndian.Uint32(bin[q+4*j:]))) / 2))
					}
					cellules[c]++
				}
				for c, n := range cellules {
					fmt.Fprintf(&b, "  grappe %08x cell=%d,%d,%d (x2) tris=%d\n", m.Extras.ID, c[0], c[1], c[2], n)
				}
			}
			fmt.Fprintf(&b, "%08x %08x %s tris=%d centre=%.1f,%.1f,%.1f taille=%.1f,%.1f,%.1f\n", m.Extras.ID, m.Extras.Shader, nd.Name, ia.Count/3,
				(lo[0]+hi[0])/2, (lo[1]+hi[1])/2, (lo[2]+hi[2])/2, hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2])
		}
	}
	if err := os.WriteFile(sortie, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestSondeBilanEmissifs counts, for the maps IT3D_SONDE_CARTES ("name=glb path;..."), the
// materials that emit, per shader: those of the fixed table and those read by names, see-through
// or opaque, picture or mask.
func TestSondeBilanEmissifs(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	cartes := os.Getenv("IT3D_SONDE_CARTES")
	if cartes == "" {
		t.Skip("IT3D_SONDE_CARTES")
	}
	for _, c := range strings.Split(cartes, ";") {
		nom, glb, _ := strings.Cut(c, "=")
		mod := filepath.Join(racine, "pc", "levels", "multi", nom, nom+"-rtx-new.module")
		mats, err := CheminsMateriaux(racine, mod)
		if err != nil {
			t.Fatal(err)
		}
		idxMat, err := NewModuleIndex(mats...)
		if err != nil {
			t.Fatal(err)
		}
		geo, err := GeometrySearchPathMonde(racine, mod)
		if err != nil {
			t.Fatal(err)
		}
		idxGeo, err := NewModuleIndex(geo...)
		if err != nil {
			t.Fatal(err)
		}
		var ids []uint32
		for _, m := range sondeLitGLB(t, glb) {
			ids = append(ids, m.Extras.ID)
		}
		table, illisibles := LitMateriaux(idxMat, idxGeo, ids)
		type compte struct{ total, emet int }
		parShader := map[string]*compte{}
		for _, m := range table {
			_, fixe := shadersEmissifs[m.Shader]
			sorte := "noms"
			if fixe {
				sorte = "table"
			}
			if m.Emissif != nil {
				if m.Emissif.Image {
					sorte += "/image"
				}
				if !m.Opaque() && !m.Vitre() {
					sorte += "/superpose"
				}
			}
			k := fmt.Sprintf("%08x %s", m.Shader, sorte)
			if parShader[k] == nil {
				parShader[k] = &compte{}
			}
			parShader[k].total++
			if m.Emissif != nil {
				parShader[k].emet++
			}
		}
		cles := make([]string, 0, len(parShader))
		for k, v := range parShader {
			if v.emet > 0 {
				cles = append(cles, k)
			}
		}
		sort.Strings(cles)
		t.Logf("%s : %d materiaux, %d illisibles", nom, len(table), illisibles)
		for _, k := range cles {
			t.Logf("  %s : %d emettent", k, parShader[k].emet)
		}
		// Animated parameters of the emitters: per shader, role, kind and function.
		roles := map[string]int{}
		animes := map[string]int{}
		for id, m := range table {
			if m.Emissif == nil {
				continue
			}
			tag, err := idxMat.Extract(id)
			if err != nil {
				continue
			}
			pp, _ := sondePostprocess(tag)
			registre := -1
			if r, ok := pp.transfos[m.Emissif.octets.emplacement]; ok && m.Emissif.octets.emplacement >= 0 {
				registre = r
			}
			if len(m.Emissif.Animations) > 0 {
				animes[fmt.Sprintf("%08x", m.Shader)]++
			}
			for _, p := range pp.animes {
				ondes := ""
				for _, s := range p.Fonction.Periodiques {
					ondes += fmt.Sprintf("/%d@%.3g", s.Onde, s.Frequence)
				}
				k := fmt.Sprintf("%08x %-8s sorte=%d @%d reg%d fn=%d%s", m.Shader, roleAnimation(m.Emissif.octets, registre, p), p.Sorte, p.Octet, registre, p.Fonction.Type, ondes)
				roles[k]++
				if r := roleAnimation(m.Emissif.octets, registre, p); r == "couleur" || r == "fonction" {
					t.Logf("      detail %08x %s : %+v", id, r, p.Fonction)
				}
			}
		}
		for k, v := range animes {
			t.Logf("  anime %s : %d materiaux", k, v)
		}
		cr := make([]string, 0, len(roles))
		for k := range roles {
			cr = append(cr, k)
		}
		sort.Strings(cr)
		for _, k := range cr {
			t.Logf("    %s : %d", k, roles[k])
		}
		_ = idxMat.Close()
		_ = idxGeo.Close()
	}
}

// TestSondeBlocsMateriau dumps, for the materials IT3D_SONDE_MATS (hex ids) of IT3D_SONDE_MODULE,
// the postprocess record and every block nested under it (field offset, size, section, bytes),
// recursively, into IT3D_SONDE_OUT.
func TestSondeBlocsMateriau(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	mod, sortie := os.Getenv("IT3D_SONDE_MODULE"), os.Getenv("IT3D_SONDE_OUT")
	if mod == "" || sortie == "" || os.Getenv("IT3D_SONDE_MATS") == "" {
		t.Skip("IT3D_SONDE_MODULE, IT3D_SONDE_OUT, IT3D_SONDE_MATS")
	}
	if !filepath.IsAbs(mod) {
		mod = filepath.Join(racine, mod)
	}
	mats, err := CheminsMateriaux(racine, mod)
	if err != nil {
		t.Fatal(err)
	}
	idx, err := NewModuleIndex(mats...)
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	var b strings.Builder
	var dump func(ti tagInfo, bloc, prof int)
	dump = func(ti tagInfo, bloc, prof int) {
		// Struct-table entries of another kind under this block (data references...).
		for i := 0; i < ti.structs; i++ {
			e := ti.structTab + i*structEntrySize
			if sorte := u16(ti.tag, e+0x10); sorte != 1 && i32(ti.tag, e+0x18) == bloc {
				c := i32(ti.tag, e+0x14)
				fmt.Fprintf(&b, "%s[entree sorte %d, champ +%d, cible %d]", strings.Repeat("  ", prof), sorte, u32(ti.tag, e+0x1C), c)
				if c >= 0 && c < ti.dataBlocks {
					abs, size := ti.blockAbsSection(c)
					fmt.Fprintf(&b, " %d o : %x", size, ti.tag[abs:min(abs+size, len(ti.tag), abs+512)])
				}
				b.WriteString("\n")
			}
		}
		// Data references (0x14 o after the struct table: parent struct, ?, target block, field
		// block, field offset) whose field lives in this block.
		if h := sondeEnteteH(ti); h > 0 {
			nRef := u32(ti.tag, h-0x14)
			tab := ti.structTab + ti.structs*structEntrySize
			for i := 0; i < nRef && tab+(i+1)*0x14 <= len(ti.tag); i++ {
				e := tab + i*0x14
				if i32(ti.tag, e+12) != bloc {
					continue
				}
				c := i32(ti.tag, e+8)
				fmt.Fprintf(&b, "%s[donnees champ +%d, cible %d]", strings.Repeat("  ", prof), u32(ti.tag, e+16), c)
				if c >= 0 && c < ti.dataBlocks {
					abs, size := ti.blockAbsSection(c)
					fmt.Fprintf(&b, " %d o : %x", size, ti.tag[abs:min(abs+size, len(ti.tag), abs+512)])
				}
				b.WriteString("\n")
			}
		}
		sous := ti.sousBlocsParOffset(bloc)
		offs := make([]int, 0, len(sous))
		for o := range sous {
			offs = append(offs, o)
		}
		sort.Ints(offs)
		for _, o := range offs {
			c := sous[o]
			if c < 0 || c >= ti.dataBlocks {
				fmt.Fprintf(&b, "%s+%d -> (vide)\n", strings.Repeat("  ", prof), o)
				continue
			}
			abs, size := ti.blockAbsSection(c)
			sec := u16(ti.tag, ti.blockTab+c*blockEntrySize+6)
			fin := min(abs+size, len(ti.tag), abs+1024)
			fmt.Fprintf(&b, "%s+%d -> bloc %d, %d o, section %d : %x\n", strings.Repeat("  ", prof), o, c, size, sec, ti.tag[abs:fin])
			dump(ti, c, prof+1)
		}
	}
	for _, h := range strings.Split(os.Getenv("IT3D_SONDE_MATS"), ",") {
		var id uint32
		if _, err := fmt.Sscanf(strings.TrimSpace(h), "%x", &id); err != nil {
			continue
		}
		tag, err := idx.Extract(id)
		if err != nil {
			fmt.Fprintf(&b, "== %08x : %v\n", id, err)
			continue
		}
		for _, ti := range tagCandidates(tag) {
			offs, targets, err := ti.rootBlockRefs()
			if err != nil {
				continue
			}
			fmt.Fprintf(&b, "== %08x\n", id)
			for i, o := range offs {
				if o != matOffPostprocess || targets[i] < 0 {
					continue
				}
				abs, size := ti.blockAbs(targets[i])
				fmt.Fprintf(&b, "postprocess %d o : %x\n", size, ti.tag[abs:abs+min(size, postprocessStride)])
				dump(ti, targets[i], 1)
			}
			break
		}
	}
	if err := os.WriteFile(sortie, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

// sondeEnteteH: the header byte H where tagCandidates found (headerSize, dataSize); 0 if none.
func sondeEnteteH(ti tagInfo) int {
	for h := tagHeaderScanFrom; h <= tagHeaderScanTo && h+8 <= len(ti.tag); h += 4 {
		if u32(ti.tag, h) == ti.headerSize && u32(ti.tag, h+4) == ti.dataSize && u32(ti.tag, h-0x18) == ti.structs {
			return h
		}
	}
	return 0
}

// TestSondeAnimesDossier surveys the emitters of every GLB in the folder IT3D_SONDE_DOSSIER (the
// weapon library, the first-person pieces), read through Recharge's module and the globals: how
// many carry animated parameters, by shader and role.
func TestSondeAnimesDossier(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	dossier := os.Getenv("IT3D_SONDE_DOSSIER")
	if dossier == "" {
		t.Skip("IT3D_SONDE_DOSSIER")
	}
	glbs, _ := filepath.Glob(filepath.Join(dossier, "*.glb"))
	vus := map[uint32]bool{}
	var ids []uint32
	for _, g := range glbs {
		for _, m := range sondeLitGLB(t, g) {
			if !vus[m.Extras.ID] && len(m.Emissive) > 0 {
				vus[m.Extras.ID] = true
				ids = append(ids, m.Extras.ID)
			}
		}
	}
	mod := filepath.Join(racine, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module")
	mats, _ := CheminsMateriaux(racine, mod)
	idxMat, err := NewModuleIndex(mats...)
	if err != nil {
		t.Fatal(err)
	}
	defer idxMat.Close()
	geo, _ := GeometrySearchPathMonde(racine, mod)
	idxGeo, err := NewModuleIndex(geo...)
	if err != nil {
		t.Fatal(err)
	}
	defer idxGeo.Close()
	table, illisibles := LitMateriaux(idxMat, idxGeo, ids)
	roles := map[string]int{}
	for id, m := range table {
		if m.Emissif == nil {
			continue
		}
		tag, err := idxMat.Extract(id)
		if err != nil {
			continue
		}
		pp, _ := sondePostprocess(tag)
		registre := -1
		if r, ok := pp.transfos[m.Emissif.octets.emplacement]; ok && m.Emissif.octets.emplacement >= 0 {
			registre = r
		}
		for _, p := range pp.animes {
			roles[fmt.Sprintf("%08x %-8s sorte=%d @%d fn=%d", m.Shader, roleAnimation(m.Emissif.octets, registre, p), p.Sorte, p.Octet, p.Fonction.Type)]++
		}
	}
	t.Logf("%d GLB, %d emetteurs, %d lus, %d illisibles", len(glbs), len(ids), len(table), illisibles)
	for k, v := range roles {
		t.Logf("  %s : %d", k, v)
	}
}

// TestSondeNomsCombines hashes prefix + word [+ "_" + word] for the prefixes and words of the
// files IT3D_SONDE_PREFIXES and IT3D_SONDE_MOTS (one per line) against IT3D_SONDE_CIBLES.
func TestSondeNomsCombines(t *testing.T) {
	fp, fm, cibles := os.Getenv("IT3D_SONDE_PREFIXES"), os.Getenv("IT3D_SONDE_MOTS"), os.Getenv("IT3D_SONDE_CIBLES")
	if fp == "" || fm == "" || cibles == "" {
		t.Skip("IT3D_SONDE_PREFIXES, IT3D_SONDE_MOTS, IT3D_SONDE_CIBLES")
	}
	lignes := func(f string) []string {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, l := range strings.Split(strings.ReplaceAll(string(b), "\r", ""), "\n") {
			out = append(out, strings.TrimSpace(strings.TrimPrefix(l, string(rune(0xFEFF)))))
		}
		return out
	}
	cible := map[uint32]bool{}
	for _, h := range strings.Split(cibles, ",") {
		var v uint32
		if _, err := fmt.Sscanf(strings.TrimSpace(h), "%x", &v); err == nil {
			cible[v] = true
		}
	}
	mots := lignes(fm)
	essai := func(s string) {
		if h := uint32(mapvar.LabelHash(s)); cible[h] {
			t.Logf("%08x = %s", h, s)
		}
	}
	for _, p := range lignes(fp) {
		for _, a := range mots {
			if a == "" {
				continue
			}
			essai(p + a)
			for _, b := range mots {
				if b != "" {
					essai(p + a + "_" + b)
				}
			}
		}
	}
}

// TestSondeNomsShader hashes IT3D_SONDE_NOMS (comma-separated texts) and prints those that land
// on IT3D_SONDE_CIBLES (hex hashes).
func TestSondeNomsShader(t *testing.T) {
	noms, cibles := os.Getenv("IT3D_SONDE_NOMS"), os.Getenv("IT3D_SONDE_CIBLES")
	if f := os.Getenv("IT3D_SONDE_NOMS_FICHIER"); f != "" {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		noms = strings.ReplaceAll(strings.ReplaceAll(string(b), "\r", ""), "\n", ",")
	}
	if noms == "" || cibles == "" {
		t.Skip("IT3D_SONDE_NOMS (or IT3D_SONDE_NOMS_FICHIER), IT3D_SONDE_CIBLES")
	}
	for _, n := range strings.Split(noms, ",") {
		h := fmt.Sprintf("%08x", uint32(mapvar.LabelHash(strings.TrimSpace(n))))
		if strings.Contains(cibles, h) {
			t.Logf("%s = %s", h, n)
		}
	}
}

// sondePostprocess: the first postprocess of a mat tag and its function-parameter count (+60).
func sondePostprocess(tag []byte) (postprocessLu, int) {
	for _, ti := range tagCandidates(tag) {
		offs, targets, err := ti.rootBlockRefs()
		if err != nil {
			continue
		}
		for i, o := range offs {
			if o == matOffPostprocess && targets[i] >= 0 {
				abs, _ := ti.blockAbs(targets[i])
				n := 0
				if abs >= 0 && abs+64 <= len(tag) {
					n = int(u32(tag, abs+60))
				}
				return ti.postprocess(targets[i]), n
			}
		}
	}
	return postprocessLu{}, 0
}
