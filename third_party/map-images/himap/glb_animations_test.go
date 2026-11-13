package himap

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
	"testing"
)

// modeleDeDeux : le squelette de deux os de TestEcritGLBPeau, trois sommets.
func modeleDeDeux() *ModeleAPeau {
	return &ModeleAPeau{
		Maillage: &MaillageMonde{Structure: GroupeMaillage{
			Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 0, 1},
			Indices: map[uint32][]uint32{0xA: {0, 1, 2}},
		}},
		Noeuds:     squeletteDeDeux(),
		Noms:       []string{"b_pedestal", "b_pelvis"},
		Influences: []Influences{{Poids: [OsParSommet]float32{1}}, {Poids: [OsParSommet]float32{1}}, {Os: [OsParSommet]uint16{1}, Poids: [OsParSommet]float32{1}}},
	}
}

// clipDeDeux : trois images ; la racine a une rotation statique (90 degres autour de Z Halo),
// l'enfant une rotation et une translation animees, sa derniere rotation ecrite dans l'hemisphere
// oppose ; deplacement de racine de 0,02 u par image en X Halo.
func clipDeDeux() *ClipAnimation {
	s := math.Sqrt(0.5)
	return &ClipAnimation{
		Graphe: 0x33ce, Animation: AnimationGraphe{Rang: 13, Mouvement: MouvementDxDy, Cap: [3]float64{1, 0, 0}},
		Codec: CodecQuantifie, Images: 3,
		Os: []PisteOs{
			{Rotations: [][4]float64{{0, 0, s, s}}},
			{
				Rotations:    [][4]float64{{0, 0, 0, 1}, {s, 0, 0, s}, {0, 0, 0, -1}},
				Translations: [][3]float64{{0, 0, 1}, {0, 0, 1.1}, {0, 0, 1.2}},
			},
		},
		Deplacement: [][4]float64{{0.02, 0, 0, 0}, {0.02, 0, 0, 0}, {0.02, 0, 0, 0}},
	}
}

// litGLB rend le document et le bloc binaire d'un GLB.
func litGLB(t *testing.T, b []byte) (gltfDoc, []byte) {
	t.Helper()
	n := int(binary.LittleEndian.Uint32(b[12:]))
	var doc gltfDoc
	if err := json.Unmarshal(bytes.TrimRight(b[20:20+n], " "), &doc); err != nil {
		t.Fatalf("JSON glTF : %v", err)
	}
	return doc, b[20+n+8:]
}

// flottants lit les valeurs d'un accesseur flottant, ou d'entiers 16 bits normalises.
func flottants(doc gltfDoc, data []byte, acc int) []float32 {
	a := doc.Accessors[acc]
	v := doc.BufferViews[a.BufferView]
	if a.ComponentType == glComponentI16 && a.Normalized {
		out := make([]float32, v.ByteLength/2)
		for i := range out {
			out[i] = float32(float64(int16(binary.LittleEndian.Uint16(data[v.ByteOffset+2*i:]))) / quantumRotation16)
		}
		return out
	}
	out := make([]float32, v.ByteLength/4)
	for i := range out {
		out[i] = math.Float32frombits(binary.LittleEndian.Uint32(data[v.ByteOffset+4*i:]))
	}
	return out
}

