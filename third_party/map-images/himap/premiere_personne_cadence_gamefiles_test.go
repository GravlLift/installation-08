//go:build gamefiles

package himap

import (
	"context"
	"fmt"
	"math"
	"strings"
	"testing"
)

// TestCadencePremierePersonne : une animation qui porte le drapeau « creee a 60 Hz » stocke 60
// images par seconde (CadenceAnimation). Aucun champ du tag ne le dit ; la preuve tient sur des
// jumeaux, un meme geste stocke a 30 Hz sans drapeau et a 60 Hz avec : l'escalade du Bulldog (35
// images, sans drapeau) et celle du BR75 (70, avec) ; le rechargement du SPNKr a la premiere
// personne (238, avec) et celui du lance-missiles a la troisieme (117, sans) ; celui du Sidekick a la
// premiere personne (37, sans) et a la troisieme (82, avec). Le membre de ressource stocke autant
// d'images que l'enregistrement en annonce. Table des durees des clips cles au journal.
func TestCadencePremierePersonne(t *testing.T) {
	ctx := context.Background()
	a := ouvreArsenalRecharge(t)
	fp := map[string]*GraphesAnimation{}
	for _, w := range armesFPArene {
		gs, err := a.GraphesDepuis(ctx, w.graphe)
		if err != nil {
			t.Fatal(err)
		}
		fp[w.nom] = gs
		for _, an := range gs.Propre.Animations {
			if m := gs.Propre.membres[[2]int{an.Groupe, an.Membre}]; m.images != an.Images {
				t.Errorf("%s animation %d : %d images annoncees, %d stockees", w.nom, an.Rang, an.Images, m.images)
			}
		}
		t.Logf("%-13s %s", w.nom, dureesCles(t, gs))
	}
	t.Logf("dependances du graphe FP du BR75 (fichier d'evenements compris) : %v", groupesDependances(mustExtract(t, a, 0x6d609d45)))
	tp, err := a.GraphesDuSpartan(ctx)
	if err != nil {
		t.Fatal(err)
	}
	jumeaux := []struct {
		quoi       string
		a, b       AnimationGraphe
		toleranceS float64
	}{
		{"escalade Bulldog / BR75", actionFP(t, fp["Bulldog"], "clamber"), actionFP(t, fp["BR75"], "clamber"), 0.02},
		{"rechargement SPNKr FP / missile 3P", actionFP(t, fp["SPNKr"], "reload_full"), nommee3P(t, tp, "crouch:missile:reload_1"), 0.1},
		{"rechargement Sidekick FP / 3P", actionFP(t, fp["Sidekick"], "reload_full"), nommee3P(t, tp, "combat:pistol:strk:reload_1"), 0.15},
	}
	for _, j := range jumeaux {
		da, db := duree(j.a), duree(j.b)
		t.Logf("%s : %d images%s = %.2f s, %d images%s = %.2f s", j.quoi, j.a.Images, marque60(j.a), da, j.b.Images, marque60(j.b), db)
		if j.a.CreeeA60Hz() == j.b.CreeeA60Hz() || math.Abs(da-db) > j.toleranceS {
			t.Errorf("%s : jumeaux de meme drapeau ou durees ecartees (%.2f / %.2f s)", j.quoi, da, db)
		}
	}
	for _, nom := range []string{"combat:rifle:reload_1", "combat:rifle:melee_strike_1", "combat:rifle:melee_strike_2", "combat:rifle:put_away",
		"combat:rifle:ready", "combat:rifle:throw_grenade", "combat:pistol:throw_grenade", "combat:pistol:melee_strike_1", "combat:rifle:land_hard",
		"combat:rifle:dodge_front", "crouch:rifle:slide", "combat:rifle:fire_1", "combat:rifle:br:reload_1", "combat:rifle:sr:reload_1"} {
		an := nommee3P(t, tp, nom)
		t.Logf("3P %-30s %3d images%s = %.2f s (a 30 Hz : %.2f s)", nom, an.Images, marque60(an), duree(an), float64(an.Images)/ImagesParSecondeAnimation)
	}
}

func duree(a AnimationGraphe) float64 { return float64(a.Images) / float64(CadenceAnimation(a)) }

func marque60(a AnimationGraphe) string {
	if a.CreeeA60Hz() {
		return " (60 Hz)"
	}
	return ""
}

func actionFP(t *testing.T, gs *GraphesAnimation, action string) AnimationGraphe {
	t.Helper()
	clips, err := gs.ClipsDeLAction(action, false)
	if err != nil || len(clips) == 0 {
		t.Fatalf("action %s : %v", action, err)
	}
	return clips[0].Animation()
}

func nommee3P(t *testing.T, gs *GraphesAnimation, nom string) AnimationGraphe {
	t.Helper()
	g, r, err := gs.Nommee(nom)
	if err != nil || g == nil {
		t.Fatalf("3P %s : %v", nom, err)
	}
	return g.Animations[r]
}

// dureesCles rend les durees reelles des clips cles d'un graphe FP.
func dureesCles(t *testing.T, gs *GraphesAnimation) string {
	t.Helper()
	var cols []string
	for _, ac := range []string{"reload_full", "reload_empty", "reload_enter", "reload_continue_empty", "fire_1", "ready", "put_away",
		"melee_strike_1", "melee_lunge", "throw_grenade", "clamber"} {
		clips, err := gs.ClipsDeLAction(ac, false)
		if err != nil {
			t.Fatal(err)
		}
		if len(clips) > 0 {
			an := clips[0].Animation()
			cols = append(cols, fmt.Sprintf("%s=%.2fs(%d@%d)", ac, duree(an), an.Images, CadenceAnimation(an)))
		}
	}
	return strings.Join(cols, " ")
}

// groupesDependances compte les dependances d'un tag par groupe.
func groupesDependances(raw []byte) map[string]int {
	ti, err := meilleurTagInfo(raw)
	if err != nil {
		return nil
	}
	out := map[string]int{}
	tab := ti.blockTab - ti.deps*depEntrySize
	for i := 0; i < ti.deps; i++ {
		v := uint32(u32(raw, tab+i*depEntrySize))
		out[string([]byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)})]++
	}
	return out
}
