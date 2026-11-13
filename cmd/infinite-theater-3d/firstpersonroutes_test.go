package main

// firstpersonroutes_test.go — the first-person library routes: the index, the arm catalog,
// a library file, and the build/state pair. The first-person job is driven by the same mesh
// build runner as the map builds and the weapons job, so a build and a state request share
// its queue. The fake build writes the index, the arm catalog and a rig file, so the routes
// transition not-built -> building -> built exactly as the weapons routes do.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/firstperson"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// firstPersonTestRunner wires a Runner whose fake build, for the first-person job only,
// writes the library's index.json, bras.json and one rig GLB into the store (so the state
// reports ready once done). It honours its context. Other modules are left unbuilt.
func firstPersonTestRunner(t *testing.T, root *store.Root) *meshjobs.Runner {
	t.Helper()
	var mu sync.Mutex
	done := false
	ready := func(module string) bool {
		if module == meshjobs.JobFirstPerson {
			mu.Lock()
			defer mu.Unlock()
			return done
		}
		return false
	}
	build := func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		if module != meshjobs.JobFirstPerson {
			return meshjobs.BuildResult{}, context.Canceled
		}
		select {
		case <-ctx.Done():
			return meshjobs.BuildResult{}, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
		if err := writeFirstPersonFixtures(filepath.Join(root.Dir(), "first-person")); err != nil {
			return meshjobs.BuildResult{}, err
		}
		mu.Lock()
		done = true
		mu.Unlock()
		return meshjobs.BuildResult{Bytes: 16}, nil
	}
	r, err := meshjobs.New(build, "", ready)
	if err != nil {
		t.Fatal(err)
	}
	r.SetDest(func(module string) string { return filepath.Join(root.Dir(), "first-person") })
	r.Start()
	t.Cleanup(func() { r.Stop(2 * time.Second) })
	return r
}

// writeFirstPersonFixtures lays down the library files the routes serve: the index (the
// shape the viewer reads), the arm catalog, and one rig GLB plus one shared texture.
func writeFirstPersonFixtures(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	files := map[string]string{
		firstperson.FichierIndex:                      `{"schema":1,"generator":"test","weapons":[{"weapon":"abcdef12","file":"rig-0123456789abcdef.glb"}],"rigs":[{"file":"rig-0123456789abcdef.glb","bones":1,"triangles":1,"bytes":1,"clips":[],"actions":[],"missingActions":[]}],"failures":[],"textures":{"files":1,"bytes":12,"references":1}}`,
		firstperson.FichierBras:                       `{"schema":1,"skeleton":{"bones":[]},"pieces":[],"default":{},"failures":[]}`,
		"rig-0123456789abcdef.glb":                    "glTF-rig-bytes",
		"texture-" + strings.Repeat("0", 64) + ".png": "texture-bytes",
	}
	for nom, contenu := range files {
		if err := os.WriteFile(filepath.Join(dir, nom), []byte(contenu), 0o644); err != nil {
			return err
		}
	}
	return nil
}

// firstPersonTestHandlers builds a serverHandlers whose weapon catalog names map "moda"
// (so the first-person build is allowed even with an empty store).
func firstPersonTestHandlers(t *testing.T, root *store.Root, jobs *meshjobs.Runner) serverHandlers {
	t.Helper()
	return newServerHandlers(root, "", jobs, weapons.Catalog{Map: "moda"}, testLabelCatalog)
}

