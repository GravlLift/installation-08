//go:build gamefiles

package himap

import (
	"context"
	"testing"
)

// etiquettesArene : la classe et le type d'animation de chaque arme de armesFPArene, lus dans son
// `weap` ; chaque type est confirme par le hachage d'un nom d'animation du graphe racine
// (`combat:<classe>:<type>:reload_1` ou `fire_1`, TestEtiquettesAnimationArme).
var etiquettesArene = map[string][2]string{
	"BR75": {"rifle", "br"}, "MA40": {"rifle", "ar"}, "Sidekick": {"pistol", "strk"}, "Commando": {"rifle", "comri"},
	"Bandit": {"rifle", "bandit"}, "BanditEvo": {"rifle", "bandit"}, "S7": {"rifle", "sr"}, "Bulldog": {"rifle", "comsh"},
	"SPNKr": {"missile", "spnker"}, "Needler": {"pistol", "ne"}, "PulseCarbine": {"rifle", "ww"}, "PlasmaPistol": {"pistol", "pp"},
	"Heatwave": {"rifle", "hw"}, "ShockRifle": {"rifle", "va"}, "Stalker": {"rifle", "stalker"}, "Mangler": {"pistol", "mang"},
	"Skewer": {"missile", "skwr"}, "Cindershot": {"rifle", "cindr"}, "Ravager": {"rifle", "pv"}, "SentinelBeam": {"rifle", "sb"},
	"Disruptor": {"pistol", "arc"}, "EnergySword": {"sword", "eb"}, "GravityHammer": {"hammer", "gh"}, "Hydra": {"rifle", "mlrs"},
}

// TestEtiquettesAnimationArme : chaque arme de l'arene porte sa classe et son type d'animation ; hors
// epee et marteau, un rechargement ou un tir du graphe racine porte le nom compose avec eux ; chaque
// `weap` a vue a la premiere personne porte l'enregistrement.
func TestEtiquettesAnimationArme(t *testing.T) {
	ctx := context.Background()
	a := ouvreArsenalRecharge(t)
	gs, err := a.GraphesDuSpartan(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, w := range armesFPArene {
		e, err := a.EtiquettesAnimationArme(w.weap, gs)
		if err != nil {
			t.Errorf("%s : %v", w.nom, err)
			continue
		}
		got := [2]string{NomEtiquette(e.Classe), NomEtiquette(e.Type)}
		if got != etiquettesArene[w.nom] {
			t.Errorf("%s (%08x) : %v, attendu %v", w.nom, w.weap, got, etiquettesArene[w.nom])
		}
		if got[0] == "sword" || got[0] == "hammer" {
			continue
		}
		prefixe := "combat:" + got[0] + ":" + got[1] + ":"
		r, _, _ := gs.Nommee(prefixe + "reload_1")
		f, _, _ := gs.Nommee(prefixe + "fire_1")
		f2, _, _ := gs.Nommee(prefixe + "fire_2")
		if r == nil && f == nil && f2 == nil {
			t.Errorf("%s : ni %sreload_1 ni %sfire_1 ni fire_2", w.nom, prefixe, prefixe)
		}
	}
	armes, _ := a.ArmesPremierePersonne()
	sans := 0
	for _, s := range armes {
		e, err := a.EtiquettesAnimationArme(s.Arme, gs)
		switch {
		case err != nil:
			t.Logf("%v", err)
			sans++
		case e.Type == 0:
			t.Logf("%08x : classe %s sans type", s.Arme, NomEtiquette(e.Classe))
		}
	}
	t.Logf("%d armes a vue a la premiere personne, %d sans enregistrement d'animation", len(armes), sans)
	if sans > 0 {
		t.Errorf("%d armes sans enregistrement d'animation", sans)
	}
}
