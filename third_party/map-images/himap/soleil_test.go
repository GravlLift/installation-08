package himap

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
	"testing"
)

// soleilRecharge : la direction attendue pour Recharge (angle horaire 0, latitude 28, azimut
// 250, saison 0), l'ancre de la convention de DirectionSoleil.
var soleilRecharge = [3]float64{-0.0753, 0.0274, 0.9968}

func procheDe(a, b [3]float64, tol float64) bool {
	for k := range a {
		if math.Abs(a[k]-b[k]) > tol {
			return false
		}
	}
	return true
}

// enregistrementSoleil fabrique un enregistrement « Dynamic Suns » de 0x34 octets.
func enregistrementSoleil(drapeaux uint16, couleur [3]float32, intensite, heure, lat, az, saison float32) []byte {
	b := make([]byte, soleilTaille)
	binary.LittleEndian.PutUint16(b[soleilOffDrap:], drapeaux)
	put := func(o int, v float32) { binary.LittleEndian.PutUint32(b[o:], math.Float32bits(v)) }
	for k, v := range couleur {
		put(soleilOffCouleur+4*k, v)
	}
	put(soleilOffIntens, intensite)
	put(soleilOffHeure, heure)
	put(soleilOffLat, lat)
	put(soleilOffAzimut, az)
	put(soleilOffSaison, saison)
	return b
}

func TestDirectionSoleilRecharge(t *testing.T) {
	d := DirectionSoleil(0, 28, 250, 0)
	if !procheDe(d, soleilRecharge, 0.01) {
		t.Fatalf("Recharge : %v, attendu %v", d, soleilRecharge)
	}
	if n := math.Sqrt(d[0]*d[0] + d[1]*d[1] + d[2]*d[2]); math.Abs(n-1) > 1e-9 {
		t.Fatalf("norme %v", n)
	}
}

// TestDirectionSoleilRechargeAngles : au sens de la visionneuse (atan2(y, x), asin(z)),
// Recharge vaut azimut 160, elevation 85,44.
func TestDirectionSoleilRechargeAngles(t *testing.T) {
	d := DirectionSoleil(0, 28, 250, 0)
	az := math.Atan2(d[1], d[0]) * 180 / math.Pi
	el := math.Asin(d[2]) * 180 / math.Pi
	if math.Abs(az-160) > 0.01 || math.Abs(el-85.44) > 0.01 {
		t.Fatalf("Recharge : azimut %v elevation %v, attendu 160 / 85,44", az, el)
	}
}

// TestDirectionSoleilGeometrie : l'elevation de midi vaut 90 - |latitude - declinaison| ; la
// saison 0 est le solstice de juin, 0,5 celui de decembre, 0,25 un equinoxe ; l'apres-midi part
// vers l'ouest (lacet de l'Est + 180 a azimut nul : -X) ; l'equateur a l'equinoxe met le soleil
// de midi au zenith.
func TestDirectionSoleilGeometrie(t *testing.T) {
	el := func(d [3]float64) float64 { return math.Asin(d[2]) * 180 / math.Pi }
	for _, c := range []struct{ saison, attendu float64 }{
		{0, 90 - (40 - InclinaisonAxe)},
		{0.25, 50},
		{0.5, 90 - (40 + InclinaisonAxe)},
		{-0.5, 90 - (40 + InclinaisonAxe)},
	} {
		if e := el(DirectionSoleil(0, 40, 0, c.saison)); math.Abs(e-c.attendu) > 1e-9 {
			t.Fatalf("midi a 40 deg, saison %v : elevation %v, attendu %v", c.saison, e, c.attendu)
		}
	}
	if d := DirectionSoleil(0, 0, 123, 0.25); !procheDe(d, [3]float64{0, 0, 1}, 1e-9) {
		t.Fatalf("equateur, equinoxe, midi : %v, attendu le zenith", d)
	}
	if d := DirectionSoleil(30, 0, 0, 0.25); d[0] >= 0 || math.Abs(d[1]) > 1e-9 {
		t.Fatalf("apres-midi a azimut 0 : %v, attendu vers -X (ouest)", d)
	}
}

