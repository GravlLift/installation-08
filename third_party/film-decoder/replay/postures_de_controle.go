package replay

// postures_de_controle.go — ACCROUPI, GLISSADE ET SAUT, LUS DANS LA COMMANDE DU JOUEUR (schema 111).
//
// # CE QUE LE FILM ECRIT
//
// La vue de controle porte, par place de controle et par tick, les boutons du joueur
// (`types.ControlInputChange`) : le bit d accroupi, qui est aussi celui de la glissade, et
// l impulsion du saut. Le film ne porte pas la posture du bipede sur les builds recents (`i29` et
// `i62` n y sont annonces par aucun masque) : c est la commande qui la dit.
//
// # LA REGLE
//
// Une PRESSION du bouton d accroupi, posee sur la vie de son joueur a cet instant
// (places_de_controle.go), est une GLISSADE si un sprint lu (`i57`) est actif, ou fini depuis au plus
// [glissadeApresSprintMS] ; ou si la vie chute a la pression, a moins de [glissadeEnChuteApresSprintMS]
// d un sprint, et touche le sol dans les [contactAuSolMaxMS] : la glissade commence alors au contact.
// Sinon c est un ACCROUPI, de la pression au relachement.
//
// Une glissade finit au premier echantillon dont la vitesse au sol passe sous
// [vitesseFinDeGlissadeUS], au saut suivant, a la fin de la vie, ou a [plafondGlissadeMS] ; le jeu la
// poursuit apres le relachement, d ou une fin lue dans la vitesse. Un bouton encore tenu a cet instant
// prolonge la posture en accroupi jusqu au relachement. Une glissade dont la premiere vitesse lue est
// deja sous le seuil n en est pas une : c est un accroupi, compte.
//
// Un SAUT est l instant d une impulsion du bit de saut.
//
// Rien n est pose sur une vie qui n est pas a pied : en vehicule (`vehicles[].rides`), ou sans
// position de bipede a moins de [presencePositionMS] de l instant (un occupant que la primitive des
// montees n a pas attribue ne replique plus sa position). Une vie dont la posture est LUE (`i29`,
// `i62`, builds anciens) garde cette lecture : la commande n y ajoute ni accroupi ni glissade.
//
// PUR : aucune I/O.

