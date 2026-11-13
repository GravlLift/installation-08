package himap

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"testing"
)

// TestEcritGLBSondes : chaque region sort dans scenes[0].extras.levelupProbes avec ses bornes en
// axes Halo, et sa vue du tampon binaire rend ses texels a l'octet pres, alignee sur 4 octets.
func TestEcritGLBSondes(t *testing.T) {
	irr := func(n int, octet byte) []byte {
		return bytes.Repeat([]byte{octet}, n*TuileSonde*TuileSonde*octetsIrradiance)
	}
	sondes := &SondesLumiere{Regions: []RegionSondes{
		{Min: [3]float64{-1, -2, -3}, Max: [3]float64{1, 2, 3}, Nombre: [3]int{2, 1, 1}, Priorite: 1, FonduXY: 0.5, FonduZ: 0.25, Irradiance: irr(2, 7)},
		{Min: [3]float64{0, 0, 0}, Max: [3]float64{1, 1, 1}, Nombre: [3]int{1, 1, 1}, Priorite: 3, FonduXY: 0.5, FonduZ: 0.5, Irradiance: irr(1, 9)},
	}}
	m := &MaillageMonde{
		Structure: GroupeMaillage{Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0}, Indices: map[uint32][]uint32{0: {0, 1, 2}}},
		Sondes:    sondes,
	}
	var buf bytes.Buffer
	if err := EcritGLB(&buf, m, "test", nil); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	lenJSON := int(binary.LittleEndian.Uint32(b[12:]))
	bin := b[20+lenJSON+8:]
	var doc struct {
		Scenes []struct {
			Extras struct {
				Probes struct {
					Tile    int `json:"tile"`
					Regions []struct {
						Min        [3]float64 `json:"min"`
						Max        [3]float64 `json:"max"`
						Count      [3]int     `json:"count"`
						Priority   int        `json:"priority"`
						Blend      [2]float64 `json:"blend"`
						Irradiance int        `json:"irradiance"`
					} `json:"regions"`
				} `json:"levelupProbes"`
			} `json:"extras"`
		} `json:"scenes"`
		BufferViews []gltfBufferView `json:"bufferViews"`
	}
	if err := json.Unmarshal(bytes.TrimRight(b[20:20+lenJSON], " "), &doc); err != nil {
		t.Fatal(err)
	}
	p := doc.Scenes[0].Extras.Probes
	if p.Tile != TuileSonde || len(p.Regions) != 2 {
		t.Fatalf("levelupProbes : %+v", p)
	}
	for i, r := range p.Regions {
		s := sondes.Regions[i]
		if r.Min != s.Min || r.Max != s.Max || r.Count != s.Nombre || r.Priority != s.Priorite || r.Blend != [2]float64{s.FonduXY, s.FonduZ} {
			t.Fatalf("region %d : %+v", i, r)
		}
		v := doc.BufferViews[r.Irradiance]
		if v.ByteOffset%4 != 0 || !bytes.Equal(bin[v.ByteOffset:v.ByteOffset+v.ByteLength], s.Irradiance) {
			t.Fatalf("region %d : vue %+v ne rend pas les texels", i, v)
		}
	}
}
