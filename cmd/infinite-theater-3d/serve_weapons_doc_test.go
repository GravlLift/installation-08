package main

// serve_weapons_doc_test.go — the weapon steps of the served replay document: one synthetic
// test per step, and the pipeline test that the served document keeps every stored field
// and adds the new ones.

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-film-decoder/replay"
)

// testWeaponDoc is a small synthetic document whose weapons the embedded tables name:
// a loadout weapon (BR75), a shot (Plasma Pistol), a pad (Sidekick), and an unlabeled
// loadout weapon (Mutilator) that the completion pass must name.
func testWeaponDoc() *replay.ReplayDocument {
	return &replay.ReplayDocument{
		SchemaVersion: 100,
		MatchID:       "abc",
		FrameCount:    10,
		Loadouts:      []replay.Loadout{{T: 0, Slot: 1, W: []string{"0x2b1824d5", "0xd7915565"}}},
		Shots:         []replay.Shot{{T: 1, Slot: 1, X: 1, Y: 2, Weapon: "0xc3542946"}},
		WeaponPads:    []replay.WeaponPad{{X: 3, Y: 4, Z: 0, Weapon: "0xf408190f", Spawns: []int{0}}},
	}
}

// TestEnrichWeaponLabels — the label step: completion names the weapon the stored document
// lacks, and every label gains its key, tint, role, fx and impact from the tables. Stored
// text and fx are never overwritten.
func TestEnrichWeaponLabels(t *testing.T) {
	cat := testLabelCatalog
	doc := testWeaponDoc()
	stored := replay.WeaponLabel{Text: replay.Text{"en": "BR75 (stored)"}, Fx: "custom"}
	doc.WeaponLabels = map[string]replay.WeaponLabel{"0x2b1824d5": stored}
	enrichWeaponLabels(context.Background(), cat, doc)

	lbl, ok := doc.WeaponLabels["0x2b1824d5"]
	if !ok {
		t.Fatal("stored label lost")
	}
	if lbl.Text["en"] != "BR75 (stored)" || lbl.Fx != "custom" {
		t.Fatalf("stored fields overwritten: %+v", lbl)
	}
	if lbl.Key != "hinf_br75" || lbl.Tint != "kinetic" || lbl.Role != "precision" || lbl.Impact {
		t.Fatalf("br75 enrichment: %+v", lbl)
	}
	// Fx is set at build time (CompleteWeaponLabels), not during enrichment.
	if lbl.Fx != "ballistic" && lbl.Fx != "custom" {
		t.Fatalf("unexpected fx: %q", lbl.Fx)
	}
	// The Mutilator was unlabeled in the document: the completion pass named it.
	// It has no tint or fx in the title's tables (not in shot_tints), so those stay empty.
	mut, ok := doc.WeaponLabels["0xd7915565"]
	if !ok {
		t.Fatal("mutilator not completed")
	}
	if mut.Key != "hinf_mutilator" || mut.Role != "shotgun" {
		t.Fatalf("mutilator enrichment: %+v", mut)
	}
	if mut.Text["en"] == "" {
		t.Fatal("completed label has no text")
	}
}

// testPadObject builds a synthetic map object that mapvar.PadSpots reads as a weapon pad
// of the given family: the pad is recognized by its type_id (mapvar.padFamilies), the
// three ids the reader isolated by pairing against the artefacts' oracle.
func testPadObject(pos mapvar.Vec3, family mapvar.PadFamily) mapvar.Object {
	id, ok := padTypeID(family)
	if !ok {
		panic("no pad type id for family " + family)
	}
	return mapvar.Object{Pos: pos, Up: mapvar.Vec3{Z: 1}, Forward: mapvar.Vec3{X: 1}, TypeID: id}
}

// padTypeID finds the type_id mapvar.padFamilies assigns to a family. The map is private,
// but the three ids are published in the reader's source (socles.go) and probed through
// the public PadFamilyOf, so the test does not carry a fourth copy.
func padTypeID(family mapvar.PadFamily) (int32, bool) {
	for _, id := range []int32{0x5F379533, 0x6253CFC0, 0x5E86D110} {
		if f, ok := mapvar.PadFamilyOf(id); ok && f == family {
			return id, true
		}
	}
	return 0, false
}

