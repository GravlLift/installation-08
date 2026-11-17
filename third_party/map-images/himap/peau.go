// Package himap — peau.go : les influences des os sur les sommets d'une section de `mode`.
//
// Une section (60 o, bloc Sections) porte son nœud rigide a +22 (u8, 255 = aucun) et son TYPE DE
// SOMMET a +23 (u8, enum du moteur `vertex type`). Le LOD retenu designe, parmi ses 19 index de
// tampons (un par usage), les INDICES DE FUSION a l'emplacement 7 et les POIDS a l'emplacement 8 :
//
//	indices : quatre octets par sommet (format 4, pas de 4), rangs dans le bloc des noeuds du mode
//	poids   : trois poids de 10 bits dans un mot de 32 bits (format 13, pas de 4), chacun sur 1023 ;
//	          le quatrieme os porte un poids implicite de 1, et les quatre se normalisent a 1
//
// Le quatrieme poids n'est PAS 1 moins la somme des trois : un sommet sur vingt porte trois poids
// de somme superieure a 1 (temoin TestSpartanAPeau), ce que « 1 moins la somme » rendrait negatif.
// Les trois poids ecrits se lisent donc relativement a celui du quatrieme os (deduit).
//
// Selon le type :
//
//	rigide (1)              : la section entiere suit son noeud rigide, poids 1
//	a peau (2), a peau DQ (26) : indices et poids (le tampon de l'emplacement 10, poids de la fusion
//	                          par quaternions duaux, n'est pas lu : la vue fusionne lineairement)
//	rigide a os (23)        : indices seuls, poids egaux
//
// Un indice repete cumule ses poids. Les positions d'une section rigide sont deja en repere modele
// (pose de repos), comme celles d'une section a peau.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// Grammaire de la peau d'une section.
const (
	sectionOffNoeudRigide = 22
	sectionOffTypeSommet  = 23
	noeudRigideAucun      = 255

	emplacementIndicesFusion = 7
	emplacementPoidsFusion   = 8
	formatIndicesOctets      = 4
	formatPoids101010        = 13
	pasTamponFusion          = 4
	poids10BitsMax           = 1023
)

// Types de sommet d'une section (enum du moteur).
const (
	TypeSommetRigide     = 1
	TypeSommetAPeau      = 2
	TypeSommetRigideOsse = 23
	TypeSommetAPeauDQ    = 26
)

// OsParSommet : le nombre d'influences qu'un sommet porte.
const OsParSommet = 4

// Influences : les os d'un sommet et leurs poids, de somme 1 ; un emplacement libre porte l'os 0 a
// un poids nul.
type Influences struct {
	Os    [OsParSommet]uint16
	Poids [OsParSommet]float32
}

// ErrPeauIllisible : la peau d'une section n'a pas la forme mesuree (type de sommet, tampons).
var ErrPeauIllisible = errors.New("himap: unreadable section skin")

