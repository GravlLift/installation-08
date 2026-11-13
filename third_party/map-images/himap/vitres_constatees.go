// Package himap — vitres_constatees.go : les materiaux dont l'aspect en jeu tranche la question
// « vitre ou non » quand leurs marqueurs lus (`Materiau.Verre`, `PasseTransparente`) se trompent.
//
// Deux erreurs connues. Des vitres dessinees par un shader propre a une carte, qui ne declare
// pas le bloc verre et dont rien dans le tag ne dit la transparence. Et des surfaces opaques
// dessinees par un shader a bloc verre : leurs reglages sont ceux d'une vraie vitre, seul le
// masque de couches (texture de l'emplacement 0) differe.
//
// Chaque entree est un constat dans le jeu, pas une deduction : on n'y ajoute qu'un materiau vu
// en jeu, designe dans la vue 3D par l'inspecteur de surfaces (Alt+clic, poste de
// developpement).
package himap

// vitresConstatees : GlobalID `mat ` -> vitre (true) ou surface opaque (false).
var vitresConstatees = map[uint32]bool{
	0x669f626c: true,  // Recharge : vitres du grenier et vitre avant de la turbine (shader 377bfad9)
	0x8bc0a3d0: false, // Recharge : angle du bassin, cote porte des tuyaux orange (shader ff2a209d)
}

// shadersVitres : les shaders dont tout materiau constate en jeu est une vitre (sept constats sur
// deux cartes, aucune paroi opaque). Un constat par materiau de vitresConstatees l'emporte.
var shadersVitres = map[uint32]bool{
	0x71ea41c5: true,
}
