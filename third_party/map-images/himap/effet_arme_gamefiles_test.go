//go:build gamefiles

package himap

// effet_arme_gamefiles_test.go (LOCAL-CHANGE (infinite-theater-3d)) — the Shock Rifle's idle
// electricity, read from the installed game: effect 1e471031, its six particles, their shaders
// and meshes.

import (
	"context"
	"math"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

const (
	effetFusilChoc   = 0x1e471031
	armeFusilChoc    = 0x1a22fee6
	lieuCanon        = 0x55990be4 // the effect's location 1, on the housing
	lieuArriere      = 0xaf9ed4c5 // location 2, the rear of the housing
	cameraPremiere   = 1
	cameraTroisieme  = 2
	systemeSansADS   = 1 << 16 // system flags: disable in aimed down sight
	systemeTueEvenmt = 1 << 19 // system flags: particles hard killed when event is dead
)

func ouvreArsenalChoc(t *testing.T) *Arsenal {
	t.Helper()
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	a, err := OuvreArsenal(racine, filepath.Join(racine, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module"))
	if err != nil {
		t.Skip(err)
	}
	t.Cleanup(func() { _ = a.Close() })
	return a
}

func pres(a, b float32) bool { return math.Abs(float64(a-b)) < 1e-4 }

// TestEffetFusilChoc pins the effect: twelve systems (six first person only, six third person
// only, the events of its first level), each readable, with the values the view simulates.
func TestEffetFusilChoc(t *testing.T) {
	a := ouvreArsenalChoc(t)
	e, err := a.EffetDeParticules(effetFusilChoc)
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Skipped) != 0 || len(e.Systems) != 12 || e.CameraRange != [2]float32{1, 120} {
		t.Fatalf("systems %d skipped %v range %v", len(e.Systems), e.Skipped, e.CameraRange)
	}
	parCamera := map[int]int{}
	for _, s := range e.Systems {
		parCamera[s.CameraMode]++
		// Only the first-person systems are turned off in aimed-down-sight.
		if s.Render.BlendMode != melangeAddSrcAlpha || s.Coordinate != 1 || s.EventDuration != [2]float32{1, 1} ||
			(s.Flags&systemeSansADS != 0) != (s.CameraMode == cameraPremiere) {
			t.Errorf("system of %08x: blend %d coordinate %d duration %v flags %08x", s.Render.Particle, s.Render.BlendMode,
				s.Coordinate, s.EventDuration, s.Flags)
		}
	}
	if parCamera[cameraPremiere] != 6 || parCamera[cameraTroisieme] != 6 {
		t.Errorf("camera modes %v", parCamera)
	}

	// The arcs: a sprite of four frames on a cylinder along the barrel, perpendicular to it.
	s0 := e.Systems[0]
	if s0.Render.Particle != 0xc2c1d7da || s0.Location != lieuCanon || s0.Render.Model != 0 || s0.Render.Shader != 0x9b1c511e ||
		s0.Emitter.Shape != 10 || s0.Emitter.Billboard != 3 || s0.Emitter.AxisScale != [3]float32{0.045, 1, 0} ||
		s0.Emitter.Direction != [3]float32{1, 0, 0} {
		t.Errorf("arcs = %+v", s0)
	}
	if got := []uint32{s0.Render.Textures[0].Bitmap, s0.Render.Textures[1].Bitmap, s0.Render.Textures[2].Bitmap}; got[0] != 0xa119e9dd ||
		got[1] != 0xa119e9dd || got[2] != 0xb5c0b591 {
		t.Errorf("arc textures %08x", got)
	}
	if c := s0.Render.Constants; c["baseTexture_texture_frameCount"][0] != 4 || c["useAlphaMapRed"][0] != 1 ||
		c["baseTextureInvert"][0] != 0 || c["baseTexture_texture_transform"][0] != 1 {
		t.Errorf("arc constants %v", c)
	}
	p := s0.Emitter.Properties
	if l := p["lifespan"]; l.Type != fonctionConstante || !l.Ranged || !pres(l.Min, 0.2) || !pres(l.Max, 0.135) {
		t.Errorf("lifespan %+v", l)
	}
	if r := p["emissionRate"]; r.Type != fonctionMultiSpline || r.Input != 14 || r.Max != 8 || len(r.Curves) != 1 ||
		len(r.Curves[0]) != 1 || !pres(r.Curves[0][0].Coefs[0], 0.0625) || !pres(r.Curves[0][0].Coefs[2], 2.0625) {
		t.Errorf("emission rate %+v", r)
	}
	if al := p["alpha"]; len(al.Curves) != 1 || len(al.Curves[0]) != 2 || !pres(al.Curves[0][0].End, 0.8983) ||
		!pres(al.Curves[0][1].Coefs[0], 9.836063) || !pres(al.Curves[0][1].Coefs[1], -8.836063) || al.Min != 1 || al.Max != 0 {
		t.Errorf("alpha %+v", al)
	}
	if sz := p["size"]; !sz.Ranged || len(sz.Curves) != 2 || !pres(sz.Min, 0.01) || !pres(sz.Max, 0.042) {
		t.Errorf("size %+v", sz)
	}
	if ti := p["tint"]; ti.Color == nil || *ti.Color != [3]float32{1, 1, 1} {
		t.Errorf("tint %+v", ti)
	}

	// The shell: a mesh around the housing, on the scrolling model shader.
	s4 := e.Systems[4]
	if s4.Render.Particle != 0x3ac39257 || s4.Render.Model != 0x3c8e80bc || s4.Render.Shader != 0x96db07b6 || s4.Location != lieuCanon ||
		s4.Flags&systemeTueEvenmt == 0 {
		t.Errorf("shell = %+v", s4)
	}
	if in := s4.Emitter.Properties["intensity"]; in.Type != fonctionIdentite || in.Input != 13 || in.Max != 20 {
		t.Errorf("shell intensity %+v", in)
	}
	if c := s4.Render.Constants; c["basemapScaleV"][0] != 4 || c["basemapSlideV"][0] != -2 || c["fresnelIntensity"][0] != 2 ||
		!pres(float32(c["baseMapUVDistortionStrength"][0]), 0.1) || c["baseMapUseScrollingUV"][0] != 1 {
		t.Errorf("shell constants %v", c)
	}
	if sc := s4.Emitter.Properties["startingCount"]; sc.Min != 2 {
		t.Errorf("shell starting count %+v", sc)
	}

	// The bolts: a mesh sliding forward from the rear of the housing.
	s5 := e.Systems[5]
	if s5.Render.Particle != 0x17c8a1d4 || s5.Render.Model != 0x1338bc59 || s5.Location != lieuArriere {
		t.Errorf("bolts = %+v", s5)
	}
	if v := s5.Emitter.Properties["velocity"]; !v.Ranged || !pres(v.Min, 0.12) || !pres(v.Max, 0.15) {
		t.Errorf("bolt velocity %+v", v)
	}
}

// TestDispositionsParticulesDuShader: every constant of a particle shader layout whose StringID
// (of its lowercased name) the shader declares sits at the byte the shader declares it at.
func TestDispositionsParticulesDuShader(t *testing.T) {
	a := ouvreArsenalChoc(t)
	for id, d := range dispositionsParticules {
		raw, err := a.geo.Extract(id)
		if err != nil {
			t.Fatalf("%08x: %v", id, err)
		}
		params, err := LitParametresShader(raw)
		if err != nil {
			t.Fatalf("%08x: %v", id, err)
		}
		vus := 0
		for _, c := range d.constantes {
			o, ok := params[uint32(mapvar.LabelHash(strings.ToLower(c.nom)))]
			if !ok {
				continue
			}
			vus++
			if o != c.octet {
				t.Errorf("%08x %s: byte %d, the shader declares %d", id, c.nom, c.octet, o)
			}
		}
		if vus < 10 {
			t.Errorf("%08x: only %d constants cross-checked", id, vus)
		}
	}
}

// TestModelesParticulesFusilChoc: the three particle meshes, read from their tags' own buffers.
func TestModelesParticulesFusilChoc(t *testing.T) {
	a := ouvreArsenalChoc(t)
	for id, tris := range map[uint32]int{0x3c8e80bc: 2400, 0x1338bc59: 40, 0x1ed87b61: 28} {
		m, err := a.ModeleDeParticule(context.Background(), id)
		if err != nil {
			t.Fatalf("%08x: %v", id, err)
		}
		if len(m.Triangles) != tris || len(m.UV) != len(m.Sommets) {
			t.Errorf("%08x: %d triangles, %d uv for %d vertices", id, len(m.Triangles), len(m.UV), len(m.Sommets))
		}
	}
	// The shell hugs the housing: 10.7 x 4 x 4 cm around its marker.
	m, _ := a.ModeleDeParticule(context.Background(), 0x3c8e80bc)
	mn, mx := m.Sommets[0], m.Sommets[0]
	for _, v := range m.Sommets {
		for c := 0; c < 3; c++ {
			mn[c], mx[c] = min(mn[c], v[c]), max(mx[c], v[c])
		}
	}
	if math.Abs(mn[0]+0.060) > 0.002 || math.Abs(mx[0]-0.047) > 0.002 || math.Abs(mx[2]-0.020) > 0.002 {
		t.Errorf("shell bounds %v %v", mn, mx)
	}
}

// TestMarqueursFusilChoc: the effect's locations on the rifle's model, identity rotations, on its
// root node; the first-person view draws the same model.
func TestMarqueursFusilChoc(t *testing.T) {
	a := ouvreArsenalChoc(t)
	mode, ok := a.ModeleDeLArme(armeFusilChoc)
	if !ok || mode != 0xec1363e7 {
		t.Fatalf("mode %08x %v", mode, ok)
	}
	ms, err := a.MarqueursDuModele(mode, map[uint32]bool{lieuCanon: true, lieuArriere: true})
	if err != nil || len(ms) != 2 {
		t.Fatalf("markers %+v %v", ms, err)
	}
	for _, m := range ms {
		if m.Rotation != [4]float64{0, 0, 0, 1} || m.Noeud != 0 || m.NomNoeud == "" {
			t.Errorf("marker %+v", m)
		}
		want := map[uint32]float64{lieuCanon: 0.3058, lieuArriere: 0.1770}[m.Nom]
		if math.Abs(m.Translation[0]-want) > 1e-3 || math.Abs(m.Translation[2]-0.0438) > 1e-3 {
			t.Errorf("marker %08x at %v", m.Nom, m.Translation)
		}
	}
	src, err := a.SourcesArme(armeFusilChoc)
	if err != nil || src.Mode != mode {
		t.Errorf("first-person model %08x (%v), third person %08x", src.Mode, err, mode)
	}
}