func TestParametresSoleil(t *testing.T) {
	const tout = uint16(0x3FF)
	p, err := litParametresSoleil(enregistrementSoleil(tout, [3]float32{1, 0.910, 0.804}, 9, 0, 28, 250, 0))
	if err != nil {
		t.Fatal(err)
	}
	s, ok := p.Soleil()
	if !ok || !procheDe(s.Direction, soleilRecharge, 0.01) {
		t.Fatalf("Recharge : %+v ok=%v", s, ok)
	}
	if !s.AvecIntensite || s.Intensite != 9 || !s.AvecCouleur || math.Abs(s.Couleur[1]-0.910) > 1e-6 {
		t.Fatalf("couleur / intensite : %+v", s)
	}
	cas := []struct {
		nom string
		b   []byte
	}{
		{"sans remplacement du soleil principal", enregistrementSoleil(tout&^SoleilRemplacePrincipal, [3]float32{1, 1, 1}, 9, 0, 28, 250, 0)},
		{"sans azimut", enregistrementSoleil(tout&^SoleilAzimut, [3]float32{1, 1, 1}, 9, 0, 28, 250, 0)},
		{"eteint", enregistrementSoleil(tout, [3]float32{1, 1, 1}, 0, 0, 28, 250, 0)},
		{"sous l'horizon", enregistrementSoleil(tout, [3]float32{1, 1, 1}, 9, 180, 28, 250, 0)},
	}
	for _, c := range cas {
		p, err := litParametresSoleil(c.b)
		if err != nil {
			t.Fatal(err)
		}
		if s, ok := p.Soleil(); ok {
			t.Fatalf("%s : soleil rendu %+v, attendu aucun", c.nom, s)
		}
	}
	if _, err := litParametresSoleil(make([]byte, soleilTaille-1)); err == nil {
		t.Fatal("enregistrement tronque accepte")
	}
}

// TestEcritGLBSoleil : le soleil sort dans scenes[0].extras.levelupSun en axes Halo ; sans
// soleil, la scene n'a pas d'extras.
func TestEcritGLBSoleil(t *testing.T) {
	scene := func(s *Soleil) map[string]json.RawMessage {
		m := &MaillageMonde{
			Structure: GroupeMaillage{Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0}, Indices: map[uint32][]uint32{0: {0, 1, 2}}},
			Soleil:    s,
		}
		var buf bytes.Buffer
		if err := EcritGLB(&buf, m, "test", nil); err != nil {
			t.Fatal(err)
		}
		b := buf.Bytes()
		lenJSON := int(binary.LittleEndian.Uint32(b[12:]))
		var doc struct {
			Scenes []map[string]json.RawMessage `json:"scenes"`
		}
		if err := json.Unmarshal(bytes.TrimRight(b[20:20+lenJSON], " "), &doc); err != nil {
			t.Fatal(err)
		}
		return doc.Scenes[0]
	}
	if _, ok := scene(nil)["extras"]; ok {
		t.Fatal("extras de scene sans soleil")
	}
	var extras struct {
		Sun struct {
			Dir       [3]float64 `json:"dir"`
			Intensity *float64   `json:"intensity"`
			Color     *[3]float64
		} `json:"levelupSun"`
	}
	brut := scene(&Soleil{Direction: soleilRecharge, Intensite: 9, AvecIntensite: true})["extras"]
	if err := json.Unmarshal(brut, &extras); err != nil {
		t.Fatalf("extras %s : %v", brut, err)
	}
	if extras.Sun.Dir != soleilRecharge || extras.Sun.Intensity == nil || *extras.Sun.Intensity != 9 || extras.Sun.Color != nil {
		t.Fatalf("levelupSun : %s", brut)
	}
}
