// Package himap — couches_noms.go : les couches d'un shader de niveau, lues par les NOMS de ses
// parametres.
//
// Le materiau (`mat `) ne porte que des valeurs : des textures rangees par emplacement et un
// tableau de constantes. Le shader (`shdv`) qu'il reference declare ses parametres : un nom
// (hache), un type et un octet dans ce tableau ; pour une texture, cet octet est son emplacement.
// Les shaders de niveau sont generes d'un meme gabarit : la couleur de la couche 2 porte le meme
// nom dans tous, quel que soit son octet. Les noms ci-dessous ont ete releves sur les shaders
// dont ekur connait la disposition, ou ils tombent tous sur l'octet attendu.
//
// La transformation de coordonnees d'une texture ne vient pas d'un parametre : l'entree de la
// texture dans le postprocess nomme son registre (16 o : echelle x, y, decalage x, y).
package himap

import "fmt"

// GroupeShader : le groupe de tag des shaders de materiau.
const GroupeShader = "shdv"

const (
	shdvChampParametres = 0x2c
	shdvStrideParametre = 0x9c
	shdvParamOffNom     = 0x00
	shdvParamOffOctet   = 0x94
	tailleRegistre      = 16
	// nomMasqueMacro : l'emplacement du masque macro (vert : couche 2, bleu : 3, alpha : 4).
	nomMasqueMacro = 0xcfcbadae
)

// ParametresShader : l'octet de chaque parametre d'un shader, par nom hache.
type ParametresShader map[uint32]int

// nomsCouche : les noms des parametres d'une couche. `couleur` fait une couche `rohm`, `paquet`
// une couche `nnhg` (sa carte porte la normale et le degrade), `controle` seul une couche `rohg`
// (sa carte porte le degrade). Zero : nom non releve.
type nomsCouche struct {
	couleur, controle, normale, paquet uint32
	teinte, haut, milieu, bas          uint32
	opacite, intensiteNormale          uint32
	melange, melangeNormale            uint32
	// indiceRouge : pour une couche degrade, l'indice est le rouge de la carte de controle, pas
	// son alpha (shaders de vegetation : alpha constant, degrade porte en rouge).
	indiceRouge bool
}

// nomsCouches : couches 1 a 4. La premiere n'a ni opacite ni melange : elle couvre tout.
var nomsCouches = [4]nomsCouche{
	{couleur: 0xebbbce3b, controle: 0x49fdc1af, normale: 0x4b754b0a,
		teinte: 0x53baddf0, haut: 0x45fe7d90, milieu: 0x5272a790, bas: 0xcf7592b5, intensiteNormale: 0x47d33e47},
	{couleur: 0x1658b054, controle: 0x0a8bf561, normale: 0x332d6690,
		teinte: 0xf1e7a002, haut: 0x3dfb6756, milieu: 0xcc9ff14e, bas: 0x4f9d5a71,
		opacite: 0x54c818bf, intensiteNormale: 0x0d56658c, melange: 0x586c6957, melangeNormale: 0xff2f1e87},
	{couleur: 0x0cb63c48, controle: 0x416e176b, normale: 0xfb908ccc, paquet: 0x62de5bb4,
		teinte: 0x4cca90e4, haut: 0x85bddf0e, milieu: 0xccd1b28d, bas: 0xe14a260c,
		opacite: 0x7ae3dd24, intensiteNormale: 0xa5b351b9, melange: 0x9bd27baf, melangeNormale: 0xa6188c3c},
	{couleur: 0xfeca70dc, controle: 0x8be09a25, normale: 0x415276ee, paquet: 0xba7d759c,
		teinte: 0x59658921, haut: 0x1888aaa0, milieu: 0x23a074e4, bas: 0x241609a5,
		opacite: 0x29a9a5a1, intensiteNormale: 0x5226be68, melange: 0x83f6ca94, melangeNormale: 0xa357229f},
}

