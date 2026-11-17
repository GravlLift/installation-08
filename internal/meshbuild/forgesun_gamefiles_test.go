// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package meshbuild

import (
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestForgeSunStored reads the Sun settings of three stored Forge maps (IT3D_DATA_DIR's
// matches/<id>/map.mvar) and resolves each over its installed canvas's dynamic sun, as the world
// build does: the variant's yaw and pitch with the canvas's hour angle and season, the variant's
// intensity. Origin's sun was its canvas's (fo08_wetland: azimuth 141.8, elevation 41.8).
func TestForgeSunStored(t *testing.T) {
	data := os.Getenv("IT3D_DATA_DIR")
	if data == "" {
		t.Skip("IT3D_DATA_DIR unset")
	}
	levels, err := himap.LevelsDir("pc")
	if err != nil {
		t.Skip(err)
	}
	for _, c := range []struct {
		name, match string
		intensity   float64
		dir         [3]float64
	}{
		{"Origin", "27de812c-b32e-4d2c-8d54-87a488c8a921", 2, [3]float64{0, 0.8032, 0.5957}},
		{"Fortress", "dea65712-691c-4902-bfb1-1404340e4b67", 25, [3]float64{0.0989, -0.0571, 0.9935}},
		{"Vacancy", "f8a8d3de-f15f-46e6-a6bd-71dcd29f952e", 19, [3]float64{-0.0460, 0.0386, 0.9982}},
	} {
		blob, err := os.ReadFile(filepath.Join(data, "matches", c.match, "map.mvar"))
		if err != nil {
			t.Skip(err)
		}
		v, err := mapvar.Parse(blob)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		module := modulePathIn(levels, canvasByLevelID[v.LevelID])
		if module == "" {
			t.Skipf("%s: canvas not installed", c.name)
		}
		n, err := himap.LitNiveau(module)
		if err != nil || len(n.Structures) == 0 {
			t.Fatalf("%s: scenario %v", c.name, err)
		}
		src, err := himap.SourcesLumiereDe(module, module, n.Structures[0].BSP)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		p, err := himap.LitParametresSoleil(src.ModuleEtat, src.EtatDuMonde)
		if err != nil {
			t.Fatalf("%s: canvas sun: %v", c.name, err)
		}
		az, lat := forgeSunDirection(v.Lighting)
		if az == nil || lat == nil || v.Lighting.SunIntensity == nil || *v.Lighting.SunIntensity != c.intensity {
			t.Fatalf("%s: lighting %+v", c.name, v.Lighting)
		}
		canvasAz, canvasLat := p.Azimut, p.Latitude
		p.Azimut, p.Latitude = *az, *lat
		s, ok := p.Soleil()
		if !ok {
			t.Fatalf("%s: no sun", c.name)
		}
		for i := range s.Direction {
			if math.Abs(s.Direction[i]-c.dir[i]) > 0.002 {
				t.Fatalf("%s: direction %v, want %v", c.name, s.Direction, c.dir)
			}
		}
		t.Logf("%-8s yaw %.1f pitch %.1f over canvas azimuth %.1f latitude %.1f (hour %.1f, season %.2f): dir %.3f elevation %.1f",
			c.name, *az, *lat, canvasAz, canvasLat, p.AngleHoraire, p.Saison, s.Direction, math.Asin(s.Direction[2])*180/math.Pi)
	}
}
