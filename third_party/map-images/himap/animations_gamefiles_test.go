//go:build gamefiles

package himap

import (
	"context"
	"errors"
	"math"
	"math/bits"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Planchers des comptes de decodage (mesures 2026-11-09) : le jeu peut ajouter des animations, le
// temoin n'en tient qu'un plancher.
const (
	decodeesPlancherPropre = 164
	decodeesPlancherRacine = 2988
)

// grapheRacineSpartan : le graphe racine dont herite le graphe du Spartan.
const grapheRacineSpartan uint32 = 0x000033CE

// Tolerances des controles physiques, en unites du jeu.
const (
	toleranceNormeQuat  = 1e-3   // quantum de 16 bits : ecart mesure 3e-4
	toleranceLongueurOs = 0.01   // ecart relatif de longueur d'un os (mesure : 0,00 % en locomotion)
	longueurOsMin       = 0.02   // en deca, un os est un pivot : sa longueur ne se compare pas
	correlationPiedsMax = -0.8   // pieds en opposition de phase
	piedAuSol           = 0.06   // hauteur de cheville sous laquelle un pied peut etre d'appui
	margeAppui          = 0.002  // hauteur d'une cheville d'appui au-dessus de son minimum
	glissementPiedMax   = 0.0015 // glissement moyen d'un pied d'appui contre le deplacement, par image (4,6 mm)
	metresParUnite      = 3.048
	// Cycles de locomotion du graphe racine trouves par la physique : marche avant (cap +X) et
	// marche arriere a la balle (cap -X).
	cycleAvantRacine        = 13
	cycleBalleArriereRacine = 295
)

// ouvreGraphesSpartan ouvre l'arsenal de Recharge, les graphes du Spartan et les noeuds de son mode.
func ouvreGraphesSpartan(t *testing.T) (*GraphesAnimation, []Noeud) {
	t.Helper()
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
	t.Cleanup(func() { _ = a.Close() })
	gs, err := a.GraphesDuSpartan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	tag, err := a.geo.Extract(ModeSpartan)
	if err != nil {
		t.Fatal(err)
	}
	noeuds, err := ModeNodes(tag)
	if err != nil {
		t.Fatal(err)
	}
	return gs, noeuds
}

// TestAnimationsSpartan : les graphes du Spartan se lisent, leurs os sont ceux du `mode` rang par
// rang, chaque animation se decode ou est refusee sur son codec, et les animations decodees passent
// les controles physiques : quaternions unitaires, comptes d'en-tete egaux aux drapeaux, longueurs
// d'os conservees, pieds en opposition de phase sur un cycle de marche avant, pied pose qui recule
// exactement du deplacement de racine de l'animation.
func TestAnimationsSpartan(t *testing.T) {
	gs, noeuds := ouvreGraphesSpartan(t)
	tous := gs.Tous()
	if len(tous) != 2 || gs.Graphe(grapheRacineSpartan) == nil {
		t.Fatalf("%d graphes, racine %08x lue : %v", len(tous), grapheRacineSpartan, gs.Graphe(grapheRacineSpartan) != nil)
	}
	normeMax, longueurs := 0.0, 0
	for _, g := range tous {
		if err := g.MemeSquelette(noeuds); err != nil {
			t.Error(err)
		}
		b := g.Bilan()
		t.Logf("graphe %08x : %d animations, %d entrees ; decodees %d, refusees %v, courbes non lues %v, illisibles %d",
			g.ID, len(g.Animations), len(g.Entrees), b.Decodees, b.NonDecodees, b.CourbesNonLues, len(b.Illisibles))
		for _, err := range b.Illisibles {
			t.Error(err)
		}
		for c, n := range b.NonDecodees {
			t.Errorf("graphe %08x : %d animations refusees sous la cle %d", g.ID, n, c)
		}
		for r, n := range b.CourbesNonLues {
			t.Errorf("graphe %08x : %d animations de codec 10 refusees (%s)", g.ID, n, r)
		}
		plancher := decodeesPlancherPropre
		if g.ID == grapheRacineSpartan {
			plancher = decodeesPlancherRacine
		}
		if b.Decodees < plancher {
			t.Errorf("graphe %08x : %d animations decodees, plancher %d", g.ID, b.Decodees, plancher)
		}
		n, m := verifieClipsDecodes(t, g, noeuds, locomotions(gs, g))
		normeMax, longueurs = math.Max(normeMax, n), longueurs+m
	}
	if longueurs == 0 {
		t.Error("aucune longueur d'os mesuree sur la locomotion")
	}
	t.Logf("ecart maximal de norme des quaternions : %.5f", normeMax)
	racine := gs.Graphe(grapheRacineSpartan)
	verifiePhasePieds(t, racine, noeuds, cycleAvantRacine)
	for _, k := range []int{cycleAvantRacine, cycleBalleArriereRacine} {
		verifiePiedPose(t, racine, noeuds, k)
	}
	verifieChemins(t, gs, noeuds)
}

// verifieChemins : le cycle de marche avant se retrouve par son chemin de l'arbre des modes (en
// clair et sous ses StringID), et la marche accroupie au fusil, designee par le sien, est un cycle
// de locomotion.
func verifieChemins(t *testing.T, gs *GraphesAnimation, noeuds []Noeud) {
	t.Helper()
	c, _, err := gs.Clip([NiveauxModes]string{"combat", "neutral", "any", "any", "locomote_walk_front"})
	if err != nil || c.Graphe != grapheRacineSpartan || c.Animation.Rang != cycleAvantRacine {
		t.Fatalf("chemin du cycle avant : %v", err)
	}
	if c, _, err = gs.Clip([NiveauxModes]string{"*", "#f6bae26f", "any", "any", "#b2303cca"}); err != nil || c.Animation.Rang != cycleAvantRacine {
		t.Fatalf("chemin du cycle avant sous ses StringID : %v", err)
	}
	c, e, err := gs.Clip([NiveauxModes]string{"crouch", "rifle", "any", "any", "locomote_walk_front"})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%s -> animation %d du %08x", e.Chemin(), c.Animation.Rang, c.Graphe)
	verifiePhasePieds(t, gs.Graphe(c.Graphe), noeuds, c.Animation.Rang)
	if _, _, err := gs.Clip([NiveauxModes]string{"*", "rifle", "*", "any", "idle"}); err == nil {
		t.Error("un chemin a joker qui designe plusieurs animations est refuse")
	}
}

// osAnatomique : les os de la chaine du corps, dont la longueur (distance a leur parent dans le
// repere du modele) ne change pas. Les os d'aide (`_fixup`, `_twist`, `_jiggle`), d'armure, de doigt,
// la camera et les poignees (`b_*_grip`, l'attache de l'arme, qui bouge par construction) en sont
// exclus, comme les clavicules (les epaules se haussent) et le bassin (sa translation est la
// hauteur du corps).
var osAnatomique = regexp.MustCompile(`^b_(spine\d?|neck\d?|head|[lr]_(thigh|calf|foot|toe|upperarm|forearm|hand))$`)

// imagesParClipLongueurs : les images echantillonnees par animation pour les longueurs d'os.
const imagesParClipLongueurs = 6

// verifieClipsDecodes controle chaque animation decodee du graphe (normes, comptes, longueurs) et
// rend l'ecart maximal de norme et le nombre de longueurs mesurees. Les longueurs se mesurent apres
// composition de la pose, sur les animations de base a deplacement de racine que l'arbre des modes
// designe par une action de locomotion (`adr`, locomotions) : hors locomotion, des animations etirent
// les bras a dessein (la sortie de vehicule 2120 du graphe racine et les morts sous un vehicule 63 et
// 72 allongent les mains de 27 %).
func verifieClipsDecodes(t *testing.T, g *GrapheAnimation, noeuds []Noeud, adr map[int]bool) (float64, int) {
	t.Helper()
	normeMax, pires, mesures := 0.0, map[string]ecartOs{}, 0
	for i := range g.Animations {
		c, err := g.Decode(i)
		if errors.Is(err, ErrCodecNonDecode) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		verifieComptesDrapeaux(t, g, i)
		for _, p := range c.Os {
			for _, q := range p.Rotations {
				normeMax = math.Max(normeMax, math.Abs(math.Sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3])-1))
			}
		}
		if c.Animation.Type == AnimationBase && c.Animation.Mouvement != MouvementAucun && adr[i] {
			mesures += mesureLongueurs(t, c, noeuds, pires)
		}
	}
	if normeMax > toleranceNormeQuat {
		t.Errorf("graphe %08x : ecart de norme %.5f au-dela de %.5f", g.ID, normeMax, toleranceNormeQuat)
	}
	t.Logf("graphe %08x : %d longueurs d'os anatomiques mesurees", g.ID, mesures)
	verifieLongueurs(t, g, pires)
	return normeMax, mesures
}

