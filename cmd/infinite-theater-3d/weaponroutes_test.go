package main

// weaponroutes_test.go — the weapon library routes: the index, a model file, the build and the
// state. The weapons job is driven by the same mesh build runner as the map builds, so a build
// and a state request share its queue. The fake build writes the index and a model file, so the
// routes transition not-built -> building -> built exactly as the mesh routes do.

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// weaponTestRunner wires a Runner whose fake build, for the weapons job only, writes the
// library's index.json and one model GLB into the store (so the state reports ready once done).
// It honours its context. Map modules are left unbuilt (the fake only handles the weapons job).
func weaponTestRunner(t *testing.T, root *store.Root) *meshjobs.Runner {
	t.Helper()
	var mu sync.Mutex
	done := false
	ready := func(module string) bool {
		if module == meshjobs.JobWeapons {
			mu.Lock()
			defer mu.Unlock()
			return done
		}
		return false
	}
	build := func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		if module != meshjobs.JobWeapons {
			return meshjobs.BuildResult{}, context.Canceled
		}
		select {
		case <-ctx.Done():
			return meshjobs.BuildResult{}, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
		dir := filepath.Join(root.Dir(), "weapons")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return meshjobs.BuildResult{}, err
		}
		if err := os.WriteFile(filepath.Join(dir, "index.json"), []byte(`{"schema":1}`), 0o644); err != nil {
			return meshjobs.BuildResult{}, err
		}
		if err := os.WriteFile(filepath.Join(dir, "2b1824d5.glb"), []byte("glTF-model-bytes"), 0o644); err != nil {
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
	r.SetDest(func(module string) string { return filepath.Join(root.Dir(), "weapons") })
	r.Start()
	t.Cleanup(func() { r.Stop(2 * time.Second) })
	return r
}

// weaponTestHandlers builds a serverHandlers whose weapon catalog names map "moda".
func weaponTestHandlers(t *testing.T, root *store.Root, jobs *meshjobs.Runner) serverHandlers {
	t.Helper()
	return newServerHandlers(root, "", jobs, weapons.Catalog{Map: "moda"})
}

// TestWeaponIndexNotBuilt — before a build, GET /api/weapons is a JSON 404 naming
// weapons_not_built.
func TestWeaponIndexNotBuilt(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := weaponTestHandlers(t, root, nil)
	rec := get(t, h, "/api/weapons", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("index status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "weapons_not_built") {
		t.Fatalf("body = %s, want weapons_not_built", rec.Body.String())
	}
}

// TestWeaponBuildThenServe — POST build answers 202; the state route transitions to ready; the
// index is then served; a model file is served with its GLB bytes; a second POST answers 200.
func TestWeaponBuildThenServe(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	jobs := weaponTestRunner(t, root)
	h := weaponTestHandlers(t, root, jobs)

	rec := postMesh(t, h, "/api/weapons/build", nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("build status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	// Wait for ready.
	waitMeshReady(t, h, "/api/weapons/state")

	// The index is now served.
	idx := get(t, h, "/api/weapons", nil)
	if idx.Code != http.StatusOK || !strings.Contains(idx.Body.String(), `"schema"`) {
		t.Fatalf("index = %d %s, want 200 schema", idx.Code, idx.Body.String())
	}
	// A model file is served with its bytes.
	model := get(t, h, "/api/weapons/2b1824d5.glb", nil)
	if model.Code != http.StatusOK || !strings.Contains(model.Body.String(), "glTF-model-bytes") {
		t.Fatalf("model = %d %s, want 200 glTF bytes", model.Code, model.Body.String())
	}
	// A second build answers 200 ready.
	rec2 := postMesh(t, h, "/api/weapons/build", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second build status = %d, want 200 (ready); body=%s", rec2.Code, rec2.Body.String())
	}
	if !strings.Contains(rec2.Body.String(), `"ready"`) {
		t.Fatalf("second build body = %s, want ready", rec2.Body.String())
	}
}

// TestWeaponBuildOriginCheck — a POST from a non-loopback Origin is refused with 403; a
// loopback Origin is allowed.
func TestWeaponBuildOriginCheck(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	jobs := weaponTestRunner(t, root)
	h := weaponTestHandlers(t, root, jobs)

	rec := postMesh(t, h, "/api/weapons/build", map[string]string{"Origin": "https://evil.example.com"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin build status = %d, want 403; body=%s", rec.Code, rec.Body.String())
	}
	for _, o := range []string{"http://localhost:8177", "http://127.0.0.1:8177", "http://[::1]:8177"} {
		r2 := postMesh(t, h, "/api/weapons/build", map[string]string{"Origin": o})
		if r2.Code == http.StatusForbidden {
			t.Fatalf("loopback origin %s refused with 403", o)
		}
	}
}

// TestWeaponModelKeyValidation — a model path that is not a well-formed model key is a JSON 404,
// and a path that would escape the weapons folder is refused (it is a 404, not a file read).
func TestWeaponModelKeyValidation(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := weaponTestHandlers(t, root, nil)

	// A non-GLB name is not a model key.
	bad := get(t, h, "/api/weapons/notakey", nil)
	if bad.Code != http.StatusNotFound || !strings.Contains(bad.Body.String(), "weapon_model_not_available") {
		t.Fatalf("non-key = %d %s, want 404 weapon_model_not_available", bad.Code, bad.Body.String())
	}
	// A path escape is refused: the decoded segment is not a model key.
	escape := get(t, h, "/api/weapons/..%2fsecret.glb", nil)
	if escape.Code != http.StatusNotFound {
		t.Fatalf("escape = %d, want 404", escape.Code)
	}
}

// TestWeaponStateNoMap — with no map key in the catalog, state and build are 409.
func TestWeaponStateNoMap(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, "", nil, weapons.Catalog{})

	rec := get(t, h, "/api/weapons/state", nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("no-map state = %d, want 409", rec.Code)
	}
	rec2 := postMesh(t, h, "/api/weapons/build", nil)
	if rec2.Code != http.StatusConflict {
		t.Fatalf("no-map build = %d, want 409", rec2.Code)
	}
}

// TestWeaponBuildUnavailable — with no runner, state and build are 503.
func TestWeaponBuildUnavailable(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, "", nil, weapons.Catalog{Map: "moda"})

	rec := get(t, h, "/api/weapons/state", nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("no-runner state = %d, want 503", rec.Code)
	}
	rec2 := postMesh(t, h, "/api/weapons/build", nil)
	if rec2.Code != http.StatusServiceUnavailable {
		t.Fatalf("no-runner build = %d, want 503", rec2.Code)
	}
}

// TestWeaponStateTransitions — the state route shows the lifecycle: absent before a build,
// ready after one (with the byte summary).
func TestWeaponStateTransitions(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	jobs := weaponTestRunner(t, root)
	h := weaponTestHandlers(t, root, jobs)

	rec := get(t, h, "/api/weapons/state", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"absent"`) {
		t.Fatalf("pre-build state = %d %s, want 200 absent", rec.Code, rec.Body.String())
	}
	postMesh(t, h, "/api/weapons/build", nil)
	body := waitMeshReady(t, h, "/api/weapons/state")
	if !strings.Contains(body, `"weapons"`) {
		t.Fatalf("ready state missing key: %s", body)
	}
}
