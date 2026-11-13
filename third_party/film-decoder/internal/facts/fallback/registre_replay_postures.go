package fallback

// registre_replay_postures.go — le repli du SAUT publie au rejeu (`replay/build_postures.go`).
//
// LA LECTURE QUE CE REPLI REMPLACE QUAND ELLE MANQUE. Un saut est l impulsion du bouton de saut que la
// vue de controle porte pour la place du joueur (`replay/postures_de_controle.go`). Le saut derive de
// la vitesse verticale (`jumpDerived`, reconnu a la hauteur integree d `i1`) n est publie que la ou
// l etat de cette commande n est pas connu.
var registreReplayPostures = []Repli{
	{
		Nom:  NomSautDeriveDeLaVitesse,
		Fait: "l instant d un saut d une vie publiee",
		Mecanisme: "l integrale de la vitesse verticale d `i1` reconnue a sa hauteur (`stances[]` de genre " +
			"`jumpDerived`) est publiee quand l etat de la commande de la place du joueur n est pas connu a " +
			"son instant (silence de la vue de controle, place non lue, film sans lecture des places) ; " +
			"ailleurs le saut est l impulsion lue (`actions[]` de genre `jump`) et le derive est retire",
		// LA LECTURE QUI MANQUE est l etat de la commande : une place que les tirs n ont liee a aucun
		// joueur, un index que la vue de controle a tu plus de 300 ms, un film dont l index de tireur
		// n est pas la place.
		Condition: CondLectureNonPortee,
		Ordre:     OrdreApresLecture,
		Sites: []Site{
			{Fichier: pkgReplay + "build_postures.go", Ancre: "a.opt.Fallbacks.DeclencheN(fallback.NomSautDeriveDeLaVitesse, cov.JumpsDerivedKept)"},
		},
		DatePose:     "2026-11-09",
		CibleRetrait: "la lecture des places de controle sur les films ou l index de tireur n est pas la place",
		CritereRetrait: "coverage.stances.control.jumpsDerivedKept a 0 sur le corpus du gate de rejeu (un temoin " +
			"par build) : le saut n est plus jamais derive",
		CompteurBranche: true,
	},
}