import (
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

const (
	// seuilChuteUS : la vitesse verticale sous laquelle une vie chute, en unites par seconde.
	seuilChuteUS = -0.6
	// demiFenetreChuteMS : la chute se lit dans les 100 ms qui entourent la pression.
	demiFenetreChuteMS = 50
	// glissadeApresSprintMS : une pression jusqu a 250 ms apres la fin d un sprint glisse encore.
	glissadeApresSprintMS = 250
	// glissadeEnChuteApresSprintMS : une pression en l air glisse a l atterrissage si un sprint a eu
	// lieu dans les 1,5 s.
	glissadeEnChuteApresSprintMS = 1500
	// contactAuSolMaxMS : l atterrissage d une pression en l air se cherche sur une seconde.
	contactAuSolMaxMS = 1000
	// vitesseFinDeGlissadeUS : la vitesse au sol de la course stick plein (p50 mesure sans drapeau).
	vitesseFinDeGlissadeUS = 2.45
	// plafondGlissadeMS : la plus longue glissade publiee.
	plafondGlissadeMS = 1600
	// presencePositionMS : une commande ne se pose que sur une vie qui replique sa position a moins
	// de 250 ms.
	presencePositionMS = 250
)

// Les motifs de fin d une glissade (`coverage.stances.control.slideEnds`).
const (
	finParLaVitesse = "speed"
	finParLeSaut    = "jump"
	finAuPlafond    = "cap"
	finDeLaVie      = "lifeEnd"
)

// genreSaut est le genre d action d un saut lu (`actions[].kind`).
const genreSaut = "jump"

// ControlStanceCoverage dit ce que la commande a donne aux postures (`coverage.stances.control`).
type ControlStanceCoverage struct {
	// Read : la vue de controle a ete balayee ET les places de controle lues sur ce film.
	Read bool `json:"read"`
	// Entries, Changes, Silences, SilenceMS, Indexes : les comptes de la lecture
	// (`types.ControlInputStats`) ; SilenceMS est le temps ou l etat d un index n etait pas connu.
	Entries   int   `json:"entries"`
	Changes   int   `json:"changes"`
	Silences  int   `json:"silences"`
	SilenceMS int64 `json:"silenceMs"`
	Indexes   int   `json:"indexes"`
	// Presses : pressions du bouton d accroupi lues ; JumpPulses : impulsions du saut lues.
	Presses    int `json:"presses"`
	JumpPulses int `json:"jumpPulses"`
	// Crouches, Slides : intervalles publies ; SlidesAfterFall : glissades ouvertes a l atterrissage ;
	// CrouchesAfterSlide : accroupis qui prolongent une glissade ; SlowStarts : pressions sous sprint
	// rendues en accroupi faute de vitesse ; Jumps : sauts publies.
	Crouches           int `json:"crouches"`
	Slides             int `json:"slides"`
	SlidesAfterFall    int `json:"slidesAfterFall"`
	CrouchesAfterSlide int `json:"crouchesAfterSlide"`
	SlowStarts         int `json:"slowStarts"`
	Jumps              int `json:"jumps"`
	// SlideEnds compte les glissades par motif de fin : speed, jump, cap, lifeEnd.
	SlideEnds map[string]int `json:"slideEnds,omitempty"`
	// Les pressions et impulsions ECARTEES, par raison : NoPlayer (l index n est tenu par aucun
	// joueur lu a cet instant), NoLife (aucune vie publiee du joueur ne couvre l instant), InVehicle,
	// NoPosition (aucune position du bipede a moins de 250 ms), ReadByComponent (la vie porte une
	// posture lue ; pressions seulement).
	NoPlayer        int `json:"noPlayer"`
	NoLife          int `json:"noLife"`
	InVehicle       int `json:"inVehicle"`
	NoPosition      int `json:"noPosition"`
	ReadByComponent int `json:"readByComponent"`
	// Les sauts DERIVES de la vitesse (`jumpDerived`) : Kept, ceux publies faute de commande connue a
	// leur instant (repli `repli_saut_derive_de_la_vitesse`) ; Replaced, ceux retires parce que la
	// commande etait connue ; Contradicted, parmi ces derniers, ceux sans impulsion du saut a moins
	// de 300 ms.
	JumpsDerivedKept         int `json:"jumpsDerivedKept"`
	JumpsDerivedReplaced     int `json:"jumpsDerivedReplaced"`
	JumpsDerivedContradicted int `json:"jumpsDerivedContradicted"`
	// LE STICK DE DEPLACEMENT (schema 114, stick_de_deplacement.go) : StickSamples, les echantillons
	// publies dans `tracks[].fullRate` ; StickNoLife, les changements qu aucune vie publiee ne recoit
	// (place sans joueur, joueur sans vie a cet instant).
	StickSamples int `json:"stickSamples"`
	StickNoLife  int `json:"stickNoLife"`
}

// pressionLue est une pression du bouton d accroupi d une place, de son instant a son relachement
// (ou a la derniere entree lue avant un silence), en microsecondes du film.
type pressionLue struct {
	de, a uint64
}

// commandesDUnePlace sont les pressions, les impulsions du saut et les intervalles ou l etat est
// connu, d une place.
type commandesDUnePlace struct {
	pressions []pressionLue
	sauts     []uint64
	connus    [][2]uint64
}

// etatDeLecture est l etat courant d une place pendant [lireLesCommandes].
type etatDeLecture struct {
	connu    bool
	depuis   uint64
	boutons  uint8
	pression uint64
}

// lireLesCommandes replie les changements (tries par instant) en commandes par place.
func lireLesCommandes(ch []types.ControlInputChange) map[int]*commandesDUnePlace {
	out := map[int]*commandesDUnePlace{}
	etats := map[int]*etatDeLecture{}
	for _, c := range ch {
		cmd, st := out[c.Index], etats[c.Index]
		if cmd == nil {
			cmd, st = &commandesDUnePlace{}, &etatDeLecture{}
			out[c.Index], etats[c.Index] = cmd, st
		}
		if c.Unknown {
			cmd.cesser(st, c.TimestampUS)
			continue
		}
		if !st.connu {
			st.connu, st.depuis, st.boutons = true, c.TimestampUS, 0
		}
		cmd.appliquer(st, c)
	}
	return out
}

// cesser rend l etat inconnu a l instant `ts` : l intervalle connu et la pression en cours s y ferment.
func (cmd *commandesDUnePlace) cesser(st *etatDeLecture, ts uint64) {
	if !st.connu {
		return
	}
	cmd.connus = append(cmd.connus, [2]uint64{st.depuis, ts})
	if st.boutons&types.ControlButtonCrouch != 0 {
		cmd.pressions = append(cmd.pressions, pressionLue{de: st.pression, a: ts})
	}
	st.connu, st.boutons = false, 0
}

// appliquer pose un etat connu : ouvre ou ferme la pression, note l impulsion du saut.
func (cmd *commandesDUnePlace) appliquer(st *etatDeLecture, c types.ControlInputChange) {
	avant, apres := st.boutons, c.Buttons
	switch {
	case apres&types.ControlButtonCrouch != 0 && avant&types.ControlButtonCrouch == 0:
		st.pression = c.TimestampUS
	case apres&types.ControlButtonCrouch == 0 && avant&types.ControlButtonCrouch != 0:
		cmd.pressions = append(cmd.pressions, pressionLue{de: st.pression, a: c.TimestampUS})
	}
	if apres&types.ControlButtonJump != 0 && avant&types.ControlButtonJump == 0 {
		cmd.sauts = append(cmd.sauts, c.TimestampUS)
	}
	st.boutons = apres
}

// connuA dit que l etat de la place est connu a l instant `ts`.
func (cmd *commandesDUnePlace) connuA(ts uint64) bool {
	for _, iv := range cmd.connus {
		if ts >= iv[0] && ts <= iv[1] {
			return true
		}
	}
	return false
}

// sautEntre dit qu une impulsion du saut tombe dans [de, a].
func (cmd *commandesDUnePlace) sautEntre(de, a uint64) bool {
	for _, s := range cmd.sauts {
		if s >= de && s <= a {
			return true
		}
	}
	return false
}

// sautApres rend la premiere impulsion du saut strictement apres `ts`.
func (cmd *commandesDUnePlace) sautApres(ts uint64) (uint64, bool) {
	for _, s := range cmd.sauts {
		if s > ts {
			return s, true
		}
	}
	return 0, false
}
