// Package himap — glb_images_externes.go : les images d'un GLB sorties dans des fichiers a part.
//
// Les pieces d'armure partagent leurs textures (une surface dure cuite est la meme d'une piece a
// l'autre : memes masques, meme image). Plutot que d'en copier les octets dans chaque GLB, chaque
// image passe au depot de l'appelant, qui la range une fois et rend son URI ; l'image du document
// devient `{"uri": ..., "mimeType": ...}` et ses octets quittent le bloc binaire. Un lecteur glTF
// (three.js GLTFLoader) resout une URI relative contre l'URL du GLB : le GLB se charge tel quel si
// les images sont servies a cote de lui.
//
// Le document est relu en JSON generique (nombres gardes en texte) : la passe ne depend pas de
// l'ecrivain, et tout champ qu'elle ne connait pas passe tel quel.
package himap

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
)

// DepotImage range les octets d'une image encodee et rend l'URI sous laquelle le GLB la nommera.
type DepotImage func(donnees []byte, mime string) (uri string, err error)

// ErrGLBIllisible : les octets ne sont pas un GLB a deux blocs (JSON puis binaire).
var ErrGLBIllisible = errors.New("himap: GLB illisible")

// ExterniseImagesGLB rend le GLB dont chaque image a ete deposee par `depot`, et le nombre d'images
// deposees. Un GLB sans image est rendu tel quel. Une vue de tampon partagee entre une image et un
// accesseur est refusee (aucun ecrivain du paquet n'en produit).
func ExterniseImagesGLB(glb []byte, depot DepotImage) ([]byte, int, error) {
	doc, bin, err := ouvreGLB(glb)
	if err != nil {
		return nil, 0, err
	}
	images, _ := doc["images"].([]any)
	if len(images) == 0 {
		return glb, 0, nil
	}
	vues, _ := doc["bufferViews"].([]any)
	retirees := map[int]bool{}
	for i, im := range images {
		img, _ := im.(map[string]any)
		bv, ok := entier(img["bufferView"])
		if _, externe := img["uri"]; !ok && externe {
			continue
		}
		if !ok || bv < 0 || bv >= len(vues) {
			return nil, 0, fmt.Errorf("%w : image %d sans vue de tampon lisible", ErrGLBIllisible, i)
		}
		donnees, err := octetsDeVue(vues[bv], bin)
		if err != nil {
			return nil, 0, err
		}
		mime, _ := img["mimeType"].(string)
		uri, err := depot(donnees, mime)
		if err != nil {
			return nil, 0, fmt.Errorf("depot de l'image %d : %w", i, err)
		}
		delete(img, "bufferView")
		img["uri"] = uri
		retirees[bv] = true
	}
	if len(retirees) == 0 {
		return glb, 0, nil
	}
	nouveau, err := compacteTampon(doc, vues, bin, retirees)
	if err != nil {
		return nil, 0, err
	}
	var out bytes.Buffer
	if err := ecritGLBGenerique(&out, doc, nouveau); err != nil {
		return nil, 0, err
	}
	return out.Bytes(), len(retirees), nil
}

// ouvreGLB rend le document JSON (nombres en texte) et le bloc binaire d'un GLB.
func ouvreGLB(glb []byte) (map[string]any, []byte, error) {
	if len(glb) < 20 || binary.LittleEndian.Uint32(glb) != glbMagic {
		return nil, nil, fmt.Errorf("%w : en-tete", ErrGLBIllisible)
	}
	lj := int(binary.LittleEndian.Uint32(glb[12:]))
	if binary.LittleEndian.Uint32(glb[16:]) != glbChunkJSON || 20+lj > len(glb) {
		return nil, nil, fmt.Errorf("%w : bloc JSON", ErrGLBIllisible)
	}
	dec := json.NewDecoder(bytes.NewReader(glb[20 : 20+lj]))
	dec.UseNumber()
	var doc map[string]any
	if err := dec.Decode(&doc); err != nil {
		return nil, nil, fmt.Errorf("%w : %w", ErrGLBIllisible, err)
	}
	var bin []byte
	if o := 20 + lj; o+8 <= len(glb) {
		lb := int(binary.LittleEndian.Uint32(glb[o:]))
		if binary.LittleEndian.Uint32(glb[o+4:]) != glbChunkBIN || o+8+lb > len(glb) {
			return nil, nil, fmt.Errorf("%w : bloc binaire", ErrGLBIllisible)
		}
		bin = glb[o+8 : o+8+lb]
	}
	return doc, bin, nil
}

// entier lit un nombre JSON entier.
func entier(v any) (int, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	i, err := n.Int64()
	return int(i), err == nil
}

// octetsDeVue rend les octets d'une vue de tampon dans le bloc binaire.
func octetsDeVue(v any, bin []byte) ([]byte, error) {
	vue, _ := v.(map[string]any)
	off, _ := entier(vue["byteOffset"])
	n, ok := entier(vue["byteLength"])
	if !ok || off < 0 || n < 0 || off+n > len(bin) {
		return nil, fmt.Errorf("%w : vue de tampon hors du bloc binaire", ErrGLBIllisible)
	}
	return bin[off : off+n], nil
}

// compacteTampon retire les vues `retirees` du document et rend le bloc binaire des vues gardees,
// chacune alignee sur 4 octets ; les accesseurs et images sont renumerotes.
func compacteTampon(doc map[string]any, vues []any, bin []byte, retirees map[int]bool) ([]byte, error) {
	accesseurs, _ := doc["accessors"].([]any)
	for _, a := range accesseurs {
		acc, _ := a.(map[string]any)
		if bv, ok := entier(acc["bufferView"]); ok && (retirees[bv] || bv < 0 || bv >= len(vues)) {
			return nil, fmt.Errorf("%w : vue %d d'accesseur retiree ou hors du document", ErrGLBIllisible, bv)
		}
	}
	rang := make([]int, len(vues))
	var gardees []any
	var out []byte
	for i, v := range vues {
		rang[i] = -1
		if retirees[i] {
			continue
		}
		donnees, err := octetsDeVue(v, bin)
		if err != nil {
			return nil, err
		}
		vue, _ := v.(map[string]any)
		vue["byteOffset"] = json.Number(fmt.Sprint(len(out)))
		out = append(out, donnees...)
		out = completeA4(out, 0)
		rang[i] = len(gardees)
		gardees = append(gardees, vue)
	}
	for _, a := range accesseurs {
		acc, _ := a.(map[string]any)
		if bv, ok := entier(acc["bufferView"]); ok {
			acc["bufferView"] = json.Number(fmt.Sprint(rang[bv]))
		}
	}
	doc["bufferViews"] = gardees
	buffers, _ := doc["buffers"].([]any)
	tampon, _ := premier(buffers).(map[string]any)
	if len(buffers) != 1 || tampon == nil {
		return nil, fmt.Errorf("%w : %d tampons (un attendu)", ErrGLBIllisible, len(buffers))
	}
	tampon["byteLength"] = json.Number(fmt.Sprint(len(out)))
	return out, nil
}

// premier rend le premier element, nil pour une liste vide.
func premier(l []any) any {
	if len(l) == 0 {
		return nil
	}
	return l[0]
}

// ecritGLBGenerique ecrit un document generique et son bloc binaire (ecritConteneurGLB).
func ecritGLBGenerique(w *bytes.Buffer, doc map[string]any, bin []byte) error {
	js, err := json.Marshal(doc)
	if err != nil {
		return fmt.Errorf("json glTF : %w", err)
	}
	t := &tamponGLB{}
	t.ajoute(bin)
	return ecritConteneurGLB(w, js, t)
}
