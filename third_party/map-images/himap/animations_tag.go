// Package himap — animations_tag.go : la navigation de la struct-table d'un graphe d'animation
// `jmad`, ou tout passe par des liens entre data-blocks.
//
// Trois sortes de liens portent la structure du graphe (mesures sur les `jmad` 6514a7e3 et
// 000033ce) :
//
//	struct de type 1 (TagBlock)  : le bloc proprietaire porte a `champ` un TagBlock dont le
//	                               contenu est le bloc `cible`
//	struct de type 3 (ressource) : une ressource de tag « eclatee » dans le tag : son
//	                               enregistrement racine est le bloc `cible`
//	reference de donnees (0x14 o) : { +8 bloc cible, +0xC bloc proprietaire, +0x10 champ } ; le
//	                               champ (24 o) du proprietaire designe les octets du bloc cible
//
// La table des references de donnees suit la struct-table ; son compte est a -0x14 du couple
// (headerSize, dataSize) de l'en-tete, comme les comptes de dependances, blocs et structs.
package himap

import "fmt"

// Liens de la struct-table.
const (
	lienTypeTagBlock  = 1
	lienTypeRessource = 3

	refDonneesStride      = 0x14
	refDonneesOffCible    = 0x08
	refDonneesOffProprio  = 0x0C
	refDonneesOffChamp    = 0x10
	enteteOffCompteRefs   = 0x14 // a rebours du couple (headerSize, dataSize)
	enteteOffBlocsDepuisH = 0x18 // la table des blocs suit le couple et les dependances
)

// lienTag : un lien de la struct-table ou de la table des references de donnees.
type lienTag struct {
	champ, cible int
}

// navigateurTag : les liens d'un tag rangés par bloc proprietaire et par sorte.
type navigateurTag struct {
	ti         tagInfo
	blocs      map[int][]lienTag // TagBlock (type 1)
	ressources map[int][]lienTag // ressources eclatees (type 3)
	donnees    map[int][]lienTag // references de donnees
}

// nouveauNavigateur lit en une passe la struct-table et la table des references de donnees.
func nouveauNavigateur(tag []byte) (*navigateurTag, error) {
	ti, err := meilleurTagInfo(tag)
	if err != nil {
		return nil, err
	}
	n := &navigateurTag{ti: ti, blocs: map[int][]lienTag{}, ressources: map[int][]lienTag{}, donnees: map[int][]lienTag{}}
	for i := 0; i < ti.structs; i++ {
		b := ti.structTab + i*structEntrySize
		l := lienTag{champ: u32(tag, b+0x1C), cible: i32(tag, b+0x14)}
		proprio := i32(tag, b+0x18)
		switch u16(tag, b+0x10) {
		case lienTypeTagBlock:
			n.blocs[proprio] = append(n.blocs[proprio], l)
		case lienTypeRessource:
			n.ressources[proprio] = append(n.ressources[proprio], l)
		}
	}
	h := ti.blockTab - enteteOffBlocsDepuisH - ti.deps*depEntrySize
	if h < enteteOffCompteRefs {
		return nil, fmt.Errorf("en-tete de tag : table des blocs a %#x, avant le couple de tailles", ti.blockTab)
	}
	refs := u32(tag, h-enteteOffCompteRefs)
	debut := ti.structTab + ti.structs*structEntrySize
	if refs < 0 || debut+refs*refDonneesStride > ti.headerSize {
		return nil, fmt.Errorf("table des references de donnees (%d) hors de l'en-tete", refs)
	}
	for i := 0; i < refs; i++ {
		r := debut + i*refDonneesStride
		proprio := i32(tag, r+refDonneesOffProprio)
		n.donnees[proprio] = append(n.donnees[proprio], lienTag{champ: u32(tag, r+refDonneesOffChamp), cible: i32(tag, r+refDonneesOffCible)})
	}
	return n, nil
}

// racine rend le bloc de l'enregistrement racine du tag.
func (n *navigateurTag) racine() (int, error) { return n.ti.rootBlockIndex() }

// octets rend le contenu d'un data-block, ou nil hors bornes.
func (n *navigateurTag) octets(bloc int) []byte {
	if bloc < 0 || bloc >= n.ti.dataBlocks {
		return nil
	}
	abs, taille := n.ti.blockAbsSection(bloc)
	if abs < 0 || taille < 0 || abs+taille > len(n.ti.tag) {
		return nil
	}
	return n.ti.tag[abs : abs+taille]
}

// tagBlock rend le bloc du TagBlock que `proprio` porte au champ `champ`, -1 quand il est vide.
func (n *navigateurTag) tagBlock(proprio, champ int) int {
	for _, l := range n.blocs[proprio] {
		if l.champ == champ {
			return l.cible
		}
	}
	return -1
}

// compte rend le compte du TagBlock que `proprio` porte au champ `champ` (u32 a +16 du champ).
func (n *navigateurTag) compte(proprio, champ int) int {
	b := n.octets(proprio)
	if champ < 0 || champ+tagBlockCountOffset+4 > len(b) {
		return 0
	}
	return u32(b, champ+tagBlockCountOffset)
}

// enregistrements rend le bloc du TagBlock (`proprio`, `champ`), son compte et son pas ; une
// taille de bloc qui n'est pas un multiple du compte est une erreur (le pas serait faux).
func (n *navigateurTag) enregistrements(proprio, champ, pasAttendu int) ([]byte, int, error) {
	bloc := n.tagBlock(proprio, champ)
	nb := n.compte(proprio, champ)
	if bloc < 0 || nb == 0 {
		return nil, 0, nil
	}
	b := n.octets(bloc)
	if len(b) != nb*pasAttendu {
		return nil, 0, fmt.Errorf("bloc du champ %#x : %d octets pour %d enregistrements de %d", champ, len(b), nb, pasAttendu)
	}
	return b, nb, nil
}
