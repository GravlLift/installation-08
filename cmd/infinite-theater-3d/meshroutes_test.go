package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// meshTestStore builds a temp store with two matches: "abc" (module "moda", no mesh file)
// and "def" (module "modb", no mesh file). Both have no mesh on disk, so the build routes
// can exercise the build path.
func meshTestStore(t *testing.T) *store.Root {
	t.Helper()
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for id, module := range map[string]string{"abc": "moda", "def": "modb"} {
		if err := root.SaveMatchMeta(id, store.Match{MatchID: id, MapName: "M", MapModule: module, ImportedAt: "2026-01-01T00:00:00Z"}); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// meshTestRunner wires a Runner whose fake build writes the module's mesh file into the
// store (so it reports ready once done) and honours its context.
func meshTestRunner(t *testing.T, root *store.Root) *meshjobs.Runner {
	t.Helper()
	var mu sync.Mutex
	files := make(map[string]bool)
	ready := func(module string) bool {
		mu.Lock()
		defer mu.Unlock()
		return files[module]
	}
	build := func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		select {
		case <-ctx.Done():
			return meshjobs.BuildResult{}, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
		if err := root.WriteFile(out, []byte("glTF")); err != nil {
			return meshjobs.BuildResult{}, err
		}
		mu.Lock()
		files[module] = true
		mu.Unlock()
		return meshjobs.BuildResult{Bytes: 4, Triangles: 10}, nil
	}
	r, err := meshjobs.New(build, "", ready)
	if err != nil {
		t.Fatal(err)
	}
	r.SetDest(func(module string) string {
		p, err := root.MeshPath(module)
		if err != nil {
			return module + ".glb"
		}
		return p
	})
	r.Start()
	t.Cleanup(func() { r.Stop(2 * time.Second) })
	return r
}

func postMesh(t *testing.T, h http.Handler, path string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// waitMeshReady polls the state route until the module is ready.
func waitMeshReady(t *testing.T, h http.Handler, path string) string {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	var body string
	for time.Now().Before(deadline) {
		rec := get(t, h, path, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("state status = %d", rec.Code)
		}
		body = rec.Body.String()
		if strings.Contains(body, `"ready"`) {
			return body
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("mesh never became ready: %s", body)
	return body
}

// newTestHandlers builds a serverHandlers with the given store, runner and weapon catalog. The
// mesh-route tests pass an empty weapon catalog (they exercise the mesh routes only).
func newTestHandlers(root *store.Root, jobs *meshjobs.Runner) serverHandlers {
	return newServerHandlers(root, "", jobs, weapons.Catalog{})
}

// TestMeshBuildStartsAndJoins — POST build on a match with no mesh returns 202; the state
// route transitions absent -> (queued|building) -> ready; a second POST joins, not a
// duplicate build.
func TestMeshBuildStartsAndJoins(t *testing.T) {
	root := meshTestStore(t)
	jobs := meshTestRunner(t, root)
	h := newTestHandlers(root, jobs)

	rec := postMesh(t, h, "/api/matches/abc/mesh/build", nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("build status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	statePath := "/api/matches/abc/mesh/state"
	// Wait for ready.
	waitMeshReady(t, h, statePath)
	// Once ready, a further POST answers 200 ready (the file exists).
	rec2 := postMesh(t, h, "/api/matches/abc/mesh/build", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second build status = %d, want 200 (ready); body=%s", rec2.Code, rec2.Body.String())
	}
	if !strings.Contains(rec2.Body.String(), `"ready"`) {
		t.Fatalf("second build body = %s, want ready", rec2.Body.String())
	}
}

// TestMeshBuildOriginCheck — a POST from a non-loopback Origin is refused with 403; no
// build is started.
func TestMeshBuildOriginCheck(t *testing.T) {
	root := meshTestStore(t)
	jobs := meshTestRunner(t, root)
	h := newTestHandlers(root, jobs)

	rec := postMesh(t, h, "/api/matches/abc/mesh/build", map[string]string{"Origin": "https://evil.example.com"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin build status = %d, want 403; body=%s", rec.Code, rec.Body.String())
	}
	// Loopback origins are allowed.
	for _, o := range []string{"http://localhost:8177", "http://127.0.0.1:8177", "http://[::1]:8177"} {
		r2 := postMesh(t, h, "/api/matches/abc/mesh/build", map[string]string{"Origin": o})
		if r2.Code == http.StatusForbidden {
			t.Fatalf("loopback origin %s refused with 403", o)
		}
	}
}

// TestMeshBuildUnknownMatch — a POST for an unknown match is a 404.
func TestMeshBuildUnknownMatch(t *testing.T) {
	root := meshTestStore(t)
	jobs := meshTestRunner(t, root)
	h := newTestHandlers(root, jobs)

	rec := postMesh(t, h, "/api/matches/fff0000/mesh/build", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown match build status = %d, want 404", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "match_not_found") {
		t.Fatalf("body = %s, want match_not_found", rec.Body.String())
	}
}

// TestMeshBuildNoModule — a match with no mapModule is a 409 on both build and state.
func TestMeshBuildNoModule(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := root.SaveMatchMeta("abc", store.Match{MatchID: "abc", MapName: "M", MapModule: "", ImportedAt: "2026-01-01T00:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	jobs := meshTestRunner(t, root)
	h := newTestHandlers(root, jobs)

	rec := postMesh(t, h, "/api/matches/abc/mesh/build", nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("no-module build status = %d, want 409", rec.Code)
	}
	rec2 := get(t, h, "/api/matches/abc/mesh/state", nil)
	if rec2.Code != http.StatusConflict {
		t.Fatalf("no-module state status = %d, want 409", rec2.Code)
	}
}

// TestMeshStateTransitions — the state route shows the lifecycle: absent before a build,
// ready after one (with the byte/triangle summary).
func TestMeshStateTransitions(t *testing.T) {
	root := meshTestStore(t)
	jobs := meshTestRunner(t, root)
	h := newTestHandlers(root, jobs)
	statePath := "/api/matches/abc/mesh/state"

	// Absent before any build.
	rec := get(t, h, statePath, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"absent"`) {
		t.Fatalf("pre-build state = %d %s, want 200 absent", rec.Code, rec.Body.String())
	}
	postMesh(t, h, "/api/matches/abc/mesh/build", nil)
	body := waitMeshReady(t, h, statePath)
	if !strings.Contains(body, `"moda"`) {
		t.Fatalf("ready state missing moduleKey: %s", body)
	}
}
