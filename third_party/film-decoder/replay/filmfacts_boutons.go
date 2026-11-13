package replay

// filmfacts_boutons.go — LES BOUTONS DE CONTROLE DANS LE FICHIER DE FAITS (schema des faits 20) : les
// changements des boutons d accroupi et de saut et du couple analogique de chaque index de controle
// (`types.ControlInputChange`), puis leurs denominateurs, au complement de la section 1
// ([encodeComplementDesEntrees]), apres les actions du joueur.

import "github.com/JGtm/halo-infinite-film-decoder/types"

// fbInconnu : le bit de l octet des boutons qui marque un passage inconnu. Les bits identifies des
// drapeaux (`types.ControlButtonsKnown`) sont sous lui.
const fbInconnu byte = 1 << 7

// encodeBoutonsDeControle ecrit les changements (tries par instant, d ou le delta) et leurs comptes.
func encodeBoutonsDeControle(w *gwriter, ch []types.ControlInputChange, st types.ControlInputStats) {
	w.u(uint64(len(ch)))
	var last uint64
	for _, c := range ch {
		w.u(c.TimestampUS - last)
		last = c.TimestampUS
		w.byte8(byte(c.Index)) //nolint:gosec // R(5)
		b := c.Buttons
		if c.Unknown {
			b |= fbInconnu
		}
		w.byte8(b)
		w.byte8(byte(c.Stick[0])) //nolint:gosec // R(6) ou -1
		w.byte8(byte(c.Stick[1])) //nolint:gosec // R(6) ou -1
	}
	w.bool8(st.Scanned)
	for _, v := range [...]int{st.Entries, st.WithoutBlock, st.WithFlags, st.Changes, st.Silences, st.Indexes} {
		w.u(uint64(v)) //nolint:gosec // compte positif
	}
	w.u(uint64(st.SilenceMS)) //nolint:gosec // duree positive
}

// decodeBoutonsDeControle relit ce qu [encodeBoutonsDeControle] ecrit ; une liste vide se relit nil.
func decodeBoutonsDeControle(r *greader) ([]types.ControlInputChange, types.ControlInputStats) {
	n := r.compte(5)
	ch := make([]types.ControlInputChange, 0, n)
	var last uint64
	for k := 0; k < n && r.err == nil; k++ {
		last += r.u()
		c := types.ControlInputChange{TimestampUS: last, Index: int(r.byte8())}
		b := r.byte8()
		c.Buttons, c.Unknown = b&^fbInconnu, b&fbInconnu != 0
		c.Stick = [2]int8{int8(r.byte8()), int8(r.byte8())} //nolint:gosec // relu tel qu ecrit
		ch = append(ch, c)
	}
	var st types.ControlInputStats
	st.Scanned = r.bool8()
	for _, p := range [...]*int{&st.Entries, &st.WithoutBlock, &st.WithFlags, &st.Changes, &st.Silences, &st.Indexes} {
		*p = int(r.u()) //nolint:gosec // compte relu
	}
	st.SilenceMS = int64(r.u()) //nolint:gosec // duree relue
	if len(ch) == 0 {
		ch = nil
	}
	return ch, st
}
