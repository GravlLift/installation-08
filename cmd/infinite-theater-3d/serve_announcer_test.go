// serve_announcer_test.go — the announcer sound library: readiness from the manifest's version,
// the state/build route pair over the mesh build runner (a fake build writes the manifest), the
// read-only refusal.

package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// writeAnnouncerManifest writes a manifest of the given version into the store's sound folder.
func writeAnnouncerManifest(t *testing.T, dataDir string, version int) {
	t.Helper()
	dir := soundsDir(dataDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(map[string]any{"version": version, "language": "en", "lines": map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, announcer.ManifestName), raw, 0o644); err != nil {
		t.Fatal(err)
	}
}

// announcerTestHandlers wires a runner whose readiness is the server's own (jobModuleReady) and
// whose fake build, for the announcer job only, writes a current manifest.
func announcerTestHandlers(t *testing.T) (serverHandlers, *store.Root) {
	t.Helper()
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	build := func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		if module != meshjobs.JobAnnouncer {
			return meshjobs.BuildResult{}, context.Canceled
		}
		writeAnnouncerManifest(t, root.Dir(), announcer.ManifestVersion)
		return meshjobs.BuildResult{Bytes: 1}, nil
	}
	r, err := meshjobs.New(build, "", func(m string) bool { return jobModuleReady(root, m) })
	if err != nil {
		t.Fatal(err)
	}
	r.Start()
	t.Cleanup(func() { r.Stop(2 * time.Second) })
	return newServerHandlers(root, "", r, weapons.Catalog{}, testLabelCatalog), root
}

// announcerState reads the state route's built and stale fields and its state word.
func announcerState(t *testing.T, h http.Handler) (state string, built, stale bool) {
	t.Helper()
	rec := get(t, h, "/api/announcer/state", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("state status = %d", rec.Code)
	}
	var body struct {
		State string `json:"state"`
		Built bool   `json:"built"`
		Stale bool   `json:"stale"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.State, body.Built, body.Stale
}

// TestAnnouncerReadiness — absent and version-1 manifests are not ready (the startup queues the
// job); a current manifest is.
func TestAnnouncerReadiness(t *testing.T) {
	h, root := announcerTestHandlers(t)
	if jobModuleReady(root, meshjobs.JobAnnouncer) {
		t.Fatal("ready without a manifest")
	}
	if state, built, stale := announcerState(t, h); state != "absent" || built || stale {
		t.Fatalf("no manifest: %s built %v stale %v", state, built, stale)
	}
	writeAnnouncerManifest(t, root.Dir(), 1)
	if jobModuleReady(root, meshjobs.JobAnnouncer) {
		t.Fatal("a version-1 manifest is ready")
	}
	if state, built, stale := announcerState(t, h); state != "absent" || !built || !stale {
		t.Fatalf("version 1: %s built %v stale %v", state, built, stale)
	}
	writeAnnouncerManifest(t, root.Dir(), announcer.ManifestVersion)
	if state, built, stale := announcerState(t, h); state != "ready" || !built || stale {
		t.Fatalf("current: %s built %v stale %v", state, built, stale)
	}
}

// TestAnnouncerBuildRoute — POST build answers 202, the state turns ready and current, a second
// POST answers 200; a foreign Origin is refused; the read-only mode refuses the POST.
func TestAnnouncerBuildRoute(t *testing.T) {
	h, _ := announcerTestHandlers(t)
	if rec := postMesh(t, h, "/api/announcer/build", map[string]string{"Origin": "https://evil.example.com"}); rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin build = %d, want 403", rec.Code)
	}
	ro := h
	ro.readOnly = true
	if rec := post(t, ro.readOnlyHandler(), "/api/announcer/build"); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "read_only") {
		t.Fatalf("read-only build = %d %s, want 403 read_only", rec.Code, rec.Body.String())
	}
	if _, built, _ := announcerState(t, h); built {
		t.Fatal("a refused build wrote the manifest")
	}
	if rec := postMesh(t, h, "/api/announcer/build", nil); rec.Code != http.StatusAccepted {
		t.Fatalf("build = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	waitMeshReady(t, h, "/api/announcer/state")
	if _, built, stale := announcerState(t, h); !built || stale {
		t.Fatalf("after build: built %v stale %v", built, stale)
	}
	if rec := postMesh(t, h, "/api/announcer/build", nil); rec.Code != http.StatusOK {
		t.Fatalf("second build = %d, want 200", rec.Code)
	}
}
