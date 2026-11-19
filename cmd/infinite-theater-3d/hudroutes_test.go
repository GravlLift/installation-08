// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// hudroutes_test.go — the HUD icon route and the HUD job's place in the startup order.
// The route serves the built set only (a glyph the build wrote, or index.json), 404s an
// unknown name and a traversal, and never enqueues anything. The startup step queues the
// HUD icon job right after the weapon-icon job and skips it when the set is ready. No test
// uses a real game install.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

const hudRoute = "/static/weapons-assets/halo_infinite/hud/"

// hudFixtureSet writes a minimal built HUD icon set into the data directory: the 15 stems
// plus the damage arc, the shield chase, the shield quad, and index.json.
func hudFixtureSet(t *testing.T, dataDir string) {
	t.Helper()
	dir := weaponicons.HudOutDir(dataDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	for _, name := range weaponicons.HudFileNames() {
		if err := os.WriteFile(filepath.Join(dir, name+".png"), []byte("fixture-"+name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range weaponicons.HudFontNames() {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("fixture-"+name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "index.json"), []byte(`[]`), 0o600); err != nil {
		t.Fatal(err)
	}
}

// TestHudRouteServesBuiltFile — a built file is served with its content type.
func TestHudRouteServesBuiltFile(t *testing.T) {
	root := newFakeStore(t)
	hudFixtureSet(t, root.Dir())
	h := newTestHandlers(root, nil)

	rec := get(t, h, hudRoute+"Frag.png", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("Content-Type = %q, want image/png", rec.Header().Get("Content-Type"))
	}
	if body := rec.Body.String(); body != "fixture-Frag" {
		t.Fatalf("body = %q", body)
	}

	rec = get(t, h, hudRoute+"index.json", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("index status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", rec.Header().Get("Content-Type"))
	}

	rec = get(t, h, hudRoute+"DamageArc.png", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("DamageArc status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("DamageArc Content-Type = %q, want image/png", rec.Header().Get("Content-Type"))
	}
	if body := rec.Body.String(); body != "fixture-DamageArc" {
		t.Fatalf("DamageArc body = %q", body)
	}

	rec = get(t, h, hudRoute+"ShieldChase.png", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("ShieldChase status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("ShieldChase Content-Type = %q, want image/png", rec.Header().Get("Content-Type"))
	}
	if body := rec.Body.String(); body != "fixture-ShieldChase" {
		t.Fatalf("ShieldChase body = %q", body)
	}

	rec = get(t, h, hudRoute+"NormativePro-Regular.ttf", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("font status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "font/ttf" {
		t.Fatalf("font Content-Type = %q, want font/ttf", rec.Header().Get("Content-Type"))
	}
}

// TestHudRouteUnknownName — a name that is not a built file is a 404.
func TestHudRouteUnknownName(t *testing.T) {
	root := newFakeStore(t)
	hudFixtureSet(t, root.Dir())
	h := newTestHandlers(root, nil)
	for _, name := range []string{"nope.png", "frag.png", "Frag.PNG", "Frag.txt", "contour-00.png"} {
		rec := get(t, h, hudRoute+name, nil)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s: status = %d, want 404", name, rec.Code)
		}
	}
}

// TestHudRouteTraversal — a name that would escape the set's folder is a 404.
func TestHudRouteTraversal(t *testing.T) {
	root := newFakeStore(t)
	hudFixtureSet(t, root.Dir())
	h := newTestHandlers(root, nil)
	rec := get(t, h, hudRoute+"..%2f..%2findex.json", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// TestHudRouteMissingSet — a set the build did not write is a 404, and nothing is
// enqueued: the route's job is to serve, not to trigger.
func TestHudRouteMissingSet(t *testing.T) {
	root := newFakeStore(t)
	r, err := meshjobs.New(func(ctx context.Context, module, gameRoot, out string) (meshjobs.BuildResult, error) {
		return meshjobs.BuildResult{}, nil
	}, "", func(module string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	r.SetDest(func(module string) string { return filepath.Join(root.Dir(), module) })
	h := newTestHandlers(root, r)

	rec := get(t, h, hudRoute+"Frag.png", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	r.Start()
	defer r.Stop(time.Second)
	time.Sleep(100 * time.Millisecond)
	if s := r.Snapshot(meshjobs.JobHudIcons); s.State != meshjobs.StateAbsent {
		t.Fatalf("state after the request = %s, want absent (nothing enqueued)", s.State)
	}
}

// TestHudIconFile — the name filter: a built file passes, anything else does not.
func TestHudIconFile(t *testing.T) {
	yes := map[string]bool{"index.json": true, "Frag.png": true, "Overshield.png": true}
	for _, name := range weaponicons.HudFileNames() {
		yes[name+".png"] = true
	}
	cases := map[string]bool{
		"nope.png": false, "frag.png": false, "Frag.PNG": false, "Frag.txt": false,
		"contour-00.png": false, "jeu/index.json": false,
	}
	for _, name := range weaponicons.HudFontNames() {
		yes[name] = true
	}
	cases["NormativePro-Regular.otf"] = false
	cases["Consolas.ttf"] = false
	for name, want := range yes {
		cases[name] = want
	}
	for name, want := range cases {
		if got := hudIconFile(name); got != want {
			t.Errorf("hudIconFile(%q) = %v, want %v", name, got, want)
		}
	}
}

// TestHudRouteViaMux — the route is registered on the server's mux (a built file served
// through the full handler, not just the function).
func TestHudRouteViaMux(t *testing.T) {
	root := newFakeStore(t)
	hudFixtureSet(t, root.Dir())
	h := newTestHandlers(root, nil)
	req := httptest.NewRequest(http.MethodGet, hudRoute+"Dynamo.png", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("Content-Type = %q, want image/png", rec.Header().Get("Content-Type"))
	}
}

// TestHudStartupOrder — the startup step queues the HUD icon job right after the
// weapon-icon job, before the rank badge job and the weapon library.
func TestHudStartupOrder(t *testing.T) {
	rr := newRecordingRunner(t, func(string) bool { return false })
	enqueueStartupBuilds(rr, rr.ready, false)
	want := []string{
		meshjobs.JobWeaponIcons, meshjobs.JobHudIcons, meshjobs.JobRanks, meshjobs.JobBackdrop, meshjobs.JobAnnouncer,
		meshjobs.JobWeapons, meshjobs.JobFirstPerson, meshjobs.JobSpartanPieces,
	}
	if got := rr.modules(); !reflect.DeepEqual(got, want) {
		t.Fatalf("queued = %v, want %v", got, want)
	}
}

// TestHudStartupSkipsReady — a HUD set that is already on disk is not queued.
func TestHudStartupSkipsReady(t *testing.T) {
	ready := map[string]bool{meshjobs.JobHudIcons: true}
	rr := newRecordingRunner(t, func(m string) bool { return ready[m] })
	enqueueStartupBuilds(rr, rr.ready, false)
	want := []string{meshjobs.JobWeaponIcons, meshjobs.JobRanks, meshjobs.JobBackdrop, meshjobs.JobAnnouncer, meshjobs.JobWeapons,
		meshjobs.JobFirstPerson, meshjobs.JobSpartanPieces}
	if got := rr.modules(); !reflect.DeepEqual(got, want) {
		t.Fatalf("queued = %v, want %v", got, want)
	}
}
