// Package himap — animations_courbes.go : le codec 10 (« courbes revisees ») des pistes animees :
// par piste, des images cles et, entre deux cles, un segment de Hermite cubique.
//
// En-tete du flux (36 o) : codec u8 +0, comptes u16 de rotations +2, translations +4, echelles +6,
// deux flottants +8 / +12 (non lus), table des translations u32 +16 et des echelles u32 +20
// (relatives au debut des donnees ; 0xff sans piste), debut des donnees u32 +24, taille du flux u32
// +28, marque « RANG » +32. La table des rotations ouvre les donnees ; chaque table porte un
// decalage u32 par piste, relatif au debut des donnees, dans l'ordre des bits des drapeaux animes.
//
// Piste : marque u8 +0 (« R » rotation, « T » translation), compte de cles u16 +2, drapeaux u8 +4
// (bit 0 : une valeur par image, sans courbe) ; les octets +1, +5 a +7 ne se lisent pas (restes de
// memoire sur quelques pistes). Une translation porte ensuite quatre f32 : origine x, y, z et
// etendue, sa valeur est origine + etendue x (i16 / 32767). Suivent, pour une courbe, `cles` ecarts
// u8 entre images cles (la premiere cle est l'image 0, la derniere la derniere image), la valeur de
// la premiere cle puis, par segment, ses tangentes (un octet par composant : 4 pour une rotation, 3
// pour une translation) et la valeur de la cle suivante ; pour une piste brute, une valeur par
// image. Une valeur est 3 x i16 (quatRevise pour une rotation). Chaque piste se termine sur un
// multiple de 4 (bourrage 0xff) : la suivante commence la.
//
// Tangentes : quartet haut au depart du segment, quartet bas a l'arrivee, n = quartet - 7 ;
// tangente = (p2 - p1) + 0,3 x (n/7) x |n/7| (n = 0 : la corde, le segment est alors lineaire). Au
// temps t = (image - cle) / (cle suivante - cle) : (2t³-3t²+1) p1 + (t³-2t²+t) m1 + (3t²-2t³) p2 +
// (t³-t²) m2, composant par composant ; pour une rotation, sur les quaternions reconstruits, puis
// renormalise. Disposition de la famille Halo 3 / Reach, relue dans la description de TagTool et
// mesuree sur les graphes du Spartan ; aucun code repris.
package himap

// LOCAL-CHANGE: user-visible strings translated to English.

import (
	"errors"
	"fmt"
	"math"
)

// Grammaire du codec 10.
const (
	courbeEntete       = 36
	courbeOffTabTrans  = 16
	courbeOffTabEch    = 20
	courbeOffDonnees   = 24
	courbeOffTaille    = 28
	courbeOffMarque    = 32
	courbeMarque       = "RANG"
	courbeSansTable    = 0xff
	pisteEntete        = 8
	pisteOffCles       = 2
	pisteOffDrapeaux   = 4
	pisteDrapeauBrut   = 0x01
	pisteMarqueRot     = 'R'
	pisteMarqueTrans   = 'T'
	pisteTransCadre    = 16
	valeurCourbeOctets = 6
	alignementPiste    = 4
	quartetNeutre      = 7.0
	gainTangente       = 0.3
)

// ErrCourbeNonLue : une variante du codec 10 que ce lecteur ne lit pas ; errors.Is(err,
// ErrCodecNonDecode).
var ErrCourbeNonLue = errors.New("himap: codec 10 variant not read")

// CourbeNonLueError porte la raison du refus (CourbeNonLue*) ; errors.Is(err, ErrCodecNonDecode).
type CourbeNonLueError struct {
	Raison string
	Detail string
}

// Raisons d'un refus du codec 10.
const (
	CourbeNonLueMarque    = "marque"
	CourbeNonLueEchelles  = "echelles"
	CourbeNonLueDrapeaux  = "drapeaux de piste"
	CourbeNonLueCles      = "cles"
	CourbeNonLueBourrage  = "disposition des pistes"
	CourbeNonLueHemisphre = "segment entre hemispheres"
)

func (e CourbeNonLueError) Error() string {
	return fmt.Sprintf("%v : %s (%s)", ErrCourbeNonLue, e.Raison, e.Detail)
}

