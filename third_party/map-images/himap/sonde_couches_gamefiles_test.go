//go:build gamefiles

package himap

// sonde_couches_gamefiles_test.go — sonde : poids des shaders (en triangles) sur une carte
// installee (LEVELUP_SONDE_MODULE, defaut Recharge) et presence des trois jeux de coordonnees.

import (
	"context"
	"fmt"
	"image/png"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func TestSondeCouches(t *testing.T) {
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

	parMat := map[uint32]int{}
	var avecUV [NJeuxUV]int
	tris := 0
	ParcourtInstances(context.Background(), idx, bsp, func(m *Mesh, in Instance, decor, horsPasse bool) {
		if decor || horsPasse {
			return
		}
		mats := materiauxDesTriangles(m, in)
		for _, id := range mats {
			parMat[id]++
		}
		tris += len(m.Triangles)
		for j, jeu := range m.UV {
			if jeu != nil {
				avecUV[j] += len(m.Triangles)
			}
		}
	})
	t.Logf("triangles de structure %d ; avec jeu UV 0/1/2 : %v", tris, avecUV)

	chemins, _ := CheminsMateriaux(root, mod)
	mi, err := NewModuleIndex(chemins...)
	if err != nil {
		t.Fatal(err)
	}
	defer func(i *ModuleIndex) { _ = i.Close() }(mi)
	ids := make([]uint32, 0, len(parMat))
	for id := range parMat {
		ids = append(ids, id)
	}
	table, illisibles := LitMateriaux(mi, idx, ids)
	parShader := map[uint32][2]int{}
	for id, n := range parMat {
		s := uint32(0)
		if m, ok := table[id]; ok {
			s = m.Shader
		}
		v := parShader[s]
		v[0]++
		v[1] += n
		parShader[s] = v
	}
	type ligne struct {
		shader    uint32
		mats, tri int
	}
	var lignes []ligne
	for s, v := range parShader {
		lignes = append(lignes, ligne{s, v[0], v[1]})
	}
	sort.Slice(lignes, func(i, j int) bool { return lignes[i].tri > lignes[j].tri })
	t.Logf("materiaux %d, illisibles %d, shaders %d", len(parMat), illisibles, len(lignes))
	// Couches lues : couverture, bitmaps distincts par role, deux exemples par shader.
	couverts, exemples := 0, map[uint32]int{}
	roles := map[string]map[uint32]bool{"masque": {}, "couleur": {}, "degrade": {}, "normale": {}, "controle": {}}
	for id, n := range parMat {
		m, ok := table[id]
		if !ok || m.Couches == nil {
			continue
		}
		couverts += n
		if m.Couches.Masque != 0 {
			roles["masque"][m.Couches.Masque] = true
		}
		for _, k := range m.Couches.Couches {
			if k.Sorte == CoucheCouleur {
				roles["couleur"][k.Bitmap] = true
			} else {
				roles["degrade"][k.Bitmap] = true
			}
			if k.Normale != 0 {
				roles["normale"][k.Normale] = true
			}
			if k.Controle != 0 {
				roles["controle"][k.Controle] = true
			}
		}
		if exemples[m.Shader] < 2 {
			exemples[m.Shader]++
			t.Logf("mat %08x shader %08x masque %08x", id, m.Shader, m.Couches.Masque)
			for i, k := range m.Couches.Couches {
				t.Logf("  couche %d sorte %d bmp %08x transfo %v teinte %v haut %v milieu %v bas %v melange %d opa %.2f",
					i+1, k.Sorte, k.Bitmap, k.Transfo, k.Teinte, k.Haut, k.Milieu, k.Bas, k.Melange, k.Opacite)
				t.Logf("    normale %08x transfo %v intensite %.3g melange %d ; controle %08x transfo %v",
					k.Normale, k.TransfoNormale, k.IntensiteNormale, k.MelangeNormale, k.Controle, k.TransfoControle)
			}
		}
	}
	t.Logf("triangles a couches %d (%.1f %%) ; bitmaps masque %d couleur %d degrade %d normale %d controle %d", couverts,
		100*float64(couverts)/float64(tris), len(roles["masque"]), len(roles["couleur"]), len(roles["degrade"]),
		len(roles["normale"]), len(roles["controle"]))
	// LEVELUP_SONDE_PNG=<dossier> ecrit les textures d'un materiau (LEVELUP_SONDE_MAT, hexa).
	if dir, cible := os.Getenv("LEVELUP_SONDE_PNG"), os.Getenv("LEVELUP_SONDE_MAT"); dir != "" && cible != "" {
		for id, m := range table {
			if fmt.Sprintf("%08x", id) != cible || m.Couches == nil {
				continue
			}
			ecrit := func(nom string, bmp uint32, cote int) {
				tx, err := LitBitmap(idx, bmp, cote)
				if err != nil {
					t.Logf("%s %08x : %v", nom, bmp, err)
					return
				}
				f, _ := os.Create(filepath.Join(dir, fmt.Sprintf("%s_%08x.png", nom, bmp)))
				_ = png.Encode(f, tx.Image)
				_ = f.Close()
				t.Logf("%s %08x : %dx%d mono %v", nom, bmp, tx.Image.Rect.Dx(), tx.Image.Rect.Dy(), tx.Monocanal)
			}
			ecrit("masque", m.Couches.Masque, 256)
			for i, k := range m.Couches.Couches {
				ecrit(fmt.Sprintf("couche%d", i+1), k.Bitmap, 256)
			}
		}
	}
	cumul := 0
	for _, l := range lignes {
		cumul += l.tri
		t.Logf("shader %08x (%d) : %d materiaux, %d triangles, cumul %.1f %%",
			l.shader, int32(l.shader), l.mats, l.tri, 100*float64(cumul)/float64(tris))
	}
}
