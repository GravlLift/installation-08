package lecture

// MessageDAction est un message de la vue A qu'une action du joueur écrit, avec ses trois
// références et, pour `damage_aftermath` (genre 0, lecteur `FUN_1407f15a4`), la source `R(32)` de
// sa charge, gardée par sa porte ([ActionSourceLue]). Sur le genre 0, la réf. 0 désigne l'entité
// touchée et la réf. 1 le responsable (domaine 1).
//
// Les références sont les index BRUTS de leur domaine (`FUN_1406d3140`), sans base : la base
// appartient au domaine, et c'est le canal qui la pose.
//
// Seize octets : sa taille est gelée par `tailles_test.go`.
type MessageDAction struct {
	// Debut est le premier bit du message : le bit de continuation qui l'annonce.
	Debut uint32
	// Source est le `R(32)` de tête de la charge du genre 0 ([ActionSourceLue]).
	Source uint32
	// Ref sont les index des deux premières références ; Gen leurs générations (2 bits). La
	// troisième (domaine 7 sur les genres gardés) n'est pas gardée.
	Ref [2]uint16
	Gen [2]uint8
	// Genre est le genre du message.
	Genre uint8
	// Drapeaux : [ActionRef0], [ActionRef1], [ActionSourceLue].
	Drapeaux uint8
}

// Les drapeaux d'un [MessageDAction].
const (
	// ActionRef0, ActionRef1 : la porte de la référence est ouverte.
	ActionRef0 uint8 = 1 << iota
	ActionRef1
	// ActionSourceLue : la porte de la source du genre 0 est ouverte et son `R(32)` est lu.
	ActionSourceLue
)

// ADrapeau dit que le drapeau `d` est posé sur le message.
func (m MessageDAction) ADrapeau(d uint8) bool { return m.Drapeaux&d != 0 }
