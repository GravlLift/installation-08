//go:build gamefiles

package himap

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// ouvreArmurerieRecharge ouvre l'arsenal de Recharge et l'armurerie du Spartan.
func ouvreArmurerieRecharge(t *testing.T) (*Arsenal, *Armurerie) {
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
	r, err := a.OuvreArmurerie(ModeSpartan)
	if err != nil {
		t.Fatal(err)
	}
	return a, r
}

// selectionAviator : la configuration prouvee par la recherche du lot 8 (base du theme Mark VII
// d'apres son fichier GameCMS, casque AVIATOR, genouilleres Adamant Points, gants ATX, epauliere
// gauche 008-001-olympus-5744ad2e, sans section dans le mode).
func selectionAviator() []CleArmure {
	var sel []CleArmure
	for _, r := range []uint32{0xdcb69b0f, 0x8490853c, 0x3f91af6a, 0xa3bf50c6, 0x67548bfd, 0x438f8307, 0xbb7733d0,
		0x4e91a821, 0x29e36a32, 0x4a818295, 0x6b2f1024, 0x2a1a6635, 0x72a4b483} {
		sel = append(sel, CleArmure{r, 0x13d24f1f})
	}
	return append(sel, CleArmure{0xe5f7f02b, 0xe31502ee}, CleArmure{0x0d75f26e, 0xba96f71d}, CleArmure{0x88078d0d, 0xba96f71d},
		CleArmure{0x62059329, 0xd6b89789}, CleArmure{0x7c8065e9, 0xd6b89789}, CleArmure{0x006f42a8, 0x3b843b28})
}

// selectionMarkIV : l'armure d'un joueur tiers (noyau 017-001-hws-c13d0b38), resolue sans GameCMS :
// base du theme Mark IV (son ocur, permutation 18f393d2), casque Mark VII (e5f7f02b / 13d24f1f, nom
// d'Ekur « MARK VII »), gants Mark IV (18f393d2, nom d'Ekur « Mark IV »), genouilleres Mark IV
// (18f393d2, deduit : la permutation propre du noyau), epaulieres « Reach » remplacees par celles du
// Mark V [B] (26b3012b, premiere permutation de son ocur d'apres Ekur).
func selectionMarkIV(t *testing.T, a *Arsenal) []CleArmure {
	t.Helper()
	themes, err := a.ThemesDuModele(context.Background(), ModeSpartan)
	if err != nil {
		t.Fatal(err)
	}
	sel := map[uint32]uint32{}
	for _, th := range themes {
		if th.Permutation == 0x18f393d2 {
			for _, c := range th.Base {
				sel[c.Region] = c.Permutation
			}
		}
	}
	if len(sel) == 0 {
		t.Fatal("theme Mark IV (18f393d2) absent")
	}
	for r, p := range map[uint32]uint32{0xe5f7f02b: 0x13d24f1f, 0x62059329: 0x18f393d2, 0x7c8065e9: 0x18f393d2,
		0x0d75f26e: 0x18f393d2, 0x88078d0d: 0x18f393d2, 0x006f42a8: 0x26b3012b, 0xb64a2796: 0x26b3012b} {
		sel[r] = p
	}
	var out []CleArmure
	for r, p := range sel {
		out = append(out, CleArmure{r, p})
	}
	return out
}

