package himap

import (
	"encoding/binary"
	"errors"
	"math"
	"testing"
)

// fluxCourbes construit un flux de codec 10 : une piste de rotation et une de translation, dont les
// octets (en-tete de piste compris) sont donnes ; chaque piste est bourree de 0xff jusqu'a 4.
func fluxCourbes(rot, trans []byte) []byte {
	aligne := func(b []byte) []byte {
		for len(b)%alignementPiste != 0 {
			b = append(b, 0xff)
		}
		return b
	}
	rot, trans = aligne(rot), aligne(trans)
	donnees := courbeEntete
	b := make([]byte, courbeEntete)
	b[0] = CodecCourbeRevisee
	binary.LittleEndian.PutUint16(b[fluxOffRotations:], 1)
	binary.LittleEndian.PutUint16(b[fluxOffTranslations:], 1)
	copy(b[courbeOffMarque:], courbeMarque)
	b = binary.LittleEndian.AppendUint32(b, 4) // table des rotations : la piste suit la table
	b = append(b, rot...)
	tabTrans := len(b) - donnees
	b = binary.LittleEndian.AppendUint32(b, uint32(tabTrans+4))
	b = append(b, trans...)
	binary.LittleEndian.PutUint32(b[courbeOffTabTrans:], uint32(tabTrans))
	binary.LittleEndian.PutUint32(b[courbeOffTabEch:], courbeSansTable)
	binary.LittleEndian.PutUint32(b[courbeOffDonnees:], uint32(donnees))
	binary.LittleEndian.PutUint32(b[courbeOffTaille:], uint32(len(b)))
	return b
}

// valeurI16 ajoute trois i16.
func valeurI16(b []byte, a, c, d int16) []byte {
	for _, v := range []int16{a, c, d} {
		b = binary.LittleEndian.AppendUint16(b, uint16(v))
	}
	return b
}

// pisteRotationIdentite : 5 images, cles 0, 2, 4 ; identite, 90 degres autour de X, identite ;
// tangentes neutres (0x77, segments lineaires) sauf le depart du second segment sur x (0xe7).
func pisteRotationIdentite() []byte {
	b := []byte{pisteMarqueRot, 0, 2, 0, 0, 0, 'S', 'Q', 2, 2}
	identite := func(b []byte) []byte { return valeurI16(b, 0, 1, 1) } // w omis (rang 3), positif
	b = identite(b)
	b = append(b, 0x77, 0x77, 0x77, 0x77)
	x := int16(math.Round(math.Sqrt(0.5)*math.Sqrt2*quantumRotation16)) &^ 1
	b = valeurI16(b, x, 1, 1) // (sqrt(1/2), 0, 0, sqrt(1/2))
	b = append(b, 0xe7, 0x77, 0x77, 0x77)
	return identite(b)
}

// pisteTranslationBrute : 5 images, une valeur par image, origine (1, 2, 3), etendue 0,5.
func pisteTranslationBrute() []byte {
	b := []byte{pisteMarqueTrans, 0, 4, 0, pisteDrapeauBrut, 0, 0, 0}
	for _, f := range []float32{1, 2, 3, 0.5} {
		b = binary.LittleEndian.AppendUint32(b, math.Float32bits(f))
	}
	for k := 0; k < 5; k++ {
		b = valeurI16(b, int16(k*8191), 0, -32767)
	}
	return b
}

func clipCourbes(images int) *ClipAnimation {
	return &ClipAnimation{Images: images, Os: make([]PisteOs, 2)}
}

// TestQuatRevise : composant omis au rang des deux bits de poids faible, signe du premier.
func TestQuatRevise(t *testing.T) {
	x := uint16(int16(math.Round(0.6*math.Sqrt2*quantumRotation16))) &^ 1
	q := quatRevise(x, 1, 1)
	if math.Abs(q[0]-0.6) > 1e-4 || q[1] != 0 || q[2] != 0 || math.Abs(q[3]-0.8) > 1e-4 {
		t.Fatalf("w omis : %v", q)
	}
	if q = quatRevise(x|1, 0, 0); math.Abs(q[0]+0.8) > 1e-4 || math.Abs(q[1]-0.6) > 1e-4 {
		t.Fatalf("x omis, negatif : %v", q)
	}
}

