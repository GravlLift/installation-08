//go:build gamefiles

package himap

// sonde_textures_gamefiles_test.go — sonde : parametres et textures des materiaux d'une carte
// (noms de parametres = murmur3, candidats testes), et en-tetes des bitmaps references.

import (
	"encoding/binary"
	"fmt"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

const (
	sondeParamsOff     = 44
	sondeParamStride   = 156
	sondeTexStride     = 56
	sondeBitmapsOff    = 0xD4
	sondeBitmapStride  = 40
	sondeTexOffParam   = 0x2A
	sondePostConstants = 0x58
)

func TestSondeTextures(t *testing.T) {
	root, err := DeployRoot()
	if err != nil {
		t.Skipf("installation absente : %v", err)
	}
	mod := filepath.Join(root, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module")
	var b BilanCuisson
	idx, bsp, err := ouvreBSPRetenu(&b, OptionsCuisson{RacineDeploy: root, CheminModule: mod})
	if err != nil {
		t.Fatal(err)
	}
	defer func(i *ModuleIndex) { _ = i.Close() }(idx)
	chemins, _ := CheminsMateriaux(root, mod)
	mats, err := NewModuleIndex(chemins...)
	if err != nil {
		t.Fatal(err)
	}
	defer func(i *ModuleIndex) { _ = i.Close() }(mats)

	refs := map[uint32]int{}
	for _, in := range bsp.Instances {
		for _, id := range in.Materiaux {
			refs[id]++
		}
	}
	noms := map[uint32]string{}
	for _, n := range strings.Fields(os.Getenv("LEVELUP_SONDE_NOMS") + " " + candidatsNoms) {
		noms[uint32(mapvar.LabelHash(n))] = n
	}
	nom := func(h uint32) string {
		if n, ok := noms[h]; ok {
			return n
		}
		return fmt.Sprintf("%08x", h)
	}

	type parShader struct {
		mats, refs int
		params     map[string]int
		tex        map[int]int
		exemple    uint32
	}
	shaders := map[uint32]*parShader{}
	bitmaps := map[uint32]bool{}
	for id, n := range refs {
		tag, err := mats.Extract(id)
		if err != nil {
			continue
		}
		lu, ok := sondeLitMateriau(tag)
		if !ok {
			continue
		}
		s := shaders[lu.shader]
		if s == nil {
			s = &parShader{params: map[string]int{}, tex: map[int]int{}, exemple: id}
			shaders[lu.shader] = s
		}
		s.mats++
		s.refs += n
		for _, p := range lu.params {
			s.params[fmt.Sprintf("%s:%d", nom(p.nom), p.typ)]++
			if p.bitmap != 0 && p.bitmap != 0xFFFFFFFF {
				bitmaps[p.bitmap] = true
			}
		}
		for _, tx := range lu.textures {
			s.tex[tx.param]++
		}
	}
	ordre := make([]uint32, 0, len(shaders))
	for k := range shaders {
		ordre = append(ordre, k)
	}
	sort.Slice(ordre, func(i, j int) bool { return shaders[ordre[i]].refs > shaders[ordre[j]].refs })
	for _, k := range ordre {
		s := shaders[k]
		t.Logf("shader %08x (%d) : %d materiaux, %d refs, ex %08x\n   params %v\n   textures (index:n) %v", k, int32(k), s.mats, s.refs, s.exemple, s.params, s.tex)
	}

	// En-tetes des bitmaps : groupe, module, format, dimensions.
	formats := map[string]int{}
	absents := 0
	for id := range bitmaps {
		g, m, ok := idx.Lookup(id)
		if !ok {
			absents++
			continue
		}
		tag, err := idx.Extract(id)
		if err != nil || g != "bitm" {
			formats["illisible "+g]++
			continue
		}
		for _, ti := range tagCandidates(tag) {
			rb, err := ti.rootBlockIndex()
			if err != nil {
				continue
			}
			_ = rb
			cible := ti.subBlockTarget(rb, sondeBitmapsOff)
			if cible < 0 || cible >= ti.dataBlocks {
				formats["sans bloc bitmaps"]++
				break
			}
			abs, size := ti.blockAbs(cible)
			if abs < 0 || abs+size > len(tag) || size < sondeBitmapStride {
				formats["bloc bitmaps hors borne"]++
				break
			}
			rel, _ := filepath.Rel(root, m)
			formats[fmt.Sprintf("n=%d fmt=%d type=%d %s", size/sondeBitmapStride, u16(tag, abs+8), tag[abs+6], filepath.Dir(rel))]++
			break
		}
	}
	t.Logf("bitmaps references par parametres : %d, absents de l'index geometrie : %d", len(bitmaps), absents)
	for k, n := range formats {
		t.Logf("  %s : %d", k, n)
	}

	// Decodage de toutes les textures de postprocess ; quelques PNG dans LEVELUP_SONDE_PNG.
	sortie := os.Getenv("LEVELUP_SONDE_PNG")
	debut := time.Now()
	ok, erreurs, ecrits := 0, map[string]int{}, 0
	vusTex := map[uint32]bool{}
	for id := range refs {
		tag, err := mats.Extract(id)
		if err != nil {
			continue
		}
		lu, _ := sondeLitMateriau(tag)
		for _, tx := range lu.textures {
			if vusTex[tx.bitmap] {
				continue
			}
			vusTex[tx.bitmap] = true
			tex, err := LitBitmap(idx, tx.bitmap, 512)
			if err != nil && strings.Contains(err.Error(), "unreadable") && erreurs["detail"] < 2 {
				erreurs["detail"]++
				brut, _ := idx.Extract(tx.bitmap)
				_, fe, _ := idx.entree(tx.bitmap)
				t.Logf("bitmap %08x : %d octets, %d candidats, entree %+v, debut %s", tx.bitmap, len(brut), len(tagCandidates(brut)), fe, hexa(brut[:min(64, len(brut))]))
				for _, ti := range tagCandidates(brut) {
					offs, targets, e1 := ti.rootBlockRefs()
					rb, e2 := ti.rootBlockIndex()
					t.Logf("bitmap %08x : %d octets, root %d (%v), blocs racine %v -> %v (%v), dataBlocks %d", tx.bitmap, len(brut), rb, e2, offs, targets, e1, ti.dataBlocks)
				}
			}
			if err != nil {
				msg := err.Error()
				if len(msg) > 60 {
					msg = msg[:60]
				}
				erreurs[msg]++
				continue
			}
			ok++
			interessant := lu.shader == 0xb125c3cf || lu.shader == 0x7c4fbef5 || lu.shader == 0x13dbef74 || lu.shader == 0xa50c052e
			if sortie != "" && interessant && ecrits < 80 {
				nomF := filepath.Join(sortie, fmt.Sprintf("%08x_s%d_%08x_%dx%d.png", lu.shader, tx.param, tx.bitmap, tex.Image.Rect.Dx(), tex.Image.Rect.Dy()))
				if fh, err := os.Create(nomF); err == nil {
					_ = png.Encode(fh, tex.Image)
					_ = fh.Close()
					ecrits++
				}
			}
		}
	}
	t.Logf("textures decodees %d en %v, erreurs %v, png %d", ok, time.Since(debut), erreurs, ecrits)

	var tous []string
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && filepath.Ext(p) == ".module" {
			tous = append(tous, p)
		}
		return nil
	})
	large, err := NewModuleIndex(tous...)
	if err != nil {
		t.Fatal(err)
	}
	defer func(i *ModuleIndex) { _ = i.Close() }(large)
	ou := map[string]int{}
	for id := range vusTex {
		if _, _, ok := idx.Lookup(id); ok {
			continue
		}
		if g, m, ok := large.Lookup(id); ok {
			rel, _ := filepath.Rel(root, m)
			ou[g+" "+rel]++
		} else {
			ou["introuvable"]++
		}
	}
	t.Logf("bitmaps hors index geometrie : %v", ou)

	table, _ := LitMateriaux(mats, idx, func() []uint32 {
		var ids []uint32
		for id := range refs {
			ids = append(ids, id)
		}
		return ids
	}())
	for id, m := range table {
		if m.Decoupe != nil {
			tag, _ := mats.Extract(id)
			mm, fe, _ := mats.entree(id)
			res, _ := mm.Ressources(fe)
			t.Logf("entree mat %08x : %+v, %d ressources", id, fe, len(res))
			for _, r := range res {
				o, err := mm.Extract(r)
				var sb strings.Builder
				for k := 0; k+4 <= min(len(o), 160); k += 4 {
					fmt.Fprintf(&sb, " %.4g", math.Float32frombits(binary.LittleEndian.Uint32(o[k:])))
				}
				t.Logf("   ressource %+v err %v :%s", r, err, sb.String())
			}
			for _, ti := range tagCandidates(tag) {
				offs, targets, err := ti.rootBlockRefs()
				if err != nil {
					continue
				}
				for i, o := range offs {
					if o == matOffPostprocess {
						for champ, cible := range ti.sousBlocsParOffset(targets[i]) {
							if cible < 0 || cible >= ti.dataBlocks {
								continue
							}
							a, s := ti.blockAbs(cible)
							var sb strings.Builder
							for k := 0; k+4 <= min(s, 96); k += 4 {
								fmt.Fprintf(&sb, " %.4g", math.Float32frombits(binary.LittleEndian.Uint32(tag[a+k:])))
							}
							t.Logf("  sous-bloc champ %#x : %d o :%s", champ, s, sb.String())
						}
						pp := ti.postprocess(targets[i])
						tx, c := pp.textures, pp.constantes
						var sb strings.Builder
						for k := 0; k+4 <= len(c); k += 4 {
							fmt.Fprintf(&sb, " %d:%.4g", k, math.Float32frombits(binary.LittleEndian.Uint32(c[k:])))
						}
						t.Logf("constantes %08x (%d o) textures %v :%s", id, len(c), tx, sb.String())
					}
				}
				break
			}
			t.Logf("decoupe : materiau %08x shader %08x refs %d melange %d -> %+v", id, m.Shader, refs[id], m.Melange, *m.Decoupe)
		}
	}
}

