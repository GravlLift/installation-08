//go:build gamefiles

package himap

import (
	"math"
	"sort"
	"testing"
)

// Seuils du temoin du codec 10 (mesures 2026-11-09 dans le journal).
const (
	// courbesPlancher : animations de codec 10 decodees dans la chaine (2 + 1 435 mesurees).
	courbesPlancher = 1437
	// appuisCourbesPlancher : animations de codec 10 a deplacement dont le pied d'appui glisse de
	// moins de glissementPiedMax (mesure : 63 sur 208).
	appuisCourbesPlancher = 20
	// gainSurLineaire : le glissement moyen des pieds d'appui avec les tangentes, rapporte a celui
	// d'une interpolation lineaire des memes cles (mesure : 0,40).
	gainSurLineaire = 0.6
	// jumeauxEcartMax : ecart angulaire moyen (degres) entre une animation de codec 10 et sa jumelle
	// de codec 3 (mesure : 0,43 a 0,98) ; jumeauxGainMax : le meme ecart rapporte a celui de
	// l'interpolation lineaire (mesure : 0,48 a 0,71) ; jumeauxTransMax : ecart moyen des
	// translations animees des deux cotes, en unites (mesure : 0,0029).
	jumeauxEcartMax = 1.0
	jumeauxGainMax  = 0.8
	jumeauxTransMax = 0.005
	// ecartCordeMax : borne analytique de l'ecart, avant renormalisation, entre un segment de Hermite
	// et l'interpolation lineaire de ses cles. Le polynome vaut lerp(t) + h10 d1 + h11 d2, ou d est
	// l'ecart d'une tangente a la corde : 0,3 au plus par composant (quartet 0 ou 14), 0,6 en norme ;
	// max |h10| = max |h11| = 4/27, d'ou 4/27 x 1,2 = 0,178. Apres renormalisation, l'angle de
	// rotation reste sous 2 asin(0,178 / |lerp(t)|) : 20,5 degres pour une corde unitaire. Un segment
	// entre hemispheres, une renormalisation fausse ou un composant mal range la depassent.
	ecartCordeMax = 4.0 / 27 * 2 * 0.6
	// margeCordeDeg : marge d'arrondi de la borne (quantum i16 des cles).
	margeCordeDeg = 0.1
)

// TestAnimationsCourbes : le codec 10 decode toute la chaine sans refus ; le pied d'appui suit le
// deplacement de racine sur au moins appuisCourbesPlancher animations, mieux qu'une interpolation
// lineaire ; les pieds alternent sur la marche et la course au fusil ; les animations de codec 10
// collent a leurs jumelles de codec 3 ; aucun segment ne s'ecarte de sa corde au-dela de la borne
// analytique ; le mouvement angle-axe se lit.
func TestAnimationsCourbes(t *testing.T) {
	gs, noeuds := ouvreGraphesSpartan(t)
	courbes, ecartCorde := 0, 0.0
	for _, g := range gs.Tous() {
		for i := range g.Animations {
			c, err := g.Decode(i)
			if err != nil {
				t.Fatalf("graphe %08x, animation %d : %v", g.ID, i, err)
			}
			if c.Codec == CodecCourbeRevisee {
				courbes++
				ecartCorde = math.Max(ecartCorde, verifieCordes(t, g, c))
			}
		}
	}
	t.Logf("%d animations de codec 10 decodees ; plus grand ecart d'un segment a sa corde %.2f degres", courbes, ecartCorde)
	if courbes < courbesPlancher {
		t.Errorf("%d animations de codec 10 decodees, plancher %d", courbes, courbesPlancher)
	}
	verifieAppuisCourbes(t, gs, noeuds)
	for _, nom := range []string{"combat:rifle:locomote_walk_front", "combat:rifle:locomote_run_front", "crouch:pistol:locomote_walk_front"} {
		c, err := gs.ClipNomme(nom)
		if err != nil || c.Codec != CodecCourbeRevisee {
			t.Fatalf("%s : %v (codec %v)", nom, err, c)
		}
		verifiePhasePieds(t, gs.Graphe(c.Graphe), noeuds, c.Animation.Rang)
	}
	verifieJumeaux(t, gs)
	verifieAngleAxe(t, gs.Graphe(grapheRacineSpartan))
}

