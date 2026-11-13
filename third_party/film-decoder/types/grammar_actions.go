package types

// grammar_actions.go — LES ACTIONS DU JOUEUR QUE LE FILM ECRIT : le jeu d armes desire a chaque
// changement (composant i42 du bipede, trames delta) et les messages d action de la vue A (degats,
// rechargement, coup de corps a corps, lancer amorce).

// DrawnWeaponRead est UNE lecture du jeu d armes desire du bipede (`i42 biped-desired-weapon-set`,
// `FUN_1406d01fc`) dans une trame delta. Un delta ne porte `i42` que quand le jeu CHANGE : la suite
// des lectures d une vie est la suite de ses changements d arme.
type DrawnWeaponRead struct {
	// TimestampUS : l horodatage du paquet porteur, MEME horloge que BipedPosition.TimestampUS.
	TimestampUS uint64
	// Slot : le slot du bipede, comparable a BipedPosition.Slot.
	Slot uint32
	// Principal : l emplacement desire en main principale (0..3), egal a l emplacement degaine hors
	// d un changement en cours ; -1 quand le film n en ecrit aucun.
	Principal int8
	// Second : l emplacement desire en seconde main ; -1 hors ambidextrie.
	Second int8
}

// DrawnWeaponStats sont les denominateurs de la lecture du jeu d armes desire.
type DrawnWeaponStats struct {
	// Read : lectures retenues. SlotUnbound : lectures ecartees parce que leur slot n est pas lie au
	// bipede dans la table d entites de la marche. Duplicates : la meme lecture re-publiee par une
	// seconde traversee du meme record.
	Read, SlotUnbound, Duplicates int
}

// Les genres de [FilmActionMessage.Genre] que la grammaire garde (numerotation de `FUN_140e453b4`).
const (
	// FilmActionDamage : `damage_aftermath`.
	FilmActionDamage uint8 = 0
	// FilmActionReload : `weapon_reload`.
	FilmActionReload uint8 = 38
	// FilmActionThrowStart : `biped_throw_initiate`.
	FilmActionThrowStart uint8 = 39
	// FilmActionMelee : `biped_melee_initiate`.
	FilmActionMelee uint8 = 40
)

// FilmActionMessage est UN message d action de la vue A, avec la vie qu il designe :
//
//	genre 0   `damage_aftermath` : Actor l entite touchee (reference 0 ; un bipede, un vehicule
//	          ou un objet), Other le responsable (reference 1) ; Source la source du degat
//	genre 38  `weapon_reload` : Actor l unite qui recharge
//	genre 39  `biped_throw_initiate` : Actor le bipede qui amorce un lancer
//	genre 40  `biped_melee_initiate` : Actor le bipede qui frappe
//
// Les vies portent la base de leur domaine de reference (0x200 pour les domaines 0, 1, 2 et 4) :
// le slot est comparable a BipedPosition.Slot.
type FilmActionMessage struct {
	// TimestampUS : l horodatage du paquet porteur, MEME horloge que BipedPosition.TimestampUS.
	TimestampUS uint64
	// Genre est le genre du message (0, 38, 39 ou 40).
	Genre uint8
	// Actor : la vie que la reference 0 designe ; valide seulement si HasActor.
	Actor    LifeKey
	HasActor bool
	// Other : la vie que la reference 1 du genre 0 designe (le responsable) ; valide seulement si
	// HasOther.
	Other    LifeKey
	HasOther bool
	// Source : l identifiant `R(32)` de la source du degat (genre 0) ; valide seulement si
	// HasSource.
	Source    uint32
	HasSource bool
}
