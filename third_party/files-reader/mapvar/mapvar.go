// Package mapvar — mapvar.go : grammaire métier d'une variante de carte (.mvar).
//
// Grammaire ÉTABLIE sur pièces (cf. tests sur fixtures breaker/cliffhanger) :
//
//	root[1]                  en-tête de carte (root[1][0][0] = identifiant de niveau)
//	root[3]                  liste des objets placés
//	root[6]                  tables de regroupement (non exploitées ici)
//	root[10][1]              table des chaînes lisibles (paires nom d'instance / préfab)
//	root[11]                 surcharges de propriétés indexées (non exploitées ici)
//
// Par objet (root[3][i]) :
//
//	[2][0]     type_id int32  (identifiant de type d'objet Forge)
//	[3]        position  vec3 (repère monde, mètres — même repère que les positions joueur)
//	[4]        vecteur up
//	[5]        vecteur forward
//	[7]        flags uint8
//	[8]        sac de propriétés — voir gameplayBag ci-dessous
//	[10][0]    identifiant d'instance int32
//
// Sac de propriétés #8, sous-arbre gameplay ([0] → liste de 1 struct) :
//
//	[0][0]     sac de FORME (famille + dimensions) — voir shape.go
//	[1]        catégorie int
//	[8]        index d'équipe (0 / 1) — ABSENT si l'objet n'est pas d'équipe
//	[9]        liste de labels ; chaque entrée est un struct{0: hash int32}
//
// Sac de propriétés #8, hors sous-arbre gameplay :
//
//	[4][0][0]  StringId de lieu (zones nommées) — voir readLocationID
//	[23][0][0] échelle vec3 par axe local (avant, gauche, haut) — ABSENTE quand l'objet garde
//	           l'échelle de son type
//
// Le hash de label est un murmur3_x86_32(seed=0) du nom snake_case du label
// (CRAQUÉ : murmur3("stockpile_socket") == 2110778921, valeur observée telle quelle
// dans ctf_breaker.mvar). Voir objectives.go pour la table de résolution.
package mapvar

import "fmt"

// Vec3 est une position ou une direction en repère monde.
type Vec3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

// TeamUnset marque un objet sans index d'équipe.
const TeamUnset = -1

// Object est un objet placé par la variante de carte.
type Object struct {
	Index   int
	StyleID *int32
	// RepresentationID est le hash du nom choisi au chemin 8/24[0]/1/0, nil quand absent.
	RepresentationID *int32
	TypeID           int32
	Pos              Vec3
	Up               Vec3
	Forward          Vec3
	Flags            uint8
	Category         int
	TeamIndex        int
	Labels           []int32
	InstanceID       int32
	// ShapeRaw : les entiers du sac de forme, non convertis. nil quand l'objet
	// n'a pas de forme (cas normal des objectifs ponctuels). Voir shape.go —
	// la conversion en mètres passe par Object.Shape().
	ShapeRaw *ShapeRaw
	// LocationID : le StringId de LIEU porte au chemin `#8/4[]/0/0`. Non nul sur les seuls
	// objets « zone nommee » (TypeID `TypeIDZoneNommee`), il se resout contre le tableau du
	// tag global `locs` — le MEME vocabulaire que les callouts des cartes natives (mesure du
	// 2026-08-27 : 439 des 463 chaines connues y figurent, et 18/18 des StringId d Isolation
	// s y resolvent).
	//
	// POURQUOI PERSONNE NE L AVAIT VU : un balayage d entiers LE32 du fichier rend ZERO
	// occurrence — les entiers Bond sont des varint zigzag, il faut decoder l arbre. D ou
	// l affirmation, longtemps ecrite dans nos en-tetes, qu une carte Forge n a pas de
	// callouts. Elle est FAUSSE : le zero ne vaut que pour les CANEVAS.
	LocationID uint32
	// Scale : l'échelle de l'objet par axe local (X avant, Y gauche, Z haut), au chemin
	// `#8/23[0]/0`. nil quand l'objet n'en porte pas : il garde l'échelle unitaire de son type.
	Scale *Vec3
}

// Variant est une variante de carte décodée.
type Variant struct {
	Objects []Object
	Styles  map[int32][]StyleLayer
	Names   []string // root[10][1] : chaînes lisibles, ordre du fichier
	LevelID int32    // root[1][0][0]
}

// Parse décode un .mvar complet.
func Parse(buf []byte) (*Variant, error) {
	root, err := DecodeRoot(buf)
	if err != nil {
		return nil, fmt.Errorf("mapvar: %w", err)
	}
	v := &Variant{Styles: readStyles(root)}
	if hdr, ok := root.Field(1); ok {
		if sub, ok2 := hdr.Field(0); ok2 {
			if id, ok3 := sub.Field(0); ok3 {
				v.LevelID = int32(id.Int)
			}
		}
	}
	if names, ok := root.Field(10); ok {
		if lst, ok2 := names.Field(1); ok2 {
			for _, it := range lst.Items {
				v.Names = append(v.Names, it.Str)
			}
		}
	}
	objs, ok := root.Field(3)
	if !ok {
		return nil, fmt.Errorf("mapvar: champ racine 3 (objets) absent")
	}
	v.Objects = make([]Object, 0, len(objs.Items))
	for i, raw := range objs.Items {
		v.Objects = append(v.Objects, parseObject(i, raw))
	}
	return v, nil
}

