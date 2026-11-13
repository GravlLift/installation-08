//go:build gamefiles

package himap

// sonde_materiaux_gamefiles_test.go — sonde : materiaux par instance et parts des maillages,
// mesures sur une carte installee (LEVELUP_SONDE_MODULE, defaut Recharge).

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func TestSondeMateriaux(t *testing.T) {
	root, err := DeployRoot()
	if err != nil {
		t.Skipf("installation absente : %v", err)
	}
	mod := os.Getenv("LEVELUP_SONDE_MODULE")
	if mod == "" {
		mod = filepath.Join(root, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module")
	}
	var b BilanCuisson
	idx, bsp, err := ouvreBSPRetenu(&b, OptionsCuisson{RacineDeploy: root, CheminModule: mod})
	if err != nil {
		t.Fatal(err)
	}
	defer func(i *ModuleIndex) { _ = i.Close() }(idx)

	avecMat, ids := 0, map[uint32]int{}
	groupes := map[string]int{}
	for _, in := range bsp.Instances {
		if len(in.Materiaux) > 0 {
			avecMat++
		}
		for _, id := range in.Materiaux {
			ids[id]++
		}
	}
	for id := range ids {
		g, _, ok := idx.Lookup(id)
		if !ok {
			g = "(absent)"
		}
		groupes[g]++
	}
	t.Logf("instances %d, avec materiaux %d, materiaux distincts %d, groupes %v", len(bsp.Instances), avecMat, len(ids), groupes)
	t.Logf("instance 0 : %d materiaux, premiers %x", len(bsp.Instances[0].Materiaux), bsp.Instances[0].Materiaux[:min(4, len(bsp.Instances[0].Materiaux))])
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
	parModule := map[string]int{}
	for id := range ids {
		if g, m, ok := large.Lookup(id); ok {
			rel, _ := filepath.Rel(root, m)
			parModule[g+" "+rel]++
		}
	}
	t.Logf("index large : %d modules ; materiaux resolus %v", len(tous), parModule)

	// Drapeaux d'instance (flags, plugin : bit 3 cinema only, bit 15 isHLOD), ponderes par
	// triangles, sur les instances que le parcours garde.
	parBit := map[int][2]int{}
	ParcourtInstances(context.Background(), idx, bsp, func(m *Mesh, in Instance, decor, _ bool) {
		for bit := 0; bit < 16; bit++ {
			if in.Flags&(1<<bit) != 0 {
				v := parBit[bit]
				v[0]++
				v[1] += len(m.Triangles)
				parBit[bit] = v
			}
		}
	})
	t.Logf("flags (bit: instances, triangles) %v", parBit)

	// Parts : couverture des triangles et rangs hors liste.
	tris, couverts, horsListe, sansParts := 0, 0, 0, 0
	ParcourtInstances(context.Background(), idx, bsp, func(m *Mesh, in Instance, _, _ bool) {
		tris += len(m.Triangles)
		if len(m.Parts) == 0 {
			sansParts++
		}
		for _, p := range m.Parts {
			couverts += p.Compte
			if p.Materiau < 0 || p.Materiau >= len(in.Materiaux) {
				horsListe += p.Compte
			}
		}
	})
	t.Logf("triangles %d, couverts par une part %d, rang hors liste %d, maillages sans part %d", tris, couverts, horsListe, sansParts)

	// Octets bruts du postprocess[0] des materiaux, autour du blend mode (+64).
	type vu struct {
		id    uint32
		n     int
		brut  string
		refs  []int
		shade uint32
	}
	var vus []vu
	for id, n := range ids {
		tag, err := large.Extract(id)
		if err != nil {
			continue
		}
		for _, ti := range tagCandidates(tag) {
			offs, targets, err := ti.rootBlockRefs()
			if err != nil {
				continue
			}
			rb, _ := ti.rootBlockIndex()
			rAbs, _ := ti.blockAbs(rb)
			v := vu{id: id, n: n, refs: offs, shade: uint32(u32(tag, rAbs+16+refOffGlobalID))}
			for i, o := range offs {
				if o != 64 || targets[i] < 0 {
					continue
				}
				abs, size := ti.blockAbs(targets[i])
				if size >= 160 {
					v.brut = hexa(tag[abs+56 : abs+76])
				}
			}
			vus = append(vus, v)
			break
		}
	}
	sort.Slice(vus, func(i, j int) bool { return vus[i].n > vus[j].n })
	hist := map[string]int{}
	shaders := map[uint32]int{}
	for _, v := range vus {
		hist[v.brut] += v.n
		shaders[v.shade] += v.n
	}
	if len(vus) == 0 {
		t.Fatal("aucun materiau lu")
	}
	t.Logf("materiaux lus %d ; offsets de blocs racine du premier : %v", len(vus), vus[0].refs)
	for k, n := range hist {
		t.Logf("postprocess[0] +56..+76 = %s : %d references", k, n)
	}
	t.Logf("shaders distincts %d", len(shaders))
}

func hexa(b []byte) string {
	const h = "0123456789abcdef"
	out := make([]byte, 0, len(b)*3)
	for i, c := range b {
		if i > 0 && i%4 == 0 {
			out = append(out, ' ')
		}
		out = append(out, h[c>>4], h[c&15])
	}
	return string(out)
}
