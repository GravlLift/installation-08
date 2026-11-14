//go:build gamefiles

package himap

import (
	"bytes"
	"context"
	"math"
	"os"
	"testing"
)

// TestRigPremierePersonneBR75 : le rig du BR75 porte le squelette du graphe FP (91 os, 3 sans pose),
// les bras de l'armure par defaut et l'arme a peau ; en attente, la peau posee par l'animation tient
// l'arme devant l'oeil, canon vers l'avant, mains dessus ; au rechargement a vide le chargeur quitte
// l'arme et y revient. Le GLB s'ecrit et se relit (une peau, une animation par clip). DIAG_FP_GLB
// pose : le GLB y est aussi ecrit, pour le regarder.
func TestRigPremierePersonneBR75(t *testing.T) {
	ctx := context.Background()
	a := ouvreArsenalRecharge(t)
	r, err := a.RigPremierePersonne(ctx, 0x2b1824d5, nil)
	if err != nil {
		t.Fatal(err)
	}
	m := r.Modele
	t.Logf("BR75 : %d os (sans pose %v), %d sommets dont %d des bras, %d triangles, %d materiaux, %d clips, %d actions, absentes %v",
		len(m.Noeuds), r.OsSansPose, len(m.Influences), r.SommetsBras, m.Maillage.Structure.Triangles(), len(m.Maillage.Materiaux),
		len(r.Clips), len(r.Actions), r.Absentes)
	if len(m.Noeuds) != 91 || len(r.OsSansPose) != 3 {
		t.Errorf("%d os, %d sans pose : attendu 91 et 3", len(m.Noeuds), len(r.OsSansPose))
	}
	if r.SommetsBras != 13518 || len(m.Influences) <= r.SommetsBras {
		t.Errorf("sommets des bras %d sur %d : attendu 13518 puis l'arme", r.SommetsBras, len(m.Influences))
	}
	clips := map[string]*ClipAnimation{}
	for _, c := range r.Clips {
		clips[c.Nom] = c.Clip
		if c.Cadence != CadenceAnimation(c.Clip.Animation) {
			t.Errorf("clip %s : cadence %d", c.Nom, c.Cadence)
		}
		if (c.Nom == "throw_grenade" || c.Nom == "clamber") != (c.Cadence == ImagesParSeconde60Hz) {
			t.Errorf("clip %s : cadence %d (60 attendu pour le lancer et l'escalade seuls)", c.Nom, c.Cadence)
		}
	}
	for _, nom := range []string{"idle", "fire_1", "fire_1:var1", "reload_full", "reload_empty", "ready", "put_away", "melee_strike_1",
		"throw_grenade", "sprint_loop", "moving", "jump", "crouch", "evade_front", "evade_back", "evade_left", "evade_right",
		"grapple_hook_deploy", NomActionDuJeu(JeuRepulseur, ActionUsageEquipement), NomActionDuJeu(JeuCapteurMenace, ActionUsageEquipement)} {
		if clips[nom] == nil {
			t.Errorf("clip %s absent", nom)
		}
	}
	verifiePousseeGauche(t, r, clips[NomActionDuJeu(JeuRepulseur, ActionUsageEquipement)])
	if pos, avant, ok := r.ArmeEnAttente(); !ok || pos[0] < 0.03 || avant[0] < 0.95 || r.Modele.Noeuds[r.RacineArme].Name != noeudRacineArme {
		t.Errorf("arme en attente : %v %v (%v)", pos, avant, ok)
	} else {
		t.Logf("arme en attente : racine %.3f %.3f %.3f, axe avant %.3f %.3f %.3f", pos[0], pos[1], pos[2], avant[0], avant[1], avant[2])
	}
	journaliseRacines(t, r, clips["idle"])
	verifieOsDeVisee(t, r)
	verifieSurcouche(t, r, clips["moving"])
	verifieTenueEnAttente(t, r, clips["idle"])
	verifieChargeur(t, r, modeNoeuds(t, a, r.Arme.Mode), clips["reload_empty"])
	verifieGLBDuRig(t, r)
}

// Le geste du repulseur, mesure sur le BR75 (2026-11-14) : a son avancee la plus forte (image 3 sur
// 41), la main gauche est a +0,04 u vers l'avant, +0,06 vers la gauche et +0,09 vers le haut de sa
// premiere image (0,11 u) ; la main droite avance de 0,02 u au plus.
const (
	// courseGaucheMin : le deplacement minimal (unites du jeu) de la main gauche depuis la premiere image.
	courseGaucheMin = 0.08
	// avanceeGaucheMin : l'avancee minimale (+X du rig) de la main gauche au meme moment.
	avanceeGaucheMin = 0.02
)