// mesureLongueurs compose la pose de quelques images de l'animation et garde, par os anatomique, le
// pire ecart relatif de sa distance au parent contre celle du repos ; rend le nombre de mesures.
func mesureLongueurs(t *testing.T, c *ClipAnimation, noeuds []Noeud, pires map[string]ecartOs) int {
	t.Helper()
	n := 0
	pas := max(1, c.Images/imagesParClipLongueurs)
	for f := 0; f < c.Images; f += pas {
		pose, err := c.PoseLocale(noeuds, f)
		if err != nil {
			t.Fatal(err)
		}
		for o, nd := range noeuds {
			nom := NomDuNoeud(nd.Name)
			if nd.Parent < 0 || !osAnatomique.MatchString(nom) {
				continue
			}
			repos := distance3(NodeModelTransform(noeuds, o).Trans, NodeModelTransform(noeuds, nd.Parent).Trans)
			if repos < longueurOsMin {
				continue
			}
			d := distance3(NodeModelTransform(pose, o).Trans, NodeModelTransform(pose, nd.Parent).Trans)
			n++
			if e := math.Abs(d-repos) / repos; e > pires[nom].ecart {
				pires[nom] = ecartOs{ecart: e, animation: c.Animation.Rang}
			}
		}
	}
	return n
}

