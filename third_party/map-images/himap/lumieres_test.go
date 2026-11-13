package himap

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
	"testing"
)

// TestDirectionProjecteur : vers le bas a orientation nulle ; le premier et le troisieme angle
// seuls ne bougent pas un faisceau vertical ; le deuxieme l'incline, le premier tourne
// l'inclinaison autour de Z.
func TestDirectionProjecteur(t *testing.T) {
	cas := []struct {
		o, attendu [3]float64
	}{
		{[3]float64{0, 0, 0}, [3]float64{0, 0, -1}},
		{[3]float64{-math.Pi, 0, math.Pi}, [3]float64{0, 0, -1}},
		{[3]float64{0, -math.Pi / 2, 0}, [3]float64{0, 1, 0}},
		{[3]float64{math.Pi / 2, -math.Pi / 2, 0}, [3]float64{-1, 0, 0}},
	}
	for _, c := range cas {
		if d := DirectionProjecteur(c.o); !procheDe(d, c.attendu, 1e-9) {
			t.Errorf("orientation %v : %v, attendu %v", c.o, d, c.attendu)
		}
	}
}

// TestEcritGLBLumieres : omni et projecteurs publies avec leur direction, les autres types non.
func TestEcritGLBLumieres(t *testing.T) {
	m := &MaillageMonde{
		Structure: GroupeMaillage{Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0}, Indices: map[uint32][]uint32{0: {0, 1, 2}}},
		Lumieres: []Lumiere{
			{Type: LumiereOmni, Position: [3]float64{1, 2, 3}, Couleur: [3]float64{0, 0.4, 1}, Energie: 20, Portee: 7},
			{Type: LumiereProjecteur, Couleur: [3]float64{1, 1, 1}, Energie: 3, Portee: 7, ConeInterieur: 80, ConeExterieur: 100},
			{Type: LumierePlane, Couleur: [3]float64{1, 1, 1}, Energie: 1, Portee: 1},
		},
	}
	var buf bytes.Buffer
	if err := EcritGLB(&buf, m, "test", nil); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	lenJSON := int(binary.LittleEndian.Uint32(b[12:]))
	var doc struct {
		Scenes []struct {
			Extras struct {
				Lights []struct {
					Type      string     `json:"type"`
					Position  [3]float64 `json:"position"`
					Direction [3]float64 `json:"direction"`
					Energy    float64    `json:"energy"`
					Cone      [2]float64 `json:"cone"`
				} `json:"levelupLights"`
			} `json:"extras"`
		} `json:"scenes"`
	}
	if err := json.Unmarshal(bytes.TrimRight(b[20:20+lenJSON], " "), &doc); err != nil {
		t.Fatal(err)
	}
	ls := doc.Scenes[0].Extras.Lights
	if len(ls) != 2 || ls[0].Type != "omni" || ls[0].Position != [3]float64{1, 2, 3} || ls[1].Type != "spot" ||
		ls[1].Direction != [3]float64{0, 0, -1} || ls[1].Cone != [2]float64{80, 100} {
		t.Fatalf("levelupLights : %+v", ls)
	}
}
