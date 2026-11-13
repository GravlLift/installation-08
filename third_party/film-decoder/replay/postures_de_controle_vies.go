package replay

// postures_de_controle_vies.go — LA COMMANDE D UNE PLACE POSEE SUR LA VIE DE SON JOUEUR, puis classee
// en accroupi, glissade ou saut (la regle est en tete de postures_de_controle.go).

import (
	"cmp"
	"slices"

	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// posturesDeControle porte ce que la pose des postures de la commande lit du document.
type posturesDeControle struct {
	places  placesDeControle
	occ     occupantsDesSlots
	horloge replayClock
	tracks  []Track
	// viesParSlot : les indices, dans `tracks`, des vies de chaque slot.
	viesParSlot map[uint32][]int
	// lues : les vies qui portent une posture lue (`i29`, `i62`).
	lues map[int]bool
	// sprints : les intervalles de sprint lus de chaque slot, en microsecondes du film.
	sprints map[uint32][][2]uint64
	// montees : les episodes de vehicule de chaque slot, en frames.
	montees map[uint32][][2]int
	cin     map[int]cinematique
	cov     *ControlStanceCoverage
}

// ms rend l instant du film `ts` en millisecondes depuis l origine de la grille.
func (p *posturesDeControle) ms(ts uint64) int64 {
	return int64((ts - p.horloge.origin) / fullRateTimeUnitUS) //nolint:gosec // horloge du film
}

// frameDeMs rend la frame d un instant en ms depuis l origine de la grille, bornee a la vie `ti`.
func (p *posturesDeControle) frameDeMs(ms int64, ti int) int {
	fr := int(ms * fullRateTimeUnitUS / int64(p.horloge.step)) //nolint:gosec // pas de grille
	return min(max(fr, p.tracks[ti].StartFrame), p.tracks[ti].EndFrame)
}

// cinematiqueDe rend le plein debit absolu de la vie `ti`, reconstruit une fois.
func (p *posturesDeControle) cinematiqueDe(ti int) cinematique {
	c, ok := p.cin[ti]
	if !ok {
		c = cinematiqueDe(p.tracks[ti].FullRate)
		p.cin[ti] = c
	}
	return c
}

// resoudre rend la vie a pied du joueur qui tient la place `place` a l instant `ts`, et compte la
// raison d un refus.
func (p *posturesDeControle) resoudre(place int, ts uint64) (int, bool) {
	if ts < p.horloge.origin {
		p.cov.NoLife++
		return 0, false
	}
	fr := p.horloge.frame(ts)
	pi, ok := p.places.joueurA(place, fr)
	if !ok {
		p.cov.NoPlayer++
		return 0, false
	}
	ti, ok := p.vieA(pi, fr, ts)
	switch {
	case !ok:
		p.cov.NoLife++
	case p.enVehicule(p.tracks[ti].Slot, fr):
		p.cov.InVehicle++
	case !p.cinematiqueDe(ti).presDe(p.ms(ts), presencePositionMS):
		p.cov.NoPosition++
	default:
		return ti, true
	}
	return 0, false
}

// vieA rend la vie publiee du joueur `pi` qui couvre la frame `fr`.
func (p *posturesDeControle) vieA(pi, fr int, ts uint64) (int, bool) {
	for _, s := range p.occ.slotsDe(pi, int64(ts)) { //nolint:gosec // horloge du film
		for _, ti := range p.viesParSlot[s] {
			if fr >= p.tracks[ti].StartFrame && fr <= p.tracks[ti].EndFrame {
				return ti, true
			}
		}
	}
	return 0, false
}

// enVehicule dit qu un episode de vehicule du slot couvre la frame.
func (p *posturesDeControle) enVehicule(slot uint32, fr int) bool {
	for _, m := range p.montees[slot] {
		if fr >= m[0] && fr <= m[1] {
			return true
		}
	}
	return false
}

// etatDuSprint dit, a l instant `ts` du slot, si un sprint est actif, fini depuis au plus
// [glissadeApresSprintMS], ou fini depuis au plus [glissadeEnChuteApresSprintMS].
func (p *posturesDeControle) etatDuSprint(slot uint32, ts uint64) (recent, proche bool) {
	for _, s := range p.sprints[slot] {
		if ts < s[0] {
			continue
		}
		if ts <= s[1] || ts-s[1] <= glissadeApresSprintMS*1000 {
			return true, true
		}
		if ts-s[1] <= glissadeEnChuteApresSprintMS*1000 {
			proche = true
		}
	}
	return false, proche
}

// poser classe la pression `pr` de la place `cmd`, posee sur la vie `ti`.
func (p *posturesDeControle) poser(pr pressionLue, cmd *commandesDUnePlace, ti int) []Stance {
	if p.lues[ti] {
		p.cov.ReadByComponent++
		return nil
	}
	c := p.cinematiqueDe(ti)
	de, a := p.ms(pr.de), min(p.ms(pr.a), c.fin())
	debut, glisse := p.debutDeGlissade(pr.de, de, ti, c)
	if !glisse {
		return p.accroupi(de, a, ti)
	}
	saut := int64(-1)
	if s, ok := cmd.sautApres(pr.de); ok {
		saut = p.ms(s)
	}
	fin, motif := finDeGlissade(c, debut, saut)
	if motif == "" {
		p.cov.SlowStarts++
		return p.accroupi(de, a, ti)
	}
	if p.cov.SlideEnds == nil {
		p.cov.SlideEnds = map[string]int{}
	}
	p.cov.SlideEnds[motif]++
	p.cov.Slides++
	out := []Stance{p.posture(types.MovementSlide, debut, fin, ti)}
	if a > fin {
		p.cov.CrouchesAfterSlide++
		out = append(out, p.accroupi(fin, a, ti)...)
	}
	return out
}

// debutDeGlissade rend l instant (ms) ou la pression devient une glissade, et faux pour un accroupi.
func (p *posturesDeControle) debutDeGlissade(ts uint64, de int64, ti int, c cinematique) (int64, bool) {
	recent, proche := p.etatDuSprint(p.tracks[ti].Slot, ts)
	if recent {
		return de, true
	}
	if !proche || !c.chuteA(de) {
		return 0, false
	}
	contact, ok := c.contactAuSol(de, de+contactAuSolMaxMS)
	if ok {
		p.cov.SlidesAfterFall++
	}
	return contact, ok
}

// finDeGlissade rend la fin (ms) d une glissade qui commence a `debut`, et son motif ; un motif vide
// quand la premiere vitesse lue est deja sous le seuil. `saut` est la prochaine impulsion du saut
// (ms), negative quand il n y en a pas.
func finDeGlissade(c cinematique, debut, saut int64) (int64, string) {
	limite, motif := debut+plafondGlissadeMS, finAuPlafond
	if c.fin() < limite {
		limite, motif = c.fin(), finDeLaVie
	}
	if saut > debut && saut < limite {
		limite, motif = saut, finParLeSaut
	}
	premiere := true
	for i := c.aPartirDe(debut); i < len(c.t) && c.t[i] <= limite; i++ {
		sol, _, ok := c.vitesse(i)
		if !ok {
			continue
		}
		if sol < vitesseFinDeGlissadeUS {
			if premiere {
				return debut, ""
			}
			return c.t[i], finParLaVitesse
		}
		premiere = false
	}
	return limite, motif
}

// accroupi rend l accroupi [de, a] de la vie `ti`, rien quand il est vide.
func (p *posturesDeControle) accroupi(de, a int64, ti int) []Stance {
	if a <= de {
		return nil
	}
	p.cov.Crouches++
	return []Stance{p.posture(types.MovementCrouch, de, a, ti)}
}

// posture rend l intervalle `kind` [de, a] (ms) de la vie `ti`, a la frame et a la milliseconde.
func (p *posturesDeControle) posture(kind string, de, a int64, ti int) Stance {
	return Stance{Slot: p.tracks[ti].Slot, Kind: kind, T0: p.frameDeMs(de, ti), T1: p.frameDeMs(a, ti),
		Ms0: &de, Ms1: &a}
}

// sprintsParSlot replie les lectures du sprint en intervalles par slot : ouvert a une lecture posee,
// ferme a la lecture levee suivante, ouvert jusqu a la fin du film sinon.
func sprintsParSlot(reads []types.MovementStateRead) map[uint32][][2]uint64 {
	parSlot := map[uint32][]types.MovementStateRead{}
	for _, r := range reads {
		if r.Kind == types.MovementSprint {
			parSlot[r.Slot] = append(parSlot[r.Slot], r)
		}
	}
	out := make(map[uint32][][2]uint64, len(parSlot))
	for slot, rs := range parSlot {
		slices.SortStableFunc(rs, func(a, b types.MovementStateRead) int { return cmp.Compare(a.TimestampUS, b.TimestampUS) })
		ouvert, depuis := false, uint64(0)
		for _, r := range rs {
			switch {
			case r.On && !ouvert:
				ouvert, depuis = true, r.TimestampUS
			case !r.On && ouvert:
				out[slot] = append(out[slot], [2]uint64{depuis, r.TimestampUS})
				ouvert = false
			}
		}
		if ouvert {
			out[slot] = append(out[slot], [2]uint64{depuis, ^uint64(0)})
		}
	}
	return out
}