// TestEcritGLBPeauAnime : une animation glTF nommee, un canal par piste vers le bon os, entrees aux
// temps strictement croissants, comptes des accesseurs, axes glTF, hemisphere des quaternions,
// deplacement de racine dans les extras.
func TestEcritGLBPeauAnime(t *testing.T) {
	var buf bytes.Buffer
	if err := EcritGLBPeauAnime(&buf, modeleDeDeux(), []ClipGLB{{Nom: "marche", Clip: clipDeDeux(), Chemin: "a / b"}}, "test", nil); err != nil {
		t.Fatal(err)
	}
	doc, data := litGLB(t, buf.Bytes())
	if len(doc.Animations) != 1 || doc.Animations[0].Name != "marche" {
		t.Fatalf("animations %+v", doc.Animations)
	}
	a := doc.Animations[0]
	type cle struct {
		noeud  int
		chemin string
	}
	attendus := map[cle]int{{1, cheminRotation}: 1, {2, cheminRotation}: 3, {2, cheminTranslation}: 3}
	if len(a.Channels) != len(attendus) || len(a.Samplers) != len(attendus) {
		t.Fatalf("%d canaux, %d echantillonneurs", len(a.Channels), len(a.Samplers))
	}
	for _, c := range a.Channels {
		n, ok := attendus[cle{c.Target.Node, c.Target.Path}]
		if !ok {
			t.Fatalf("canal inattendu %+v", c.Target)
		}
		s := a.Samplers[c.Sampler]
		entree, sortie := doc.Accessors[s.Input], doc.Accessors[s.Output]
		if s.Interpolation != interpolationLin || entree.Count != n || sortie.Count != n || entree.Type != typeScalaire {
			t.Fatalf("canal %+v : entree %+v, sortie %+v", c.Target, entree, sortie)
		}
		if rot := c.Target.Path == cheminRotation; rot != (sortie.ComponentType == glComponentI16 && sortie.Normalized) {
			t.Fatalf("canal %+v : sortie %+v (rotations en i16 normalises, le reste en flottants)", c.Target, sortie)
		}
		temps := flottants(doc, data, s.Input)
		for k := 1; k < len(temps); k++ {
			if temps[k] <= temps[k-1] {
				t.Fatalf("temps non croissants %v", temps)
			}
		}
		if len(entree.Min) != 1 || entree.Min[0] != 0 || len(entree.Max) != 1 || entree.Max[0] != temps[len(temps)-1] {
			t.Fatalf("bornes de l'entree %+v, temps %v", entree, temps)
		}
		if n == 3 && math.Abs(float64(temps[2])-2.0/ImagesParSecondeAnimation) > 1e-6 {
			t.Fatalf("temps %v a %d images par seconde", temps, ImagesParSecondeAnimation)
		}
		verifieSortie(t, c.Target, flottants(doc, data, s.Output))
	}
	ex, ok := a.Extras[CleAnimationGLB].(map[string]any)
	if !ok {
		t.Fatalf("extras %+v", a.Extras)
	}
	dep, _ := ex["rootMotion"].([]any)
	if len(dep) != 3 || ex["graph"] != "000033ce" || ex["index"] != float64(13) || ex["frameCount"] != float64(3) || ex["path"] != "a / b" {
		t.Fatalf("extras %+v", ex)
	}
	if d0, _ := dep[0].([]any); len(d0) != 3 || d0[0] != 0.02 || d0[1] != float64(0) || d0[2] != float64(0) {
		t.Fatalf("deplacement %v (0,02 u en X Halo = X glTF)", dep[0])
	}
}

// verifieSortie controle les valeurs des pistes du clip de deux os, en axes glTF.
func verifieSortie(t *testing.T, c gltfCible, v []float32) {
	t.Helper()
	s := float32(math.Sqrt(0.5))
	presqueV := func(got, want []float32) bool {
		for i := range want {
			if math.Abs(float64(got[i]-want[i])) > 1e-4 { // quantum des rotations en i16 : 3e-5
				return false
			}
		}
		return len(got) == len(want)
	}
	var want []float32
	switch {
	case c.Node == 1 && c.Path == cheminRotation:
		want = []float32{0, s, 0, s} // autour de Z Halo = autour de Y glTF
	case c.Path == cheminRotation:
		want = []float32{0, 0, 0, 1, s, 0, 0, s, 0, 0, 0, 1} // la derniere ramenee dans l'hemisphere
	default:
		want = []float32{0, 1, 0, 0, 1.1, 0, 0, 1.2, 0}
	}
	if !presqueV(v, want) {
		t.Fatalf("canal %+v : %v, attendu %v", c, v, want)
	}
}

// TestEcritGLBPeauAnimeRefus : nom vide ou en double, pistes d'un autre squelette, piste au compte
// de cles faux.
func TestEcritGLBPeauAnimeRefus(t *testing.T) {
	faux := clipDeDeux()
	faux.Os[1].Translations = faux.Os[1].Translations[:2]
	court := clipDeDeux()
	court.Os = court.Os[:1]
	for nom, clips := range map[string][]ClipGLB{
		"vide":     {{Nom: "", Clip: clipDeDeux()}},
		"double":   {{Nom: "a", Clip: clipDeDeux()}, {Nom: "a", Clip: clipDeDeux()}},
		"pistes":   {{Nom: "a", Clip: court}},
		"cles":     {{Nom: "a", Clip: faux}},
		"sansClip": {{Nom: "a"}},
	} {
		if err := EcritGLBPeauAnime(&bytes.Buffer{}, modeleDeDeux(), clips, "test", nil); err == nil {
			t.Errorf("%s : accepte", nom)
		}
	}
}