// verifieLongueurs journalise les os aux plus grands ecarts de longueur et refuse ceux au-dela de
// la tolerance.
func verifieLongueurs(t *testing.T, g *GrapheAnimation, pires map[string]ecartOs) {
	t.Helper()
	noms := make([]string, 0, len(pires))
	for n := range pires {
		noms = append(noms, n)
	}
	sort.Slice(noms, func(i, j int) bool { return pires[noms[i]].ecart > pires[noms[j]].ecart })
	for k, n := range noms {
		p := pires[n]
		if k < 3 {
			t.Logf("graphe %08x : longueur de %s a %.2f %% du repos au pire (animation %d)", g.ID, n, 100*p.ecart, p.animation)
		}
		if p.ecart > toleranceLongueurOs {
			t.Errorf("graphe %08x : longueur de %s ecartee de %.2f %% (animation %d)", g.ID, n, 100*p.ecart, p.animation)
		}
	}
}

// adressees rend les rangs des animations du graphe `g` que l'arbre des modes de la chaine designe.
func adressees(gs *GraphesAnimation, g *GrapheAnimation) map[int]bool {
	out := map[int]bool{}
	for _, f := range gs.Fiches(g) {
		if len(f.Chemins) > 0 {
			out[f.Rang] = true
		}
	}
	return out
}

// locomotions rend les rangs des animations du graphe `g` qu'un chemin de l'arbre des modes designe
// par une action de locomotion (`locomote...`).
func locomotions(gs *GraphesAnimation, g *GrapheAnimation) map[int]bool {
	out := map[int]bool{}
	for _, f := range gs.Fiches(g) {
		for _, c := range f.Chemins {
			if niveaux := strings.Split(c, " / "); strings.HasPrefix(niveaux[len(niveaux)-1], "locomote") {
				out[f.Rang] = true
			}
		}
	}
	return out
}

