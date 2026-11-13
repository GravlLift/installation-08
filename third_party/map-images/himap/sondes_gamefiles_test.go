//go:build gamefiles

package himap

import (
	"encoding/binary"
	"math"
	"path/filepath"
	"sort"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

func sondesRecharge(t *testing.T) SondesLumiere {
	t.Helper()
	s, ok, err := LitSondes(sourcesRecharge(t))
	if err != nil || !ok {
		t.Fatalf("sondes de Recharge : ok=%v err=%v", ok, err)
	}
	return s
}

// TestSondesRecharge : 15 regions, la plus grande en premier (37 x 26 x 8 sondes), chacune a
// la taille de sa grille (verifie par LitSondes).
func TestSondesRecharge(t *testing.T) {
	s := sondesRecharge(t)
	if len(s.Regions) != 15 {
		t.Fatalf("%d regions, attendu 15", len(s.Regions))
	}
	r := s.Regions[0]
	if r.Nombre != [3]int{37, 26, 8} || r.Priorite != 1 {
		t.Fatalf("region 0 : %v sondes, priorite %d", r.Nombre, r.Priorite)
	}
	total := 0
	for i, r := range s.Regions {
		total += r.Nombre[0] * r.Nombre[1] * r.Nombre[2]
		t.Logf("region %2d : %v sondes, %v .. %v, priorite %d, fondu %.2f / %.2f, %d o",
			i, r.Nombre, r.Min, r.Max, r.Priorite, r.FonduXY, r.FonduZ, len(r.Irradiance))
	}
	t.Logf("%d sondes", total)
}

// TestSondesOrientation fixe le repere de l'octaedre (cf. l'en-tete de sondes.go) par deux
// mesures independantes :
//   - la lumiere arrive d'ou il fait plus clair : pour chaque sonde dont les deux voisines sur un
//     axe sont actives, l'ecart de clarte entre ces voisines suit le premier moment directionnel
//     de la sonde sur cet axe. Parmi les 48 reperes (permutations signees des axes du decodage),
//     l'identite l'emporte et correle sur les trois axes ;
//   - le ciel est en haut : la direction moyenne des texels clairs de la deuxieme texture d'une
//     region (vue du ciel) pointe vers +Z du decodage.
func TestSondesOrientation(t *testing.T) {
	s := sondesRecharge(t)
	type essai struct {
		base [3][3]float64
		corr [3]float64
	}
	var essais []essai
	for _, b := range basesSignees() {
		essais = append(essais, essai{base: b, corr: correlationsOrientation(s, b)})
	}
	score := func(e essai) float64 { return min(e.corr[0], e.corr[1], e.corr[2]) }
	sort.Slice(essais, func(i, j int) bool { return score(essais[i]) > score(essais[j]) })
	for _, e := range essais[:6] {
		t.Logf("base %v : correlations X %.3f Y %.3f Z %.3f", e.base, e.corr[0], e.corr[1], e.corr[2])
	}
	if essais[0].base != [3][3]float64{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}} || score(essais[0]) < 0.1 {
		t.Fatalf("repere retenu %v (correlations %v), attendu l'identite au-dessus de 0,1", essais[0].base, essais[0].corr)
	}
	ciel := cielMoyen(t)
	t.Logf("direction moyenne du ciel vu (repere du decodage) : %v", ciel)
	if ciel[2] < 0.2 || math.Abs(ciel[0]) > 0.1 || math.Abs(ciel[1]) > 0.1 {
		t.Fatalf("ciel vu vers %v, attendu vers +Z", ciel)
	}
}

