// LOCAL-CHANGE (infinite-theater-3d): log and error strings translated to English.
package replay

// build_postures.go — LA PASSE DES POSTURES DE LA COMMANDE : accroupis, glissades et sauts lus dans la
// vue de controle (postures_de_controle.go), poses sur les vies publiees, et les sauts derives de la
// vitesse retires la ou la commande est connue.
//
// APRES LES VEHICULES (les episodes de montee ecartent les commandes d un occupant) et apres les
// gestes (les sauts rejoignent `actions[]`), AVANT `clore` (le repli des sauts derives y est publie).

import (
	"cmp"
	"log/slog"
	"slices"

	"github.com/JGtm/halo-infinite-film-decoder/internal/facts/fallback"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// fenetreSautDeriveUS : un saut derive est confirme par une impulsion du saut a moins de 300 ms.
const fenetreSautDeriveUS = 300_000

// poserLesPosturesDeControle publie les postures et les sauts de la commande.
func (a *assemblage) poserLesPosturesDeControle() {
	st := a.opt.ControlInputStats
	cov := &ControlStanceCoverage{Read: st.Scanned && a.places.cov.Read, Entries: st.Entries,
		Changes: st.Changes, Silences: st.Silences, SilenceMS: st.SilenceMS, Indexes: st.Indexes}
	cmds := lireLesCommandes(a.opt.ControlInputs)
	p := a.contexteDesPostures(cov)
	var postures []Stance
	var sauts []PlayerAction
	if cov.Read {
		postures, sauts = p.poserLesCommandes(cmds)
		p.poserLeStick(a.opt.ControlInputs)
	}
	derives := p.filtrerLesSautsDerives(a.doc.Stances, cmds)
	a.doc.Stances = append(derives, postures...)
	sortStances(a.doc.Stances)
	recompterLesPostures(a.doc.Stances, &a.stanceCov)
	a.stanceCov.Control = cov
	placesCov := a.places.cov
	a.doc.Coverage.ControlPlaces = &placesCov
	a.doc.Actions = append(a.doc.Actions, sauts...)
	sortPlayerActions(a.doc.Actions)
	a.opt.Fallbacks.DeclencheN(fallback.NomSautDeriveDeLaVitesse, cov.JumpsDerivedKept)
	slog.InfoContext(a.ctx, "replay: command postures",
		"read", cov.Read, "presses", cov.Presses, "crouches", cov.Crouches, "slides", cov.Slides,
		"slidesAfterFall", cov.SlidesAfterFall, "jumpPulses", cov.JumpPulses, "jumps", cov.Jumps,
		"noPlayer", cov.NoPlayer, "noLife", cov.NoLife, "inVehicle", cov.InVehicle,
		"noPosition", cov.NoPosition, "readByComponent", cov.ReadByComponent,
		"jumpsDerivedKept", cov.JumpsDerivedKept, "jumpsDerivedReplaced", cov.JumpsDerivedReplaced,
		"jumpsDerivedContradicted", cov.JumpsDerivedContradicted, "silenceMs", cov.SilenceMS,
		"stick", cov.StickSamples, "stickNoLife", cov.StickNoLife)
}

// contexteDesPostures rassemble ce que la pose lit du document.
func (a *assemblage) contexteDesPostures(cov *ControlStanceCoverage) *posturesDeControle {
	p := &posturesDeControle{places: a.places, occ: a.reg.Occupants(), horloge: a.horloge(),
		tracks: a.doc.Tracks, viesParSlot: map[uint32][]int{}, lues: map[int]bool{},
		sprints: sprintsParSlot(a.opt.MovementStates), montees: map[uint32][][2]int{},
		cin: map[int]cinematique{}, cov: cov}
	for ti, tr := range a.doc.Tracks {
		p.viesParSlot[tr.Slot] = append(p.viesParSlot[tr.Slot], ti)
	}
	for _, s := range a.doc.Stances {
		if s.Ms0 != nil || (s.Kind != types.MovementCrouch && s.Kind != types.MovementSlide) {
			continue // une posture de la commande n est pas une posture lue
		}
		if ti, ok := p.vieDuSlot(s.Slot, s.T0); ok {
			p.lues[ti] = true
		}
	}
	for _, v := range a.doc.Vehicles {
		for _, r := range v.Rides {
			p.montees[r.Slot] = append(p.montees[r.Slot], [2]int{r.T0, r.T1})
		}
	}
	return p
}

// vieDuSlot rend la vie publiee du slot qui couvre la frame.
func (p *posturesDeControle) vieDuSlot(slot uint32, fr int) (int, bool) {
	for _, ti := range p.viesParSlot[slot] {
		if fr >= p.tracks[ti].StartFrame && fr <= p.tracks[ti].EndFrame {
			return ti, true
		}
	}
	return 0, false
}

// poserLesCommandes pose les pressions et les impulsions de chaque place, dans l ordre des places.
func (p *posturesDeControle) poserLesCommandes(cmds map[int]*commandesDUnePlace) ([]Stance, []PlayerAction) {
	places := make([]int, 0, len(cmds))
	for pl := range cmds {
		places = append(places, pl)
	}
	slices.Sort(places)
	var postures []Stance
	var sauts []PlayerAction
	for _, pl := range places {
		cmd := cmds[pl]
		for _, pr := range cmd.pressions {
			p.cov.Presses++
			if ti, ok := p.resoudre(pl, pr.de); ok {
				postures = append(postures, p.poser(pr, cmd, ti)...)
			}
		}
		for _, s := range cmd.sauts {
			p.cov.JumpPulses++
			if ti, ok := p.resoudre(pl, s); ok {
				ms := p.ms(s)
				sauts = append(sauts, PlayerAction{T: p.frameDeMs(ms, ti), Ms: ms, Slot: p.tracks[ti].Slot, Kind: genreSaut})
				p.cov.Jumps++
			}
		}
	}
	return postures, sauts
}

// filtrerLesSautsDerives rend les postures sans les sauts derives que la commande remplace : un saut
// derive reste publie quand l etat de la commande de sa vie n est pas connu a son instant.
func (p *posturesDeControle) filtrerLesSautsDerives(stances []Stance, cmds map[int]*commandesDUnePlace) []Stance {
	out := stances[:0:0]
	for _, s := range stances {
		if s.Kind != types.MovementJumpDerived {
			out = append(out, s)
			continue
		}
		ts := p.horloge.origin + uint64(s.T0)*p.horloge.step //nolint:gosec // frame du document
		cmd, ok := p.commandeDe(s.Slot, s.T0, ts, cmds)
		if !ok || !cmd.connuA(ts) {
			p.cov.JumpsDerivedKept++
			out = append(out, s)
			continue
		}
		p.cov.JumpsDerivedReplaced++
		if !cmd.sautEntre(ts-min(ts, fenetreSautDeriveUS), ts+p.horloge.step+fenetreSautDeriveUS) {
			p.cov.JumpsDerivedContradicted++
		}
	}
	return out
}

// commandeDe rend les commandes de la place que tient, a la frame `fr`, le joueur du slot.
func (p *posturesDeControle) commandeDe(slot uint32, fr int, ts uint64, cmds map[int]*commandesDUnePlace) (*commandesDUnePlace, bool) {
	if !p.cov.Read {
		return nil, false
	}
	pi, ok := p.occ.indexA(slot, int64(ts)) //nolint:gosec // horloge du film
	if !ok {
		return nil, false
	}
	place, ok := p.places.placeDe(pi, fr)
	if !ok {
		return nil, false
	}
	cmd, ok := cmds[place]
	return cmd, ok
}

// recompterLesPostures pose dans la couverture les comptes des intervalles publies.
func recompterLesPostures(out []Stance, cov *StanceCoverage) {
	cov.Intervals = len(out)
	cov.ByKind = map[string]int{}
	lives := map[uint32]struct{}{}
	for _, s := range out {
		cov.ByKind[s.Kind]++
		lives[s.Slot] = struct{}{}
	}
	cov.Lives = len(lives)
	if len(cov.ByKind) == 0 {
		cov.ByKind = nil
	}
}

// sortPlayerActions ordonne les actions sur (ms, slot, genre) : un ordre total.
func sortPlayerActions(out []PlayerAction) {
	slices.SortStableFunc(out, func(a, b PlayerAction) int {
		return cmp.Or(cmp.Compare(a.Ms, b.Ms), cmp.Compare(a.Slot, b.Slot), cmp.Compare(a.Kind, b.Kind))
	})
}