// ecartOs : le pire ecart relatif de longueur d'un os et l'animation qui le porte.
type ecartOs struct {
	ecart     float64
	animation int
}

// verifieComptesDrapeaux : les comptes de chaque flux non vide egalent les bits de ses drapeaux.
func verifieComptesDrapeaux(t *testing.T, g *GrapheAnimation, i int) {
	t.Helper()
	a := g.Animations[i]
	sec := sectionsDuMembre(g.membres[[2]int{a.Groupe, a.Membre}])
	for _, cas := range []struct{ flux, drapeaux int }{
		{sectionAnimee, sectionDrapeauxAnimes}, {sectionStatique, sectionDrapeauxStatiq}, {sectionStatiquePartage, sectionDrapeauxStatiq},
	} {
		f, err := litFlux(sec[cas.flux])
		if b := sec[cas.flux]; len(b) >= courbeEntete && b[0] == CodecCourbeRevisee {
			f = fluxLu{codec: CodecCourbeRevisee, nRot: int(u16(b, fluxOffRotations)), nTrans: int(u16(b, fluxOffTranslations)),
				nEch: int(u16(b, fluxOffEchelles))}
			err = nil
		}
		if err != nil || f.codec == CodecAucun {
			continue
		}
		d := sec[cas.drapeaux]
		tt := len(d) / tableauxDrapeaux
		if got := [3]int{compteBits(d[:tt]), compteBits(d[tt : 2*tt]), compteBits(d[2*tt:])}; got != [3]int{f.nRot, f.nTrans, f.nEch} {
			t.Errorf("graphe %08x, animation %d, flux %d : drapeaux %v, en-tete %d/%d/%d", g.ID, i, cas.flux, got, f.nRot, f.nTrans, f.nEch)
		}
	}
}

// positionsModele rend, par image, la position dans le repere du modele des noeuds demandes.
func positionsModele(t *testing.T, c *ClipAnimation, noeuds []Noeud, rangs ...int) [][][3]float64 {
	t.Helper()
	out := make([][][3]float64, c.Images)
	for f := 0; f < c.Images; f++ {
		pose, err := c.PoseLocale(noeuds, f)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range rangs {
			out[f] = append(out[f], NodeModelTransform(pose, r).Trans)
		}
	}
	return out
}

// piedsDuModele rend les rangs des chevilles gauche et droite.
func piedsDuModele(t *testing.T, noeuds []Noeud) (int, int) {
	t.Helper()
	g, d := -1, -1
	for i, n := range noeuds {
		switch NomDuNoeud(n.Name) {
		case "b_l_foot":
			g = i
		case "b_r_foot":
			d = i
		}
	}
	if g < 0 || d < 0 {
		t.Fatal("chevilles b_l_foot / b_r_foot absentes du squelette")
	}
	return g, d
}

// verifiePhasePieds : sur le cycle `rang`, l'avance des deux pieds est anticorrelee.
func verifiePhasePieds(t *testing.T, g *GrapheAnimation, noeuds []Noeud, rang int) {
	t.Helper()
	c, err := g.Decode(rang)
	if err != nil {
		t.Fatal(err)
	}
	pg, pd := piedsDuModele(t, noeuds)
	pos := positionsModele(t, c, noeuds, pg, pd)
	var xg, xd []float64
	for _, p := range pos {
		xg, xd = append(xg, p[0][0]), append(xd, p[1][0])
	}
	r := correlation(xg, xd)
	t.Logf("animation %d (cap %v, %d images) : correlation des pieds %.3f, amplitude gauche %.3f u", rang, c.Animation.Cap, c.Images, r, etendue(xg))
	if r > correlationPiedsMax {
		t.Errorf("animation %d : pieds correles a %.3f, opposition attendue sous %.2f", rang, r, correlationPiedsMax)
	}
}

