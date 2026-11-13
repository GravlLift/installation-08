package main

// iconroutes_test.go — the weapon-icon route and the serve startup enqueue. The route
// serves the built set only (a PNG or index.json), 404 when the set is unbuilt or the name
// is not a built file, and 404 on a traversal. A request never enqueues anything: the
// build's single trigger is the startup, which enqueues the job when the game install is
// found and the set is missing, and does not when the set is present.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

const iconRoute = "/static/weapons-assets/halo_infinite/jeu/"

// iconFixtureSet writes a minimal built icon set into the data directory: one file per
// style plus index.json.
func iconFixtureSet(t *testing.T, dataDir string) {
	t.Helper()
	dir := weaponicons.OutDir(dataDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"contour-00.png", "silhouette-00.png", "killfeed-00.png", "index.json"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("fixture-"+name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// TestIconRouteServesBuiltFile — a built file is served with its content type.
func TestIconRouteServesBuiltFile(t *testing.T) {
	root := newFakeStore(t)
	iconFixtureSet(t, root.Dir())
	h := newTestHandlers(root, nil)

	rec := get(t, h, iconRoute+"contour-00.png", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("Content-Type = %q, want image/png", rec.Header().Get("Content-Type"))
	}
	if body := rec.Body.String(); body != "fixture-contour-00.png" {
		t.Fatalf("body = %q", body)
	}

	rec = get(t, h, iconRoute+"index.json", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("index status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", rec.Header().Get("Content-Type"))
	}
}

// TestIconRouteUnknownName — a name that is not a built file is a 404.
func TestIconRouteUnknownName(t *testing.T) {
	root := newFakeStore(t)
	iconFixtureSet(t, root.Dir())
	h := newTestHandlers(root, nil)
	for _, name := range []string{"nope.png", "contour-1.png", "contour-123.png", "weap.xml"} {
		rec := get(t, h, iconRoute+name, nil)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s: status = %d, want 404", name, rec.Code)
		}
	}
}

// TestIconRouteTraversal — a name that would escape the set's folder is a 404.
func TestIconRouteTraversal(t *testing.T) {
	root := newFakeStore(t)
	iconFixtureSet(t, root.Dir())
	h := newTestHandlers(root, nil)
	rec := get(t, h, iconRoute+"..%2f..%2findex.json", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// TestIconRouteMissingSet — a set the build did not write is a 404, and nothing is
// enqueued: the route's job is to serve, not to trigger.
func TestIconRouteMissingSet(t *testing.T) {
	root := newFakeStore(t)
	r, err := meshjobs.New(func(ctx context.Context, module, gameRoot, out string) (meshjobs.BuildResult, error) {
		return meshjobs.BuildResult{}, nil
	}, "", func(module string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	r.SetDest(func(module string) string { return filepath.Join(root.Dir(), module) })
	h := newTestHandlers(root, r)

	rec := get(t, h, iconRoute+"contour-00.png", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	r.Start()
	defer r.Stop(time.Second)
	time.Sleep(100 * time.Millisecond)
	for _, job := range []string{meshjobs.JobWeaponIcons, meshjobs.JobHudIcons} {
		if s := r.Snapshot(job); s.State != meshjobs.StateAbsent {
			t.Fatalf("%s state after the request = %s, want absent (nothing enqueued)", job, s.State)
		}
	}
}

// TestIconFile — the name filter: a built file passes, anything else does not.
func TestIconFile(t *testing.T) {
	cases := map[string]bool{
		"index.json":        true,
		"contour-00.png":    true,
		"contour-40.png":    true,
		"silhouette-07.png": true,
		"killfeed-88.png":   true,
		"contour-1.png":     false,
		"contour-123.png":   false,
		"contour_00.png":    false,
		"nope.png":          false,
		"weap.xml":          false,
		"contour-0a.png":    false,
	}
	for name, want := range cases {
		_, ok := iconFile(name)
		if ok != want {
			t.Errorf("iconFile(%q) = %v, want %v", name, ok, want)
		}
	}
}

// TestIconRouteViaMux — the route is registered on the server's mux (a built file served
// through the full handler, not just the function).
func TestIconRouteViaMux(t *testing.T) {
	root := newFakeStore(t)
	iconFixtureSet(t, root.Dir())
	h := newTestHandlers(root, nil)
	req := httptest.NewRequest(http.MethodGet, iconRoute+"killfeed-00.png", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("Content-Type = %q", rec.Header().Get("Content-Type"))
	}
}