// verifieAppuisCourbes : sur les animations de base de codec 10 a deplacement dx dy que l'arbre
// designe, le pied d'appui recule du deplacement a glissementPiedMax pres sur au moins
// appuisCourbesPlancher d'entre elles, et glisse moins qu'avec les memes cles interpolees en ligne.
func verifieAppuisCourbes(t *testing.T, gs *GraphesAnimation, noeuds []Noeud) {
	t.Helper()
	tenues, clips := 0, 0
	var avec, sans glissement
	for _, g := range gs.Tous() {
		adr := adressees(gs, g)
		for i, a := range g.Animations {
			if a.Type != AnimationBase || a.Mouvement != MouvementDxDy || !adr[i] {
				continue
			}
			c, err := g.Decode(i)
			if err != nil || c.Codec != CodecCourbeRevisee {
				continue
			}
			m := glissementPied(t, c, noeuds)
			if m.appuis == 0 {
				continue
			}
			clips++
			if m.moyen() <= glissementPiedMax {
				tenues++
			}
			linearise(t, g, c)
			l := glissementPied(t, c, noeuds)
			avec.somme, avec.appuis = avec.somme+m.somme, avec.appuis+m.appuis
			sans.somme, sans.appuis = sans.somme+l.somme, sans.appuis+l.appuis
		}
	}
	t.Logf("codec 10 a deplacement : %d animations avec appuis, %d sous %.4f u par image ; glissement moyen %.2f mm (lineaire : %.2f mm)",
		clips, tenues, glissementPiedMax, avec.moyen()*metresParUnite*1000, sans.moyen()*metresParUnite*1000)
	if tenues < appuisCourbesPlancher {
		t.Errorf("%d animations de codec 10 au pied d'appui tenu, plancher %d", tenues, appuisCourbesPlancher)
	}
	if avec.moyen() > gainSurLineaire*sans.moyen() {
		t.Errorf("glissement avec tangentes %.5f u contre %.5f u en lineaire : les tangentes n'aident pas", avec.moyen(), sans.moyen())
	}
}

// pisteDeCourbe : les images cles et les valeurs aux cles d'une piste de rotation de codec 10, lues
// pour le temoin ; brute = une valeur par image.
type pisteDeCourbe struct {
	os    int
	cles  []int
	quats [][]float64
	brute bool
}

// pistesDeCourbe relit les pistes de rotation d'une animation de codec 10.
func pistesDeCourbe(t *testing.T, g *GrapheAnimation, c *ClipAnimation) []pisteDeCourbe {
	t.Helper()
	a := c.Animation
	sec := sectionsDuMembre(g.membres[[2]int{a.Groupe, a.Membre}])
	b := sec[sectionAnimee]
	_, animes, err := drapeauxDuMembre(sec, len(g.Os))
	if err != nil {
		t.Fatal(err)
	}
	f, don := fluxLu{octets: b}, u32(b, courbeOffDonnees)
	var out []pisteDeCourbe
	for k, os := range animes[0] {
		o := don + u32(b, don+4*k)
		p := pisteDeCourbe{os: os, brute: b[o+pisteOffDrapeaux]&pisteDrapeauBrut != 0}
		if !p.brute {
			n := int(u16(b, o+pisteOffCles))
			if p.cles, err = imagesCles(f, o+pisteEntete, n, c.Images); err != nil {
				t.Fatal(err)
			}
			v := o + pisteEntete + n
			for s := 0; s <= n; s++ {
				p.quats = append(p.quats, valeurCourbe(b, v+s*(sorteRotation.tangentes+valeurCourbeOctets), sorteRotation))
			}
		}
		out = append(out, p)
	}
	return out
}

// linearise remplace les rotations de codec 10 du clip par l'interpolation lineaire de leurs cles.
func linearise(t *testing.T, g *GrapheAnimation, c *ClipAnimation) {
	t.Helper()
	for _, p := range pistesDeCourbe(t, g, c) {
		if p.brute {
			continue
		}
		r := make([][4]float64, c.Images)
		r[0] = [4]float64(p.quats[0])
		for s := 0; s+1 < len(p.cles); s++ {
			m := make([]float64, 4)
			for j := range m {
				m[j] = p.quats[s+1][j] - p.quats[s][j]
			}
			for img := p.cles[s] + 1; img <= p.cles[s+1]; img++ {
				r[img] = [4]float64(hermite(p.quats[s], m, p.quats[s+1], m, float64(img-p.cles[s])/float64(p.cles[s+1]-p.cles[s])))
			}
		}
		c.Os[p.os].Rotations = r
	}
}

// verifieCordes : chaque image d'un segment de courbe reste sous la borne analytique de son ecart a
// l'interpolation lineaire des cles (ecartCordeMax) ; rend le plus grand ecart mesure, en degres.
func verifieCordes(t *testing.T, g *GrapheAnimation, c *ClipAnimation) float64 {
	t.Helper()
	pire := 0.0
	for _, p := range pistesDeCourbe(t, g, c) {
		for s := 0; s+1 < len(p.cles); s++ {
			p1, p2 := p.quats[s], p.quats[s+1]
			for img := p.cles[s] + 1; img < p.cles[s+1]; img++ {
				u := float64(img-p.cles[s]) / float64(p.cles[s+1]-p.cles[s])
				var l [4]float64
				for j := range l {
					l[j] = (1-u)*p1[j] + u*p2[j]
				}
				n := math.Sqrt(produitScalaire(l[:], l[:]))
				for j := range l {
					l[j] /= n
				}
				borne := 2*math.Asin(math.Min(1, ecartCordeMax/n))*180/math.Pi + margeCordeDeg
				d := angleQuatDeg(l, c.Os[p.os].Rotations[img])
				pire = math.Max(pire, d)
				if d > borne {
					t.Errorf("graphe %08x, animation %d, os %d, image %d : %.1f degres de la corde (borne %.1f)", g.ID, c.Animation.Rang, p.os, img, d, borne)
					return pire
				}
			}
		}
	}
	return pire
}