// verifiePiedPose : d'une image a la suivante, un pied d'appui (cheville a sa hauteur de repos au
// sol, a moins de `margeAppui` de son minimum sur l'animation, aux deux images) recule du
// deplacement de racine de l'image ; le deroule du talon a l'envol et a la pose n'est pas un appui.
func verifiePiedPose(t *testing.T, g *GrapheAnimation, noeuds []Noeud, rang int) {
	t.Helper()
	c, err := g.Decode(rang)
	if err != nil {
		t.Fatal(err)
	}
	g2 := glissementPied(t, c, noeuds)
	if g2.appuis == 0 {
		t.Fatalf("animation %d : aucun appui", rang)
	}
	t.Logf("animation %d : %d appuis, avance %.3f u, glissement moyen %.4f u (%.1f mm), pire %.4f u par image",
		rang, g2.appuis, g2.avance, g2.moyen(), g2.moyen()*metresParUnite*1000, g2.pire)
	if g2.moyen() > glissementPiedMax {
		t.Errorf("animation %d : le pied d'appui glisse de %.4f u par image contre le deplacement", rang, g2.moyen())
	}
}

// glissement : les appuis d'une animation et le glissement des pieds d'appui contre le deplacement.
type glissement struct {
	appuis              int
	somme, pire, avance float64
}

func (g glissement) moyen() float64 { return g.somme / float64(max(1, g.appuis)) }

// glissementPied mesure, d'une image a la suivante, l'ecart entre le recul d'un pied d'appui (cheville
// a sa hauteur de repos au sol, a moins de `margeAppui` de son minimum, aux deux images) et le
// deplacement de racine de l'image.
func glissementPied(t *testing.T, c *ClipAnimation, noeuds []Noeud) glissement {
	t.Helper()
	if len(c.Deplacement) != c.Images {
		t.Fatalf("animation %d : %d deplacements pour %d images", c.Animation.Rang, len(c.Deplacement), c.Images)
	}
	pg, pd := piedsDuModele(t, noeuds)
	pos := positionsModele(t, c, noeuds, pg, pd)
	bas := [2]float64{math.Inf(1), math.Inf(1)}
	for _, p := range pos {
		bas[0], bas[1] = math.Min(bas[0], p[0][2]), math.Min(bas[1], p[1][2])
	}
	var g glissement
	for f := 0; f+1 < c.Images; f++ {
		d := c.Deplacement[f]
		g.avance += d[0]
		for p := 0; p < 2; p++ {
			if bas[p] >= piedAuSol || pos[f][p][2] > bas[p]+margeAppui || pos[f+1][p][2] > bas[p]+margeAppui {
				continue
			}
			r := math.Hypot(pos[f+1][p][0]-pos[f][p][0]+d[0], pos[f+1][p][1]-pos[f][p][1]+d[1])
			g.appuis, g.somme, g.pire = g.appuis+1, g.somme+r, math.Max(g.pire, r)
		}
	}
	return g
}

func distance3(a, b [3]float64) float64 {
	return math.Sqrt((a[0]-b[0])*(a[0]-b[0]) + (a[1]-b[1])*(a[1]-b[1]) + (a[2]-b[2])*(a[2]-b[2]))
}

func correlation(a, b []float64) float64 {
	ma, mb := moyenne(a), moyenne(b)
	var sab, saa, sbb float64
	for i := range a {
		sab += (a[i] - ma) * (b[i] - mb)
		saa += (a[i] - ma) * (a[i] - ma)
		sbb += (b[i] - mb) * (b[i] - mb)
	}
	return sab / math.Sqrt(saa*sbb)
}

func moyenne(v []float64) float64 {
	s := 0.0
	for _, x := range v {
		s += x
	}
	return s / float64(len(v))
}

func etendue(v []float64) float64 {
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, x := range v {
		lo, hi = math.Min(lo, x), math.Max(hi, x)
	}
	return hi - lo
}

// compteBits compte les bits allumes d'un tableau.
func compteBits(b []byte) int {
	n := 0
	for _, x := range b {
		n += bits.OnesCount8(x)
	}
	return n
}
