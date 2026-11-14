package himap

// LOCAL-CHANGE (infinite-theater-3d): tests of filtres_mode.go, without game files.

import (
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// TestFiltresModeEcarte : un objet a filtres d'inclusion n'existe que dans l'un de ses modes ; un
// filtre d'exclusion du mode le retire ; un objet sans filtre, ou a label non resolu, reste.
func TestFiltresModeEcarte(t *testing.T) {
	h := mapvar.LabelHash
	objet := func(labels ...int32) mapvar.Object { return mapvar.Object{Labels: labels} }
	sansMode := FiltresMode{}
	ctf := FiltresMode{Inclus: map[int32]bool{h("ctf_include"): true}, Exclus: map[int32]bool{h("ctf_exclude"): true}}
	koth := FiltresMode{Inclus: map[int32]bool{mapvar.LabelHashHillInclude: true}}
	cas := []struct {
		nom   string
		f     FiltresMode
		o     mapvar.Object
		ecart bool
	}{
		{"caisse sans label", sansMode, objet(), false},
		{"grille hors Infection", sansMode, objet(h("infection_exclude")), false},
		{"label non resolu", sansMode, objet(-831896525), false},
		{"socle de drapeau a Slayer", sansMode, objet(h("ctf_include"), h("flag_spawn")), true},
		{"repere de colline a Slayer", sansMode, objet(mapvar.LabelHashHillInclude, mapvar.LabelHashHillMarker), true},
		{"socle de drapeau en CTF", ctf, objet(h("ctf_include"), h("flag_spawn")), false},
		{"socle central en CTF a deux drapeaux", ctf, objet(h("ctf_neutral_include"), h("flag_spawn")), true},
		{"couvert retire en CTF", ctf, objet(h("ctf_exclude")), true},
		{"repere de Bastion en CTF", ctf, objet(h("strongholds_include")), true},
		{"zone de Bastion et colline en KOTH", koth, objet(h("strongholds_include"), mapvar.LabelHashHillInclude), false},
		{"porte d'Infection en KOTH", koth, objet(h(mapvar.LabelInfectionInclude)), true},
	}
	for _, c := range cas {
		if got := c.f.ecarte(c.o); got != c.ecart {
			t.Errorf("%s : ecarte %v, attendu %v", c.nom, got, c.ecart)
		}
	}
}

// TestEcartHorsModeCompte : l'objet que le mode ne cree pas se compte a sa ligne et n'est pas
// pose ; le meme objet se pose dans son mode (jusqu'au modele, absent ici).
func TestEcartHorsModeCompte(t *testing.T) {
	o := mapvar.Object{TypeID: -877512201, Flags: 1, Labels: []int32{mapvar.LabelHash("landgrab_include")}}
	var m MaillageMonde
	var b BilanVariante
	m.poseVarianteTeinte(OptionsVariante{Objets: []mapvar.Object{o}}, nil, nil, &b)
	if b.HorsMode != 1 || b.SansModele != 0 {
		t.Fatalf("partie sans mode : bilan %+v", b)
	}
	b = BilanVariante{}
	lg := FiltresMode{Inclus: map[int32]bool{mapvar.LabelHash("landgrab_include"): true}}
	m.poseVarianteTeinte(OptionsVariante{Objets: []mapvar.Object{o}, Filtres: lg}, nil, nil, &b)
	if b.HorsMode != 0 || b.SansModele != 1 {
		t.Fatalf("partie de Land Grab : bilan %+v", b)
	}
}
