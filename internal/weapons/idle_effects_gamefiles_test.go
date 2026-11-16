//go:build gamefiles

package weapons

// idle_effects_gamefiles_test.go — the Shock Rifle's idle electricity, read from the installed game
// into the library entry the view draws.

import (
	"context"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

const shockKey = "1a22fee6"

// TestShockIdleEffectFromGame — one idle effect, scaled by fx_ready (on while ready, off while
// reloading or empty), its twelve systems, markers and files.
func TestShockIdleEffectFromGame(t *testing.T) {
	root, err := himap.DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	module := filepath.Join(root, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module")
	if _, err := os.Stat(module); err != nil {
		t.Skip(err)
	}
	a, err := himap.OuvreArsenal(root, module)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = a.Close() }()
	dir := t.TempDir()
	got, err := readIdleEffects(context.Background(), a, root, module, dir, []string{shockKey, flagKey})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := got[flagKey]; ok {
		t.Error("the flag's banner read as an idle effect")
	}
	es := got[shockKey]
	if len(es) != 1 {
		t.Fatalf("shock rifle: %d idle effects", len(es))
	}
	e := es[0]
	if e.Effect != "1e471031" || e.ScaleA != "fx_ready" || e.ScaleB != "#118a9c27" || len(e.Systems) != 12 {
		t.Fatalf("effect %s scales %s/%s, %d systems", e.Effect, e.ScaleA, e.ScaleB, len(e.Systems))
	}
	fn := map[string]IdleFunction{}
	for _, f := range e.Functions {
		fn[f.Export] = f
	}
	want := map[string]IdleFunction{
		"fx_ready":     {Import: "ready", Default: 1, Export: "fx_ready", TurnOffWith: "fx_reloading"},
		"fx_reloading": {Import: "is_reloading", Default: 1, Export: "fx_reloading", TurnOffWith: "fx_ammo", Invert: true},
		"fx_ammo":      {Import: "primary_ammunition", Default: 1, Export: "fx_ammo"},
		"#118a9c27":    {Import: "camo", Default: 1, Export: "#118a9c27", Invert: true},
	}
	for k, w := range want {
		if fn[k] != w {
			t.Errorf("function %s = %+v, want %+v", k, fn[k], w)
		}
	}
	// Markers in GLB axes: (x, z, -y) of the model's (0.306, 0, 0.044).
	if m := e.Markers["55990be4"]; len(m) != 1 || m[0][0] < 0.305 || m[0][0] > 0.307 || m[0][1] < 0.043 || m[0][1] > 0.045 {
		t.Errorf("marker 55990be4 = %v", m)
	}
	s := e.Systems[0]
	if s.Location != "55990be4" || s.CameraMode != 1 || s.Emitter.AxisScale != [3]float32{0.045, 0, 1} || s.Emitter.Direction != [3]float32{1, 0, 0} {
		t.Errorf("system 0 = %+v", s)
	}
	if len(s.Render.Textures) != 3 || s.Render.Textures[0].File != "fx-a119e9dd.png" || s.Render.Textures[0].Layers != 4 ||
		s.Render.Textures[2].File != "fx-b5c0b591.png" || !s.Render.Textures[0].SRGB || s.Render.Textures[0].Signed {
		t.Errorf("system 0 textures %+v", s.Render.Textures)
	}
	shell := e.Systems[4]
	if shell.Render.Model != "fx-3c8e80bc.bin" {
		t.Errorf("shell model %q", shell.Render.Model)
	}
	// The shell's distortion map is the one linear, signed texture.
	for _, tx := range shell.Render.Textures {
		if tx.Name == "uvDistortionMap" && (tx.SRGB || !tx.Signed) || tx.Name != "uvDistortionMap" && (!tx.SRGB || tx.Signed) {
			t.Errorf("shell texture %+v", tx)
		}
	}
	raw, err := os.ReadFile(filepath.Join(dir, shell.Render.Model))
	if err != nil || len(raw) != 2400*3*5*4 {
		t.Fatalf("shell mesh: %d bytes, %v", len(raw), err)
	}
	f := func(i int) float32 { return float32frombits(binary.LittleEndian.Uint32(raw[4*i:])) }
	for v := 0; v < 2400*3; v++ {
		if x := f(5 * v); x < -0.07 || x > 0.06 {
			t.Fatalf("shell vertex %d x = %v", v, x)
		}
	}
	for _, name := range []string{"fx-a119e9dd.png", "fx-399302ae.png", "fx-028aa998.png", "fx-0b5c7ffc.png", "fx-2178e580.png", "fx-b5c0b591.png",
		"fx-1338bc59.bin", "fx-1ed87b61.bin"} {
		if !EffectFile(name) {
			t.Errorf("%s: not an effect file name", name)
		}
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func float32frombits(b uint32) float32 { return math.Float32frombits(b) }