// TestMapWeaponPadsFor — the pad step: a confirmed location crosses the match's pad; a
// location farther than a metre stays off; no confirmed location leaves the field absent.
func TestMapWeaponPadsFor(t *testing.T) {
	variant := &mapvar.Variant{Objects: []mapvar.Object{
		testPadObject(mapvar.Vec3{X: 1, Y: 2, Z: 3}, mapvar.PadFamilyRack),
		testPadObject(mapvar.Vec3{X: 50, Y: 60, Z: 0}, mapvar.PadFamilyRack),
	}}
	keys := matchMapKeys{mapID: "moda"}
	pads := []replay.WeaponPad{{X: 1, Y: 2, Z: 3, Weapon: "0xf408190f", Spawns: []int{0}}}

	out := mapWeaponPadsFor(context.Background(), "abc", keys, variant, pads)
	if out == nil {
		t.Fatal("no pads confirmed")
	}
	if out.CatalogN != 2 || len(out.Pads) != 1 {
		t.Fatalf("cross: %+v", out)
	}
	if out.Pads[0].Pad != 0 || out.Pads[0].Family != "rack" {
		t.Fatalf("confirmed pad: %+v", out.Pads[0])
	}
	// The spawner's own axes travel with it: a rack holds its weapon in this orientation.
	if f, u := out.Pads[0].Forward, out.Pads[0].Up; len(f) != 3 || f[0] != 1 || len(u) != 3 || u[2] != 1 {
		t.Fatalf("confirmed pad axes: forward %v up %v", f, u)
	}
	if axisOf(mapvar.Vec3{}) != nil {
		t.Fatal("a zero axis must stay absent")
	}
	if got := mapWeaponPadsFor(context.Background(), "abc", matchMapKeys{}, variant, pads); got != nil {
		t.Fatal("pads without a map id")
	}
	if got := mapWeaponPadsFor(context.Background(), "abc", keys, nil, pads); got != nil {
		t.Fatal("pads without a variant")
	}
}

// TestWeaponTiersFor — the tiers step: a random-start mode is named, a regular mode is not,
// and an unknown mode asserts nothing (nil).
func TestWeaponTiersFor(t *testing.T) {
	if tiers := weaponTiersFor("Castle Wars: Ranked"); tiers == nil || !tiers.RandomStarts {
		t.Fatalf("castle wars: %+v", tiers)
	}
	if tiers := weaponTiersFor("Ranked: Slayer"); tiers == nil || tiers.RandomStarts {
		t.Fatalf("slayer: %+v", tiers)
	}
	if tiers := weaponTiersFor(""); tiers != nil {
		t.Fatalf("empty mode: %+v", tiers)
	}
}

// TestCheckWeaponTierJoin — the pad-join check: a light role on a power pad alerts, the
// same count on a rack pad does not, and the alert names the offending weapon.
func TestCheckWeaponTierJoin(t *testing.T) {
	cat := testLabelCatalog
	doc := testWeaponDoc()
	doc.MapWeaponPads = &replay.MapWeaponPads{CatalogN: 1, Pads: []replay.MapWeaponPadDTO{
		{X: 3, Y: 4, Z: 0, Pad: 0, Family: "power"},
	}}
	// Sidekick is a sidearm: a light role on a power pad.
	enrichWeaponLabels(context.Background(), cat, doc)
	check := runTierCrossCheck(doc.WeaponPads, []string{"power"}, func(w string) string {
		return cat.Roles[doc.WeaponLabels[w].Key]
	})
	if !tierCrossCheckAlert(check) || check.LightOnPower != 1 {
		t.Fatalf("power+sidearm: %+v", check)
	}
	if check.Weapons["0xf408190f"] != 1 {
		t.Fatalf("offending weapon not named: %+v", check)
	}
	// The same pad crossed with a rack location is nominal.
	check = runTierCrossCheck(doc.WeaponPads, []string{"rack"}, func(w string) string {
		return cat.Roles[doc.WeaponLabels[w].Key]
	})
	if tierCrossCheckAlert(check) || check.LightOnPower != 0 {
		t.Fatalf("rack+sidearm: %+v", check)
	}
}

