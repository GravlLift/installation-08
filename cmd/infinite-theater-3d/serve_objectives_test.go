package main

import (
	"encoding/binary"
	"encoding/json"
	"os"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

func TestObjectiveModesAndOrdering(t *testing.T) {
	v := &mapvar.Variant{Objects: []mapvar.Object{
		{Pos: mapvar.Vec3{X: 5}, Up: mapvar.Vec3{Z: 1}, Forward: mapvar.Vec3{X: 1}, Labels: []int32{mapvar.LabelHashHillRole}, ShapeRaw: &mapvar.ShapeRaw{Family: 2, S5: 393216, S7: 65536, S8: 65536}},
		{Pos: mapvar.Vec3{X: 1}, Up: mapvar.Vec3{Z: 1}, Forward: mapvar.Vec3{X: 1}, Labels: []int32{mapvar.LabelHashHillRole}, ShapeRaw: &mapvar.ShapeRaw{Family: 2, S5: 393216, S7: 65536, S8: 65536}},
	}}
	got := objectivesFromVariant(v, objectiveSpecs("Ranked:King of the Hill"))
	if got == nil || len(got.Zones) != 2 || got.Zones[0].X != 1 || got.Zones[0].Team != -1 {
		t.Fatalf("zones: %+v", got)
	}
	if got := objectivesFromVariant(v, objectiveSpecs("Slayer")); got != nil {
		t.Fatalf("slayer: %+v", got)
	}
	if _, err := deriveObjectives([]byte("invalid"), "KOTH"); err == nil {
		t.Fatal("invalid variant accepted")
	}
}

func TestServeMapObjectives(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)
	rec := get(t, h, "/api/matches/abc/replay", nil)
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if _, ok := doc["mapObjectives"]; ok {
		t.Fatal("objectives present without variant")
	}
	raw := syntheticVariant()
	if fixture := os.Getenv("MAPOBJ_TEST_MVAR"); fixture != "" {
		var err error
		raw, err = os.ReadFile(fixture)
		if err != nil {
			t.Fatal(err)
		}
	}
	var err error
	if err = root.WriteFile(variantPath(root, "abc", "map.mvar"), raw); err != nil {
		t.Fatal(err)
	}
	if err = root.WriteFile(variantPath(root, "abc", "stats.json"), []byte(`{"gameVariantName":"Ranked:King of the Hill"}`)); err != nil {
		t.Fatal(err)
	}
	for _, headers := range []map[string]string{nil, {"Accept-Encoding": "gzip"}} {
		rec = get(t, h, "/api/matches/abc/replay", headers)
		body := rec.Body.Bytes()
		if headers != nil {
			body, err = gunzipBytes(body)
			if err != nil {
				t.Fatal(err)
			}
		}
		doc = nil
		if err = json.Unmarshal(body, &doc); err != nil {
			t.Fatal(err)
		}
		if len(doc["mapObjectives"]) == 0 {
			t.Fatal("objectives absent with variant")
		}
		t.Logf("mapObjectives=%s", doc["mapObjectives"])
	}
}

func BenchmarkDeriveObjectives(b *testing.B) {
	raw, err := os.ReadFile(os.Getenv("MAPOBJ_TEST_MVAR"))
	if err != nil {
		b.Skip(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := deriveObjectives(raw, "KOTH"); err != nil {
			b.Fatal(err)
		}
	}
}

func syntheticVariant() []byte {
	pack := func(body []byte) []byte { return append([]byte{byte(len(body) + 1)}, append(body, 0)...) }
	integer := make([]byte, binary.MaxVarintLen64)
	value := int64(mapvar.LabelHashHillRole)
	n := binary.PutUvarint(integer, uint64(value<<1)^uint64(value>>63))
	label := pack(append([]byte{16}, integer[:n]...))
	labels := append([]byte{0xcb, 9, 0x4a}, label...)
	gameplay := pack(labels)
	bag := pack(append([]byte{11, 0x4a}, gameplay...))
	object := pack(append([]byte{0xca, 8}, bag...))
	return pack(append([]byte{0x6b, 0x4a}, object...))
}
