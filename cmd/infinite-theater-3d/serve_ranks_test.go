package main

// serve_ranks_test.go — the rank badge route. The route serves the built set only (a
// badge the build wrote, under the exact name the context emits), 404s an unknown name
// and a traversal, and never enqueues anything. No test uses a real game install.

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/rankicons"
)

const rankRoute = "/static/ranks/halo_infinite/"

// rankFixtureSet writes a minimal built badge set into the data directory: all 31 names.
func rankFixtureSet(t *testing.T, dataDir string) {
	t.Helper()
	dir := rankicons.OutDir(dataDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	for _, name := range rankicons.Names() {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("fixture-"+name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// TestRankRouteServesBuiltFile — a built badge is served with its content type.
func TestRankRouteServesBuiltFile(t *testing.T) {
	root := newFakeStore(t)
	rankFixtureSet(t, root.Dir())
	h := newTestHandlers(root, nil)

	rec := get(t, h, rankRoute+"120px-HINF-CSR_Onyx.png", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("Content-Type = %q, want image/png", rec.Header().Get("Content-Type"))
	}
	if body := rec.Body.String(); body != "fixture-120px-HINF-CSR_Onyx.png" {
		t.Fatalf("body = %q", body)
	}

	rec = get(t, h, rankRoute+"120px-HINF-CSR_Bronze1.png", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

// TestRankRouteUnknownName — a name that is not a badge file is a 404.
func TestRankRouteUnknownName(t *testing.T) {
	root := newFakeStore(t)
	rankFixtureSet(t, root.Dir())
	h := newTestHandlers(root, nil)
	for _, name := range []string{
		"nope.png",
		"120px-HINF-CSR_onyx.png",
		"120px-HINF-CSR_Bronze7.png",
		"120px-HINF-CSR_Bronze1.PNG",
		"120px-HINF-CSR_Bronze1.txt",
		"contour-00.png",
	} {
		rec := get(t, h, rankRoute+name, nil)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s: status = %d, want 404", name, rec.Code)
		}
	}
}

// TestRankRouteTraversal — a name that would escape the set's folder is a 404.
func TestRankRouteTraversal(t *testing.T) {
	root := newFakeStore(t)
	rankFixtureSet(t, root.Dir())
	h := newTestHandlers(root, nil)
	rec := get(t, h, rankRoute+"..%2f..%2findex.json", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// TestRankRouteMissingSet — a set the build did not write is a 404.
func TestRankRouteMissingSet(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)
	rec := get(t, h, rankRoute+"120px-HINF-CSR_Onyx.png", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// TestRankIconFile — the name filter: a badge name passes, anything else does not.
func TestRankIconFile(t *testing.T) {
	for _, name := range rankicons.Names() {
		if !rankIconFile(name) {
			t.Errorf("rankIconFile(%q) = false, want true", name)
		}
	}
	for _, name := range []string{
		"nope.png",
		"120px-HINF-CSR_onyx.png",
		"120px-HINF-CSR_Bronze7.png",
		"120px-HINF-CSR_Bronze1.PNG",
		"jeu/index.json",
		"../weapons.json",
	} {
		if rankIconFile(name) {
			t.Errorf("rankIconFile(%q) = true, want false", name)
		}
	}
}

// TestRankRouteViaMux — the route is registered on the server's mux (a built badge
// served through the full handler, not just the function).
func TestRankRouteViaMux(t *testing.T) {
	root := newFakeStore(t)
	rankFixtureSet(t, root.Dir())
	h := newTestHandlers(root, nil)
	req := httptest.NewRequest(http.MethodGet, rankRoute+"120px-HINF-CSR_Gold4.png", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("Content-Type = %q, want image/png", rec.Header().Get("Content-Type"))
	}
}
