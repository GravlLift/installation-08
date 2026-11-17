package main

// serve_jobs_format_test.go — the build-format wiring of the readiness checks: a map or
// variant GLB records its build format in asset.extras, a library index carries its
// schema; an older or missing version is not ready (outdated) and the existing build flow
// rebuilds it. All fixtures are small synthetic GLBs and index files in temp stores; no
// game install, no network.

import (
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/firstperson"
	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// formatGLB is a minimal GLB whose asset.extras carries buildFormat (0: absent) and whose
// extensionsUsed lists KHR_texture_basisu when basisu is set (the KTX2 pass's marker).
func formatGLB(t *testing.T, buildFormat int, basisu bool) []byte {
	t.Helper()
	asset := map[string]any{"version": "2.0"}
	if buildFormat > 0 {
		asset["extras"] = map[string]any{"buildFormat": buildFormat, "module": "m"}
	}
	doc := map[string]any{"asset": asset}
	if basisu {
		doc["extensionsUsed"] = []any{"KHR_texture_basisu"}
	}
	js, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	for len(js)%4 != 0 {
		js = append(js, ' ')
	}
	buf := make([]byte, 0, 20+len(js))
	le := binary.LittleEndian
	w := func(v uint32) { buf = le.AppendUint32(buf, v) }
	w(0x46546c67) // "glTF"
	w(2)
	w(uint32(20 + len(js)))
	w(uint32(len(js)))
	w(0x4e4f534a) // JSON chunk
	buf = append(buf, js...)
	return buf
}

// writeGLBAt writes a minimal GLB with the given buildFormat (0: absent) and KTX2 marker
// at path.
func writeGLBAt(t *testing.T, path string, buildFormat int, basisu bool) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, formatGLB(t, buildFormat, basisu), 0o644); err != nil {
		t.Fatal(err)
	}
}

// TestGlbFormatCurrent — the build-format read of a map GLB: the stamped current format
// is current, an older stamp is not, an unstamped KTX2 GLB (KHR_texture_basisu, built
// before the stamp existed: format 2) is not since format 3, an unstamped PNG one is not,
// and a non-GLB is not.
func TestGlbFormatCurrent(t *testing.T) {
	dir := t.TempDir()
	writeGLBAt(t, filepath.Join(dir, "cur.glb"), mapmesh.BuildFormat, false)
	writeGLBAt(t, filepath.Join(dir, "old.glb"), mapmesh.BuildFormat-1, false)
	writeGLBAt(t, filepath.Join(dir, "ktx2.glb"), 0, true)
	writeGLBAt(t, filepath.Join(dir, "none.glb"), 0, false)
	if err := os.WriteFile(filepath.Join(dir, "junk.glb"), []byte("not a glb"), 0o644); err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]bool{
		"cur.glb": true, "old.glb": false, "ktx2.glb": false, "none.glb": false, "junk.glb": false,
	} {
		if got := glbFormatCurrent(filepath.Join(dir, name)); got != want {
			t.Errorf("glbFormatCurrent(%s) = %v, want %v", name, got, want)
		}
	}
}

// TestJobModuleFormatMapMesh — a map mesh on disk: current format ready, older format not
// ready but outdated, no file neither. The high quality is a separate module and file.
func TestJobModuleFormatMapMesh(t *testing.T) {
	root := meshTestStore(t)
	p, err := root.MeshPath("moda", meshjobs.QualityStandard)
	if err != nil {
		t.Fatal(err)
	}
	writeGLBAt(t, p, mapmesh.BuildFormat-1, false)
	if jobModuleReady(root, "moda") {
		t.Error("old-format map mesh ready")
	}
	if !jobModuleOutdated(root, "moda") {
		t.Error("old-format map mesh not outdated")
	}
	writeGLBAt(t, p, mapmesh.BuildFormat, false)
	if !jobModuleReady(root, "moda") {
		t.Error("current map mesh not ready")
	}
	if jobModuleOutdated(root, "moda") {
		t.Error("current map mesh outdated")
	}
	// The high build is a separate module: absent for both.
	if jobModuleReady(root, meshjobs.JobKey("moda", meshjobs.QualityHigh)) || jobModuleOutdated(root, meshjobs.JobKey("moda", meshjobs.QualityHigh)) {
		t.Error("high map mesh present without a file")
	}
	// No file at all: absent, not outdated.
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if jobModuleReady(root, "moda") || jobModuleOutdated(root, "moda") {
		t.Error("missing map mesh ready or outdated")
	}
}

// TestJobModuleFormatVariant — a match variant layer on disk: same contract as the map
// mesh, on the variant job key.
func TestJobModuleFormatVariant(t *testing.T) {
	root := meshTestStore(t)
	key := variantPrefix + "abc"
	writeGLBAt(t, variantPath(root, "abc", "variant.glb"), mapmesh.BuildFormat-1, false)
	if jobModuleReady(root, key) || !jobModuleOutdated(root, key) {
		t.Error("old variant: want not ready, outdated")
	}
	writeGLBAt(t, variantPath(root, "abc", "variant.glb"), mapmesh.BuildFormat, false)
	if !jobModuleReady(root, key) || jobModuleOutdated(root, key) {
		t.Error("current variant: want ready, not outdated")
	}
}