// Is rattache l'erreur a ErrCourbeNonLue et a ErrCodecNonDecode.
func (e CourbeNonLueError) Is(cible error) bool {
	return cible == ErrCourbeNonLue || cible == ErrCodecNonDecode
}

// sortePisteCourbe : ce qui distingue une piste de rotation d'une piste de translation.
type sortePisteCourbe struct {
	marque     byte
	composants int // composants d'une valeur reconstruite (4 ou 3) ; aussi les octets de tangentes
	tangentes  int
	cadre      int // octets entre l'en-tete et les ecarts (le cadre d'une translation)
}

var (
	sorteRotation    = sortePisteCourbe{marque: pisteMarqueRot, composants: 4, tangentes: 4}
	sorteTranslation = sortePisteCourbe{marque: pisteMarqueTrans, composants: 3, tangentes: 3, cadre: pisteTransCadre}
)

// pisteCourbe : une piste lue, une valeur par image (normalisee pour une translation : avant
// origine et etendue), et l'octet ou elle se termine.
type pisteCourbe struct {
	valeurs [][]float64
	fin     int
	origine [3]float64
	etendue float64
}

// litPistesCourbes lit un flux de codec 10 dans les pistes du clip.
func (c *ClipAnimation) litPistesCourbes(b []byte, rangs [tableauxDrapeaux][]int) error {
	if len(b) < courbeEntete {
		return fmt.Errorf("%w: curve stream of %d bytes", ErrAnimationIllisible, len(b))
	}
	if string(b[courbeOffMarque:courbeOffMarque+len(courbeMarque)]) != courbeMarque {
		return CourbeNonLueError{Raison: CourbeNonLueMarque, Detail: fmt.Sprintf("%q", b[courbeOffMarque:courbeEntete])}
	}
	f := fluxLu{codec: CodecCourbeRevisee, nRot: int(u16(b, fluxOffRotations)), nTrans: int(u16(b, fluxOffTranslations)),
		nEch: int(u16(b, fluxOffEchelles)), octets: b}
	if err := f.verifieComptes(rangs); err != nil {
		return err
	}
	if f.nEch > 0 {
		return CourbeNonLueError{Raison: CourbeNonLueEchelles, Detail: fmt.Sprintf("%d pistes", f.nEch)}
	}
	if t := u32(b, courbeOffTaille); t != len(b) {
		return fmt.Errorf("%w: curve stream of %d bytes, header %d", ErrAnimationIllisible, len(b), t)
	}
	donnees := u32(b, courbeOffDonnees)
	rot, err := c.tablePistes(f, donnees, donnees, f.nRot, sorteRotation)
	if err != nil {
		return fmt.Errorf("rotations: %w", err)
	}
	for i, os := range rangs[0] {
		c.Os[os].Rotations = rotationsDeCourbe(rot[i].valeurs)
	}
	if f.nTrans == 0 {
		return nil
	}
	trans, err := c.tablePistes(f, donnees, donnees+u32(b, courbeOffTabTrans), f.nTrans, sorteTranslation)
	if err != nil {
		return fmt.Errorf("translations: %w", err)
	}
	for i, os := range rangs[1] {
		c.Os[os].Translations = translationsDeCourbe(trans[i])
	}
	return nil
}

// tablePistes lit les `n` pistes d'une table (a `table`, decalages relatifs a `donnees`) ; chaque
// piste se termine, bourrage compris, la ou la suivante commence.
func (c *ClipAnimation) tablePistes(f fluxLu, donnees, table, n int, s sortePisteCourbe) ([]pisteCourbe, error) {
	if err := f.borne(table, 4*n); err != nil {
		return nil, err
	}
	out := make([]pisteCourbe, n)
	for k := 0; k < n; k++ {
		o := donnees + u32(f.octets, table+4*k)
		if k > 0 && alignePiste(out[k-1].fin) != o {
			return nil, CourbeNonLueError{Raison: CourbeNonLueBourrage,
				Detail: fmt.Sprintf("piste %d a %d, la precedente finit a %d", k, o, out[k-1].fin)}
		}
		p, err := litPisteCourbe(f, o, c.Images, s)
		if err != nil {
			return nil, fmt.Errorf("track %d: %w", k, err)
		}
		out[k] = p
	}
	return out, nil
}

