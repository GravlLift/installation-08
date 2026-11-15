package main

// serve_backdrop_test.go — the home backdrop route. It serves the built file with its
// content type and a long cache header, and 404s when it is not built. It never enqueues
// anything. No test uses a real game install.

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/backdrop"
)

const backdropRoute = "/api/backdrop/home"

// backdropFixture writes a built backdrop file into the data directory.
func backdropFixture(t *testing.T, dataDir string) {
	t.Helper()
	dir := backdrop.OutDir(dataDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, backdrop.FileName), []byte("fixture-backdrop"), 0o600); err != nil {
		t.Fatal(err)
	}
}

// TestBackdropRouteServesBuiltFile — a built backdrop is served with its content type and a
// long cache header.
func TestBackdropRouteServesBuiltFile(t *testing.T) {
	root := newFakeStore(t)
	backdropFixture(t, root.Dir())
	h := newTestHandlers(root, nil)

	rec := get(t, h, backdropRoute, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("Content-Type = %q, want image/jpeg", rec.Header().Get("Content-Type"))
	}
	if rec.Header().Get("Cache-Control") == "" {
		t.Fatal("no Cache-Control header")
	}
	if body := rec.Body.String(); body != "fixture-backdrop" {
		t.Fatalf("body = %q", body)
	}
}

// TestBackdropRouteMissing — a backdrop the build did not write is a 404.
func TestBackdropRouteMissing(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)
	rec := get(t, h, backdropRoute, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// TestBackdropRouteViaMux — the route is registered on the server's mux (a built backdrop
// served through the full handler, not just the function).
func TestBackdropRouteViaMux(t *testing.T) {
	root := newFakeStore(t)
	backdropFixture(t, root.Dir())
	h := newTestHandlers(root, nil)
	req := httptest.NewRequest(http.MethodGet, backdropRoute, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("Content-Type = %q, want image/jpeg", rec.Header().Get("Content-Type"))
	}
}
