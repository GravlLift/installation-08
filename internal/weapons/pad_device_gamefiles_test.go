// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package weapons

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"math"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/ekurport"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

func padIndexes(t *testing.T) (*himap.ModuleIndex, *himap.ModuleIndex) {
	t.Helper()
	root, err := himap.DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	mod := filepath.Join(root, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module")
	paths, err := himap.GeometrySearchPathMonde(root, mod)
	if err != nil {
		t.Fatal(err)
	}
	geo, err := himap.NewModuleIndex(paths...)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = geo.Close() })
	paths, err = himap.CheminsMateriaux(root, mod)
	if err != nil {
		t.Fatal(err)
	}
	mats, err := himap.NewModuleIndex(paths...)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = mats.Close() })
	return geo, mats
}

func TestPadDeviceMaterialsFromGame(t *testing.T) {
	names, err := weaponicons.StringIDNames(map[uint32]bool{0x4a2c3a6a: true})
	if err != nil {
		t.Logf("input name lookup: %v", err)
	} else {
		t.Logf("input 4a2c3a6a name: %q", names[0x4a2c3a6a])
	}
	geo, mats := padIndexes(t)
	raw, err := geo.Extract(0x58f5b4af)
	if err != nil {
		t.Fatal(err)
	}
	id, group, ok := himap.RefModeleVehicule(context.Background(), geo, raw)
	if !ok || group != "mode" || id != 0xec6cf1a4 {
		t.Fatalf("device model %s %08x %v", group, id, ok)
	}
	gameRoot, err := himap.DeployRoot()
	if err != nil {
		t.Fatal(err)
	}
	a, err := himap.OuvreArsenal(gameRoot, filepath.Join(gameRoot, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Close() })
	markers, err := a.MarqueursDuModele(id, map[uint32]bool{0x54b94882: true})
	if err != nil || len(markers) != 0 {
		t.Fatalf("effect marker on device: %+v, %v", markers, err)
	}
	functions, err := weaponicons.ReadObjectFunctions(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(functions) != 6 || functions[0].Export != 0x4a2c3a6a {
		t.Fatalf("device functions %+v", functions)
	}
	for _, f := range functions {
		if f.Import != 0 || f.Default != 1 || f.Invert || f.TurnOffWith != 0 {
			t.Errorf("function %+v", f)
		}
	}

	ids := []uint32{0xe562fa15, 0x00002690, 0x58c9bf17, 0x876b85dc, 0xb8cfe89f}
	model, err := geo.Extract(id)
	if err != nil {
		t.Fatal(err)
	}
	for i, material := range ids {
		offset := 0x568c + 0x1c*i
		if got := binary.LittleEndian.Uint32(model[offset:]); got != material {
			t.Errorf("model material %d = %08x", i, got)
		}
	}
	table, missing := himap.LitMateriaux(mats, geo, ids)
	if missing != 0 {
		t.Fatalf("%d materials unreadable", missing)
	}
	for _, want := range []struct {
		id    uint32
		color [3]float32
		force float32
	}{
		{0xe562fa15, [3]float32{0.19461787, 0.018500218, 0}, 86.36364},
		{0x58c9bf17, [3]float32{1, 1, 1}, 1},
		{0x876b85dc, [3]float32{0.19120172, 0.00699541, 0.00699541}, 100},
		{0xb8cfe89f, [3]float32{0.19461787, 0.018500218, 0}, 86.36364},
	} {
		e := table[want.id].Emissif
		if e == nil || e.Couleur != want.color || math.Abs(float64(e.Force-want.force)) > 0.0001 {
			t.Errorf("material %08x emissive %+v", want.id, e)
		}
	}
	if table[0x2690].Emissif != nil {
		t.Error("material 00002690 unexpectedly emissive")
	}
	for _, id := range []uint32{0xe562fa15, 0x876b85dc, 0xb8cfe89f} {
		raw, err := mats.Extract(id)
		if err != nil {
			t.Fatal(err)
		}
		tag, err := ekurport.ParseTag(raw)
		if err != nil {
			t.Fatal(err)
		}
		root, err := tag.Root()
		if err != nil {
			t.Fatal(err)
		}
		posts, err := root.Block(64, 160)
		if err != nil || posts.Len() == 0 {
			t.Fatalf("%08x posts: %v", id, err)
		}
		fs, err := posts.At(0).Block(24, 48)
		if err != nil || fs.Len() != 1 {
			t.Fatalf("%08x functions: %v", id, err)
		}
		kind, _ := fs.At(0).U32(0)
		input, _ := fs.At(0).U32(4)
		if kind != 1 || input != 0x4a2c3a6a {
			t.Errorf("%08x color function: %d %08x", id, kind, input)
		}
		mapping := "0034030000257aff0000000000000000ff7153ff6f12833a6f12033b00000000"
		if id == 0x876b85dc {
			mapping = "00340300141479ff000000ff00000000f29200ff6f12833a6f12033b00000000"
		}
		b, _ := hex.DecodeString(mapping)
		if !bytes.Contains(raw, b) {
			t.Errorf("%08x color mapping changed", id)
		}
		e := table[id].Emissif
		if e == nil || len(e.Objets) != 1 || e.Objets[0].Entree != 0x4a2c3a6a || !bytes.Equal(e.Objets[0].Donnees, b) {
			t.Errorf("%08x exported object mapping: %+v", id, e)
		}
	}
}

func TestPadCheapLightsFromGame(t *testing.T) {
	geo, _ := padIndexes(t)
	// Both cheap lights use the same periodic intensity and constant far attenuation.
	intensity, _ := hex.DecodeString("03300000cdcccc3e0000003f00000000000000006f12833a6f12033b14000000090000000000004000000000000000000000803f")
	radius, _ := hex.DecodeString("013000000000803f0000803f00000000000000006f12833a6f12033b00000000")
	for _, id := range []uint32{0x92275534, 0x5443c497} {
		raw, err := geo.Extract(id)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(raw, intensity) || !bytes.Contains(raw, radius) {
			t.Errorf("light %08x mappings changed", id)
		}
	}
	for id, h := range map[uint32]string{0x92275534: "08300200000000ff0000000000000000af9635ff", 0x5443c497: "01300100ae9533ff000000000000000000000000"} {
		raw, err := geo.Extract(id)
		if err != nil {
			t.Fatal(err)
		}
		color, _ := hex.DecodeString(h)
		if !bytes.Contains(raw, color) {
			t.Errorf("light %08x color changed", id)
		}
	}
	f, err := himap.DecodeMappingFunction(intensity)
	if err != nil {
		t.Fatal(err)
	}
	if f.Type != 3 || len(f.Periodic) != 1 || f.Min != 0.4 || f.Max != 0.5 || f.Periodic[0].Onde != 9 || f.Periodic[0].Frequence != 2 {
		t.Errorf("intensity %+v", f)
	}
	f, err = himap.DecodeMappingFunction(radius)
	if err != nil || f.Min != 1 || f.Max != 1 {
		t.Errorf("attenuation %+v %v", f, err)
	}
}

func TestPadLensFlareFromGame(t *testing.T) {
	geo, _ := padIndexes(t)
	radius, _ := hex.DecodeString("013400003333333f3333333f")
	intensity, _ := hex.DecodeString("013400000000204100002041")
	for id, h := range map[uint32]string{0xc2f90227: "01340100c6a813ff", 0x37393001: "01340100c6a800ff"} {
		raw, err := geo.Extract(id)
		if err != nil {
			t.Fatal(err)
		}
		color, _ := hex.DecodeString(h)
		if !bytes.Contains(raw, radius) || !bytes.Contains(raw, intensity) || !bytes.Contains(raw, color) {
			t.Errorf("lens %08x first reflection changed", id)
		}
	}
}