// TestSondesEspacement fixe la place des sondes dans leur boite (cf. l'en-tete de sondes.go). La
// troisieme texture d'une region porte, par sonde et par direction, la distance moyenne a la
// premiere surface (moments de visibilite, RG16F, tuiles de 16). D'une couche de sondes a la
// suivante, sous le meme sol et le meme plafond, la distance au sol (coins de l'octaedre) croit
// de l'espacement vertical : celui des cellules (etendue / n), pas celui d'une grille bord a bord
// (etendue / (n - 1)). Mesure sur la region la plus grande, la plus fournie en paires.
func TestSondesEspacement(t *testing.T) {
	dir, _ := LevelsDir("pc")
	m, err := himodule.Open(filepath.Join(dir, "sgh_blueprint", "sgh_blueprint-rtx-new.module"))
	if err != nil {
		t.Skip(err)
	}
	defer func() { _ = m.Close() }()
	ti, err := tagDeEntree(m, m.Files(GroupeLumiereStatique)[0])
	if err != nil {
		t.Fatal(err)
	}
	regions, debuts, id, err := litRegionsSondes(ti)
	if err != nil {
		t.Fatal(err)
	}
	f, _ := entreeParID(m, GroupeBitmap, id)
	res, _ := m.Ressources(f)
	const tuile = 16
	for i, r := range regions {
		brut, err := m.Extract(res[debuts[i]+2])
		if err != nil {
			t.Fatal(err)
		}
		d := res[debuts[i]+2].Donnees(brut)
		l, h := r.Nombre[0]*tuile, r.Nombre[1]*tuile
		if len(d) != l*h*r.Nombre[2]*4 {
			t.Fatalf("region %d : %d o de moments", i, len(d))
		}
		dist := func(x, y, z, ti, tj int) float64 {
			o := 4 * (z*l*h + (y*tuile+tj)*l + x*tuile + ti)
			return demiFlottant(binary.LittleEndian.Uint16(d[o:]))
		}
		bas := func(x, y, z int) float64 {
			return (dist(x, y, z, 1, 1) + dist(x, y, z, tuile-2, 1) + dist(x, y, z, 1, tuile-2) + dist(x, y, z, tuile-2, tuile-2)) / 4
		}
		haut := func(x, y, z int) float64 {
			c := tuile / 2
			return (dist(x, y, z, c-1, c-1) + dist(x, y, z, c, c-1) + dist(x, y, z, c-1, c) + dist(x, y, z, c, c)) / 4
		}
		var ecarts []float64
		for z := 0; z+1 < r.Nombre[2]; z++ {
			for y := 0; y < r.Nombre[1]; y++ {
				for x := 0; x < r.Nombre[0]; x++ {
					b0, b1, h0, h1 := bas(x, y, z), bas(x, y, z+1), haut(x, y, z), haut(x, y, z+1)
					// Une distance plafonnee (rien a portee) se repete d'une couche a l'autre.
					if b0 <= 0 || b1 <= 0 || h0 <= 0 || h1 <= 0 || b0 == b1 || h0 == h1 {
						continue
					}
					// Meme sol et meme plafond pour les deux sondes : leurs hauteurs se completent.
					if math.Abs((b0+h0)-(b1+h1)) > 0.05 {
						continue
					}
					ecarts = append(ecarts, b1-b0)
				}
			}
		}
		if len(ecarts) == 0 {
			continue
		}
		sort.Float64s(ecarts)
		n := float64(r.Nombre[2])
		median, cellule, bord := ecarts[len(ecarts)/2], (r.Max[2]-r.Min[2])/n, (r.Max[2]-r.Min[2])/(n-1)
		t.Logf("region %2d : %3d paires, ecart median %.3f ; centre des cellules %.3f, bord a bord %.3f",
			i, len(ecarts), median, cellule, bord)
		if i == 0 && (len(ecarts) < 100 || math.Abs(median-cellule) > 0.05 || math.Abs(median-bord) < 0.1) {
			t.Fatalf("region 0 : ecart median %.3f sur %d paires, attendu %.3f (cellules)", median, len(ecarts), cellule)
		}
	}
}

func demiFlottant(h uint16) float64 {
	s := 1.0
	if h&0x8000 != 0 {
		s = -1
	}
	e := int(h>>10) & 31
	m := float64(h & 0x3ff)
	if e == 0 {
		return s * m / 1024 * math.Pow(2, -14)
	}
	return s * (1 + m/1024) * math.Pow(2, float64(e-15))
}