// nomsSurfaces : les shaders a UNE surface, hors du gabarit des couches de niveau, lus sur le 1er
// jeu de coordonnees (le seul que portent leurs maillages). Un nom est le murmur3 de son texte :
// le texte est donne quand il est connu ; sinon le parametre a ete reconnu au format de la
// texture qu'il lie (normale BC5 signee ; controle BC7, occlusion en vert, alpha du degrade).
var nomsSurfaces = []nomsCouche{
	// `base_*` : un degrade choisi par l'alpha de la carte de controle (`rohg`).
	{controle: 0xf925b13f, normale: 0x87794a55,
		haut: 0x17986f67, milieu: 0x997879ce, bas: 0x9e4aff11, // base_top_color, base_mid_color, base_bottom_color
		intensiteNormale: 0xbfd10cd8}, // base_normal_intensity
	// `surface_*` : une carte de couleur teintee.
	{couleur: 0x9d92f94d, teinte: 0xf6746e7b, // surface_color_map_texture, surface_color_tint
		normale: 0xd014dac9, controle: 0x255bb2ea},
	// Une carte de couleur sans teinte (feuille de motifs), meme normale et meme controle.
	{couleur: 0x82303557, normale: 0xd014dac9, controle: 0x255bb2ea},
	// Atlas de feuillage : couleur et normale reconnus au contenu des textures liees.
	{couleur: 0xca775400, normale: 0x0d66c9ce},
	// Structure Forge : couleur de base a l'emplacement 4 (nom non resolu, reconnu au contenu), normale et intensite `base_*`.
	{couleur: 0xc8ddb4d2, normale: 0x87794a55, intensiteNormale: 0xbfd10cd8},
	// Atlas de panneaux : carte de couleur et normale de base.
	{couleur: 0xdaef076c, normale: 0x87794a55, intensiteNormale: 0xbfd10cd8},
	// Vegetation et sol sans carte de couleur : un degrade choisi par le ROUGE de la carte de
	// controle (nom non resolu, reconnu a la texture liee ; mesure sur Aquarius, l'alpha est
	// constant et le rouge porte le degrade). Le shader declare aussi `surface_color_tint`, non lu.
	{controle: 0x33056de0, normale: 0x0d66c9ce, // -, surface_normal_map
		haut: 0x2427bd73, milieu: 0x4dd1036e, bas: 0x36d57828, // top_color, mid_color, bottom_color
		intensiteNormale: 0x09dad903, indiceRouge: true}, // surface_normal_intensity
}

// surfaceParNoms lit la surface d'un shader a une surface : la premiere forme de nomsSurfaces
// dont le materiau lie la texture principale ; nil sinon.
func surfaceParNoms(params ParametresShader, pp postprocessLu) *Couches {
	c := lecteurConstantes(pp.constantes)
	for _, n := range nomsSurfaces {
		if k, ok := n.lit(params, pp, c, true, true); ok {
			return &Couches{JeuUV: jeuUVDiffus, Couches: []Couche{k}}
		}
	}
	return nil
}

// LitParametresShader lit les parametres declares d'un tag `shdv` deja decompresse.
func LitParametresShader(tag []byte) (ParametresShader, error) {
	for _, ti := range tagCandidates(tag) {
		offs, targets, err := ti.rootBlockRefs()
		if err != nil {
			continue
		}
		out := ParametresShader{}
		for i, o := range offs {
			if o != shdvChampParametres || targets[i] < 0 || targets[i] >= ti.dataBlocks {
				continue
			}
			abs, size := ti.blockAbs(targets[i])
			if abs < 0 || abs+size > len(tag) || size%shdvStrideParametre != 0 {
				return nil, fmt.Errorf("himap: %s : bloc des parametres de %#x o", GroupeShader, size)
			}
			for k := 0; k < size; k += shdvStrideParametre {
				out[uint32(u32(tag, abs+k+shdvParamOffNom))] = int(u16(tag, abs+k+shdvParamOffOctet))
			}
		}
		return out, nil
	}
	return nil, fmt.Errorf("himap: tag %s illisible", GroupeShader)
}

// couchesParNoms lit les couches d'un shader de niveau, ou a defaut sa surface unique
// (surfaceParNoms) : nil si le shader ne nomme ni couche ni surface, ou si aucune n'a sa texture
// dans le materiau. Une couche sans texture est omise.
func couchesParNoms(params ParametresShader, pp postprocessLu) *Couches {
	if out := couchesDeNiveau(params, pp); out != nil {
		return out
	}
	return surfaceParNoms(params, pp)
}

// couchesDeNiveau lit les couches du gabarit de niveau (nomsCouches) et le masque macro.
func couchesDeNiveau(params ParametresShader, pp postprocessLu) *Couches {
	c := lecteurConstantes(pp.constantes)
	out := &Couches{JeuUV: jeuUVNiveau}
	if o, ok := params[nomMasqueMacro]; ok {
		out.Masque = pp.textures[o]
	}
	for i, n := range nomsCouches {
		if k, ok := n.lit(params, pp, c, i == 0, false); ok {
			k.Hauteur = litHauteur(nomsHauteur[i], params, c, i == 0)
			if k.Sorte == CoucheDegrade {
				k.Matiere = litMatiere(nomsMatiere[i], params, c)
			}
			if i < 2 && k.Sorte == CoucheCouleur && k.Hauteur != nil && k.Controle == 0 {
				if o, ok := params[[2]uint32{0xff6c550e, 0x9e2295b4}[i]]; ok {
					k.Controle = pp.textures[o]
					k.TransfoControle = pp.transfo(o, c)
				}
			}
			out.Couches = append(out.Couches, k)
		}
	}
	if len(out.Couches) == 0 {
		return nil
	}
	return out
}