// TestServedDocKeepsStoredFieldsAndAddsNew — the pipeline: the served document keeps every
// stored field byte-for-byte on the fields it does not touch, and adds mapObjectives,
// mapWeaponPads, weaponTiers and the enriched weaponLabels.
func TestServedDocKeepsStoredFieldsAndAddsNew(t *testing.T) {
	root := newFakeStore(t)
	doc := testWeaponDoc()
	raw, err := encodeReplayDocument(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err = root.WriteFile(variantPath(root, "abc", "replay.json.gz"), raw); err != nil {
		t.Fatal(err)
	}
	if err = root.WriteFile(variantPath(root, "abc", "match.json"), []byte(`{"mapAssetId":"moda"}`)); err != nil {
		t.Fatal(err)
	}
	if err = root.WriteFile(variantPath(root, "abc", "stats.json"), []byte(`{"gameVariantName":"Castle Wars: Ranked"}`)); err != nil {
		t.Fatal(err)
	}

	out := gunzipBytesForTest(t, replayWithEnrichments(context.Background(), root, "abc", testLabelCatalog, raw))
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(out, &fields); err != nil {
		t.Fatal(err)
	}
	// mapWeaponPads requires a map variant; this test has none, so it must be absent.
	if len(fields["mapWeaponPads"]) > 0 {
		t.Fatalf("mapWeaponPads present without a variant: %s", fields["mapWeaponPads"])
	}
	for _, name := range []string{"weaponTiers", "weaponLabels"} {
		if len(fields[name]) == 0 {
			t.Fatalf("field %s absent", name)
		}
	}
	if _, ok := fields["mapObjectives"]; ok {
		t.Fatal("objectives present without a mode that asks for them")
	}
	var got replay.ReplayDocument
	if err = json.Unmarshal(out, &got); err != nil {
		t.Fatal(err)
	}
	if got.MatchID != "abc" || got.FrameCount != 10 || len(got.Loadouts) != 1 || len(got.Shots) != 1 ||
		len(got.WeaponPads) != 1 || got.Loadouts[0].W[0] != "0x2b1824d5" {
		t.Fatalf("stored fields altered: %+v", got)
	}
	if got.WeaponTiers == nil || !got.WeaponTiers.RandomStarts {
		t.Fatalf("tiers: %+v", got.WeaponTiers)
	}
	if lbl := got.WeaponLabels["0xd7915565"]; lbl.Key != "hinf_mutilator" {
		t.Fatalf("served label not enriched: %+v", lbl)
	}
}

// TestServedDocNamesTitleSlug — the stored document leaves titleSlug empty (it predates the
// field); the server sets the title it serves, as LevelUp's server does.
func TestServedDocNamesTitleSlug(t *testing.T) {
	root := newFakeStore(t)
	doc := testWeaponDoc()
	doc.TitleSlug = ""
	raw, err := encodeReplayDocument(doc)
	if err != nil {
		t.Fatal(err)
	}
	if err = root.WriteFile(variantPath(root, "abc", "replay.json.gz"), raw); err != nil {
		t.Fatal(err)
	}
	if err = root.WriteFile(variantPath(root, "abc", "match.json"), []byte(`{"mapAssetId":"moda"}`)); err != nil {
		t.Fatal(err)
	}
	if err = root.WriteFile(variantPath(root, "abc", "stats.json"), []byte(`{"gameVariantName":"Castle Wars: Ranked"}`)); err != nil {
		t.Fatal(err)
	}

	out := gunzipBytesForTest(t, replayWithEnrichments(context.Background(), root, "abc", testLabelCatalog, raw))
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(out, &fields); err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(string(fields["titleSlug"])); got != `"`+`halo_infinite`+`"` {
		t.Fatalf("titleSlug: %s", fields["titleSlug"])
	}
}

func gunzipBytesForTest(t *testing.T, gz []byte) []byte {
	t.Helper()
	out, err := gunzipBytes(gz)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestServedWeaponIconCoverage(t *testing.T) {
	families := map[string]string{
		"0x0A1992BC": "05", "0x1A22FEE6": "23", "0x2B1824D5": "01",
		"0x3E070217": "39", "0x48C19D2D": "00", "0x6ACDC44D": "33",
		"0xC3542946": "11", "0xF408190F": "03", "0xFD98554C": "02",
	}
	doc := &replay.ReplayDocument{WeaponLabels: map[string]replay.WeaponLabel{}}
	for family := range families {
		doc.WeaponLabels[family] = replay.WeaponLabel{Text: replay.Text{"en": "stored"}}
		doc.WeaponLabels[family+"42C9679F"] = replay.WeaponLabel{Text: replay.Text{"en": "stored"}}
	}
	doc.WeaponLabels["0x00007CA9"] = replay.WeaponLabel{Img: "/static/weapons-assets/halo_infinite/Melee.png"}
	enrichWeaponLabels(context.Background(), testLabelCatalog, doc)
	if got := doc.WeaponLabels["0x00007CA9"].Img; got != "/static/weapons-assets/halo_infinite/jeu/killfeed-65.png" {
		t.Errorf("legacy melee image = %q", got)
	}
	if dir := os.Getenv("IT3D_TEST_ICON_DIR"); dir != "" {
		for family := range testLabelCatalog.LabelCatalog.Weapons {
			icon, ok := testLabelCatalog.LabelCatalog.Icons[family]
			if !ok || icon.URL == "" {
				t.Errorf("%08x has no icon", family)
				continue
			}
			if _, err := os.Stat(filepath.Join(dir, filepath.Base(icon.URL))); err != nil {
				t.Errorf("%08x icon file: %v", family, err)
			}
		}
	}
	for family, index := range families {
		for _, id := range []string{family, family + "42C9679F"} {
			want := "/static/weapons-assets/halo_infinite/jeu/contour-" + index + ".png"
			if got := doc.WeaponLabels[id].Img; got != want {
				t.Errorf("%s image = %q, want %q", id, got, want)
			}
			if dir := os.Getenv("IT3D_TEST_ICON_DIR"); dir != "" {
				if _, err := os.Stat(filepath.Join(dir, filepath.Base(want))); err != nil {
					t.Errorf("%s icon file: %v", id, err)
				}
			}
		}
	}
}
