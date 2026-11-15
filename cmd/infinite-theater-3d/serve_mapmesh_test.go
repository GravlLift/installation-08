package main

import (
	"os"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// TestMeshKeyOf: a match on a Forge canvas draws the mesh of its map asset; a native match draws
// its module's; a Forge match without an asset id keeps its module.
func TestMeshKeyOf(t *testing.T) {
	cases := []struct {
		meta store.Match
		want string
	}{
		{store.Match{MapModule: "fo09_academy", MapAssetID: "a54808fb-9bf5-432a-a3c3-f76cbea944c1"}, "a54808fb-9bf5-432a-a3c3-f76cbea944c1"},
		{store.Match{MapModule: "sgh_blueprint", MapAssetID: "336b5174-3579-4fd8-b2f0-922e4a5f7628"}, "sgh_blueprint"},
		{store.Match{MapModule: "fo11_blank"}, "fo11_blank"},
		{store.Match{}, ""},
	}
	for _, c := range cases {
		if got := meshKeyOf(c.meta); got != c.want {
			t.Errorf("%+v: %q, want %q", c.meta, got, c.want)
		}
	}
}

// TestForgeMeshMatch: the mesh of a Forge asset is built from a stored match on it that has its map
// variant; a native key or a Forge match without its variant finds none.
func TestForgeMeshMatch(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const asset = "a54808fb-9bf5-432a-a3c3-f76cbea944c1"
	save := func(id, module, assetID string, mvar bool) {
		if err := root.SaveMatchMeta(id, store.Match{MatchID: id, MapName: "Fortress - Ranked", MapAssetID: assetID, MapModule: module, ImportedAt: "2026-01-01T00:00:00Z"}); err != nil {
			t.Fatal(err)
		}
		if mvar {
			if err := os.WriteFile(variantPath(root, id, "map.mvar"), []byte{1}, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	save("aaaa", "fo09_academy", asset, false)
	if _, ok := forgeMeshMatch(root, asset); ok {
		t.Fatal("a Forge match without its variant chosen")
	}
	save("bbbb", "fo09_academy", asset, true)
	save("cccc", "sgh_blueprint", "336b5174-3579-4fd8-b2f0-922e4a5f7628", true)
	if m, ok := forgeMeshMatch(root, asset); !ok || m.MatchID != "bbbb" {
		t.Fatalf("forge match %+v %v", m, ok)
	}
	for _, key := range []string{"sgh_blueprint", "336b5174-3579-4fd8-b2f0-922e4a5f7628"} {
		if _, ok := forgeMeshMatch(root, key); ok {
			t.Errorf("native key %s built as a Forge map", key)
		}
	}
}
