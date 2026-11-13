//go:build gamefiles

package himap

import (
	"bytes"
	"context"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSpartanAPeau : le Spartan sort de l'arsenal de Recharge dans son armure par defaut, avec un
// squelette nomme dont les matrices inverses de liaison sont celles de sa pose de repos, des poids
// normalises sur des os du squelette, une hauteur de Spartan debout, et s'ecrit en GLB a peau.
//
// Comptes : regions, noeuds, marqueurs et boites sont ceux d'une reference independante du meme tag ;
// permutations, sections et materiaux croissent avec les mises a jour du jeu (nouvelles pieces
// d'armure), le temoin n'en tient qu'un plancher, celui de la reference.
func TestSpartanAPeau(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	levels, err := LevelsDir("pc")
	if err != nil {
		t.Skip(err)
	}
	a, err := OuvreArsenal(racine, filepath.Join(levels, "sgh_blueprint", "sgh_blueprint-rtx-new.module"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = a.Close() }()
	m, err := a.ModeleAPeau(context.Background(), ModeSpartan)
	if err != nil {
		t.Fatal(err)
	}
	c := m.Comptes
	t.Logf("comptes %+v ; permutations retenues %d ; sections dessinees %d, ombre %d ; shaders hors surface dure %v",
		c, m.PermutationsRetenues, m.SectionsDessinees, m.SectionsOmbre, m.ShadersInconnus)
	if c.Regions != 27 || c.Noeuds != 120 || c.Marqueurs != 127 || c.Boites != 1 {
		t.Errorf("comptes %+v : attendu 27 regions, 120 noeuds, 127 marqueurs, 1 boite", c)
	}
	if c.Permutations < 1625 || c.Sections < 1142 || c.Materiaux < 1292 {
		t.Errorf("comptes %+v : sous le plancher 1625 permutations, 1142 sections, 1292 materiaux", c)
	}
	t.Logf("armure par defaut : ocgd %08x, bipd %08x, hlmt %08x, variante %08x (%d regions nommees)",
		m.Armure.Personnalisation, m.Armure.Biped, m.Armure.Modele, m.Armure.NomVariante, len(m.Armure.Variante))
	if len(m.Armure.Variante) != c.Regions || m.PermutationsRetenues == 0 || m.SectionsIllisibles != 0 || m.SectionsDessinees == 0 {
		t.Errorf("armure par defaut : %d regions nommees sur %d, %d permutations, %d sections illisibles",
			len(m.Armure.Variante), c.Regions, m.PermutationsRetenues, m.SectionsIllisibles)
	}
	verifieCorpsComplet(t, m)
	verifieInfluences(t, m)
	verifieSquelette(t, m)
	lo, hi, _ := m.Maillage.Structure.Borne()
	t.Logf("boite du modele %v %v : hauteur %.3f u (%.2f m), %d triangles, %d sommets", lo, hi, hi[2]-lo[2],
		float64(hi[2]-lo[2])*3.048, m.Maillage.Structure.Triangles(), len(m.Influences))
	if h := hi[2] - lo[2]; h < 0.6 || h > 0.8 || math.Abs(float64(lo[2])) > 0.01 {
		t.Errorf("hauteur %.3f u, pieds a %.3f : pas un Spartan debout (~0,72 u, pieds a 0)", h, lo[2])
	}
	var buf bytes.Buffer
	if err := EcritGLBPeau(&buf, m, "test", nil); err != nil {
		t.Fatal(err)
	}
	t.Logf("GLB %d octets", buf.Len())
	if dst := os.Getenv("DIAG_GLB"); dst != "" {
		if err := os.WriteFile(dst, buf.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// Gabarit du corps complet, en unites du jeu (axes Halo : +X devant, Y lateral, Z haut).
const (
	trancheCorps     = 0.05
	troncBas         = 0.35 // du bassin...
	troncHaut        = 0.70 // ... au bas du casque
	secteursTronc    = 12
	axeTroncX        = 0.01 // l'axe vertical du tronc, mesure sur le modele
	demiLargeurTronc = 0.11 // au-dela, les bras
)

// verifieCorpsComplet : l'armure par defaut est un corps sans trou. Trois gardes :
//   - les boites des sections dessinees, tranchees en hauteur de 0,05 u des pieds a la tete, n'ont
//     aucune tranche vide ;
//   - la poitrine (0,40..0,55) et le bassin (0,30..0,42) ont chacune une section dont la boite
//     enjambe le plan median (y = 0) ;
//   - autour de l'axe du tronc, de 0,35 a 0,70, chaque tranche porte des sommets dans chacun des 12
//     secteurs : un plastron ou un dos absent y laisse des secteurs vides (garde que les boites
//     seules ne voient pas : une piece de bassin haute enjambe aussi la poitrine).
func verifieCorpsComplet(t *testing.T, m *ModeleAPeau) {
	t.Helper()
	s := m.Maillage.Structure.Sommets
	type boite struct{ lo, hi [3]float32 }
	var boites []boite
	for _, p := range m.Plages {
		b := boite{lo: [3]float32{s[3*p.Debut], s[3*p.Debut+1], s[3*p.Debut+2]}}
		b.hi = b.lo
		for i := p.Debut; i < p.Fin; i++ {
			for c := 0; c < 3; c++ {
				b.lo[c], b.hi[c] = min(b.lo[c], s[3*i+c]), max(b.hi[c], s[3*i+c])
			}
		}
		boites = append(boites, b)
	}
	lo, hi, _ := m.Maillage.Structure.Borne()
	for z := lo[2]; z < hi[2]; z += trancheCorps {
		vide := true
		for _, b := range boites {
			vide = vide && (b.hi[2] < z || b.lo[2] > z+trancheCorps)
		}
		if vide {
			t.Errorf("tranche %.2f..%.2f u : aucune section", z, z+trancheCorps)
		}
	}
	for _, zone := range []struct {
		nom    string
		z0, z1 float32
	}{{"poitrine", 0.40, 0.55}, {"bassin", 0.30, 0.42}} {
		n := 0
		for _, b := range boites {
			if b.lo[2] < zone.z1 && b.hi[2] > zone.z0 && b.lo[1] < 0 && b.hi[1] > 0 {
				n++
			}
		}
		if n == 0 {
			t.Errorf("%s (%.2f..%.2f u) : aucune section n'enjambe le plan median", zone.nom, zone.z0, zone.z1)
		}
	}
	verifieSecteursTronc(t, s)
}

// verifieSecteursTronc : chaque tranche du tronc a des sommets dans chacun de ses secteurs.
func verifieSecteursTronc(t *testing.T, s []float32) {
	t.Helper()
	nTranches := int(math.Round((troncHaut - troncBas) / trancheCorps))
	grille := make([][secteursTronc]int, nTranches)
	for i := 0; i+2 < len(s); i += 3 {
		x, y, z := float64(s[i])-axeTroncX, float64(s[i+1]), float64(s[i+2])
		b := int(math.Floor((z - troncBas) / trancheCorps))
		if b < 0 || b >= nTranches || math.Abs(y) > demiLargeurTronc {
			continue
		}
		grille[b][min(int((math.Atan2(y, x)+math.Pi)/(2*math.Pi)*secteursTronc), secteursTronc-1)]++
	}
	for b, l := range grille {
		for k, n := range l {
			if n == 0 {
				t.Errorf("tronc, tranche %.2f u, secteur %d (%.0f deg, 0 = devant) : aucun sommet",
					troncBas+float64(b)*trancheCorps, k, float64(k)*360/secteursTronc-180+15)
			}
		}
	}
	t.Logf("sommets du tronc par tranche (bas en haut) et secteur (de l'arriere, sens direct) : %v", grille)
}

// verifieInfluences : chaque sommet a des poids de somme 1 sur des os du squelette.
func verifieInfluences(t *testing.T, m *ModeleAPeau) {
	t.Helper()
	for i, inf := range m.Influences {
		s := 0.0
		for c := 0; c < OsParSommet; c++ {
			s += float64(inf.Poids[c])
			if int(inf.Os[c]) >= len(m.Noeuds) {
				t.Fatalf("sommet %d lie a l'os %d sur %d", i, inf.Os[c], len(m.Noeuds))
			}
		}
		if math.Abs(s-1) > 1e-3 {
			t.Fatalf("sommet %d : poids de somme %f", i, s)
		}
	}
}

// verifieSquelette : noms en clair, os de la vue presents, inverse de liaison = inverse de la pose.
func verifieSquelette(t *testing.T, m *ModeleAPeau) {
	t.Helper()
	noms := map[string]int{}
	for i, n := range m.Noms {
		if strings.HasPrefix(n, "noeud_") {
			t.Errorf("noeud %d sans nom en clair (%s)", i, n)
		}
		noms[n] = i
	}
	for _, n := range []string{"b_pedestal", "b_pelvis", "b_aim_pitch", "b_aim_yaw", "b_r_grip", "b_l_grip", "b_head"} {
		if _, ok := noms[n]; !ok {
			t.Errorf("os %s absent", n)
		}
	}
	ecart := 0.0
	for k, n := range m.Noeuds {
		mt := NodeModelTransform(m.Noeuds, k)
		for _, p := range [][3]float64{{0, 0, 0}, {1, 0, 0}, {0, 1, 0}, {0, 0, 1}} {
			q := mt.Applique(p)
			for r := 0; r < 3; r++ {
				v := n.InvAxes[0][r]*q[0] + n.InvAxes[1][r]*q[1] + n.InvAxes[2][r]*q[2] + n.InvPos[r]
				ecart = max(ecart, math.Abs(v-p[r]))
			}
		}
	}
	t.Logf("inverse de liaison contre pose de repos : ecart max %.2e", ecart)
	if ecart > 1e-4 {
		t.Errorf("inverse de liaison et pose de repos different de %.2e", ecart)
	}
}