// TestCourbesRevisees : cles, segment lineaire, segment a tangente, piste brute, origine et etendue.
func TestCourbesRevisees(t *testing.T) {
	c := clipCourbes(5)
	rangs := [tableauxDrapeaux][]int{{0}, {1}, nil}
	if err := c.litPistesCourbes(fluxCourbes(pisteRotationIdentite(), pisteTranslationBrute()), rangs); err != nil {
		t.Fatal(err)
	}
	r := c.Os[0].Rotations
	s := math.Sqrt(0.5)
	if len(r) != 5 || math.Abs(r[2][0]-s) > 1e-4 || math.Abs(r[2][3]-s) > 1e-4 || math.Abs(r[0][3]-1) > 1e-9 {
		t.Fatalf("cles : %v", r)
	}
	// image 1 : milieu lineaire renormalise de (0,0,0,1) et (s,0,0,s) ; 22,5 degres autour de X
	if math.Abs(r[1][0]-math.Sin(math.Pi/8)) > 1e-3 || math.Abs(r[1][3]-math.Cos(math.Pi/8)) > 1e-3 {
		t.Fatalf("segment lineaire : %v", r[1])
	}
	// image 3 : tangente de depart sur x de +0,3 x (7/7)² au-dessus de la corde
	lin := hermite([]float64{s, 0, 0, s}, []float64{-s, 0, 0, 1 - s}, []float64{0, 0, 0, 1}, []float64{-s, 0, 0, 1 - s}, 0.5)
	if r[3][0] <= lin[0] {
		t.Fatalf("la tangente ne pousse pas x : %v contre %v", r[3], lin)
	}
	tr := c.Os[1].Translations
	if len(tr) != 5 || math.Abs(tr[4][0]-(1+0.5*4*8191/quantumRotation16)) > 1e-6 || tr[0][1] != 2 || math.Abs(tr[0][2]-2.5) > 1e-6 {
		t.Fatalf("translations : %v", tr)
	}
}

// TestCourbesReviseesRefus : marque, cles, drapeaux, echelles : CourbeNonLueError, comptee comme
// un codec non decode.
func TestCourbesReviseesRefus(t *testing.T) {
	rangs := [tableauxDrapeaux][]int{{0}, {1}, nil}
	marque := pisteRotationIdentite()
	marque[0] = 'X'
	cles := pisteRotationIdentite()
	cles[9] = 3
	drapeaux := pisteRotationIdentite()
	drapeaux[pisteOffDrapeaux] = 0x02
	for nom, cas := range map[string]struct {
		flux   []byte
		raison string
	}{
		"marque":   {fluxCourbes(marque, pisteTranslationBrute()), CourbeNonLueMarque},
		"cles":     {fluxCourbes(cles, pisteTranslationBrute()), CourbeNonLueCles},
		"drapeaux": {fluxCourbes(drapeaux, pisteTranslationBrute()), CourbeNonLueDrapeaux},
	} {
		err := clipCourbes(5).litPistesCourbes(cas.flux, rangs)
		var ve CourbeNonLueError
		if !errors.As(err, &ve) || ve.Raison != cas.raison || !errors.Is(err, ErrCodecNonDecode) {
			t.Errorf("%s : %v", nom, err)
		}
	}
	ech := fluxCourbes(pisteRotationIdentite(), pisteTranslationBrute())
	binary.LittleEndian.PutUint16(ech[fluxOffEchelles:], 1)
	err := clipCourbes(5).litPistesCourbes(ech, [tableauxDrapeaux][]int{{0}, {1}, {1}})
	if !errors.Is(err, ErrCourbeNonLue) {
		t.Errorf("echelles : %v", err)
	}
	if err := clipCourbes(5).litPistesCourbes(ech[:20], rangs); !errors.Is(err, ErrAnimationIllisible) {
		t.Errorf("flux tronque : %v", err)
	}
}
