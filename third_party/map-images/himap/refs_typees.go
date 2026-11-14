// Package himap — refs_typees.go (LOCAL-CHANGE (infinite-theater-3d)) : les references de tag
// d'une definition d'objet Forge (`food`), lues comme des references et non comme des entiers.
//
// Une reference de tag porte le GlobalID de sa cible puis, `refOffGroupe` octets plus loin, le
// fourCC du groupe de la cible, ecrit a l'envers (meme forme que la reference rtgo d'une
// representation, refsRepresentations). Un entier de propriete qui tombe par hasard sur le
// GlobalID d'un tag connu n'a pas ce fourCC a cote de lui. La lecture par simple balayage des
// octets (RefsInline) prenait la valeur 121 (0x79) des records de proprietes des generateurs
// d'objets pour le `scen` 0x00000079 des globals : chaque socle d'arme, de grenade et
// d'equipement posait alors le modele de ce decor (une boite de 114 triangles) a sa place. Sur
// les 4 235 definitions du module Forge, exiger le fourCC ne change le modele que de ces quatre
// types de generateur ; les 4 116 autres modeles resolus restent identiques.
package himap

// refOffGroupe : l'ecart entre le GlobalID d'une reference de tag et le fourCC de son groupe.
const refOffGroupe = 0xc

// refsTypeesDuGroupe rend, dans l'ordre du tag et sans doublon, les GlobalID du groupe donne
// que le tag reference vraiment : la valeur se resout dans l'index vers ce groupe ET le fourCC
// de ce groupe suit a refOffGroupe.
func refsTypeesDuGroupe(tag []byte, idx *ModuleIndex, groupe string) []uint32 {
	var out []uint32
	vus := map[uint32]bool{}
	for o := 0; o+refOffGroupe+4 <= len(tag); o += 4 {
		h := uint32(u32(tag, o))
		if vus[h] || groupeInverse(tag[o+refOffGroupe:o+refOffGroupe+4]) != groupe {
			continue
		}
		if g, _, ok := idx.Lookup(h); ok && g == groupe {
			vus[h] = true
			out = append(out, h)
		}
	}
	return out
}