// TestSelectionsTemoins : pour les deux armures temoins, l'union des pieces est la selection d'un
// bloc et forme un corps complet ; avec DIAG_SELECTIONS (dossier), les deux GLB d'un bloc y sont
// ecrits pour la sonde du navigateur.
func TestSelectionsTemoins(t *testing.T) {
	a, r := ouvreArmurerieRecharge(t)
	ctx := context.Background()
	for nom, sel := range map[string][]CleArmure{"aviator": selectionAviator(), "markiv": selectionMarkIV(t, a)} {
		mono, manquantes, err := r.Selection(ctx, sel)
		if err != nil {
			t.Fatalf("%s : %v", nom, err)
		}
		union := assemble(t, ctx, r, sel)
		t.Logf("%s : %d regions, %d manquantes %v, %d triangles d'un bloc, %d par les pieces", nom, len(sel), len(manquantes),
			manquantes, mono.Maillage.Structure.Triangles(), union.Maillage.Structure.Triangles())
		if mono.Maillage.Structure.Triangles() != union.Maillage.Structure.Triangles() {
			t.Errorf("%s : union des pieces != selection d'un bloc", nom)
		}
		verifieCorpsComplet(t, union)
		if dir := os.Getenv("DIAG_SELECTIONS"); dir != "" {
			var buf bytes.Buffer
			if err := EcritGLBPeau(&buf, mono, "test", nil); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "mono_"+nom+".glb"), buf.Bytes(), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
}

// TestPiecesArmure : chaque piece porte le squelette du Spartan par defaut (memes os, meme pose,
// memes matrices inverses de liaison) ; l'union des pieces d'une selection est la selection
// construite d'un bloc, triangle pour triangle, et forme un corps complet.
func TestPiecesArmure(t *testing.T) {
	a, r := ouvreArmurerieRecharge(t)
	ctx := context.Background()
	pieces := r.Pieces()
	t.Logf("%d pieces a geometrie sur %d permutations", len(pieces), r.Comptes.Permutations)
	if len(pieces) < 1177 {
		t.Errorf("%d pieces : sous le plancher mesure (1 177)", len(pieces))
	}
	defaut, err := a.ModeleAPeau(ctx, ModeSpartan)
	if err != nil {
		t.Fatal(err)
	}
	reference := squeletteDuGLB(t, defaut)
	for _, c := range []CleArmure{pieces[0], pieces[len(pieces)/2], pieces[len(pieces)-1]} {
		p, err := r.Piece(ctx, c)
		if err != nil {
			t.Fatalf("piece %s : %v", c, err)
		}
		if got := squeletteDuGLB(t, p); !bytes.Equal(got, reference) {
			t.Errorf("piece %s : squelette different de celui du Spartan par defaut", c)
		}
		verifieInfluences(t, p)
	}
	sel := selectionAviator()
	mono, manquantes, err := r.Selection(ctx, sel)
	if err != nil || len(manquantes) != 0 {
		t.Fatalf("selection : %v, manquantes %v", err, manquantes)
	}
	union := assemble(t, ctx, r, sel)
	t.Logf("selection AVIATOR : %d triangles d'un bloc, %d par les pieces (%d sections)", mono.Maillage.Structure.Triangles(),
		union.Maillage.Structure.Triangles(), len(union.Plages))
	if mono.Maillage.Structure.Triangles() != union.Maillage.Structure.Triangles() || len(mono.Plages) != len(union.Plages) {
		t.Errorf("union des pieces != selection d'un bloc")
	}
	if n := mono.Maillage.Structure.Triangles(); n != 40860 {
		t.Errorf("selection AVIATOR : %d triangles, la recherche en mesurait 40 860", n)
	}
	verifieCorpsComplet(t, mono)
	verifieCorpsComplet(t, union)
}

// assemble met bout a bout les pieces de la selection qui ont une geometrie.
func assemble(t *testing.T, ctx context.Context, r *Armurerie, sel []CleArmure) *ModeleAPeau {
	t.Helper()
	out := &ModeleAPeau{Maillage: &MaillageMonde{}, Noeuds: r.Noeuds, Noms: r.Noms}
	for _, c := range sel {
		p, err := r.Piece(ctx, c)
		if err != nil {
			t.Logf("piece %s sans geometrie (%v)", c, err)
			continue
		}
		base := len(out.Maillage.Structure.Sommets) / 3
		for _, pl := range p.Plages {
			out.Plages = append(out.Plages, PlageSection{Section: pl.Section, Debut: pl.Debut + base, Fin: pl.Fin + base})
		}
		out.Maillage.Structure.Sommets = append(out.Maillage.Structure.Sommets, p.Maillage.Structure.Sommets...)
		if out.Maillage.Structure.Indices == nil {
			out.Maillage.Structure.Indices = map[uint32][]uint32{}
		}
		for id, ix := range p.Maillage.Structure.Indices {
			for _, i := range ix {
				out.Maillage.Structure.Indices[id] = append(out.Maillage.Structure.Indices[id], i+uint32(base))
			}
		}
		out.Influences = append(out.Influences, p.Influences...)
	}
	return out
}

// squeletteDuGLB rend, du GLB du modele, les os de la peau (nom et pose locale) et les octets de ses
// matrices inverses de liaison.
func squeletteDuGLB(t *testing.T, m *ModeleAPeau) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := EcritGLBPeau(&buf, m, "test", nil); err != nil {
		t.Fatal(err)
	}
	doc, bin := lisDocTest(t, buf.Bytes())
	if len(doc.Skins) != 1 || len(doc.Skins[0].Joints) != len(m.Noeuds) {
		t.Fatalf("peau %+v", doc.Skins)
	}
	var out bytes.Buffer
	for _, j := range doc.Skins[0].Joints {
		n := doc.Nodes[j]
		js, _ := json.Marshal([]any{n.Name, n.Translation, n.Rotation, n.Scale, n.Children})
		out.Write(js)
	}
	vue := doc.BufferViews[doc.Accessors[doc.Skins[0].InverseBindMatrices].BufferView]
	out.Write(bin[vue.ByteOffset : vue.ByteOffset+vue.ByteLength])
	return out.Bytes()
}

