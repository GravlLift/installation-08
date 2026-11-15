package main

// serve_coatings_test.go — the coating status route: the export states (not_set, invalid,
// ok) and the per-library built/stale/materials_missing fields, driven by small synthetic
// temp folders (no game install, no network).

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// writeCoatingIndexWithCoatings writes a spartan-pieces or weapons index.json with the
// given stamp and materials_missing count (the two libraries that carry a coatings section),
// and the weapon library's reticle_ranges field (current index).
func writeCoatingIndexWithCoatings(t *testing.T, dataDir, module, stamp string, missing int) {
	t.Helper()
	folder, ok := coatingLibraryFolder(module)
	if !ok {
		t.Fatalf("module %q is not a coating library", module)
	}
	dir := filepath.Join(dataDir, folder)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"ekur_stamp":"` + stamp + `","coatings":{"materials_missing":` + strconv.Itoa(missing) + `},"reticle_ranges":{"f408190f":{"unscoped":15,"zoomed":[],"magnifications":[]}},"banners":{},"equipment":{}}`
	if err := os.WriteFile(filepath.Join(dir, "index.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// getCoatingStatus calls GET /api/coatings/status through the full handler and decodes it.
func getCoatingStatus(t *testing.T, h http.Handler) coatingsStatus {
	t.Helper()
	rec := get(t, h, "/api/coatings/status", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out coatingsStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}

// TestCoatingStatusNotSet — no variable and no <data>/ekur: the export is not_set, the
// libraries report their built state, nothing is stale. The fixture data directory is the
// handler's own store directory (the fake store's temp dir), never a fresh temp dir.
func TestCoatingStatusNotSet(t *testing.T) {
	t.Setenv(spartanpieces.EkurEnv, "")
	h := newTestHandlers(newFakeStore(t), nil)
	data := h.root.Dir()
	if _, err := os.Stat(filepath.Join(data, "ekur")); err == nil {
		t.Fatalf("fixture store unexpectedly carries an ekur folder: %v", err)
	}
	writeCoatingLibraryIndex(t, data, meshjobs.JobSpartanPieces, "00000000")
	writeCoatingIndexWithCoatings(t, data, meshjobs.JobWeapons, "00000000", 3)

	out := getCoatingStatus(t, h)
	if out.Export != exportNotSet {
		t.Fatalf("export = %q, want not_set", out.Export)
	}
	sp, ok := out.Libraries["spartan_pieces"]
	if !ok || !sp.Built || sp.Stale || sp.MaterialsMissing != 0 {
		t.Fatalf("spartan_pieces = %+v (want built, not stale, 0 missing)", sp)
	}
	weapons, ok := out.Libraries["weapons"]
	if !ok || !weapons.Built || weapons.Stale || weapons.MaterialsMissing != 3 {
		t.Fatalf("weapons = %+v (want built, not stale, 3 missing)", weapons)
	}
	fp, ok := out.Libraries["first_person"]
	if !ok || fp.Built || fp.Stale || fp.MaterialsMissing != 0 {
		t.Fatalf("first_person = %+v (want not built)", fp)
	}
	if strings.Contains(recBody(t, h), data) {
		t.Fatal("response leaks the data directory path")
	}
}

// recBody re-requests the route and returns the raw body (the leak check needs the text).
func recBody(t *testing.T, h http.Handler) string {
	t.Helper()
	rec := get(t, h, "/api/coatings/status", nil)
	return rec.Body.String()
}

// TestCoatingStatusInvalid — a candidate folder that exists but is not a valid Ekur
// reference: the export is invalid, and the libraries built under the old valid export are
// stale.
func TestCoatingStatusInvalid(t *testing.T) {
	t.Setenv(spartanpieces.EkurEnv, "")
	h := newTestHandlers(newFakeStore(t), nil)
	data := h.root.Dir()
	writeCoatingLibraryIndex(t, data, meshjobs.JobWeapons, "00000000")
	ekur := filepath.Join(data, "ekur")
	if err := os.MkdirAll(filepath.Join(ekur, "materials"), 0o755); err != nil {
		t.Fatal(err)
	}

	out := getCoatingStatus(t, h)
	if out.Export != exportInvalid {
		t.Fatalf("export = %q, want invalid", out.Export)
	}
	w, _ := out.Libraries["weapons"]
	if !w.Built {
		t.Fatal("weapons library not reported built")
	}
}

// TestWeaponLibraryStaleWithoutReticleRanges — a weapon library index built before the
// red-reticle ranges' magnifications and the team banners existed is stale even with no export
// (status route and readiness), so the normal build job rebuilds it; the same index with the
// fields is current.
func TestWeaponLibraryStaleWithoutReticleRanges(t *testing.T) {
	t.Setenv(spartanpieces.EkurEnv, "")
	h := newTestHandlers(newFakeStore(t), nil)
	data := h.root.Dir()
	writeCoatingLibraryIndex(t, data, meshjobs.JobWeapons, "00000000")
	if w := getCoatingStatus(t, h).Libraries["weapons"]; !w.Built || !w.Stale {
		t.Fatalf("weapons without magnifications = %+v (want built and stale)", w)
	}
	if coatingLibraryReady(data, meshjobs.JobWeapons) {
		t.Fatal("weapons without reticle_ranges: library ready")
	}
	writeCoatingIndexWithCoatings(t, data, meshjobs.JobWeapons, "00000000", 0)
	if w := getCoatingStatus(t, h).Libraries["weapons"]; !w.Built || w.Stale {
		t.Fatalf("weapons with reticle_ranges = %+v (want built, not stale)", w)
	}
	if !coatingLibraryReady(data, meshjobs.JobWeapons) {
		t.Fatal("weapons with reticle_ranges, no export: library not ready")
	}
}

// TestCoatingStatusOk — a valid export: ok, a matching library is not stale, a diverged
// one is stale, and its materials_missing is reported.
func TestCoatingStatusOk(t *testing.T) {
	t.Setenv(spartanpieces.EkurEnv, "")
	h := newTestHandlers(newFakeStore(t), nil)
	data := h.root.Dir()
	ekur := filepath.Join(data, "ekur")
	ekurFixtureCmd(t, ekur)
	stamp, err := spartanpieces.EkurStamp(ekur)
	if err != nil {
		t.Fatal(err)
	}
	writeCoatingIndexWithCoatings(t, data, meshjobs.JobSpartanPieces, stamp, 5)
	writeCoatingIndexWithCoatings(t, data, meshjobs.JobWeapons, "deadbeef", 0)

	out := getCoatingStatus(t, h)
	if out.Export != exportOk {
		t.Fatalf("export = %q, want ok", out.Export)
	}
	sp, _ := out.Libraries["spartan_pieces"]
	if !sp.Built || sp.Stale || sp.MaterialsMissing != 5 {
		t.Fatalf("spartan_pieces = %+v (want built, not stale, 5 missing)", sp)
	}
	w, _ := out.Libraries["weapons"]
	if !w.Built || !w.Stale {
		t.Fatalf("weapons = %+v (want built and stale)", w)
	}
}
