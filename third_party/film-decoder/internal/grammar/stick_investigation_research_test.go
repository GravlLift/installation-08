//go:build research

package grammar

// stick_investigation_research_test.go — POURQUOI `projectiles[].p` S'ARRÊTE AVANT `detoT` pour
// une grenade qui COLLE à un joueur (demande du 2026-11-16 : match d01ba030, proj 107, t0=8250,
// dernier échantillon publié frame 8260, detoT=8289 — 29 images sans aucun échantillon).
//
// INSTRUMENT DE LECTURE SEULE : il n'altère aucun décodeur. Il relève, pour l'entité EXACTE
// (slot, gen) du projectile, TOUS les records delta qui la nomment dans la fenêtre de naissance
// à 4 s après le dernier échantillon ACCEPTÉ par la production (`echantillonDuRecord`, qui exige
// `rec.Idx[0] == 0` — i0 = object-position-component) — masque de composants compris, pas
// seulement ceux que la production retient. S'il existe des records SANS i0 dans ce trou, ils
// disent ce que l'entité porte à la place (et si sa génération change, ce qui serait le signe
// d'un ré-attachement).
//
// USAGE : IT3D_STICK_DIR=<...>\data\matches\d01ba030-.../chunks go test -tags research
//
//	./third_party/film-decoder/internal/grammar/... -run TestStickInvestigation -v
//
// VERDICT (2026-11-16, trois instruments : ce fichier, stick_packet_research_test.go,
// stick_parent_research_test.go). Le record manquant EST trouvé : chunk=14 pk=1906, masque
// idx=[1 3 10 18] — i1 (vitesse), i3 (vitesse angulaire), i10 (`object-parent-state-component`,
// déjà décodé ailleurs pour le véhicule et l'équipement : branche « attaché » = un handle de
// parent + une pose relative), i18 (`projectile-at-rest-state`, dont la table ECS du dépôt dit
// déjà : « le projectile s'est ARRETE (il a touché quelque chose et COLLE) »). AUCUN i0 : c'est
// la DERNIÈRE fois que ce slot apparaît dans toute la fenêtre de recherche de détonation (+4 s).
// La méthode de ce balayage (bit à bit, sans distinguer la FORME du paquet) est celle-là même du
// scanner de production (`projectiles.go` / `echantillonsDesBandes`), donc ce record est bien
// celui que `buildProjectiles` rejette (`rec.Idx[0] != 0`), pas un artefact de cet instrument.
//
// CE QUE CE RECORD NE PERMET PAS DE FAIRE SANS TRAVAIL SUPPLÉMENTAIRE : le décodeur existant
// d'i10 (`decodeObjectParentState`) n'est câblé que dans le marcheur de trame PROPRE
// (`DecodeFrameRecords`), qui refuse la FORME de ce paquet (`pay[0]&0x40 != 0` —
// stick_packet_research_test.go le montre) ; et même décodé, le triplet `Mtx` (la pose relative)
// n'a AUCUNE largeur de déquantification établie nulle part dans ce dépôt
// (components_object_state.go : « BRUTS et NON INTERPRÉTÉS »). Composer la position du monde
// demanderait d'inventer une échelle — exactement ce qu'on nous a demandé de ne pas faire.
// Voir stick_parent_research_test.go pour la tentative de lecture directe de Quant16/Mtx.

