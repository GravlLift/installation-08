// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package meshbuild

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"
	"github.com/llampwall/infinite-theater-3d/internal/mapref"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-map-images/himap"
)

// solidsBaseline is, per stored match (id prefix), the player positions found inside the placed
// Forge solids of its variant layer before the telescoping cylinders were sized about their
// centre (fix/forge-light-2, from integration 28248ac): feet and torso samples. A layer change
// must not raise either on any map.
var solidsBaseline = map[string][2]int{
	"05dfe4e9": {1861, 1},  // Outlook, Husky Raid:CTF
	"0d4244de": {0, 0},     // Recharge, Strongholds
	"19628ee2": {0, 0},     // Live Fire, Strongholds
	"27de812c": {948, 150}, // Origin, Slayer
	"7d798138": {0, 0},     // Live Fire, Oddball
	"9220185c": {0, 0},     // Recharge, Slayer
	"a2c79b5e": {0, 0},     // Recharge, Slayer
	"abb84d42": {0, 0},     // Live Fire, Strongholds
	"aea65837": {0, 0},     // Streets, Strongholds
	"d01ba030": {0, 0},     // Recharge, King of the Hill
	"de4e1bc4": {47, 100},  // Solitude, King of the Hill
	"dea65712": {159, 174}, // Fortress, CTF 3 Captures
	"ee234787": {0, 0},     // Streets, Slayer
	"f8a8d3de": {8, 39},    // Vacancy, Oddball
	"f9a8ab62": {0, 0},     // Aquarius, CTF 5 Captures
}

// TestVariantSolidsHoldNoPlayers builds the object layer of every stored match with a map
// variant (IT3D_DATA_DIR's matches/<id>/map.mvar), geometry only (himap.CollecteSolidesVariante),
// and counts the replay's player positions that lie inside a placed solid by more than
// solidMargin: the feet sample, and a torso sample torsoHeight above it. A player cannot stand
// inside a solid, so each one marks geometry placed where the game has none (or a mesh that is
// not closed). It prints the table and fails when a count rises above solidsBaseline.
func TestVariantSolidsHoldNoPlayers(t *testing.T) {
	data := os.Getenv("IT3D_DATA_DIR")
	if data == "" {
		t.Skip("IT3D_DATA_DIR unset")
	}
	gameRoot, err := himap.DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	levels := filepath.Join(gameRoot, "pc", "levels", "multi")
	catalog, err := mapref.DefaultForgeObjects()
	if err != nil {
		t.Fatal(err)
	}
	invisible, err := mapmesh.ForgeHiddenObjects(catalog)
	if err != nil {
		t.Fatal(err)
	}
	dirs, err := os.ReadDir(filepath.Join(data, "matches"))
	if err != nil {
		t.Skip(err)
	}
	only := os.Getenv("IT3D_SOLIDS_ONLY")
	var table []string
	for _, d := range dirs {
		dir := filepath.Join(data, "matches", d.Name())
		if only != "" && !strings.HasPrefix(d.Name(), only) {
			continue
		}
		m, ok := loadStoredMatch(t, dir)
		if !ok {
			continue
		}
		module, err := resolveVariantModule(m.module, m.variant.LevelID, levels)
		if err != nil {
			t.Logf("%s: %v", d.Name(), err)
			continue
		}
		layer, _, err := himap.CollecteSolidesVariante(context.Background(), himap.OptionsVariante{
			RacineDeploy: gameRoot, CheminModule: module, Objets: m.variant.Objects,
			Invisibles: invisible, Filtres: mapmesh.ModeFilters(m.mode),
		})
		if err != nil {
			t.Fatalf("%s: %v", d.Name(), err)
		}
		s := newSolidIndex(layer.Poses)
		feet, torso := 0, 0
		byObject := map[int]int{}
		for _, p := range m.points {
			if o, in := s.holds(p); in {
				feet++
				byObject[o]++
			}
			if o, in := s.holds([3]float64{p[0], p[1], p[2] + torsoHeight}); in {
				torso++
				byObject[o]++
			}
		}
		key := d.Name()[:8]
		row := fmt.Sprintf("%s %-22s %-24s points %6d  feet %5d  torso %5d  worst %s", key, m.name, m.mode, len(m.points), feet, torso, worstObjects(byObject, m.variant.Objects))
		table = append(table, row)
		t.Log(row)
		if out := os.Getenv("IT3D_SOLIDS_DETAIL"); out != "" {
			var lines []string
			for o, n := range byObject {
				lines = append(lines, fmt.Sprintf("%s #%d type %d mode %d: %d", key, o, m.variant.Objects[o].TypeID, m.variant.Objects[o].ModeForge, n))
			}
			sort.Strings(lines)
			_ = os.WriteFile(filepath.Join(out, key+".txt"), []byte(strings.Join(lines, "\n")+"\n"), 0o600)
		}
		if b, ok := solidsBaseline[key]; ok && (feet > b[0] || torso > b[1]) {
			t.Errorf("%s (%s): feet %d torso %d inside solids, baseline %d / %d", key, m.name, feet, torso, b[0], b[1])
		}
	}
	fmt.Println(strings.Join(table, "\n"))
}