// TestFirstPersonIndexNotBuilt — before a build, the index is a JSON 404 naming
// first_person_not_built, and so is the arm catalog.
func TestFirstPersonIndexNotBuilt(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := firstPersonTestHandlers(t, root, nil)
	rec := get(t, h, "/api/first-person/index.json", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("index status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "first_person_not_built") {
		t.Fatalf("body = %s, want first_person_not_built", rec.Body.String())
	}
	bras := get(t, h, "/api/first-person/bras.json", nil)
	if bras.Code != http.StatusNotFound {
		t.Fatalf("bras status = %d, want 404", bras.Code)
	}
}

// TestFirstPersonBuildThenServe — POST build answers 202; the state route transitions to
// ready; the index and the arm catalog are then served; a rig and a texture are served
// with their bytes (range-capable); a second POST answers 200.
func TestFirstPersonBuildThenServe(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	jobs := firstPersonTestRunner(t, root)
	h := firstPersonTestHandlers(t, root, jobs)

	rec := postMesh(t, h, "/api/first-person/build", nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("build status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	waitMeshReady(t, h, "/api/first-person/state")

	idx := get(t, h, "/api/first-person/index.json", nil)
	if idx.Code != http.StatusOK || !strings.Contains(idx.Body.String(), `"schema"`) {
		t.Fatalf("index = %d %s, want 200 schema", idx.Code, idx.Body.String())
	}
	bras := get(t, h, "/api/first-person/bras.json", nil)
	if bras.Code != http.StatusOK || !strings.Contains(bras.Body.String(), `"skeleton"`) {
		t.Fatalf("bras = %d %s, want 200 skeleton", bras.Code, bras.Body.String())
	}
	rig := get(t, h, "/api/first-person/rig-0123456789abcdef.glb", nil)
	if rig.Code != http.StatusOK || !strings.Contains(rig.Body.String(), "glTF-rig-bytes") {
		t.Fatalf("rig = %d %s, want 200 rig bytes", rig.Code, rig.Body.String())
	}
	tex := get(t, h, "/api/first-person/texture-"+strings.Repeat("0", 64)+".png", nil)
	if tex.Code != http.StatusOK || !strings.Contains(tex.Body.String(), "texture-bytes") {
		t.Fatalf("texture = %d %s, want 200 texture bytes", tex.Code, tex.Body.String())
	}
	// A rig is range-capable: a Range request returns the requested slice with a 206.
	req := httptest.NewRequest(http.MethodGet, "/api/first-person/rig-0123456789abcdef.glb", nil)
	req.Header.Set("Range", "bytes=0-3")
	recRange := httptest.NewRecorder()
	h.ServeHTTP(recRange, req)
	if recRange.Code != http.StatusPartialContent {
		t.Fatalf("range status = %d, want 206", recRange.Code)
	}
	rec2 := postMesh(t, h, "/api/first-person/build", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second build status = %d, want 200 (ready); body=%s", rec2.Code, rec2.Body.String())
	}
	if !strings.Contains(rec2.Body.String(), `"ready"`) {
		t.Fatalf("second build body = %s, want ready", rec2.Body.String())
	}
}

// TestFirstPersonBuildOriginCheck — a POST from a non-loopback Origin is refused with 403;
// a loopback Origin is allowed.
func TestFirstPersonBuildOriginCheck(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	jobs := firstPersonTestRunner(t, root)
	h := firstPersonTestHandlers(t, root, jobs)

	rec := postMesh(t, h, "/api/first-person/build", map[string]string{"Origin": "https://evil.example.com"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin build status = %d, want 403; body=%s", rec.Code, rec.Body.String())
	}
	for _, o := range []string{"http://localhost:8177", "http://127.0.0.1:8177", "http://[::1]:8177"} {
		r2 := postMesh(t, h, "/api/first-person/build", map[string]string{"Origin": o})
		if r2.Code == http.StatusForbidden {
			t.Fatalf("loopback origin %s refused with 403", o)
		}
	}
}

// TestFirstPersonFileValidation — a file name that is not one of the library's own is a
// JSON 404, a path that would escape the library folder is refused, and a directory (the
// folder itself is not a named file) is not served.
func TestFirstPersonFileValidation(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := writeFirstPersonFixtures(filepath.Join(root.Dir(), "first-person")); err != nil {
		t.Fatal(err)
	}
	// A foreign file written into the library folder is not named by the library.
	secret := "secret.txt"
	if err := os.WriteFile(filepath.Join(root.Dir(), "first-person", secret), []byte("do not serve"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := firstPersonTestHandlers(t, root, nil)

	bad := get(t, h, "/api/first-person/secret.txt", nil)
	if bad.Code != http.StatusNotFound || !strings.Contains(bad.Body.String(), "first_person_file_not_available") {
		t.Fatalf("foreign file = %d %s, want 404 first_person_file_not_available", bad.Code, bad.Body.String())
	}
	escape := get(t, h, "/api/first-person/..%2fsecret.txt", nil)
	if escape.Code != http.StatusNotFound {
		t.Fatalf("escape = %d, want 404", escape.Code)
	}
	// A traversal that stays on a well-formed library name after cleaning is still refused:
	// the resolved path is outside the library folder.
	escape2 := get(t, h, "/api/first-person/sub/..%2frig-0123456789abcdef.glb", nil)
	if escape2.Code != http.StatusNotFound {
		t.Fatalf("nested escape = %d, want 404", escape2.Code)
	}
}

// TestFirstPersonStateUnavailable — with no runner, the state route is 503.
func TestFirstPersonStateUnavailable(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)

	rec := get(t, h, "/api/first-person/state", nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("no-runner state = %d, want 503", rec.Code)
	}
}

// TestFirstPersonBuildUnavailable — with no runner, build is 503.
func TestFirstPersonBuildUnavailable(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := firstPersonTestHandlers(t, root, nil)

	rec := postMesh(t, h, "/api/first-person/build", nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("no-runner build = %d, want 503", rec.Code)
	}
}

// TestFirstPersonStateTransitions — the state route shows the lifecycle: absent before a
// build, ready after one (the build and the state share the runner's queue).
func TestFirstPersonStateTransitions(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	jobs := firstPersonTestRunner(t, root)
	h := firstPersonTestHandlers(t, root, jobs)

	rec := get(t, h, "/api/first-person/state", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"absent"`) {
		t.Fatalf("pre-build state = %d %s, want 200 absent", rec.Code, rec.Body.String())
	}
	postMesh(t, h, "/api/first-person/build", nil)
	body := waitMeshReady(t, h, "/api/first-person/state")
	if !strings.Contains(body, `"first-person"`) {
		t.Fatalf("ready state missing module key: %s", body)
	}
}

// TestFirstPersonSingleFlightAcrossJobs — the first-person build joins the same queue as
// the weapons build and the map builds: while the first-person job is building, a map
// build request is queued behind it (the runner runs one heavy build at a time across
// maps, weapons and first person).
func TestFirstPersonSingleFlightAcrossJobs(t *testing.T) {
	root := newFakeStore(t) // holds match "abc" on map "moda" with its mesh present
	jobs := firstPersonTestRunner(t, root)
	h := firstPersonTestHandlers(t, root, jobs)

	postMesh(t, h, "/api/first-person/build", nil)
	// While the first-person build is running, a map build for a module that has no mesh
	// yet is refused? No: "moda"'s mesh is present, so it answers ready; use a module
	// without a mesh to prove it queues behind the first-person job.
	if err := root.SaveMatchMeta("def", store.Match{MatchID: "def", MapName: "M", MapModule: "other_mod", ImportedAt: "2026-01-01T00:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	rec := postMesh(t, h, "/api/matches/def/mesh/build", nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("map build while first-person builds = %d, want 202 (queued); body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"queued"`) {
		t.Fatalf("queued map build body = %s, want queued", body)
	}
	waitMeshReady(t, h, "/api/first-person/state")
}