import (
	"fmt"
	"os"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/profile"
	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

const stickDirEnv = "IT3D_STICK_DIR"

// stickBirthX/Y identifies the target projectile by its known birth position (the grenade's
// throw point, read from the stored replay.json.gz: grenades[] entry for proj 107).
const (
	stickBirthX = 12.38
	stickBirthY = -15.92
)

func TestStickInvestigation(t *testing.T) {
	dir := os.Getenv(stickDirEnv)
	if dir == "" {
		t.Skipf("%s absent : instrument saute", stickDirEnv)
	}
	wr := sondeWorldRange(t, dir)
	if wr == nil {
		t.Fatal("bornes monde absentes : la cible ne peut pas se décoder sans elles")
	}
	film, err := source.LoadDir(dir, nil)
	if err != nil {
		t.Fatalf("film illisible : %v", err)
	}
	fc := contexteDeBobine(film)
	lg := fc.ProfilDeBalayage().LargeursObjetDuMonde()

	tracks, err := ScanProjectiles(fc, wr)
	if err != nil {
		t.Fatalf("ScanProjectiles : %v", err)
	}
	var target *types.ProjectileTrack
	for i := range tracks {
		tr := &tracks[i]
		if len(tr.Pts) == 0 {
			continue
		}
		p0 := tr.Pts[0]
		if stickAbs(p0.X-stickBirthX) < 0.1 && stickAbs(p0.Y-stickBirthY) < 0.1 {
			target = tr
			break
		}
	}
	if target == nil {
		t.Fatalf("projectile cible introuvable (naissance ~%.2f,%.2f) parmi %d pistes", stickBirthX, stickBirthY, len(tracks))
	}
	t.Logf("CIBLE : slot=%d gen=%d — %d échantillons ACCEPTÉS par la production (i0 présent)", target.Slot, target.Gen, len(target.Pts))
	for i, p := range target.Pts {
		t.Logf("  accepté[%d] t=%dus x=%.2f y=%.2f z=%.2f atRest=%v", i, p.TimestampUS, p.X, p.Y, p.Z, p.AtRest)
	}
	if len(target.Pts) == 0 {
		return
	}
	from := target.Pts[0].TimestampUS
	to := target.Pts[len(target.Pts)-1].TimestampUS
	stickDumpAllRecords(t, film, target.Slot, target.Gen, wr, lg, from, to)
}

func stickAbs(v float32) float32 {
	if v < 0 {
		return -v
	}
	return v
}

// stickDumpAllRecords relève, SANS le filtre `rec.Idx[0] == 0` de la production, tous les
// records delta qui nomment `slot` entre `fromUS` et 4 s après `toUS` (la fenêtre de recherche
// de détonation, `detoSearchAfterUS`) : masque de composants, génération, et position si i0 est
// présent.
func stickDumpAllRecords(t *testing.T, film *source.Film, slot, gen uint32, wr *profile.Vec3Range, lg profile.PrecisionDescriptor, fromUS, toUS uint64) {
	t.Helper()
	windowEnd := toUS + 4_000_000
	n, withPos, withoutPos := 0, 0, 0
	genSeen := map[uint32]int{}
	for _, c := range FilmChunkNumbers(film) {
		chunk, pks, ok := FilmChunkAt(film, c)
		if !ok {
			continue
		}
		for _, pk := range pks {
			if pk.Type != PacketTypeDelta || pk.TimestampUS < fromUS || pk.TimestampUS > windowEnd {
				continue
			}
			pay := pk.Payload(chunk)
			limit := len(pay)*8 - (worldObjectHeaderBits + worldObjectIndexBits)
			for p := 0; p <= limit; p++ {
				if source.BitsTolerants(pay, p, 1) != 1 {
					continue
				}
				h := LireHandleDelta(pay, p)
				if h.Slot != slot {
					continue
				}
				rec, ok := masqueDObjetDuMonde(pay, p, h)
				if !ok {
					continue
				}
				n++
				genSeen[h.Gen]++
				hasPos := len(rec.Idx) > 0 && rec.Idx[0] == 0
				posStr := "SANS i0 (pas de position dans ce record)"
				if hasPos {
					if v, ok := decodeWorldObjectPos(pay, rec.After, wr, lg); ok {
						posStr = fmt.Sprintf("x=%.2f y=%.2f z=%.2f", v[0], v[1], v[2])
						withPos++
					} else {
						posStr = "i0 présent mais décodage refusé"
						withoutPos++
					}
				} else {
					withoutPos++
				}
				t.Logf("  chunk=%d pk=%d t=%dus gen=%d idx=%v %s", c, pk.Index, pk.TimestampUS, h.Gen, rec.Idx, posStr)
			}
		}
	}
	t.Logf("TOTAL records nommant le slot %d sur la fenêtre [%dus, %dus] : %d (avec position lisible %d, sans %d)",
		slot, fromUS, windowEnd, n, withPos, withoutPos)
	t.Logf("générations vues sur ce slot dans la fenêtre : %v (gen du projectile cible : %d)", genSeen, gen)
}