// cielMoyen : la direction moyenne, dans le repere du decodage, des texels de la deuxieme
// texture de chaque region (8 bits, clairs ou la sonde voit le ciel).
func cielMoyen(t *testing.T) [3]float64 {
	dir, _ := LevelsDir("pc")
	m, err := himodule.Open(filepath.Join(dir, "sgh_blueprint", "sgh_blueprint-rtx-new.module"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = m.Close() }()
	ti, err := tagDeEntree(m, m.Files(GroupeLumiereStatique)[0])
	if err != nil {
		t.Fatal(err)
	}
	regions, debuts, id, err := litRegionsSondes(ti)
	if err != nil {
		t.Fatal(err)
	}
	f, _ := entreeParID(m, GroupeBitmap, id)
	res, _ := m.Ressources(f)
	var s [3]float64
	var poids float64
	for i, r := range regions {
		brut, err := m.Extract(res[debuts[i]+1])
		if err != nil {
			t.Fatal(err)
		}
		d := res[debuts[i]+1].Donnees(brut)
		l, h := r.Nombre[0]*TuileSonde, r.Nombre[1]*TuileSonde
		for z := 0; z < r.Nombre[2]; z++ {
			for y := 0; y < r.Nombre[1]; y++ {
				for x := 0; x < r.Nombre[0]; x++ {
					for j := 0; j < TuileSonde-2; j++ {
						for k := 0; k < TuileSonde-2; k++ {
							v := float64(d[z*l*h+(y*TuileSonde+j+1)*l+x*TuileSonde+k+1]) / 255
							e := decodeOctaedre(k, j)
							for a := 0; a < 3; a++ {
								s[a] += v * e[a]
							}
							poids += v
						}
					}
				}
			}
		}
	}
	for a := range s {
		s[a] /= poids
	}
	return s
}

// basesSignees : les 48 matrices de permutation signee 3 x 3 (ligne k = axe monde de la
// composante k du decodage).
func basesSignees() [][3][3]float64 {
	perms := [][3]int{{0, 1, 2}, {0, 2, 1}, {1, 0, 2}, {1, 2, 0}, {2, 0, 1}, {2, 1, 0}}
	var out [][3][3]float64
	for _, p := range perms {
		for signes := 0; signes < 8; signes++ {
			var b [3][3]float64
			for k := 0; k < 3; k++ {
				s := 1.0
				if signes&(1<<k) != 0 {
					s = -1
				}
				b[k][p[k]] = s
			}
			out = append(out, b)
		}
	}
	return out
}

// decodeOctaedre : la direction (repere du decodage) du texel (i, j) de l'interieur d'une tuile.
func decodeOctaedre(i, j int) [3]float64 {
	n := float64(TuileSonde - 2)
	u, v := (float64(i)+0.5)/n*2-1, (float64(j)+0.5)/n*2-1
	z := 1 - math.Abs(u) - math.Abs(v)
	if z < 0 {
		u, v = (1-math.Abs(v))*math.Copysign(1, u), (1-math.Abs(u))*math.Copysign(1, v)
	}
	l := math.Sqrt(u*u + v*v + z*z)
	return [3]float64{u / l, v / l, z / l}
}

// clarteTexel : R + V + B d'un texel R11G11B10 flottant.
func clarteTexel(d []byte, i int) float64 {
	p := binary.LittleEndian.Uint32(d[4*i:])
	return flottantPetit(p&0x7ff, 6) + flottantPetit((p>>11)&0x7ff, 6) + flottantPetit((p>>22)&0x3ff, 5)
}

func flottantPetit(v uint32, bitsMantisse uint) float64 {
	m := float64(v & (1<<bitsMantisse - 1))
	e := int(v >> bitsMantisse)
	un := float64(uint32(1) << bitsMantisse)
	if e == 0 {
		return m / un * math.Pow(2, -14)
	}
	return (1 + m/un) * math.Pow(2, float64(e-15))
}

// tuileSonde : la clarte des texels interieurs de la sonde (x, y, z) d'une region.
func tuileSonde(r RegionSondes, x, y, z int) []float64 {
	l, h := r.Nombre[0]*TuileSonde, r.Nombre[1]*TuileSonde
	out := make([]float64, 0, (TuileSonde-2)*(TuileSonde-2))
	for j := 1; j < TuileSonde-1; j++ {
		for i := 1; i < TuileSonde-1; i++ {
			out = append(out, clarteTexel(r.Irradiance, z*l*h+(y*TuileSonde+j)*l+x*TuileSonde+i))
		}
	}
	return out
}

func correlationsOrientation(s SondesLumiere, base [3][3]float64) [3]float64 {
	var dirs [][3]float64
	for j := 0; j < TuileSonde-2; j++ {
		for i := 0; i < TuileSonde-2; i++ {
			e := decodeOctaedre(i, j)
			var w [3]float64
			for k := 0; k < 3; k++ {
				for a := 0; a < 3; a++ {
					w[a] += e[k] * base[k][a]
				}
			}
			dirs = append(dirs, w)
		}
	}
	var out [3]float64
	for a := 0; a < 3; a++ {
		var xs, ys []float64
		for _, r := range s.Regions {
			moyennes := moyennesSondes(r)
			n := r.Nombre
			for z := 0; z < n[2]; z++ {
				for y := 0; y < n[1]; y++ {
					for x := 0; x < n[0]; x++ {
						p := [3]int{x, y, z}
						lo, hi := p, p
						lo[a]--
						hi[a]++
						if lo[a] < 0 || hi[a] >= n[a] {
							continue
						}
						at := func(q [3]int) float64 { return moyennes[(q[2]*n[1]+q[1])*n[0]+q[0]] }
						if at(p) == 0 || at(lo) == 0 || at(hi) == 0 {
							continue
						}
						tuile := tuileSonde(r, x, y, z)
						var moment float64
						for k, c := range tuile {
							moment += c * dirs[k][a]
						}
						xs = append(xs, moment/at(p))
						ys = append(ys, math.Log(at(hi)/at(lo)))
					}
				}
			}
		}
		out[a] = pearson(xs, ys)
	}
	return out
}

func moyennesSondes(r RegionSondes) []float64 {
	n := r.Nombre
	out := make([]float64, n[0]*n[1]*n[2])
	for z := 0; z < n[2]; z++ {
		for y := 0; y < n[1]; y++ {
			for x := 0; x < n[0]; x++ {
				var s float64
				for _, c := range tuileSonde(r, x, y, z) {
					s += c
				}
				out[(z*n[1]+y)*n[0]+x] = s
			}
		}
	}
	return out
}

func pearson(xs, ys []float64) float64 {
	if len(xs) < 2 {
		return 0
	}
	var mx, my float64
	for i := range xs {
		mx += xs[i]
		my += ys[i]
	}
	mx /= float64(len(xs))
	my /= float64(len(ys))
	var sxy, sxx, syy float64
	for i := range xs {
		dx, dy := xs[i]-mx, ys[i]-my
		sxy += dx * dy
		sxx += dx * dx
		syy += dy * dy
	}
	if sxx == 0 || syy == 0 {
		return 0
	}
	return sxy / math.Sqrt(sxx*syy)
}
