// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

// LOCAL-CHANGE (infinite-theater-3d): the equipment pad's lens flares and cheap lights.

package himap

import (
	"encoding/json"
	"math"
	"path/filepath"
	"testing"
)

func padArsenal(t *testing.T) *Arsenal {
	t.Helper()
	root, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	a, err := OuvreArsenal(root, filepath.Join(root, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Close() })
	return a
}

func proche(a, b float32) bool { return math.Abs(float64(a-b)) < 1e-3 }

func TestPadLensFlareTag(t *testing.T) {
	a := padArsenal(t)
	for _, id := range []uint32{0xc2f90227, 0x37393001} {
		l, err := a.LensFlareTag(id)
		if err != nil {
			t.Fatal(err)
		}
		if !proche(l.FalloffAngle, 1.134464) || !proche(l.CutoffAngle, 1.3962634) || l.FarFade != [2]float32{10, 20} || l.Bitmap != 0x6926c65d {
			t.Errorf("%08x root %+v", id, l)
		}
		if len(l.Reflections) != 5 {
			t.Fatalf("%08x: %d reflections", id, len(l.Reflections))
		}
		b, _ := json.Marshal(l)
		t.Logf("%08x %s", id, b)
		r := l.Reflections[0]
		if r.Bitmap != 0x426b31d5 || r.Flags&LensReflectionNoRender != 0 || r.RotationOffset != 90 {
			t.Errorf("%08x reflection 0 %+v", id, r)
		}
		for k := 3; k < 5; k++ {
			if l.Reflections[k].Flags&LensReflectionNoRender == 0 {
				t.Errorf("%08x reflection %d should not render", id, k)
			}
		}
	}
	l, _ := a.LensFlareTag(0xc2f90227)
	r := l.Reflections[0]
	if !proche(r.Radius.Min, 0.7) || !proche(r.Intensity.Min, 10) || r.Color.Color == nil {
		t.Errorf("reflection 0 curves: radius %+v intensity %+v color %+v", r.Radius, r.Intensity, r.Color)
	}
}

func TestPadEffectEvents(t *testing.T) {
	a := padArsenal(t)
	evs, looping, parallel, err := a.EffectEventsOf(0xcf098056)
	if err != nil {
		t.Fatal(err)
	}
	if !looping || parallel || len(evs) != 2 {
		t.Fatalf("looping %v parallel %v events %d", looping, parallel, len(evs))
	}
	e0, e1 := evs[0], evs[1]
	if e0.Delay != [2]float32{0.5, 0.5} || e0.Duration != [2]float32{0.5, 0.5} || e1.Delay != [2]float32{0, 0} || e1.Duration != [2]float32{1, 1} {
		t.Errorf("timing %+v %+v", e0, e1)
	}
	if len(e0.Lenses) != 1 || e0.Lenses[0].Type != 0xc2f90227 || e0.Lenses[0].Radius != [2]float32{4, 4} || len(e0.Lights) != 1 || e0.Lights[0].Type != 0x92275534 {
		t.Errorf("event 0 parts %+v", e0)
	}
	if len(e1.Lenses) != 1 || e1.Lenses[0].Type != 0x37393001 || len(e1.Lights) != 1 || e1.Lights[0].Type != 0x5443c497 {
		t.Errorf("event 1 parts %+v", e1)
	}
}

func TestPadCheapLightTag(t *testing.T) {
	a := padArsenal(t)
	for _, id := range []uint32{0x92275534, 0x5443c497} {
		c, err := a.CheapLightTag(id)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := json.Marshal(c)
		t.Logf("%08x %s", id, b)
		if !proche(c.Intensity.Min, 0.4) || !proche(c.Intensity.Max, 0.5) || len(c.Intensity.Periodic) != 1 {
			t.Errorf("%08x intensity %+v", id, c.Intensity)
		}
		if !proche(c.FarAttenuation.Min, 1) || c.CameraFade != [2]float32{15, 25} || c.Diffuse != 1 || c.Specular != 0.5 {
			t.Errorf("%08x %+v", id, c)
		}
	}
}
