package replay

// tracks_visees_seules.go — LES VISEES SANS POSITION ENTRENT DANS LE PLEIN DEBIT DE LEUR VIE (schema 113).
//
// Le film replique la visee `i21` d un bipede aussi dans des records qui ne portent aucune position
// (`grammar.ScanBipedAimOnly`) : le nuage des positions ne les voit pas, et les colonnes de visee de
// `tracks[].fullRate` (aimT, h, p) ne portaient que les visees des records de position. Chaque visee sans
// position se pose sur la vie de son slot dont les bornes (celles du registre, `bornesDesVies`) couvrent
// son instant, et les deux suites se fusionnent dans l ordre du temps : les colonnes restent UNE suite de
// visees, triee, au debit du film. A instant egal (a la milliseconde), la visee du record de position
// passe la premiere.
//
// CE QUI NE SE POSE PAS SE COMPTE : une visee dont aucune vie publiee du slot ne couvre l instant (avant
// la premiere position du slot, entre deux vies, apres la derniere, sur une vie refusee par le seuil)
// entre dans `coverage.tracks.aimOnlyNoLife`. Lectures = `fullRateAimOnlySamples` + `aimOnlyNoLife`.

import (
	"cmp"
	"slices"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
)

// viseeAbsolue est une visee du plein debit en absolu : instant en ms depuis l origine de la grille,
// quanta bruts d `i21`.
type viseeAbsolue struct {
	t    int64
	h, p int32
}

// repartirLesViseesSeules pose chaque visee sans position sur le plein debit de la vie de son slot qui
// couvre son instant, et compte celles qu aucune vie ne recoit.
func repartirLesViseesSeules(visees []grammar.BipedAim, bornes map[uint32][]lifeSpan,
	accs map[uint32]*accDeSlot, origin uint64, cov *TrackCoverage) {
	for _, v := range visees {
		plein := pleinDeLInstant(accs[v.Slot], bornes[v.Slot], v.TimestampUS, origin)
		if plein == nil {
			cov.AimOnlyNoLife++
			continue
		}
		plein.seules = append(plein.seules, v)
	}
}

// pleinDeLInstant rend le plein debit de la vie du slot dont les bornes couvrent l instant, nil sans
// elle (slot sans position retenue, instant hors de toute vie ou avant l origine de la grille).
func pleinDeLInstant(a *accDeSlot, spans []lifeSpan, tsUS, origin uint64) *pleinDebit {
	if a == nil || tsUS < origin {
		return nil
	}
	t := int64(tsUS) //nolint:gosec // horloge du film en microsecondes
	vie := -1
	for i, s := range spans {
		if t >= s.from && t <= s.to {
			vie = i
			break
		}
	}
	if vie < 0 {
		return nil
	}
	for _, p := range append(a.pleinsClos, a.plein) {
		if p != nil && p.vie == vie && p.n > 0 {
			return p
		}
	}
	return nil
}

// fusionnerLesVisees rend les colonnes de visee de la piste avec les visees sans position, fusionnees
// dans l ordre du temps et recodees en ecarts.
func fusionnerLesVisees(piste FullRateTrack, seules []grammar.BipedAim, origin uint64) ([]int64, []int32, []int32) {
	lues := make([]viseeAbsolue, 0, len(piste.AimT))
	var t int64
	var h, p int32
	for i := range piste.AimT {
		t, h, p = t+piste.AimT[i], h+piste.H[i], p+piste.P[i]
		lues = append(lues, viseeAbsolue{t: t, h: h, p: p})
	}
	ajoutees := make([]viseeAbsolue, 0, len(seules))
	for _, v := range seules {
		ajoutees = append(ajoutees, viseeAbsolue{t: int64((v.TimestampUS - origin) / fullRateTimeUnitUS), //nolint:gosec // ms
			h: int32(v.YawRaw), p: int32(v.PitchRaw)}) //nolint:gosec // quanta de 12 et 11 bits
	}
	slices.SortStableFunc(ajoutees, func(a, b viseeAbsolue) int { return cmp.Compare(a.t, b.t) })
	return encoderLesVisees(fusionTriee(lues, ajoutees))
}

// fusionTriee fusionne deux suites triees ; a instant egal, `a` passe la premiere.
func fusionTriee(a, b []viseeAbsolue) []viseeAbsolue {
	out := make([]viseeAbsolue, 0, len(a)+len(b))
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		if b[j].t < a[i].t {
			out = append(out, b[j])
			j++
			continue
		}
		out = append(out, a[i])
		i++
	}
	out = append(out, a[i:]...)
	return append(out, b[j:]...)
}

// encoderLesVisees recode une suite absolue en colonnes d ecarts (cf. tracks_plein_debit.go).
func encoderLesVisees(vs []viseeAbsolue) ([]int64, []int32, []int32) {
	ts, hs, ps := make([]int64, len(vs)), make([]int32, len(vs)), make([]int32, len(vs))
	var prev viseeAbsolue
	for i, v := range vs {
		ts[i], hs[i], ps[i] = v.t-prev.t, v.h-prev.h, v.p-prev.p
		prev = v
	}
	return ts, hs, ps
}