const (
	// solidMargin: a sample counts when it and its six neighbours this far along the world
	// axes all lie inside the same placed solid.
	solidMargin = 0.1
	// torsoHeight: the torso sample, above the replay's feet position.
	torsoHeight = 0.9
)

type storedMatch struct {
	name, module, mode string
	variant            *mapvar.Variant
	points             [][3]float64
}

// loadStoredMatch reads a stored match's variant, map module, mode and replay track points;
// false when one of them is missing.
func loadStoredMatch(t *testing.T, dir string) (storedMatch, bool) {
	var m storedMatch
	blob, err := os.ReadFile(filepath.Join(dir, "map.mvar"))
	if err != nil {
		return m, false
	}
	if m.variant, err = mapvar.Parse(blob); err != nil {
		t.Logf("%s: %v", dir, err)
		return m, false
	}
	var meta struct {
		MapModule string `json:"mapModule"`
		MapName   string `json:"mapName"`
	}
	var stats struct {
		GameVariantName string `json:"gameVariantName"`
	}
	if !readJSON(filepath.Join(dir, "match.json"), &meta) || !readJSON(filepath.Join(dir, "stats.json"), &stats) {
		return m, false
	}
	m.name, m.module, m.mode = meta.MapName, meta.MapModule, stats.GameVariantName
	f, err := os.Open(filepath.Join(dir, "replay.json.gz"))
	if err != nil {
		return m, false
	}
	defer func() { _ = f.Close() }()
	zr, err := gzip.NewReader(f)
	if err != nil {
		return m, false
	}
	var replay struct {
		Tracks []struct {
			Points []struct{ X, Y, Z float64 } `json:"points"`
		} `json:"tracks"`
	}
	if err := json.NewDecoder(zr).Decode(&replay); err != nil {
		return m, false
	}
	for _, tr := range replay.Tracks {
		for _, p := range tr.Points {
			m.points = append(m.points, [3]float64{p.X, p.Y, p.Z})
		}
	}
	return m, len(m.points) > 0
}

func readJSON(path string, v any) bool {
	raw, err := os.ReadFile(path) //nolint:gosec // test input under IT3D_DATA_DIR
	return err == nil && json.Unmarshal(raw, v) == nil
}

// worstObjects names the five objects holding the most samples: #index:type:count.
func worstObjects(by map[int]int, objects []mapvar.Object) string {
	ks := make([]int, 0, len(by))
	for k := range by {
		ks = append(ks, k)
	}
	sort.Slice(ks, func(a, b int) bool { return by[ks[a]] > by[ks[b]] || by[ks[a]] == by[ks[b]] && ks[a] < ks[b] })
	var out []string
	for i, k := range ks {
		if i == 5 {
			break
		}
		ty := int32(0)
		if k < len(objects) {
			ty = objects[k].TypeID
		}
		out = append(out, fmt.Sprintf("#%d:%d:%d", k, ty, by[k]))
	}
	return strings.Join(out, " ")
}

// solidIndex finds the placed solids (visible geometries) around a world point.
type solidIndex struct {
	poses  *himap.PosesVariante
	placed []placedSolid
	cells  map[[2]int][]int
	geos   map[int]*localSolid
}