// TestAccessoiresArmure : les marqueurs du Spartan, les accessoires qui s'y posent, et l'epauliere
// gauche du Mark VII posee sur son marqueur touche le corps de la selection AVIATOR.
func TestAccessoiresArmure(t *testing.T) {
	a, r := ouvreArmurerieRecharge(t)
	ctx := context.Background()
	noms := map[uint32]bool{}
	lies := 0
	for _, g := range r.Marqueurs {
		noms[g.Nom] = true
		for _, in := range g.Instances {
			if in.Region >= len(r.Regions) || (in.Region >= 0 && in.Permutation >= len(r.Regions[in.Region].Permutations)) ||
				(in.Noeud != SansNoeud && in.Noeud >= len(r.Noeuds)) {
				t.Errorf("marqueur %08x : instance hors du mode %+v", g.Nom, in)
			}
			if in.Region >= 0 {
				lies++
			}
		}
	}
	t.Logf("%d groupes de marqueurs, %d instances liees a une region", len(r.Marqueurs), lies)
	if len(r.Marqueurs) != r.Comptes.Marqueurs {
		t.Errorf("%d groupes lus, %d comptes", len(r.Marqueurs), r.Comptes.Marqueurs)
	}
	accs, autres, illisibles := a.AccessoiresDuModele(ctx, noms)
	t.Logf("accessoires du Spartan %d, autres %d, illisibles %d", len(accs), autres, illisibles)
	if len(accs) < 1271 || illisibles != 0 {
		t.Errorf("accessoires %d (plancher 1 271), illisibles %d", len(accs), illisibles)
	}
	epauliere := accessoire(t, accs, 0xb377ea7e)
	if len(epauliere.Entrees) != 1 || epauliere.Entrees[0].Marqueurs[0].Nom != 0x48daba1a {
		t.Fatalf("epauliere %+v : attendu une entree au marqueur 48daba1a", epauliere)
	}
	if poitrine := accessoire(t, accs, 0xff4a7edb); poitrine.Entrees[0].Marqueurs[0].Nom != 0xba9eb0ed {
		t.Errorf("accessoire de poitrine %+v : attendu le marqueur ba9eb0ed (fichier GameCMS)", poitrine)
	}
	m, err := a.ModeleAccessoire(ctx, epauliere.Entrees[0])
	if err != nil {
		t.Fatal(err)
	}
	sel := map[uint32]uint32{}
	for _, c := range selectionAviator() {
		sel[c.Region] = c.Permutation
	}
	corps, _, err := r.Selection(ctx, selectionAviator())
	if err != nil {
		t.Fatal(err)
	}
	d := ecartAuCorps(t, r, m, epauliere.Entrees[0].Marqueurs[0], sel, corps)
	t.Logf("epauliere : %d triangles, ecart minimal au corps %.4f u", m.Structure.Triangles(), d)
	if d > 0.01 {
		t.Errorf("epauliere posee a %.4f u du corps : hors de son marqueur", d)
	}
}