// verifiePousseeGauche : dans le clip de l'usage du repulseur, le bras gauche monte et pousse
// l'appareil de l'avant-bras vers l'avant : la main gauche se deplace d'au moins courseGaucheMin,
// en avancant d'au moins avanceeGaucheMin, et plus que la main droite (qui tient l'arme).
func verifiePousseeGauche(t *testing.T, r *RigPremierePersonne, c *ClipAnimation) {
	if c == nil {
		return
	}
	rang := map[string]int{}
	for i, n := range r.Modele.Noms {
		rang[n] = i
	}
	course := func(os string) (float64, float64, int) {
		p0 := r.Modele.PoseRig(c, 0)[rang[os]].Trans
		best, avant, k := 0.0, 0.0, 0
		for i := 0; i < c.Animation.Images; i++ {
			p := r.Modele.PoseRig(c, i)[rang[os]].Trans
			if d := math.Hypot(math.Hypot(p[0]-p0[0], p[1]-p0[1]), p[2]-p0[2]); d > best {
				best, avant, k = d, p[0]-p0[0], i
			}
		}
		return best, avant, k
	}
	gauche, avant, image := course("b_l_hand")
	droite, _, _ := course("b_r_hand")
	t.Logf("repulseur : main gauche %.3f u (avant %+.3f) a l'image %d sur %d, main droite %.3f u", gauche, avant, image, c.Animation.Images, droite)
	if gauche < courseGaucheMin || avant < avanceeGaucheMin || gauche <= droite {
		t.Errorf("repulseur : main gauche %.3f u (avant %+.3f), droite %.3f : attendu au moins %.2f u dont %.2f vers l'avant, et plus que la droite",
			gauche, avant, droite, courseGaucheMin, avanceeGaucheMin)
	}
}

// verifieOsDeVisee : `b_pedestal` est la seule racine ; `b_base` (noeud_68e467f9) porte les deux mains ;
// `b_aim_pitch` et `b_aim_yaw` sont des feuilles qu'aucun clip n'anime et qu'aucune main n'a pour
// ancetre (contrat de la vue, meshproto.IndexPremierePersonne).
func verifieOsDeVisee(t *testing.T, r *RigPremierePersonne) {
	m := r.Modele
	rang := map[string]int{}
	racines := 0
	for i, n := range m.Noeuds {
		rang[m.Noms[i]] = i
		if n.Parent < 0 {
			racines++
		}
	}
	if i, ok := rang["b_pedestal"]; !ok || m.Noeuds[i].Parent >= 0 || racines != 1 {
		t.Errorf("racine : b_pedestal %v, %d racines", ok, racines)
	}
	ancetres := func(i int) map[string]bool {
		out := map[string]bool{}
		for p := m.Noeuds[i].Parent; p >= 0; p = m.Noeuds[p].Parent {
			out[m.Noms[p]] = true
		}
		return out
	}
	for _, main := range []string{"b_r_hand", "b_l_hand"} {
		a := ancetres(rang[main])
		if !a["noeud_68e467f9"] || a["b_aim_pitch"] || a["b_aim_yaw"] {
			t.Errorf("ancetres de %s : %v", main, a)
		}
	}
	for _, vise := range []string{"b_aim_pitch", "b_aim_yaw"} {
		i, ok := rang[vise]
		for _, n := range m.Noeuds {
			if ok && n.Parent == i {
				t.Errorf("%s a un enfant", vise)
			}
		}
		for _, c := range r.Clips {
			if p := c.Clip.Os[i]; ok && (len(p.Rotations) > 1 || len(p.Translations) > 1) {
				t.Errorf("%s anime par %s", vise, c.Nom)
			}
		}
		if !ok {
			t.Errorf("%s absent", vise)
		}
	}
}

// sommetPose rend le sommet v de la peau posee : somme ponderee de pose(os) . liaison(os) . v.
func sommetPose(m *ModeleAPeau, pose []Transforme, v int) [3]float64 {
	s := m.Maillage.Structure.Sommets
	p := [3]float64{float64(s[3*v]), float64(s[3*v+1]), float64(s[3*v+2])}
	var out [3]float64
	inf := m.Influences[v]
	for c := 0; c < OsParSommet; c++ {
		w := float64(inf.Poids[c])
		if w == 0 {
			continue
		}
		n := m.Noeuds[inf.Os[c]]
		var l [3]float64
		for r := 0; r < 3; r++ {
			l[r] = n.InvAxes[0][r]*p[0] + n.InvAxes[1][r]*p[1] + n.InvAxes[2][r]*p[2] + n.InvPos[r]
		}
		g := pose[inf.Os[c]].Applique(l)
		for r := 0; r < 3; r++ {
			out[r] += w * g[r]
		}
	}
	return out
}