// alignePiste arrondit une fin de piste au multiple de 4 suivant.
func alignePiste(o int) int { return (o + alignementPiste - 1) / alignementPiste * alignementPiste }

// litPisteCourbe lit la piste qui commence a `o`.
func litPisteCourbe(f fluxLu, o, images int, s sortePisteCourbe) (pisteCourbe, error) {
	var p pisteCourbe
	if err := f.borne(o, pisteEntete+s.cadre); err != nil {
		return p, err
	}
	b := f.octets
	if b[o] != s.marque {
		return p, CourbeNonLueError{Raison: CourbeNonLueMarque, Detail: fmt.Sprintf("piste %q, %q attendue", b[o], s.marque)}
	}
	cles, drapeaux := int(u16(b, o+pisteOffCles)), b[o+pisteOffDrapeaux]
	if drapeaux&^pisteDrapeauBrut != 0 {
		return p, CourbeNonLueError{Raison: CourbeNonLueDrapeaux, Detail: fmt.Sprintf("%#02x", drapeaux)}
	}
	if s.cadre > 0 {
		p.origine, p.etendue = vec3F32(b, o+pisteEntete), f32(b, o+pisteEntete+12)
	}
	o += pisteEntete + s.cadre
	var err error
	if drapeaux&pisteDrapeauBrut != 0 {
		p.valeurs, p.fin, err = valeursBrutes(f, o, images, s)
	} else {
		p.valeurs, p.fin, err = valeursCourbe(f, o, cles, images, s)
	}
	return p, err
}

// valeursBrutes lit une valeur par image.
func valeursBrutes(f fluxLu, o, images int, s sortePisteCourbe) ([][]float64, int, error) {
	if err := f.borne(o, images*valeurCourbeOctets); err != nil {
		return nil, 0, err
	}
	out := make([][]float64, images)
	for k := range out {
		out[k] = valeurCourbe(f.octets, o+k*valeurCourbeOctets, s)
	}
	return out, o + images*valeurCourbeOctets, nil
}

// imagesCles lit les `n` ecarts u8 a `o` : les images cles, de 0 a la derniere image.
func imagesCles(f fluxLu, o, n, images int) ([]int, error) {
	if err := f.borne(o, n); err != nil {
		return nil, err
	}
	cles := []int{0}
	for k := 0; k < n; k++ {
		d := int(f.octets[o+k])
		if d == 0 {
			return nil, CourbeNonLueError{Raison: CourbeNonLueCles, Detail: fmt.Sprintf("ecart nul a la cle %d", k+1)}
		}
		cles = append(cles, cles[k]+d)
	}
	if cles[n] != images-1 {
		return nil, CourbeNonLueError{Raison: CourbeNonLueCles, Detail: fmt.Sprintf("derniere cle %d pour %d images", cles[n], images)}
	}
	return cles, nil
}

// valeursCourbe lit les cles et les segments d'une courbe et l'echantillonne a chaque image.
func valeursCourbe(f fluxLu, o, n, images int, s sortePisteCourbe) ([][]float64, int, error) {
	cles, err := imagesCles(f, o, n, images)
	if err != nil {
		return nil, 0, err
	}
	o += n
	segment := s.tangentes + valeurCourbeOctets
	if err := f.borne(o, valeurCourbeOctets+n*segment); err != nil {
		return nil, 0, err
	}
	out := make([][]float64, images)
	p1 := valeurCourbe(f.octets, o, s)
	out[0] = p1
	for k := 0; k < n; k++ {
		t := f.octets[o+valeurCourbeOctets+k*segment:]
		p2 := valeurCourbe(t, s.tangentes, s)
		if s.marque == pisteMarqueRot && produitScalaire(p1, p2) < 0 {
			return nil, 0, CourbeNonLueError{Raison: CourbeNonLueHemisphre, Detail: fmt.Sprintf("segment %d", k)}
		}
		m1, m2 := tangentesSegment(t[:s.tangentes], p1, p2)
		for img := cles[k] + 1; img <= cles[k+1]; img++ {
			out[img] = hermite(p1, m1, p2, m2, float64(img-cles[k])/float64(cles[k+1]-cles[k]))
		}
		p1 = p2
	}
	return out, o + valeurCourbeOctets + n*segment, nil
}