// placedSolid is one placement: its world box and the inverse of its world transform.
type placedSolid struct {
	object, geometry int
	min, max         [3]float64
	inv              [3][3]float64
	origin           [3]float64
}

const solidCell = 2.0

func newSolidIndex(pv *himap.PosesVariante) *solidIndex {
	s := &solidIndex{poses: pv, cells: map[[2]int][]int{}, geos: map[int]*localSolid{}}
	for _, p := range pv.Poses {
		g := &pv.Geometries[p.Geometrie]
		if g.Ombre {
			continue
		}
		lo, hi, ok := g.Maillage.Borne()
		if !ok {
			continue
		}
		in := p.Monde()
		basis := [3][3]float64{}
		for a := range 3 {
			basis[a] = [3]float64{in.Forward[a] * in.Scale[0], in.Left[a] * in.Scale[1], in.Up[a] * in.Scale[2]}
		}
		inv, ok := invert3(basis)
		if !ok {
			continue
		}
		ps := placedSolid{object: p.Objet, geometry: p.Geometrie, inv: inv, origin: in.Position}
		for a := range 3 {
			ps.min[a], ps.max[a] = math.Inf(1), math.Inf(-1)
		}
		for c := range 8 {
			l := [3]float64{float64(lo[0]), float64(lo[1]), float64(lo[2])}
			for a := range 3 {
				if c>>a&1 == 1 {
					l[a] = float64(hi[a])
				}
			}
			w := in.LocalToWorld(l)
			for a := range 3 {
				ps.min[a], ps.max[a] = math.Min(ps.min[a], w[a]), math.Max(ps.max[a], w[a])
			}
		}
		k := len(s.placed)
		s.placed = append(s.placed, ps)
		for x := int(math.Floor(ps.min[0] / solidCell)); x <= int(math.Floor(ps.max[0]/solidCell)); x++ {
			for y := int(math.Floor(ps.min[1] / solidCell)); y <= int(math.Floor(ps.max[1]/solidCell)); y++ {
				s.cells[[2]int{x, y}] = append(s.cells[[2]int{x, y}], k)
			}
		}
	}
	return s
}

// holds reports whether `p` and its six solidMargin neighbours lie inside one placed solid, and
// that solid's object index.
func (s *solidIndex) holds(p [3]float64) (int, bool) {
	cell := [2]int{int(math.Floor(p[0] / solidCell)), int(math.Floor(p[1] / solidCell))}
	for _, k := range s.cells[cell] {
		ps := &s.placed[k]
		inBox := true
		for a := range 3 {
			if p[a]-solidMargin < ps.min[a] || p[a]+solidMargin > ps.max[a] {
				inBox = false
			}
		}
		if !inBox {
			continue
		}
		g := s.local(ps.geometry)
		all := g.inside(ps.toLocal(p))
		for a := 0; all && a < 3; a++ {
			for _, d := range []float64{-solidMargin, solidMargin} {
				q := p
				q[a] += d
				if !g.inside(ps.toLocal(q)) {
					all = false
					break
				}
			}
		}
		if all {
			return ps.object, true
		}
	}
	return 0, false
}

func (ps *placedSolid) toLocal(w [3]float64) [3]float64 {
	d := [3]float64{w[0] - ps.origin[0], w[1] - ps.origin[1], w[2] - ps.origin[2]}
	var l [3]float64
	for r := range 3 {
		l[r] = ps.inv[r][0]*d[0] + ps.inv[r][1]*d[1] + ps.inv[r][2]*d[2]
	}
	return l
}

func (s *solidIndex) local(k int) *localSolid {
	if g, ok := s.geos[k]; ok {
		return g
	}
	g := newLocalSolid(&s.poses.Geometries[k].Maillage)
	s.geos[k] = g
	return g
}

// localSolid is a geometry's triangles in its model frame, binned on X and Y for a +Z ray.
type localSolid struct {
	tris       [][3][3]float64
	min, max   [3]float64
	n          int
	sx, sy     float64
	bins       [][]int
	rayJitterX float64
	rayJitterY float64
}

const solidBins = 48

