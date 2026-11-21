// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_weapons_doc_test.go — the weapon steps of the served replay document: one synthetic
// test per step, and the pipeline test that the served document keeps every stored field
// and adds the new ones.

import (
	"context"
	"encoding/binary"
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

// TestEnrichWeaponLabelsNamesPickedWeapons — a weapon the document knows only from a pickup
// (a bare 8-hex family in weaponChanges) gets a label, with its key, under the id the client
// looks up for the hand ("0x" + upper-case family). A drop (empty w) and an unknown family add
// nothing.
func TestEnrichWeaponLabelsNamesPickedWeapons(t *testing.T) {
	doc := testWeaponDoc()
	doc.WeaponChanges = []replay.WeaponChange{
		{T: 2, Slot: 1, Kind: "taken", W: "daf193c7"},
		{T: 3, Slot: 1, Kind: "dropped"},
		{T: 4, Slot: 1, Kind: "taken", W: "0badf00d"},
	}
	enrichWeaponLabels(context.Background(), testLabelCatalog, doc)
	lbl, ok := doc.WeaponLabels["0xDAF193C7"]
	if !ok {
		t.Fatalf("picked weapon not labeled; labels: %v", doc.WeaponLabels)
	}
	if lbl.Key != "hinf_stalker_rifle" {
		t.Fatalf("picked weapon key = %q, want hinf_stalker_rifle", lbl.Key)
	}
	if _, ok := doc.WeaponLabels["0x0BADF00D"]; ok {
		t.Fatal("an unknown family was labeled")
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

// TestMapWeaponPadsForEquipment — equipment pads, as Live Fire places them: one on the map's
// equipment spawn point type (0xE42158DF, the Repulsor), one on the powerup pad type (the
// Translocator). Both leave as `equipment`; a power-up keeps `powerup`; a weapon pad near a
// spawn point is never claimed by it, and a grenade spawn point confirms nothing.
func TestMapWeaponPadsForEquipment(t *testing.T) {
	ids := []uint32{0xE42158DF, 0xADEEE6D8}
	equipmentSpawn, grenadeSpawn := int32(ids[0]), int32(ids[1])
	if k, ok := mapvar.SpawnKindOf(equipmentSpawn); !ok || k != mapvar.SpawnKindEquipment {
		t.Fatalf("0xE42158DF is not an equipment spawn point: %v %v", k, ok)
	}
	if k, ok := mapvar.SpawnKindOf(grenadeSpawn); !ok || k != mapvar.SpawnKindGrenade {
		t.Fatalf("0xADEEE6D8 is not a grenade spawn point: %v %v", k, ok)
	}
	variant := &mapvar.Variant{Objects: []mapvar.Object{
		{Pos: mapvar.Vec3{X: 6.82, Y: 35.87, Z: -0.99}, TypeID: equipmentSpawn},
		testPadObject(mapvar.Vec3{X: 17.7, Y: 16.9, Z: -1}, mapvar.PadFamilyPowerup),
		testPadObject(mapvar.Vec3{X: 7.6, Y: 44.6, Z: 1.14}, mapvar.PadFamilyPowerup),
		{Pos: mapvar.Vec3{X: 30, Y: 30, Z: 0}, TypeID: equipmentSpawn},
		{Pos: mapvar.Vec3{X: 40, Y: 40, Z: 0}, TypeID: grenadeSpawn},
	}}
	pads := []replay.WeaponPad{
		{X: 6.815, Y: 35.867, Z: -0.995, Weapon: "repulsor"},
		{X: 17.699, Y: 16.903, Z: -0.995, Weapon: "translocator_beacon"},
		{X: 7.603, Y: 44.587, Z: 1.14, Weapon: "powerup_camo"},
		{X: 30.2, Y: 30, Z: 0, Weapon: "0xF408190F"}, // a weapon pad next to a spawn point
		{X: 40.1, Y: 40, Z: 0, Weapon: "thruster"},   // an equipment pad on a grenade point
	}
	out := mapWeaponPadsFor(context.Background(), "abc", matchMapKeys{mapID: "livefire"}, variant, pads)
	if out == nil {
		t.Fatal("no pads confirmed")
	}
	got := map[int]replay.MapWeaponPadDTO{}
	for _, p := range out.Pads {
		got[p.Pad] = p
	}
	if p, ok := got[0]; !ok || p.Family != "equipment" || p.X != 6.82 {
		t.Fatalf("repulsor pad on the equipment spawn point: %+v (ok %v)", p, ok)
	}
	if p, ok := got[1]; !ok || p.Family != "equipment" || p.X != 17.7 || len(p.Up) != 3 {
		t.Fatalf("translocator pad on the powerup pad type: %+v (ok %v)", p, ok)
	}
	if p, ok := got[2]; !ok || p.Family != "powerup" {
		t.Fatalf("camo pad: %+v (ok %v)", p, ok)
	}
	if p, ok := got[3]; ok {
		t.Fatalf("a weapon pad was claimed by a spawn point: %+v", p)
	}
	if p, ok := got[4]; ok {
		t.Fatalf("a grenade spawn point confirmed a pad: %+v", p)
	}
	if out.CatalogN != 2 {
		t.Fatalf("catalogN = %d, want the 2 pad locations", out.CatalogN)
	}
	for w, want := range map[string]bool{
		"repulsor": true, "wall": true, "powerup_camo": false, "0xF408190F": false, "f408190f": false, "": false,
	} {
		if isEquipmentPadItem(w) != want {
			t.Errorf("isEquipmentPadItem(%q) = %v, want %v", w, !want, want)
		}
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

// TestPromotePadCandidates — a candidate (an item seen once at rest, never taken) becomes a pad
// on a map pad location, or on an equipment spawn point when it is equipment; never on a site an
// existing pad stands on, never on an equipment point when it is a weapon, never off the map's
// sites; appended after the existing pads.
func TestPromotePadCandidates(t *testing.T) {
	equipmentSpawn := int32(-467576609) // 0xE42158DF
	variant := &mapvar.Variant{Objects: []mapvar.Object{
		testPadObject(mapvar.Vec3{X: 1, Y: 2, Z: 3}, mapvar.PadFamilyRack),
		testPadObject(mapvar.Vec3{X: 10, Y: 0, Z: 0}, mapvar.PadFamilyRack),
		{Pos: mapvar.Vec3{X: 20, Y: 0, Z: 0}, TypeID: equipmentSpawn},
		{Pos: mapvar.Vec3{X: 30, Y: 0, Z: 0}, TypeID: equipmentSpawn},
	}}
	pads := []replay.WeaponPad{{X: 1, Y: 2, Z: 3, Weapon: "0xf408190f", Spawns: []int{0, 100}}}
	cands := []replay.WeaponPad{
		{X: 1.1, Y: 2, Z: 3, Weapon: "0x2b1824d5", Spawns: []int{0}},  // the site a pad holds
		{X: 10.2, Y: 0, Z: 0, Weapon: "0x2b1824d5", Spawns: []int{0}}, // a free rack: promoted
		{X: 20.1, Y: 0, Z: 0, Weapon: "thruster", Spawns: []int{0}},   // an equipment point: promoted
		{X: 30, Y: 0.1, Z: 0, Weapon: "0x2b1824d5", Spawns: []int{0}}, // a weapon on an equipment point
		{X: 50, Y: 0, Z: 0, Weapon: "repulsor", Spawns: []int{0}},     // no site
	}
	out := promotePadCandidates(variant, pads, cands)
	if len(out) != 3 || out[0].Weapon != "0xf408190f" || out[1].X != 10.2 || out[2].Weapon != "thruster" {
		t.Fatalf("promoted: %+v", out)
	}
	if got := promotePadCandidates(nil, pads, cands); len(got) != 1 {
		t.Fatalf("without a variant: %+v", got)
	}
}

func TestPromoteWeaponSpawnCandidate(t *testing.T) {
	variant := &mapvar.Variant{Objects: []mapvar.Object{
		{Pos: mapvar.Vec3{X: 4.9, Y: 7.9, Z: 59.1}, TypeID: 0x5f3fa667},
	}}
	candidates := []replay.WeaponPad{{X: 4.9, Y: 7.9, Z: 59.1, Weapon: "0x2AC9C2FF", Spawns: []int{0}}}
	if got := promotePadCandidates(variant, nil, candidates); len(got) != 1 || got[0].Weapon != candidates[0].Weapon {
		t.Fatalf("weapon spawn candidate: %+v", got)
	}
	if got := promotePadCandidates(variant, nil, []replay.WeaponPad{{X: 4.9, Y: 7.9, Z: 59.1, Weapon: "repulsor"}}); len(got) != 0 {
		t.Fatalf("equipment on weapon spawn: %+v", got)
	}
}

func TestPlacedWeaponCandidates(t *testing.T) {
	variant := &mapvar.Variant{Objects: []mapvar.Object{
		{TypeID: 123, Pos: mapvar.Vec3{X: 2, Y: 3, Z: 4}, Forward: mapvar.Vec3{X: 1}, Up: mapvar.Vec3{Z: 1}, Scale: &mapvar.Vec3{X: 2, Y: 3, Z: 4}},
		{TypeID: 456, Pos: mapvar.Vec3{X: 5, Y: 3, Z: 4}},
	}}
	candidates := []replay.WeaponPad{
		{X: 2.004, Y: 3, Z: 4, Weapon: "0x2B1824D5", Spawns: []int{0}},
		{X: 5, Y: 3, Z: 4, Weapon: "0x2B1824D5", Spawns: []int{0}},
		{X: 2.1, Y: 3, Z: 4, Weapon: "0x2B1824D5", Spawns: []int{0}},
	}
	resolver := func(id uint32) uint32 {
		if id == 123 {
			return 0x611bbae4
		}
		return 0
	}
	pads, spots := placedWeaponCandidates(variant, nil, candidates, resolver)
	if len(pads) != 1 || len(spots) != 1 || spots[0].Family != "placed" || spots[0].Pad != 0 || len(spots[0].Scale) != 3 || spots[0].Scale[1] != 3 || spots[0].Forward[0] != 1 || spots[0].Up[2] != 1 {
		t.Fatalf("placed candidates: pads=%+v spots=%+v", pads, spots)
	}
	if pads[0].X != candidates[0].X {
		t.Fatalf("film position changed: %+v", pads[0])
	}
	if pads[0].Weapon != "0x611BBAE4" {
		t.Fatalf("Forge weapon model: %q", pads[0].Weapon)
	}
}

func TestForgeWeapon(t *testing.T) {
	tag := make([]byte, 32)
	binary.LittleEndian.PutUint32(tag, 0x2b1824d5)
	copy(tag[12:], "paew")
	if got := forgeWeapon(tag); got != 0x2b1824d5 {
		t.Fatalf("reference = %08x", got)
	}
	binary.LittleEndian.PutUint32(tag[16:], 0x6acdc44d)
	copy(tag[28:], "paew")
	if got := forgeWeapon(tag); got != 0 {
		t.Fatalf("ambiguous references = %08x", got)
	}
}

func TestPlacedWeaponCandidatesMatch(t *testing.T) {
	dir := os.Getenv("IT3D_PAD_MATCH_DIR")
	if dir == "" {
		t.Skip("IT3D_PAD_MATCH_DIR not set")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "map.mvar"))
	if err != nil {
		t.Fatal(err)
	}
	variant, err := mapvar.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	raw, err = os.ReadFile(filepath.Join(dir, "replay.json.gz"))
	if err != nil {
		t.Fatal(err)
	}
	doc, err := decodeReplayDocument(raw)
	if err != nil {
		t.Fatal(err)
	}
	idx, err := openForgeWeapons()
	if err != nil {
		t.Fatal(err)
	}
	defer idx.Close()
	pads := promotePadCandidates(variant, doc.WeaponPads, doc.PadCandidates)
	_, spots := placedWeaponCandidates(variant, pads, doc.PadCandidates, func(id uint32) uint32 {
		group, _, ok := idx.Lookup(id)
		if !ok || group != "food" {
			return 0
		}
		tag, err := idx.Extract(id)
		if err != nil {
			t.Fatal(err)
		}
		return forgeWeapon(tag)
	})
	if len(spots) != 15 {
		t.Fatalf("placed spots: got %d, want 15: %+v", len(spots), spots)
	}
}
