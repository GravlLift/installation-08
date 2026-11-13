package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

func TestZoneCatalogWithoutVariantOrZoneMode(t *testing.T) {
	root := newFakeStore(t)
	if err := root.WriteFile(variantPath(root, "abc", "stats.json"), []byte(`{"gameVariantName":"KOTH"}`)); err != nil {
		t.Fatal(err)
	}
	_, z, err := matchObjectiveCatalog(root, "abc")
	if err != nil || len(z.Zones) != 0 {
		t.Fatalf("missing variant: %+v %v", z, err)
	}
	if err := root.WriteFile(variantPath(root, "abc", "map.mvar"), syntheticVariant()); err != nil {
		t.Fatal(err)
	}
	if err := root.WriteFile(variantPath(root, "abc", "stats.json"), []byte(`{"gameVariantName":"Slayer"}`)); err != nil {
		t.Fatal(err)
	}
	_, z, err = matchObjectiveCatalog(root, "abc")
	if err != nil || len(z.Zones) != 0 {
		t.Fatalf("slayer: %+v %v", z, err)
	}
}

func TestRebuildRealHill(t *testing.T) {
	dir := os.Getenv("IT3D_ZONE_TEST_DATA")
	if dir == "" {
		t.Skip("IT3D_ZONE_TEST_DATA not set")
	}
	const id = "d01ba030-7f78-48a7-8ed2-f3be430c3fcf"
	root, err := store.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	metaPath, err := root.MatchMetaPath(id)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(metaPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := runRebuild([]string{id, "--data", dir}); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(metaPath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("rebuild changed match metadata", err)
	}
	raw, err := root.LoadReplay(id)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := gunzipBytes(raw)
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		ZoneStates []json.RawMessage `json:"zoneStates"`
		Coverage   struct {
			Zones struct {
				Catalog int `json:"catalog"`
			} `json:"zones"`
		} `json:"coverage"`
	}
	if err := json.Unmarshal(doc, &result); err != nil {
		t.Fatal(err)
	}
	objectives, err := matchObjectives(root, id)
	if err != nil || objectives == nil || len(result.ZoneStates) != 5 || result.Coverage.Zones.Catalog != len(objectives.Zones) {
		t.Fatalf("states=%d coverage=%d objectives=%v error=%v", len(result.ZoneStates), result.Coverage.Zones.Catalog, objectives, err)
	}
	chunks, err := root.MatchChunksDir(id)
	if err != nil {
		t.Fatal(err)
	}
	docWithout, _, err := build.Build(context.Background(), build.Input{ChunkDir: chunks, MatchID: id, MapName: "Recharge - Ranked", ManifestPath: optionalPath(root.MatchManifestPath(id)), StatsPath: optionalPath(root.MatchStatsPath(id))})
	if err != nil || len(docWithout.ZoneStates) != 0 || (docWithout.Coverage != nil && docWithout.Coverage.Zones != nil) {
		t.Fatalf("missing catalog: states=%d error=%v", len(docWithout.ZoneStates), err)
	}

}