func newLocalSolid(g *himap.GroupeMaillage) *localSolid {
	l := &localSolid{n: solidBins, rayJitterX: 1.234567e-5, rayJitterY: 7.654321e-6}
	lo, hi, _ := g.Borne()
	for a := range 3 {
		l.min[a], l.max[a] = float64(lo[a]), float64(hi[a])
	}
	l.sx = math.Max((l.max[0]-l.min[0])/float64(l.n), 1e-9)
	l.sy = math.Max((l.max[1]-l.min[1])/float64(l.n), 1e-9)
	l.bins = make([][]int, l.n*l.n)
	v := func(i uint32) [3]float64 {
		return [3]float64{float64(g.Sommets[3*i]), float64(g.Sommets[3*i+1]), float64(g.Sommets[3*i+2])}
	}
	for _, ix := range g.Indices {
		for t := 0; t+2 < len(ix); t += 3 {
			tri := [3][3]float64{v(ix[t]), v(ix[t+1]), v(ix[t+2])}
			k := len(l.tris)
			l.tris = append(l.tris, tri)
			x0, x1 := l.binX(math.Min(tri[0][0], math.Min(tri[1][0], tri[2][0]))), l.binX(math.Max(tri[0][0], math.Max(tri[1][0], tri[2][0])))
			y0, y1 := l.binY(math.Min(tri[0][1], math.Min(tri[1][1], tri[2][1]))), l.binY(math.Max(tri[0][1], math.Max(tri[1][1], tri[2][1])))
			for x := x0; x <= x1; x++ {
				for y := y0; y <= y1; y++ {
					l.bins[x*l.n+y] = append(l.bins[x*l.n+y], k)
				}
			}
		}
	}
	return l
}

func (l *localSolid) binX(x float64) int { return clampBin(int((x-l.min[0])/l.sx), l.n) }
func (l *localSolid) binY(y float64) int { return clampBin(int((y-l.min[1])/l.sy), l.n) }

func clampBin(i, n int) int {
	return max(0, min(n-1, i))
}

// inside casts a ray from `p` along +Z and counts the triangles it crosses: odd is inside.
func (l *localSolid) inside(p [3]float64) bool {
	for a := range 3 {
		if p[a] < l.min[a] || p[a] > l.max[a] {
			return false
		}
	}
	x, y := p[0]+l.rayJitterX, p[1]+l.rayJitterY
	crossings := 0
	for _, k := range l.bins[l.binX(x)*l.n+l.binY(y)] {
		t := &l.tris[k]
		// Barycentric test of (x, y) in the triangle's XY projection.
		x0, y0 := t[0][0], t[0][1]
		x1, y1 := t[1][0], t[1][1]
		x2, y2 := t[2][0], t[2][1]
		den := (y1-y2)*(x0-x2) + (x2-x1)*(y0-y2)
		if math.Abs(den) < 1e-14 {
			continue
		}
		a := ((y1-y2)*(x-x2) + (x2-x1)*(y-y2)) / den
		b := ((y2-y0)*(x-x2) + (x0-x2)*(y-y2)) / den
		c := 1 - a - b
		if a < 0 || b < 0 || c < 0 {
			continue
		}
		if z := a*t[0][2] + b*t[1][2] + c*t[2][2]; z > p[2] {
			crossings++
		}
	}
	return crossings%2 == 1
}

func invert3(m [3][3]float64) ([3][3]float64, bool) {
	det := m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0])
	if math.Abs(det) < 1e-12 {
		return m, false
	}
	var r [3][3]float64
	r[0][0] = (m[1][1]*m[2][2] - m[1][2]*m[2][1]) / det
	r[0][1] = (m[0][2]*m[2][1] - m[0][1]*m[2][2]) / det
	r[0][2] = (m[0][1]*m[1][2] - m[0][2]*m[1][1]) / det
	r[1][0] = (m[1][2]*m[2][0] - m[1][0]*m[2][2]) / det
	r[1][1] = (m[0][0]*m[2][2] - m[0][2]*m[2][0]) / det
	r[1][2] = (m[0][2]*m[1][0] - m[0][0]*m[1][2]) / det
	r[2][0] = (m[1][0]*m[2][1] - m[1][1]*m[2][0]) / det
	r[2][1] = (m[0][1]*m[2][0] - m[0][0]*m[2][1]) / det
	r[2][2] = (m[0][0]*m[1][1] - m[0][1]*m[1][0]) / det
	return r, true
}