// valeurCourbe lit une valeur (3 x i16) : un quaternion reconstruit, ou trois composants normalises.
func valeurCourbe(b []byte, o int, s sortePisteCourbe) []float64 {
	if s.marque == pisteMarqueRot {
		q := quatRevise(u16(b, o), u16(b, o+2), u16(b, o+4))
		return q[:]
	}
	return []float64{
		float64(int16(u16(b, o))) / quantumRotation16, float64(int16(u16(b, o+2))) / quantumRotation16,
		float64(int16(u16(b, o+4))) / quantumRotation16,
	}
}

// quatRevise reconstruit un quaternion de trois i16 : chaque valeur, bit de poids faible efface,
// vaut v / 32767 / √2 ; le composant omis (le plus grand) a pour rang (bit 0 de c) + 2 x (bit 0 de
// b) et pour signe le bit 0 de a ; a, b, c occupent les rangs omis+1, omis+2 et omis+3 (modulo 4).
func quatRevise(a, b, c uint16) [4]float64 {
	omis := int(c&1) | int(b&1)<<1
	var q [4]float64
	somme := 0.0
	for k, v := range [3]uint16{a, b, c} {
		x := float64(int16(v&^1)) / quantumRotation16 * (math.Sqrt2 / 2)
		q[(omis+1+k)%4] = x
		somme += x * x
	}
	q[omis] = math.Sqrt(math.Max(0, 1-somme))
	if a&1 != 0 {
		q[omis] = -q[omis]
	}
	return q
}

// tangentesSegment rend les tangentes de depart et d'arrivee d'un segment.
func tangentesSegment(octets []byte, p1, p2 []float64) ([]float64, []float64) {
	m1, m2 := make([]float64, len(p1)), make([]float64, len(p1))
	for k := range p1 {
		corde := p2[k] - p1[k]
		m1[k] = corde + ecartTangente(octets[k]>>4)
		m2[k] = corde + ecartTangente(octets[k]&0x0f)
	}
	return m1, m2
}

// ecartTangente : l'ecart d'un quartet a la corde, 0,3 x (n/7) x |n/7| avec n = quartet - 7.
func ecartTangente(quartet byte) float64 {
	n := (float64(quartet) - quartetNeutre) / quartetNeutre
	return gainTangente * n * math.Abs(n)
}

// hermite evalue le segment au temps t de [0, 1] ; un quaternion (4 composants) est renormalise.
func hermite(p1, m1, p2, m2 []float64, t float64) []float64 {
	t2, t3 := t*t, t*t*t
	h00, h10, h01, h11 := 2*t3-3*t2+1, t3-2*t2+t, 3*t2-2*t3, t3-t2
	out := make([]float64, len(p1))
	for k := range p1 {
		out[k] = h00*p1[k] + h10*m1[k] + h01*p2[k] + h11*m2[k]
	}
	if len(out) == 4 {
		if n := math.Sqrt(produitScalaire(out, out)); n > 0 {
			for k := range out {
				out[k] /= n
			}
		}
	}
	return out
}

func produitScalaire(a, b []float64) float64 {
	s := 0.0
	for k := range a {
		s += a[k] * b[k]
	}
	return s
}

// rotationsDeCourbe rend les quaternions d'une piste de rotation.
func rotationsDeCourbe(v [][]float64) [][4]float64 {
	out := make([][4]float64, len(v))
	for k, q := range v {
		out[k] = [4]float64{q[0], q[1], q[2], q[3]}
	}
	return out
}

// translationsDeCourbe applique origine et etendue aux valeurs normalisees d'une translation.
func translationsDeCourbe(p pisteCourbe) [][3]float64 {
	out := make([][3]float64, len(p.valeurs))
	for k, v := range p.valeurs {
		for j := 0; j < 3; j++ {
			out[k][j] = p.origine[j] + p.etendue*v[j]
		}
	}
	return out
}