const candidatsNoms = `alpha_map alpha_test_map alpha_mask alpha_mask_map opacity_map opacity alpha_test alpha_clip
alpha_threshold alpha_clip_threshold alpha_test_threshold ac_thresh clip_threshold alpha_power alpha_add
color_map base_map albedo_map diffuse_map normal_map control_map asg_control_map mask_map mask0_map mask1_map
color_tint tint_color albedo_tint layer1_color_map layer0_color_map macro_mask_map macro_normal_map
alpha_map_transform color_map_transform base_color detail_map selfillum_map self_illum_map emissive_map
cone_map conemap decal_mask decal_normal decal_control ui_texture screen_control alpha_mask_texture
alpha_texture color_texture normal_texture control_texture mask0_texture mask1_texture`

type sondeParam struct {
	nom, typ uint32
	bitmap   uint32
}

type sondeTex struct {
	bitmap uint32
	param  int
}

type sondeMat struct {
	shader   uint32
	params   []sondeParam
	textures []sondeTex
}

func sondeLitMateriau(tag []byte) (sondeMat, bool) {
	for _, ti := range tagCandidates(tag) {
		offs, targets, err := ti.rootBlockRefs()
		if err != nil {
			continue
		}
		rb, err := ti.rootBlockIndex()
		if err != nil {
			continue
		}
		rAbs, _ := ti.blockAbs(rb)
		out := sondeMat{shader: uint32(u32(tag, rAbs+matOffShader+refOffGlobalID))}
		for i, o := range offs {
			if targets[i] < 0 {
				continue
			}
			abs, size := ti.blockAbs(targets[i])
			if abs < 0 || abs+size > len(tag) {
				continue
			}
			switch o {
			case sondeParamsOff:
				for k := 0; k+sondeParamStride <= size; k += sondeParamStride {
					r := abs + k
					out.params = append(out.params, sondeParam{nom: uint32(u32(tag, r)), typ: uint32(u32(tag, r+4)), bitmap: uint32(u32(tag, r+8+refOffGlobalID))})
				}
			case matOffPostprocess:
				sous := ti.sousBlocsParOffset(targets[i])
				if c, ok := sous[0]; ok && c >= 0 && c < ti.dataBlocks {
					ta, ts := ti.blockAbs(c)
					if ta < 0 || ta+ts > len(tag) {
						continue
					}
					for k := 0; k+sondeTexStride <= ts; k += sondeTexStride {
						out.textures = append(out.textures, sondeTex{bitmap: uint32(u32(tag, ta+k+refOffGlobalID)), param: int(u16(tag, ta+k+sondeTexOffParam))})
					}
				}
			}
		}
		return out, true
	}
	return sondeMat{}, false
}