// boiteDes rend la boite des sommets [debut, fin) de la peau posee.
func boiteDes(m *ModeleAPeau, pose []Transforme, debut, fin int) (lo, hi [3]float64) {
	lo = [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
	hi = [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
	for v := debut; v < fin; v++ {
		p := sommetPose(m, pose, v)
		for k := 0; k < 3; k++ {
			lo[k], hi[k] = math.Min(lo[k], p[k]), math.Max(hi[k], p[k])
		}
	}
	return lo, hi
}

// verifieTenueEnAttente : a la premiere image de l'attente, l'arme posee est devant l'origine
// (b_pedestal) et sous elle, plus longue en X ; chaque main est dans la boite de l'arme elargie.
func verifieTenueEnAttente(t *testing.T, r *RigPremierePersonne, idle *ClipAnimation) {
	t.Helper()
	if idle == nil {
		return
	}
	m := r.Modele
	pose := m.PoseRig(idle, 0)
	lo, hi := boiteDes(m, pose, r.SommetsBras, len(m.Influences))
	blo, bhi := boiteDes(m, pose, 0, r.SommetsBras)
	t.Logf("attente, arme posee : %.3f..%.3f, %.3f..%.3f, %.3f..%.3f ; bras %.3f..%.3f, %.3f..%.3f, %.3f..%.3f",
		lo[0], hi[0], lo[1], hi[1], lo[2], hi[2], blo[0], bhi[0], blo[1], bhi[1], blo[2], bhi[2])
	if !(hi[0] > 0.2 && lo[0] > -0.15 && hi[2] < 0.05 && hi[0]-lo[0] > hi[1]-lo[1] && hi[0]-lo[0] > hi[2]-lo[2]) {
		t.Errorf("arme posee hors de la tenue attendue : %v %v", lo, hi)
	}
	for _, main := range []string{"b_r_hand", "b_l_hand"} {
		p := pose[NoeudParNom(m.Noeuds, NomAnimation(main))].Trans
		dedans := true
		for k := 0; k < 3; k++ {
			dedans = dedans && p[k] > lo[k]-0.08 && p[k] < hi[k]+0.08
		}
		t.Logf("%s en attente : %.3f %.3f %.3f", main, p[0], p[1], p[2])
		if !dedans {
			t.Errorf("%s hors de l'arme", main)
		}
	}
}

// verifieChargeur : pendant le rechargement a vide, un noeud de l'arme s'ecarte de plus de 0,1 u de
// la racine de l'arme (dans son repere) puis revient a moins de 0,01 u.
func verifieChargeur(t *testing.T, r *RigPremierePersonne, osArme []Noeud, c *ClipAnimation) {
	t.Helper()
	if c == nil {
		return
	}
	m := r.Modele
	racine := r.RacineArme
	dans := func(pose []Transforme, i int) [3]float64 {
		ra, p := pose[racine], pose[i].Trans
		d := [3]float64{p[0] - ra.Trans[0], p[1] - ra.Trans[1], p[2] - ra.Trans[2]}
		return [3]float64{ra.Rot[0]*d[0] + ra.Rot[3]*d[1] + ra.Rot[6]*d[2], ra.Rot[1]*d[0] + ra.Rot[4]*d[1] + ra.Rot[7]*d[2],
			ra.Rot[2]*d[0] + ra.Rot[5]*d[1] + ra.Rot[8]*d[2]}
	}
	p0, pN := m.PoseRig(c, 0), m.PoseRig(c, c.Images-1)
	meilleur, ecart := -1, 0.0
	for i := range m.Noeuds {
		if i == racine || NoeudParNom(osArme, m.Noeuds[i].Name) < 0 {
			continue
		}
		for k := 0; k < c.Images; k++ {
			a, b := dans(p0, i), dans(m.PoseRig(c, k), i)
			if e := math.Hypot(math.Hypot(a[0]-b[0], a[1]-b[1]), a[2]-b[2]); e > ecart {
				meilleur, ecart = i, e
			}
		}
	}
	if meilleur < 0 {
		t.Fatal("aucun noeud d'arme hors de la racine")
	}
	a, b := dans(p0, meilleur), dans(pN, meilleur)
	retour := math.Hypot(math.Hypot(a[0]-b[0], a[1]-b[1]), a[2]-b[2])
	t.Logf("reload_empty : %s s'ecarte de %.3f u de la racine de l'arme, revient a %.4f u", m.Noms[meilleur], ecart, retour)
	if ecart < 0.1 || retour > 0.01 {
		t.Errorf("chargeur : ecart %.3f, retour %.4f", ecart, retour)
	}
}

// verifieGLBDuRig : le GLB du rig se relit, une peau de tous les os, une animation par clip.
func verifieGLBDuRig(t *testing.T, r *RigPremierePersonne) {
	t.Helper()
	var buf bytes.Buffer
	if err := EcritGLBPeauAnime(&buf, r.Modele, r.Clips, "temoin", map[string]any{"weap": "2b1824d5"}); err != nil {
		t.Fatal(err)
	}
	doc, _ := litGLB(t, buf.Bytes())
	t.Logf("GLB : %d octets, %d noeuds, %d animations, %d materiaux, %d images", buf.Len(), len(doc.Nodes), len(doc.Animations),
		len(doc.Materials), len(doc.Images))
	if len(doc.Skins) != 1 || len(doc.Skins[0].Joints) != len(r.Modele.Noeuds) || len(doc.Animations) != len(r.Clips) {
		t.Errorf("GLB : %d peaux, %d animations pour %d clips", len(doc.Skins), len(doc.Animations), len(r.Clips))
	}
	if dst := os.Getenv("DIAG_FP_GLB"); dst != "" {
		if err := os.WriteFile(dst, buf.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("ecrit %s", dst)
	}
}

// journaliseRacines : les os de tete du squelette, leur parent et leur pose en attente.
func journaliseRacines(t *testing.T, r *RigPremierePersonne, idle *ClipAnimation) {
	t.Helper()
	m := r.Modele
	pose := m.PoseRig(idle, 0)
	enfants := make([]int, len(m.Noeuds))
	for _, n := range m.Noeuds {
		if n.Parent >= 0 {
			enfants[n.Parent]++
		}
	}
	for i := 0; i < 6 && i < len(m.Noeuds); i++ {
		p := idle.Os[i]
		t.Logf("os %d %s : %d enfants", i, m.Noms[i], enfants[i])
		t.Logf("os %d %s parent %d : attente %.3f %.3f %.3f, %d rotations %d translations", i, m.Noms[i], m.Noeuds[i].Parent,
			pose[i].Trans[0], pose[i].Trans[1], pose[i].Trans[2], len(p.Rotations), len(p.Translations))
	}
}

// verifieSurcouche : une surcouche porte des rotations proches de l'identite (des ecarts a ajouter a
// la pose de base), pas des poses absolues.
func verifieSurcouche(t *testing.T, r *RigPremierePersonne, c *ClipAnimation) {
	t.Helper()
	if c == nil {
		return
	}
	identite, repos, n := 0.0, 0.0, 0
	trZero, trRepos, nt := 0.0, 0.0, 0
	for i, p := range c.Os {
		for _, v := range p.Translations {
			r0 := r.Modele.Noeuds[i].Pos
			trZero += math.Sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
			trRepos += math.Sqrt((v[0]-r0[0])*(v[0]-r0[0]) + (v[1]-r0[1])*(v[1]-r0[1]) + (v[2]-r0[2])*(v[2]-r0[2]))
			nt++
		}
		for _, q := range p.Rotations {
			identite += angleAuQuat(q, [4]float64{0, 0, 0, 1})
			repos += angleAuQuat(q, r.Modele.Noeuds[i].Quat)
			n++
		}
	}
	if n == 0 {
		t.Fatal("surcouche sans rotation")
	}
	t.Logf("surcouche moving (type %d) : ecart moyen %.2f deg a l'identite, %.2f deg a la pose de repos (%d cles) ; translations %.4f u de zero, %.4f u du repos (%d cles)",
		c.Animation.Type, identite/float64(n), repos/float64(n), n, trZero/float64(max(nt, 1)), trRepos/float64(max(nt, 1)), nt)
	if c.Animation.Type != AnimationSurcouche || identite > repos {
		t.Errorf("surcouche : type %d, plus proche de la pose de repos que de l'identite", c.Animation.Type)
	}
}

// angleAuQuat : l'angle en degres entre deux quaternions.
func angleAuQuat(a, b [4]float64) float64 {
	d := math.Abs(a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3])
	na := math.Sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2] + a[3]*a[3])
	nb := math.Sqrt(b[0]*b[0] + b[1]*b[1] + b[2]*b[2] + b[3]*b[3])
	if na < 1e-9 || nb < 1e-9 {
		return 0
	}
	return 2 * math.Acos(math.Min(1, d/(na*nb))) * 180 / math.Pi
}