// PeauDeSection rend les influences de chaque sommet du maillage `k` (memes sommets que
// `Mesh(k)`, dans le meme ordre), pour un squelette de `nNoeuds` noeuds.
func (a *RuntimeGeoAsset) PeauDeSection(k, nNoeuds int) ([]Influences, error) {
	if k < 0 || k >= a.geo.MeshCount {
		return nil, fmt.Errorf("%w: section %d outside the %d", ErrPeauIllisible, k, a.geo.MeshCount)
	}
	sAbs, _ := a.info.blockAbs(a.geo.SectionsTarget)
	rec := a.info.tag[sAbs+k*sectionStride:]
	rigide, typ := int(rec[sectionOffNoeudRigide]), int(rec[sectionOffTypeSommet])
	l, ok := a.chooseLOD(k)
	if !ok {
		return nil, fmt.Errorf("%w: section %d without LOD", ErrPeauIllisible, k)
	}
	n := a.vertexDescs[l.vertexBuf].Count
	if rigide != noeudRigideAucun || typ == TypeSommetRigide {
		if rigide >= nNoeuds {
			return nil, fmt.Errorf("%w: section %d rigid at node %d of %d", ErrPeauIllisible, k, rigide, nNoeuds)
		}
		out := make([]Influences, n)
		for i := range out {
			out[i] = Influences{Os: [OsParSommet]uint16{uint16(rigide)}, Poids: [OsParSommet]float32{1}}
		}
		return out, nil
	}
	if typ != TypeSommetAPeau && typ != TypeSommetAPeauDQ && typ != TypeSommetRigideOsse {
		return nil, fmt.Errorf("%w: section %d of vertex type %d", ErrPeauIllisible, k, typ)
	}
	indices, err := a.tamponFusion(l, emplacementIndicesFusion, formatIndicesOctets, n)
	if err != nil {
		return nil, fmt.Errorf("section %d, indices: %w", k, err)
	}
	var poids []byte
	if typ != TypeSommetRigideOsse {
		if poids, err = a.tamponFusion(l, emplacementPoidsFusion, formatPoids101010, n); err != nil {
			return nil, fmt.Errorf("section %d, weights: %w", k, err)
		}
	}
	return influencesDesTampons(indices, poids, n, nNoeuds)
}

// tamponFusion rend les octets du tampon de l'emplacement `emplacement` du LOD, verifie au format,
// au pas de 4 et au nombre de sommets.
func (a *RuntimeGeoAsset) tamponFusion(l lodEntry, emplacement int, format uint32, n int) ([]byte, error) {
	v := int(int16(binary.LittleEndian.Uint16(a.info.tag[l.abs+lodOffVertexBuffer+2*emplacement:])))
	if v < 0 || v >= len(a.vertexDescs) {
		return nil, fmt.Errorf("%w: slot %d empty", ErrPeauIllisible, emplacement)
	}
	d := a.vertexDescs[v]
	if d.Usage != format || d.Stride != pasTamponFusion || d.Count != n || d.Offset < 0 || d.Offset+d.Size > len(a.blob) {
		return nil, fmt.Errorf("%w: slot %d at format %d, stride %d, %d vertices (expected %d, %d, %d)",
			ErrPeauIllisible, emplacement, d.Usage, d.Stride, d.Count, format, pasTamponFusion, n)
	}
	return a.blob[d.Offset : d.Offset+d.Size], nil
}

// influencesDesTampons decode `n` sommets ; `poids` nil : poids egaux (rigide a os).
func influencesDesTampons(indices, poids []byte, n, nNoeuds int) ([]Influences, error) {
	out := make([]Influences, n)
	for i := range out {
		var os [OsParSommet]int
		var w [OsParSommet]float64
		for c := 0; c < OsParSommet; c++ {
			os[c] = int(indices[i*pasTamponFusion+c])
			if os[c] >= nNoeuds {
				return nil, fmt.Errorf("%w: vertex %d bound to node %d of %d", ErrPeauIllisible, i, os[c], nNoeuds)
			}
			w[c] = 1
		}
		if poids != nil {
			p := binary.LittleEndian.Uint32(poids[i*pasTamponFusion:])
			for c := 0; c < 3; c++ {
				w[c] = float64(p>>(10*c)&poids10BitsMax) / poids10BitsMax
			}
		}
		out[i] = cumuleInfluences(os, w)
	}
	return out, nil
}

// cumuleInfluences fusionne les os repetes, ecarte les poids nuls et normalise a 1.
func cumuleInfluences(os [OsParSommet]int, w [OsParSommet]float64) Influences {
	var inf Influences
	var cumul [OsParSommet]float64
	n, total := 0, 0.0
	for c := 0; c < OsParSommet; c++ {
		if w[c] <= 0 {
			continue
		}
		total += w[c]
		j := 0
		for j < n && int(inf.Os[j]) != os[c] {
			j++
		}
		if j == n {
			inf.Os[n] = uint16(os[c])
			n++
		}
		cumul[j] += w[c]
	}
	for j := 0; j < n; j++ {
		inf.Poids[j] = float32(cumul[j] / total)
	}
	return inf
}
