package himap

import (
	"fmt"
	"log/slog"
)

// couleurTerrain choisit la couche avec texture couleur presente dans le plus de noeuds retenus.
func couleurTerrain(idx *ModuleIndex, s sourceTerrain, noeuds []int) (Materiau, error) {
	var vide Materiau
	root, err := s.info.rootBlockIndex()
	if err != nil {
		return vide, err
	}
	palette := s.info.subBlockTarget(root, 0xac)
	images := s.info.subBlockTarget(root, 0xc8)
	partages := s.info.subBlockTarget(root, 0x104)
	if palette < 0 || images < 0 || partages < 0 {
		return vide, fmt.Errorf("terrain : palette absente")
	}
	pa, pn := s.info.blockAbs(palette)
	ia, in := s.info.blockAbs(images)
	sa, sn := s.info.blockAbs(partages)
	tag := s.info.tag
	if pa < 0 || ia < 0 || sa < 0 || pa+pn > len(tag) || ia+in > len(tag) || sa+sn > len(tag) || pn%40 != 0 || in%32 != 0 || sn%44 != 0 {
		return vide, fmt.Errorf("terrain : palette invalide")
	}
	comptes := make([]int, pn/40)
	for _, node := range noeuds {
		b := s.info.subBlockTarget(s.blocNoeuds, node*terrainPasNoeud)
		if b < 0 {
			continue
		}
		a, n := s.info.blockAbs(b)
		if a < 0 || a+n > len(tag) {
			continue
		}
		vus := map[int]bool{}
		for k := 0; k+4 <= n; k += 4 {
			shared := u32(tag, a+k)
			if shared >= sn/44 {
				continue
			}
			p := u32(tag, sa+shared*44+4)
			if p < len(comptes) && !vus[p] {
				comptes[p]++
				vus[p] = true
			}
		}
	}
	meilleur := -1
	var bitmap uint32
	for i := range comptes {
		ref := u32(tag, pa+i*40+4)
		if ref >= in/32 {
			continue
		}
		id := idReference(tag, ia+ref*32+4)
		g, _, ok := idx.Lookup(id)
		if !ok || g != GroupeBitmap {
			continue
		}
		if meilleur < 0 || comptes[i] > comptes[meilleur] {
			meilleur = i
			bitmap = id
		}
	}
	if meilleur < 0 {
		return vide, fmt.Errorf("terrain : aucune couleur de couche lisible")
	}
	// shortcut: sans couleur locale explicite, prendre une couleur de la palette ; lire les poids et les degrades pour la fidelite.
	if comptes[meilleur] == 0 {
		slog.Warn("terrain : aucune couleur locale explicite, couleur de la palette utilisee")
	}
	o := pa + meilleur*40
	tr := Transfo{Echelle: [2]float32{float32(f32(tag, o+8)), float32(f32(tag, o+12))}}
	for i, v := range tr.Echelle {
		if v == 0 {
			tr.Echelle[i] = 1
		}
	}
	couche := Couche{Sorte: CoucheCouleur, Bitmap: bitmap, Transfo: tr, Teinte: [3]float32{1, 1, 1}, Opacite: 1}
	return Materiau{ID: bitmap, Couches: &Couches{JeuUV: 0, Couches: []Couche{couche}}}, nil
}