// verifieJumeaux : des animations de codec 10 dont une jumelle de codec 3 existe (meme pivot, meme
// nombre d'images, pour une autre arme de la classe) en restent a jumeauxEcartMax degres en moyenne,
// et plus pres qu'avec une interpolation lineaire.
func verifieJumeaux(t *testing.T, gs *GraphesAnimation) {
	t.Helper()
	for _, action := range []string{"turn_left", "turn_right", "turn_left_fast", "turn_right_fast", "turn_left_composite", "turn_right_composite"} {
		c10, err10 := gs.ClipNomme("combat:rifle:" + action)
		c3, err3 := gs.ClipNomme("combat:rifle:sb:" + action)
		if err10 != nil || err3 != nil || c10.Codec != CodecCourbeRevisee || c3.Codec != CodecQuantifie || c10.Images != c3.Images {
			t.Fatalf("%s : jumelles %v / %v", action, err10, err3)
		}
		e, _ := ecartClips(c10, c3)
		linearise(t, gs.Graphe(c10.Graphe), c10)
		l, _ := ecartClips(c10, c3)
		t.Logf("%s : %.3f degres de sa jumelle de codec 3 (lineaire : %.3f degres)", action, e, l)
		if e > jumeauxEcartMax || e > jumeauxGainMax*l {
			t.Errorf("%s : %.3f degres de sa jumelle (lineaire %.3f degres)", action, e, l)
		}
	}
	// Translations : la marche accroupie au pistolet (codec 10) et au fusil (codec 3) ont les memes
	// jambes ; leurs translations animees des deux cotes se comparent.
	c10, err10 := gs.ClipNomme("crouch:pistol:locomote_walk_front")
	c3, err3 := gs.ClipNomme("crouch:rifle:locomote_walk_front")
	if err10 != nil || err3 != nil || c10.Codec != CodecCourbeRevisee || c3.Codec != CodecQuantifie || c10.Images != c3.Images {
		t.Fatalf("marche accroupie : jumelles %v / %v", err10, err3)
	}
	for o := range c10.Os {
		if len(c10.Os[o].Translations) < 2 || len(c3.Os[o].Translations) < 2 {
			c10.Os[o].Translations, c3.Os[o].Translations = nil, nil
		}
	}
	_, et := ecartClips(c10, c3)
	t.Logf("marche accroupie : translations animees a %.5f u de leur jumelle de codec 3", et)
	if et == 0 || et > jumeauxTransMax {
		t.Errorf("marche accroupie : translations a %.5f u de leur jumelle (aucune piste commune si 0)", et)
	}
}

// ecartClips rend les ecarts moyens de deux animations, sur les os que les deux portent : angulaire
// des rotations, en degres, et de distance des translations, en unites.
func ecartClips(x, y *ClipAnimation) (float64, float64) {
	s, n, st, nt := 0.0, 0, 0.0, 0
	for o := range x.Os {
		rx, ry := x.Os[o].Rotations, y.Os[o].Rotations
		for f := 0; f < x.Images && len(rx) > 0 && len(ry) > 0; f++ {
			s += angleQuatDeg(rx[min(f, len(rx)-1)], ry[min(f, len(ry)-1)])
			n++
		}
		tx, ty := x.Os[o].Translations, y.Os[o].Translations
		for f := 0; f < x.Images && len(tx) > 0 && len(ty) > 0; f++ {
			st += distance3(tx[min(f, len(tx)-1)], ty[min(f, len(ty)-1)])
			nt++
		}
	}
	return s / float64(max(1, n)), st / float64(max(1, nt))
}

// angleQuatDeg : l'angle, en degres, de la rotation qui mene d'un quaternion unitaire a l'autre.
func angleQuatDeg(a, b [4]float64) float64 {
	d := math.Abs(a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3])
	return 2 * math.Acos(math.Min(1, d)) * 180 / math.Pi
}

// verifieAngleAxe : l'animation a mouvement angle-axe se decode, son deplacement porte dx dy dz.
func verifieAngleAxe(t *testing.T, g *GrapheAnimation) {
	t.Helper()
	var rangs []int
	for _, a := range g.Animations {
		if a.Mouvement == MouvementDxDyDzAngle {
			rangs = append(rangs, a.Rang)
		}
	}
	sort.Ints(rangs)
	if len(rangs) == 0 {
		t.Fatal("aucune animation a mouvement angle-axe")
	}
	for _, r := range rangs {
		c, err := g.Decode(r)
		if err != nil || len(c.Deplacement) != c.Images {
			t.Fatalf("animation %d : %v", r, err)
		}
		norme := 0.0
		for _, d := range c.Deplacement {
			norme += math.Abs(d[0]) + math.Abs(d[1]) + math.Abs(d[2])
		}
		t.Logf("angle-axe : animation %d, %d images, |dx|+|dy|+|dz| cumules %.3f u", r, c.Images, norme)
		if norme == 0 {
			t.Errorf("animation %d : deplacement nul", r)
		}
	}
}
