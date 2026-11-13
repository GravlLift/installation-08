package replay

// filmfacts_actions.go — LES ACTIONS DU JOUEUR DANS LE FICHIER DE FAITS (schema des faits 19) : les
// lectures du jeu d armes desire (`i42`) avec leurs denominateurs, puis les messages d action de la
// vue A, au complement de la section 1 ([encodeComplementDesEntrees]), avant le verdict du fil des
// morts.

import "github.com/JGtm/halo-infinite-film-decoder/types"

// Les drapeaux d un message d action dans le fichier de faits.
const (
	faHasActor byte = 1 << iota
	faHasOther
	faHasSource
)

// encodeActionsDuJoueur ecrit les lectures du jeu d armes (triees par instant, d ou le delta), leurs
// denominateurs, puis les messages d action (tries par instant).
func encodeActionsDuJoueur(w *gwriter, drawn []types.DrawnWeaponRead, st types.DrawnWeaponStats,
	actions []types.FilmActionMessage) {
	w.u(uint64(len(drawn)))
	var last uint64
	for _, d := range drawn {
		w.u(d.TimestampUS - last)
		last = d.TimestampUS
		w.u(uint64(d.Slot))
		w.byte8(byte(d.Principal))
		w.byte8(byte(d.Second))
	}
	for _, v := range [...]int{st.Read, st.SlotUnbound, st.Duplicates} {
		w.u(uint64(v))
	}
	w.u(uint64(len(actions)))
	last = 0
	for _, a := range actions {
		w.u(a.TimestampUS - last)
		last = a.TimestampUS
		w.byte8(a.Genre)
		var fl byte
		if a.HasActor {
			fl |= faHasActor
		}
		if a.HasOther {
			fl |= faHasOther
		}
		if a.HasSource {
			fl |= faHasSource
		}
		w.byte8(fl)
		w.u(uint64(a.Actor.Slot))
		w.u(uint64(a.Actor.Gen))
		w.u(uint64(a.Other.Slot))
		w.u(uint64(a.Other.Gen))
		w.u(uint64(a.Source))
	}
}

// decodeActionsDuJoueur relit ce qu [encodeActionsDuJoueur] ecrit ; une liste vide se relit nil.
func decodeActionsDuJoueur(r *greader) ([]types.DrawnWeaponRead, types.DrawnWeaponStats, []types.FilmActionMessage) {
	n := r.compte(4)
	drawn := make([]types.DrawnWeaponRead, 0, n)
	var last uint64
	for k := 0; k < n && r.err == nil; k++ {
		last += r.u()
		d := types.DrawnWeaponRead{TimestampUS: last, Slot: uint32(r.u())}
		d.Principal, d.Second = int8(r.byte8()), int8(r.byte8())
		drawn = append(drawn, d)
	}
	var st types.DrawnWeaponStats
	for _, p := range [...]*int{&st.Read, &st.SlotUnbound, &st.Duplicates} {
		*p = int(r.u())
	}
	n = r.compte(8)
	actions := make([]types.FilmActionMessage, 0, n)
	last = 0
	for k := 0; k < n && r.err == nil; k++ {
		last += r.u()
		a := types.FilmActionMessage{TimestampUS: last, Genre: r.byte8()}
		fl := r.byte8()
		a.HasActor, a.HasOther, a.HasSource = fl&faHasActor != 0, fl&faHasOther != 0, fl&faHasSource != 0
		a.Actor = types.LifeKey{Slot: uint32(r.u()), Gen: uint32(r.u())}
		a.Other = types.LifeKey{Slot: uint32(r.u()), Gen: uint32(r.u())}
		a.Source = uint32(r.u())
		actions = append(actions, a)
	}
	if len(drawn) == 0 {
		drawn = nil
	}
	if len(actions) == 0 {
		actions = nil
	}
	return drawn, st, actions
}
