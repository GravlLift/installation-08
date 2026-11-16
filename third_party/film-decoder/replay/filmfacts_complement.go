package replay

// filmfacts_complement.go — LOCAL-CHANGE (infinite-theater-3d): the complement of section 1, moved out of
// filmfacts_fichier.go unchanged (plus the attach reads of facts schema 24) to keep that file under its
// 500-line cap.

// encodeComplementDesEntrees / decodeComplementDesEntrees : ce que la section 1 porte APRES le blob
// des entrees, dans l ORDRE du format — une seule ecriture, une seule lecture (les tests qui
// fabriquent une section 1 passent par elles).
//
//	canaux gardes     `FlagMarks`, `ZoneReads`/`ZoneScanned`/`ZoneKeyReads`, la jauge, `BombReads`
//	entites           les occupants du match (lot M2.2)
//	temoin            l inventaire NUL (illisible) ou non (lot J3.6, RA1-2) : le blob relit toute
//	d inventaire      liste en tranche VIDE, or `Inventory == nil` est une garde de calque
//	poussees          les poussees d equipement et leurs denominateurs (schema des faits 12)
//	equipement porte  les lectures des objets portes et leurs denominateurs (schema des faits 13)
//	actions           le jeu d armes desire et les messages d action de la vue A (schema des faits 19)
//	boutons           les boutons de controle et le couple analogique (schema des faits 20)
//	attaches          les attaches des projectiles qui collent (schema des faits 24, filmfacts_attaches.go)
//	verdict           le verdict du fil des morts (lot M8), EN DERNIER
func encodeComplementDesEntrees(w *gwriter, g *FilmFacts) {
	encodeGardesDeMode(w, g.FilmInputs)
	encodeEntitesDesJoueurs(w, g.PlayerEntities)
	w.bool8(g.Inventory != nil)
	encodePoussees(w, g.Knockbacks, g.KnockbackStats)
	encodeEquipementPorte(w, g.CarriedEquipment, g.CarriedEquipmentStats)
	encodeActionsDuJoueur(w, g.DrawnWeapons, g.DrawnWeaponStats, g.Actions)
	encodeBoutonsDeControle(w, g.ControlInputs, g.ControlInputStats)
	encodeAttachesDeProjectile(w, g.ProjectileAttaches) // LOCAL-CHANGE (infinite-theater-3d), schema 24
	encodeVerdictDuFilDesMorts(w, g.DeathsFeed)
}

func decodeComplementDesEntrees(r *greader, g *FilmFacts) {
	decodeGardesDeMode(r, &g.FilmInputs)
	g.PlayerEntities = decodeEntitesDesJoueurs(r)
	if !r.bool8() {
		g.Inventory = nil
	}
	g.Knockbacks, g.KnockbackStats = decodePoussees(r)
	g.CarriedEquipment, g.CarriedEquipmentStats = decodeEquipementPorte(r)
	g.DrawnWeapons, g.DrawnWeaponStats, g.Actions = decodeActionsDuJoueur(r)
	g.ControlInputs, g.ControlInputStats = decodeBoutonsDeControle(r)
	g.ProjectileAttaches = decodeAttachesDeProjectile(r) // LOCAL-CHANGE (infinite-theater-3d), schema 24
	g.DeathsFeed = decodeVerdictDuFilDesMorts(r)
}
