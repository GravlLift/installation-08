package himap

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
	"testing"
)

func constantesAvec(taille int, valeurs map[int]float32) []byte {
	b := make([]byte, taille)
	for o, v := range valeurs {
		binary.LittleEndian.PutUint32(b[o:], math.Float32bits(v))
	}
	return b
}

// TestEmissifDuShader : la table des deux shaders lumineux, les materiaux eteints et les shaders
// inconnus.
func TestEmissifDuShader(t *testing.T) {
	illum := constantesAvec(16, map[int]float32{0: 1, 4: 0.565, 8: 0, 12: 1})
	if e := emissifDuShader(0x779fc911, illum); e == nil || e.Couleur != [3]float32{1, 0.565, 0} || e.Force != 1 {
		t.Fatalf("illum_full : %+v", e)
	}
	diffus := constantesAvec(256, map[int]float32{224: 0.991, 228: 0.761, 232: 0.292, 236: 80, 240: 0.7})
	if e := emissifDuShader(0x3c7906af, diffus); e == nil || math.Abs(float64(e.Force-56)) > 1e-4 {
		t.Fatalf("diffuse_emissive : %+v", e)
	}
	eteint := constantesAvec(256, map[int]float32{224: 1, 228: 1, 232: 1, 236: 0, 240: 1})
	if e := emissifDuShader(0x3c7906af, eteint); e != nil {
		t.Fatalf("quantite nulle : %+v", e)
	}
	if e := emissifDuShader(0x3c7906af, illum); e != nil {
		t.Fatalf("constantes trop courtes : %+v", e)
	}
	if e := emissifDuShader(0x12345678, illum); e != nil {
		t.Fatalf("shader inconnu : %+v", e)
	}
}

// TestEcritGLBEmissif : couleur ramenee dans [0, 1], excedent dans la force, extension declaree
// une fois ; une force de 1 n'ecrit pas d'extension.
func TestEcritGLBEmissif(t *testing.T) {
	m := &MaillageMonde{
		Structure: GroupeMaillage{Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0}, Indices: map[uint32][]uint32{1: {0, 1, 2}, 2: {0, 2, 1}}},
		Materiaux: map[uint32]Materiau{
			1: {ID: 1, Emissif: &Emissif{Couleur: [3]float32{2, 1, 0}, Force: 10}},
			2: {ID: 2, Emissif: &Emissif{Couleur: [3]float32{0, 0.5, 1}, Force: 1}},
		},
	}
	var buf bytes.Buffer
	if err := EcritGLB(&buf, m, "test", nil); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	lenJSON := int(binary.LittleEndian.Uint32(b[12:]))
	var doc struct {
		ExtUsed   []string `json:"extensionsUsed"`
		Materials []struct {
			Name       string      `json:"name"`
			Emissive   *[3]float32 `json:"emissiveFactor"`
			Extensions struct {
				Strength *struct {
					Value float32 `json:"emissiveStrength"`
				} `json:"KHR_materials_emissive_strength"`
			} `json:"extensions"`
		} `json:"materials"`
	}
	if err := json.Unmarshal(bytes.TrimRight(b[20:20+lenJSON], " "), &doc); err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, x := range doc.ExtUsed {
		if x == extEmissiveStrength {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("extensionsUsed : %v", doc.ExtUsed)
	}
	for _, g := range doc.Materials {
		switch g.Name {
		case "mat_00000001":
			if g.Emissive == nil || *g.Emissive != [3]float32{1, 0.5, 0} || g.Extensions.Strength == nil || g.Extensions.Strength.Value != 20 {
				t.Fatalf("materiau 1 : %+v", g)
			}
		case "mat_00000002":
			if g.Emissive == nil || *g.Emissive != [3]float32{0, 0.5, 1} || g.Extensions.Strength != nil {
				t.Fatalf("materiau 2 : %+v", g)
			}
		}
	}
}

func TestPochoirDuShader(t *testing.T) {
	params := ParametresShader{0x9d5cd716: 16, 0xb4d4ff02: 28}
	b := constantesAvec(32, map[int]float32{16: 0.2, 20: 0.4, 24: 0.8, 28: 0.6})
	p := pochoirDuShader(0xc0b84a6a, params, b)
	if p == nil || p.Couleur != [3]float32{0.2, 0.4, 0.8} || p.Opacite != 0.6 {
		t.Fatalf("pochoir : %+v", p)
	}
	if pochoirDuShader(0, params, b) != nil || pochoirDuShader(0xc0b84a6a, nil, b) != nil || pochoirDuShader(0xc0b84a6a, params, b[:20]) != nil {
		t.Fatal("pochoir illisible accepte")
	}
}

func TestExtrasPochoir(t *testing.T) {
	g := materiauGLTF(1, map[uint32]Materiau{1: {Pochoir: &Pochoir{Couleur: [3]float32{0.2, 0.4, 0.8}, Opacite: 0.6}}})
	b, err := json.Marshal(g.Extras)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(b, []byte(`"pochoir":{"couleur":[0.2,0.4,0.8],"opacite":0.6}`)) {
		t.Fatalf("extras : %s", b)
	}
}