// lit rend la couche, ok=false quand le shader ne la declare pas ou que le materiau ne lie pas
// sa texture principale. Pour une surface (nomsSurfaces), l'entree est la famille du shader :
// une entree dont le principal est une carte de couleur ne se reconnait pas sur sa carte de
// controle secondaire (partagee entre familles de shaders), seule une forme rohg, dont la
// controle EST le principal, lit sa couche sur la controle.
func (n nomsCouche) lit(params ParametresShader, pp postprocessLu, c lecteurConstantes, premiere, surface bool) (Couche, bool) {
	texture := func(nom uint32) (uint32, Transfo, bool) {
		o, ok := params[nom]
		if nom == 0 || !ok {
			return 0, transfoNeutre, false
		}
		id, ok := pp.textures[o]
		return id, pp.transfo(o, c), ok
	}
	octet := func(nom uint32) (int, bool) { return octetParam(params, nom) }
	k := Couche{Opacite: 1}
	switch {
	case n.aTexture(texture, n.couleur):
		k.Sorte = CoucheCouleur
		k.Bitmap, k.Transfo, _ = texture(n.couleur)
		k.Teinte = [3]float32{1, 1, 1}
		if o, ok := octet(n.teinte); ok {
			k.Teinte = c.rgb(o)
		}
		k.Normale, k.TransfoNormale, _ = texture(n.normale)
		k.Controle, k.TransfoControle, _ = texture(n.controle)
	case n.aTexture(texture, n.paquet):
		k.Sorte = CoucheDegrade
		k.Bitmap, k.Transfo, _ = texture(n.paquet)
		k.Normale, k.TransfoNormale = k.Bitmap, k.Transfo
	case n.aTexture(texture, n.controle) && (!surface || (n.couleur == 0 && n.paquet == 0)):
		k.Sorte = CoucheDegrade
		k.Bitmap, k.Transfo, _ = texture(n.controle)
		k.Controle, k.TransfoControle = k.Bitmap, k.Transfo
		k.Normale, k.TransfoNormale, _ = texture(n.normale)
	default:
		return Couche{}, false
	}
	if k.Sorte == CoucheDegrade {
		k.IndiceRouge = n.indiceRouge
		for _, d := range []struct {
			nom  uint32
			dest *[3]float32
		}{{n.haut, &k.Haut}, {n.milieu, &k.Milieu}, {n.bas, &k.Bas}} {
			if o, ok := octet(d.nom); ok {
				*d.dest = c.rgb(o)
			}
		}
	}
	if o, ok := octet(n.intensiteNormale); ok {
		k.IntensiteNormale = min(max(c.f(o), 0), intensiteNormaleMax)
	}
	if !premiere {
		n.litFondu(&k, params, c)
	}
	return k, true
}

// octetParam rend l'octet de constante d'un parametre nomme du shader ; ok=false pour un nom nul
// ou que le shader ne declare pas.
func octetParam(params ParametresShader, nom uint32) (int, bool) {
	o, ok := params[nom]
	return o, nom != 0 && ok
}

// litFondu lit comment une couche au-dessus de la premiere se fond dans les precedentes : son
// opacite (gardee dans [-1, 1]) et ses modes de melange, couleur et normale.
func (n nomsCouche) litFondu(k *Couche, params ParametresShader, c lecteurConstantes) {
	if o, ok := octetParam(params, n.opacite); ok {
		if a := c.f(o); a >= -1 && a <= 1 {
			k.Opacite = a
		}
	}
	if o, ok := octetParam(params, n.melange); ok {
		k.Melange = c.mode(o)
	}
	if o, ok := octetParam(params, n.melangeNormale); ok {
		k.MelangeNormale = c.mode(o)
	}
}

func (n nomsCouche) aTexture(texture func(uint32) (uint32, Transfo, bool), nom uint32) bool {
	_, _, ok := texture(nom)
	return ok
}

// transfo rend la transformation de la texture de l'emplacement `o` : neutre quand son entree
// ne nomme aucun registre.
func (pp postprocessLu) transfo(o int, c lecteurConstantes) Transfo {
	r, ok := pp.transfos[o]
	if !ok || r < 0 {
		return transfoNeutre
	}
	return c.transfo(r * tailleRegistre)
}