// accessoire rend l'accessoire `id` de la liste.
func accessoire(t *testing.T, accs []Accessoire, id uint32) Accessoire {
	t.Helper()
	for _, a := range accs {
		if a.ID == id {
			return a
		}
	}
	t.Fatalf("accessoire %08x absent", id)
	return Accessoire{}
}

// ecartAuCorps pose l'accessoire sur l'instance de son marqueur que la selection choisit et rend la
// plus petite distance d'un de ses sommets a un sommet du corps.
func ecartAuCorps(t *testing.T, r *Armurerie, m *MaillageMonde, mq MarqueurAccessoire, sel map[uint32]uint32, corps *ModeleAPeau) float64 {
	t.Helper()
	var grp GroupeMarqueurs
	for _, g := range r.Marqueurs {
		if g.Nom == mq.Nom {
			grp = g
		}
	}
	in, ok := ChoisitInstance(grp, r.Regions, sel)
	if !ok {
		t.Fatalf("marqueur %08x sans instance pour la selection", mq.Nom)
	}
	pose := Compose(in.DansLeModele(r.Noeuds), Transforme{Scale: 1, Rot: quatVersRot(mq.Rotation), Trans: mq.Translation})
	s, c := m.Structure.Sommets, corps.Maillage.Structure.Sommets
	meilleur := math.Inf(1)
	for i := 0; i+2 < len(s); i += 3 {
		p := pose.Applique([3]float64{float64(s[i]), float64(s[i+1]), float64(s[i+2])})
		for j := 0; j+2 < len(c); j += 3 {
			dx, dy, dz := p[0]-float64(c[j]), p[1]-float64(c[j+1]), p[2]-float64(c[j+2])
			meilleur = min(meilleur, dx*dx+dy*dy+dz*dz)
		}
	}
	return math.Sqrt(meilleur)
}

// TestThemesArmure : dix themes, la base du Mark VII lue dans son ocur porte les 13 regions du
// fichier de theme GameCMS (permutation 13d24f1f) et rejoint la variante par defaut la ou les deux
// nomment une region.
func TestThemesArmure(t *testing.T) {
	a, _ := ouvreArmurerieRecharge(t)
	ctx := context.Background()
	themes, err := a.ThemesDuModele(ctx, ModeSpartan)
	if err != nil {
		t.Fatal(err)
	}
	lus := 0
	for _, th := range themes {
		if th.Lu {
			lus++
		}
		t.Logf("theme %08x ocur %08x lu %v permutation %08x base %d", th.Nom, th.Ocur, th.Lu, th.Permutation, len(th.Base))
	}
	if len(themes) != 10 || lus < 8 || themes[0].Permutation != 0x13d24f1f {
		t.Fatalf("%d themes, %d lus, permutation du theme 0 %08x", len(themes), lus, themes[0].Permutation)
	}
	base := map[uint32]uint32{}
	for _, c := range themes[0].Base {
		base[c.Region] = c.Permutation
	}
	for _, c := range selectionAviator()[:13] {
		if base[c.Region] != c.Permutation {
			t.Errorf("region %08x : base %08x, fichier GameCMS %08x", c.Region, base[c.Region], c.Permutation)
		}
	}
	defaut, err := armureParDefaut(ctx, a.geo, ModeSpartan)
	if err != nil {
		t.Fatal(err)
	}
	ecarts := 0
	for reg, perm := range base {
		if v, ok := defaut.Variante[reg]; ok && v != perm {
			ecarts++
			t.Logf("region %08x : base %08x, variante par defaut %08x", reg, perm, v)
		}
	}
	if ecarts != 0 {
		t.Errorf("%d regions ou la base du Mark VII et la variante par defaut divergent", ecarts)
	}
}