// libraryIndex is a coating library index.json with the given schema and the weapons
// library's fields (empty tables are current).
func libraryIndex(t *testing.T, dir, module, schema string, fields bool) string {
	t.Helper()
	folder, ok := coatingLibraryFolder(module)
	if !ok {
		t.Fatalf("%s is not a coating library", module)
	}
	dir = filepath.Join(dir, folder)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"ekur_stamp":""`
	if schema != "" {
		body += `,"schema":` + schema
	}
	if fields {
		body += `,"reticle_ranges":{},"banners":{},"idle_effects":{},"equipment":{},"equipment_rule":2`
	}
	body += `}`
	if err := os.WriteFile(filepath.Join(dir, "index.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// TestJobModuleFormatLibraries — the three coating libraries on disk: an index at the
// library's current schema is ready (no Ekur export is a non-downgrade), an older schema
// is not ready but outdated, a missing schema (pre-versioning) is not ready but outdated.
func TestJobModuleFormatLibraries(t *testing.T) {
	cases := []struct {
		module string
		cur    int
		old    int
	}{
		{meshjobs.JobWeapons, weapons.SchemaCurrent, weapons.SchemaCurrent - 1},
		{meshjobs.JobFirstPerson, firstperson.SchemaFirstPerson, firstperson.SchemaFirstPerson - 1},
		{meshjobs.JobSpartanPieces, 2, 1},
	}
	for _, c := range cases {
		root := libraryRoot(t)
		libraryIndex(t, root.Dir(), c.module, itoa(c.cur), true)
		if !jobModuleReady(root, c.module) {
			t.Errorf("%s: current schema not ready", c.module)
		}
		if jobModuleOutdated(root, c.module) {
			t.Errorf("%s: current schema outdated", c.module)
		}
		libraryIndex(t, root.Dir(), c.module, itoa(c.old), true)
		if jobModuleReady(root, c.module) {
			t.Errorf("%s: older schema ready", c.module)
		}
		if !jobModuleOutdated(root, c.module) {
			t.Errorf("%s: older schema not outdated", c.module)
		}
		libraryIndex(t, root.Dir(), c.module, "", true)
		if jobModuleReady(root, c.module) {
			t.Errorf("%s: no schema ready", c.module)
		}
		if !jobModuleOutdated(root, c.module) {
			t.Errorf("%s: no schema not outdated", c.module)
		}
	}
}

// TestJobModuleFormatWeaponsFields — the weapon library at its current schema is still
// not current when a field the view reads is missing (an index from before it): not
// ready, and outdated (its rebuild adds the field).
func TestJobModuleFormatWeaponsFields(t *testing.T) {
	root := libraryRoot(t)
	libraryIndex(t, root.Dir(), meshjobs.JobWeapons, "2", false) // no reticle_ranges & co
	if jobModuleReady(root, meshjobs.JobWeapons) {
		t.Error("weapons index without the view's fields ready")
	}
	if !jobModuleOutdated(root, meshjobs.JobWeapons) {
		t.Error("weapons index without the view's fields not outdated")
	}
}

// TestJobModuleFormatNoIndex — a library folder without an index is neither ready nor
// outdated (absent, not outdated).
func TestJobModuleFormatNoIndex(t *testing.T) {
	root := libraryRoot(t)
	if jobModuleReady(root, meshjobs.JobFirstPerson) || jobModuleOutdated(root, meshjobs.JobFirstPerson) {
		t.Error("no index: ready or outdated")
	}
}

// libraryRoot is a fresh temp store (the library checks need only the data directory).
func libraryRoot(t *testing.T) *store.Root {
	t.Helper()
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func itoa(n int) string { return strconv.Itoa(n) }

// TestGLBModule — the map and variant job keys (either quality) build a stamped GLB, the
// library, icon and sound jobs do not: only the former take the in-place format upgrade.
func TestGLBModule(t *testing.T) {
	for _, key := range []string{"moda", meshjobs.JobKey("moda", meshjobs.QualityHigh), variantPrefix + "abc", meshjobs.JobKey(variantPrefix+"abc", meshjobs.QualityHigh)} {
		if !glbModule(key) {
			t.Errorf("%s: not a GLB module", key)
		}
	}
	for _, key := range []string{meshjobs.JobWeapons, meshjobs.JobFirstPerson, meshjobs.JobSpartanPieces, meshjobs.JobWeaponIcons, meshjobs.JobHudIcons, meshjobs.JobRanks, meshjobs.JobBackdrop, meshjobs.JobAnnouncer} {
		if glbModule(key) {
			t.Errorf("%s: a GLB module", key)
		}
	}
}