func parseObject(index int, raw Value) Object {
	o := Object{Index: index, TeamIndex: TeamUnset, Category: -1}
	if t, ok := raw.Field(2); ok {
		if id, ok2 := t.Field(0); ok2 {
			o.TypeID = int32(id.Int)
		}
	}
	o.Pos = readVec(raw, 3)
	o.Up = readVec(raw, 4)
	o.Forward = readVec(raw, 5)
	if f, ok := raw.Field(7); ok {
		o.Flags = uint8(f.Uint)
	}
	if inst, ok := raw.Field(10); ok {
		if v, ok2 := inst.Field(0); ok2 {
			o.InstanceID = int32(v.Int)
		}
	}
	if bag, ok := raw.Field(8); ok {
		readGameplayBag(&o, bag)
	}
	return o
}

// readGameplayBag lit le sous-arbre gameplay du sac #8 : catégorie, index d'équipe
// et labels de mode de jeu.
func readGameplayBag(o *Object, bag Value) {
	o.LocationID = readLocationID(bag)
	o.Scale = readScale(bag)
	if liste, ok := bag.Field(24); ok && len(liste.Items) > 0 {
		if ref, ok := liste.Items[0].Field(1); ok {
			if id, ok := ref.Field(0); ok {
				n := int32(id.Int)
				o.RepresentationID = &n
			}
		}
	}
	sub, ok := bag.Field(0)
	if !ok || len(sub.Items) == 0 {
		return
	}
	gp := sub.Items[0]
	if ref, ok := gp.Field(13); ok {
		if id, ok := ref.Field(0); ok {
			n := int32(id.Int)
			o.StyleID = &n
		}
	}
	o.ShapeRaw = readShape(gp)
	if c, ok := gp.Field(1); ok {
		o.Category = int(c.Int)
	}
	if t, ok := gp.Field(8); ok {
		o.TeamIndex = int(t.Int)
	}
	if lbls, ok := gp.Field(9); ok {
		for _, entry := range lbls.Items {
			if h, ok2 := entry.Field(0); ok2 {
				o.Labels = append(o.Labels, int32(h.Int))
			}
		}
	}
}

// readLocationID lit le StringId de lieu du sac #8, au chemin `4[]/0/0`.
//
// CHEMIN UNIQUE, MESURE : sur les 257 variantes du dump, `root/3[]/8/4[]/0/0` porte 4 151
// occurrences et aucun autre chemin n en porte, a une exception pres (`root/3[]/10/0`, une
// seule, sur `chasm`). La liste `#4` ne contient qu un element sur toutes les zones vues ;
// on lit le premier et on ne suppose rien des suivants.
func readLocationID(bag Value) uint32 {
	lst, ok := bag.Field(4)
	if !ok || len(lst.Items) == 0 {
		return 0
	}
	st, ok := lst.Items[0].Field(0)
	if !ok {
		return 0
	}
	sid, ok := st.Field(0)
	if !ok {
		return 0
	}
	return uint32(sid.Int)
}

// readScale lit l'échelle par axe du sac #8, au chemin `23[0]/0` ; nil sans elle.
func readScale(bag Value) *Vec3 {
	lst, ok := bag.Field(23)
	if !ok || len(lst.Items) == 0 {
		return nil
	}
	if _, ok := lst.Items[0].Field(0); !ok {
		return nil
	}
	s := readVec(lst.Items[0], 0)
	return &s
}

func readVec(raw Value, field uint16) Vec3 {
	v, ok := raw.Field(field)
	if !ok {
		return Vec3{}
	}
	var out Vec3
	if c, ok := v.Field(0); ok {
		out.X = c.Float
	}
	if c, ok := v.Field(1); ok {
		out.Y = c.Float
	}
	if c, ok := v.Field(2); ok {
		out.Z = c.Float
	}
	return out
}

// StyleLayer décrit une couche et sa teinte facultative.
type StyleLayer struct {
	Hash   int32
	Tint   *Vec3
	Scalar float64
}

func readStyles(root Value) map[int32][]StyleLayer {
	out := map[int32][]StyleLayer{}
	styles, _ := root.Field(8)
	for _, style := range styles.Items {
		ident, ok := style.Field(1)
		if !ok {
			continue
		}
		id, ok := ident.Field(0)
		if !ok {
			continue
		}
		var layers []StyleLayer
		first, ok := style.Field(3)
		if !ok {
			out[int32(id.Int)] = layers
			continue
		}
		ref, ok := first.Field(1)
		if !ok {
			out[int32(id.Int)] = layers
			continue
		}
		if _, ok = ref.Field(0); !ok {
			out[int32(id.Int)] = layers
			continue
		}
		for n := uint16(3); n <= 6; n++ {
			l, ok := style.Field(n)
			if !ok {
				continue
			}
			h, ok := l.Field(1)
			if !ok {
				continue
			}
			h, ok = h.Field(0)
			if !ok {
				continue
			}
			layer := StyleLayer{Hash: int32(h.Int)}
			if tint, ok := l.Field(2); ok && len(tint.Fields) > 0 {
				v := readVec(l, 2)
				layer.Tint = &v
			}
			if scalar, ok := l.Field(3); ok {
				layer.Scalar = scalar.Float
			}
			layers = append(layers, layer)
		}
		out[int32(id.Int)] = layers
	}
	return out
}
