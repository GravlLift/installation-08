package replay

// stick_de_deplacement.go — LE STICK DE DEPLACEMENT D UNE VIE, AU DEBIT DE LA COMMANDE (schema 114).
//
// La vue de controle porte, par place de controle et a chaque changement, le couple analogique du
// deplacement (`types.ControlInputChange.Stick` : deux scalaires R(6) BRUTS, 31 au repos, 0 et 62 aux
// butees). Il se pose sur la vie du joueur qui tient la place a cet instant (places_de_controle.go), dans
// trois colonnes differentielles du plein debit, a SES instants, jamais reechantillonnees :
//
//	stickT   ms depuis l origine de la grille, l axe de `t` et de `aimT`
//	sx, sy   les deux scalaires bruts, dans l ordre ou le film les ecrit ; -1 quand l etat de la commande
//	         n est pas connu (silence de la vue de controle, couple absent). Le repere est celui de la
//	         VISEE, mesure (stick_de_deplacement_research_test.go) : `sx` suit le cap (62 = plein avant),
//	         `sy` est a +90 degres du cap, de x vers y du monde.
//
// UN ECHANTILLON PAR CHANGEMENT du couple ou de sa connaissance : un changement des seuls boutons n en
// fait pas. La vie s ouvre sur l etat que sa place porte a son premier instant (le dernier changement
// au plus tard a cet instant), quand ce changement est connu : un stick tenu depuis avant la naissance
// de la vie n attend pas son prochain changement pour s y lire.

import (
	"cmp"
	"slices"
	"sort"

	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// stickInconnu : la valeur publiee d un axe quand l etat de la commande n est pas connu.
const stickInconnu = int32(types.ControlStickAbsent)

// etatDuStick est un echantillon du stick en absolu : instant du film, valeurs brutes.
type etatDuStick struct {
	ts   uint64
	x, y int32
}

// stickDe rend l echantillon d un changement de la commande.
func stickDe(c types.ControlInputChange) etatDuStick {
	if c.Unknown {
		return etatDuStick{ts: c.TimestampUS, x: stickInconnu, y: stickInconnu}
	}
	return etatDuStick{ts: c.TimestampUS, x: int32(c.Stick[0]), y: int32(c.Stick[1])}
}

// sticksParPlace rend, par place, les changements du stick dans l ordre du temps (les changements des
// seuls boutons retires).
func sticksParPlace(ch []types.ControlInputChange) map[int][]etatDuStick {
	out := map[int][]etatDuStick{}
	for _, c := range ch {
		s := stickDe(c)
		prec := out[c.Index]
		if n := len(prec); n > 0 && prec[n-1].x == s.x && prec[n-1].y == s.y {
			continue
		}
		out[c.Index] = append(prec, s)
	}
	for p := range out {
		slices.SortStableFunc(out[p], func(a, b etatDuStick) int { return cmp.Compare(a.ts, b.ts) })
	}
	return out
}

// poserLeStick pose le stick de chaque place sur les vies de ses joueurs, et compte ce qui ne se pose pas.
func (p *posturesDeControle) poserLeStick(ch []types.ControlInputChange) {
	parVie := map[int][]etatDuStick{}
	sticks := sticksParPlace(ch)
	for place, ss := range sticks {
		for _, s := range ss {
			ti, ok := p.vieDeLaPlace(place, s.ts)
			if !ok {
				p.cov.StickNoLife++
				continue
			}
			parVie[ti] = append(parVie[ti], s)
		}
	}
	for ti := range p.tracks {
		if amorce, ok := p.amorceDuStick(ti, sticks); ok {
			parVie[ti] = append([]etatDuStick{amorce}, parVie[ti]...)
		}
	}
	for ti, ss := range parVie {
		p.cov.StickSamples += p.ecrireLeStick(ti, ss)
	}
}

// vieDeLaPlace rend la vie publiee du joueur qui tient la place a l instant, sans autre filtre : le stick
// est une donnee de la commande, a pied comme a bord.
func (p *posturesDeControle) vieDeLaPlace(place int, ts uint64) (int, bool) {
	if ts < p.horloge.origin {
		return 0, false
	}
	fr := p.horloge.frame(ts)
	pi, ok := p.places.joueurA(place, fr)
	if !ok {
		return 0, false
	}
	return p.vieA(pi, fr, ts)
}

// amorceDuStick rend l etat que la place du joueur de la vie porte au premier instant de la vie, quand
// le dernier changement de la place au plus tard a cet instant est connu.
func (p *posturesDeControle) amorceDuStick(ti int, sticks map[int][]etatDuStick) (etatDuStick, bool) {
	tr := p.tracks[ti]
	if tr.FullRate == nil || len(tr.FullRate.T) == 0 {
		return etatDuStick{}, false
	}
	debut := p.horloge.origin + uint64(tr.FullRate.T[0])*fullRateTimeUnitUS //nolint:gosec // ms >= 0
	pi, ok := p.occ.indexA(tr.Slot, int64(debut))                           //nolint:gosec // horloge du film
	if !ok {
		return etatDuStick{}, false
	}
	place, ok := p.places.placeDe(pi, p.horloge.frame(debut))
	if !ok {
		return etatDuStick{}, false
	}
	ss := sticks[place]
	i := sort.Search(len(ss), func(i int) bool { return ss[i].ts > debut }) - 1
	if i < 0 || ss[i].ts == debut || ss[i].x == stickInconnu {
		return etatDuStick{}, false // aucun etat anterieur, ou deja pose a l instant meme, ou inconnu
	}
	return etatDuStick{ts: debut, x: ss[i].x, y: ss[i].y}, true
}

// ecrireLeStick ecrit les colonnes du stick de la vie, en ecarts, sans deux echantillons egaux de
// suite ; rend le nombre d echantillons ecrits.
func (p *posturesDeControle) ecrireLeStick(ti int, ss []etatDuStick) int {
	fr := p.tracks[ti].FullRate
	if fr == nil {
		return 0
	}
	slices.SortStableFunc(ss, func(a, b etatDuStick) int { return cmp.Compare(a.ts, b.ts) })
	var prev etatDuStick
	var prevT int64
	premier := true
	for _, s := range ss {
		if !premier && s.x == prev.x && s.y == prev.y {
			continue
		}
		t := p.ms(s.ts)
		fr.StickT = append(fr.StickT, t-prevT)
		fr.SX = append(fr.SX, s.x-prev.x)
		fr.SY = append(fr.SY, s.y-prev.y)
		prev, prevT, premier = s, t, false
	}
	return len(fr.StickT)
}
