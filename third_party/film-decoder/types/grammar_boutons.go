package types

// grammar_boutons.go — LES BOUTONS DE POSTURE DU JOUEUR, TELS QUE LA VUE DE CONTROLE LES PORTE.
//
// # CE QUE LE FILM ECRIT
//
// L entree `kind 0` de chaque participant, dans la vue C de chaque trame delta, porte les drapeaux
// +0x14 du bloc de controle (`FUN_1406cd860`, R(1) puis R(5)) : la commande du joueur a ce tick, pas
// l etat de son bipede. Deux bits y sont identifies :
//
//	bit 0  le bouton d ACCROUPI, qui est aussi celui de la GLISSADE (le jeu n a qu un bouton pour
//	       les deux gestes ; la glissade est ce bouton presse pendant un sprint, juste apres, ou en
//	       l air juste avant d atterrir d un sprint)
//	bit 2  le bouton de SAUT : une impulsion d un tick
//
// Un champ +0x14 absent d une entree qui porte le bloc vaut ZERO, pas « inchange » : l impulsion du
// saut retombe au tick suivant. Une entree SANS bloc ne dit rien des boutons. Le meme bloc porte, sans
// porte, le COUPLE ANALOGIQUE du deplacement (`FUN_1406d6ef4`, deux R(6)), garde brut a cote.
//
// # CE QUI EST PUBLIE : DES CHANGEMENTS, ET LES PASSAGES OU L ETAT N EST PAS CONNU
//
// La lecture ne garde que les vues C FERMEES au bit. Chaque index ne rend qu un changement quand ses
// deux bits changent ; un silence (aucune entree lue de cet index pendant plus de
// `ControlButtonSilenceUS`) rend l etat INCONNU a partir de la derniere entree lue, jusqu a la
// suivante — jamais « relache ».

// Les bits de [ControlInputChange.Buttons] : ceux des drapeaux +0x14, a la meme place.
const (
	// ControlButtonCrouch : le bouton d accroupi et de glissade (bit 0 des drapeaux).
	ControlButtonCrouch uint8 = 1 << 0
	// ControlButtonJump : le bouton de saut (bit 2 des drapeaux).
	ControlButtonJump uint8 = 1 << 2
	// ControlButtonsKnown : les bits identifies ; les autres ne sont pas publies.
	ControlButtonsKnown = ControlButtonCrouch | ControlButtonJump
)

// ControlButtonSilenceUS est le silence au-dela duquel l etat des boutons d un index n est plus
// connu. Un joueur vivant a une entree par tick (17 ms a 60 Hz, 33 ms a 30 Hz) : 300 ms, c est neuf
// ticks d un film a 30 Hz sans aucune entree lue, assez court pour qu un accroupi tenu ne traverse
// pas une mort ou une deconnexion, assez long pour qu une trame non fermee isolee ne coupe rien.
const ControlButtonSilenceUS = 300_000

// ControlStickAbsent : la valeur d un axe du couple analogique quand l etat n est pas connu.
const ControlStickAbsent int8 = -1

// ControlInputChange est UN changement de l etat des boutons ou du couple analogique d un index de
// controle.
type ControlInputChange struct {
	// Index est l index de controle de l entree, R(5) : la PLACE du joueur, le meme espace que le
	// tireur d un record de tir (`FireEvent.FilmIndex`), pas l index du roster.
	Index int
	// TimestampUS est l instant du paquet de l entree qui etablit l etat ; pour un passage inconnu,
	// celui de la derniere entree lue avant le silence.
	TimestampUS uint64
	// Buttons sont les bits identifies des drapeaux de l entree ([ControlButtonsKnown]) ; zero sur un
	// passage inconnu.
	Buttons uint8
	// Stick est le couple analogique de l entree (`FUN_1406d6ef4`), BRUT : deux scalaires R(6),
	// codes 0 et 62 aux bornes, 31 au zero exact ; [ControlStickAbsent] sur un passage inconnu.
	// Un changement du couple seul est un changement.
	Stick [2]int8
	// Unknown dit qu a partir de cet instant l etat de l index n est plus connu, jusqu a son
	// prochain changement.
	Unknown bool
}

// ControlInputStats dit ce que la lecture des boutons a vu.
type ControlInputStats struct {
	// Scanned : la marche des trames a eu lieu.
	Scanned bool
	// Entries : entrees de controle lues dans des vues C fermees ; WithoutBlock, celles qui ne
	// portent pas le bloc de controle et ne disent donc rien des boutons ; WithFlags, celles dont les
	// drapeaux +0x14 sont presents.
	Entries, WithoutBlock, WithFlags int
	// Changes : changements connus publies ; Silences : passages inconnus ouverts par un silence
	// (la fin du film n en est pas un) ; SilenceMS : leur duree totale, de la derniere entree lue a
	// la suivante.
	Changes, Silences int
	SilenceMS         int64
	// Indexes : index de controle distincts lus.
	Indexes int
}
