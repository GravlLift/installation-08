// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// serve_announcer_test.go — the extracted sound library: readiness from the five manifests and
// their versions, the state/build route pair over the mesh build runner (a fake build writes the
// manifests), the read-only refusal.

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

	"github.com/llampwall/infinite-theater-3d/internal/ambience"
	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/endmatchvoice"
	"github.com/llampwall/infinite-theater-3d/internal/eventsounds"
	"github.com/llampwall/infinite-theater-3d/internal/footstepsounds"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/reloadsounds"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/uisounds"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// writeAnnouncerManifest writes an announcer manifest of the given version into the store's
// sound folder.
func writeAnnouncerManifest(t *testing.T, dataDir string, version int) {
	t.Helper()
	writeSoundManifest(t, dataDir, announcer.ManifestName, map[string]any{"version": version, "language": "en", "lines": map[string]any{}})
}

// writeReloadsManifest writes a reloads manifest of the given version into the store's sound folder.
func writeReloadsManifest(t *testing.T, dataDir string, version int) {
	t.Helper()
	writeSoundManifest(t, dataDir, reloadsounds.ManifestName, map[string]any{"version": version, "weapons": map[string]any{}})
}

// writeFootstepsManifest writes a foot step sounds manifest of the given version into the store's
// sound folder.
func writeFootstepsManifest(t *testing.T, dataDir string, version int) {
	t.Helper()
	writeSoundManifest(t, dataDir, footstepsounds.ManifestName, map[string]any{"version": version, "feet": map[string]any{}, "movement": map[string]any{}})
}

// writeAmbienceManifest writes an ambience manifest of the given version into the store's sound folder.
func writeAmbienceManifest(t *testing.T, dataDir string, version int) {
	t.Helper()
	writeSoundManifest(t, dataDir, ambience.ManifestName, map[string]any{"version": version, "maps": map[string]any{}})
}

// writeUIManifest writes an interface sounds manifest of the given version into the store's sound folder.
func writeUIManifest(t *testing.T, dataDir string, version int) {
	t.Helper()
	writeSoundManifest(t, dataDir, uisounds.ManifestName, map[string]any{"version": version, "sounds": map[string]any{}})
}

// writeEventsManifest writes an event sounds manifest of the given version into the store's sound folder.
func writeEventsManifest(t *testing.T, dataDir string, version int) {
	t.Helper()
	writeSoundManifest(t, dataDir, eventsounds.ManifestName, map[string]any{"version": version, "sounds": map[string]any{}})
}

// writeEndMatchVoiceManifest writes an end-of-match voice manifest of the given version into the
// store's sound folder.
func writeEndMatchVoiceManifest(t *testing.T, dataDir string, version int) {
	t.Helper()
	writeSoundManifest(t, dataDir, endmatchvoice.ManifestName, map[string]any{"version": version, "sounds": map[string]any{}})
}

func writeSoundManifest(t *testing.T, dataDir, name string, body map[string]any) {
	t.Helper()
	dir := soundsDir(dataDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), raw, 0o644); err != nil {
		t.Fatal(err)
	}
}

// announcerTestHandlers wires a runner whose readiness is the server's own (jobModuleReady) and
// whose fake build, for the announcer job only, writes current manifests.
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
		writeReloadsManifest(t, root.Dir(), reloadsounds.ManifestVersion)
		writeFootstepsManifest(t, root.Dir(), footstepsounds.ManifestVersion)
		writeUIManifest(t, root.Dir(), uisounds.ManifestVersion)
		writeAmbienceManifest(t, root.Dir(), ambience.ManifestVersion)
		writeEventsManifest(t, root.Dir(), eventsounds.ManifestVersion)
		writeEndMatchVoiceManifest(t, root.Dir(), endmatchvoice.ManifestVersion)
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
// job), nor is a current announcer manifest without the reloads', the interface sounds' or the ambience's one;
// all five current are.
func TestAnnouncerReadiness(t *testing.T) {
	h, root := announcerTestHandlers(t)
	if jobModuleReady(root, meshjobs.JobAnnouncer) {
		t.Fatal("ready without a manifest")
	}
	if state, built, stale := announcerState(t, h); state != "absent" || built || stale {
		t.Fatalf("no manifest: %s built %v stale %v", state, built, stale)
	}
	writeAnnouncerManifest(t, root.Dir(), announcer.ManifestVersion)
	if jobModuleReady(root, meshjobs.JobAnnouncer) {
		t.Fatal("ready without the reloads manifest")
	}
	if state, built, _ := announcerState(t, h); state != "absent" || built {
		t.Fatalf("announcer only: %s built %v", state, built)
	}
	writeReloadsManifest(t, root.Dir(), reloadsounds.ManifestVersion)
	if state, built, _ := announcerState(t, h); state != "absent" || built {
		t.Fatalf("without the foot step sounds: %s built %v", state, built)
	}
	writeFootstepsManifest(t, root.Dir(), footstepsounds.ManifestVersion)
	if state, built, _ := announcerState(t, h); state != "absent" || built {
		t.Fatalf("without the interface sounds: %s built %v", state, built)
	}
	writeUIManifest(t, root.Dir(), uisounds.ManifestVersion)
	if state, built, _ := announcerState(t, h); state != "absent" || built {
		t.Fatalf("without ambience: %s built %v", state, built)
	}
	writeAmbienceManifest(t, root.Dir(), ambience.ManifestVersion)
	if state, built, _ := announcerState(t, h); state != "absent" || built {
		t.Fatalf("without event sounds: %s built %v", state, built)
	}
	writeEventsManifest(t, root.Dir(), eventsounds.ManifestVersion)
	if state, built, _ := announcerState(t, h); state != "absent" || built {
		t.Fatalf("without end-of-match voice: %s built %v", state, built)
	}
	writeEndMatchVoiceManifest(t, root.Dir(), endmatchvoice.ManifestVersion)
	if state, built, stale := announcerState(t, h); state != "ready" || !built || stale {
		t.Fatalf("current: %s built %v stale %v", state, built, stale)
	}
	for name, write := range map[string]func(){
		"announcer version 1":  func() { writeAnnouncerManifest(t, root.Dir(), 1) },
		"reloads version 0":    func() { writeReloadsManifest(t, root.Dir(), reloadsounds.ManifestVersion-1) },
		"footsteps version 0":  func() { writeFootstepsManifest(t, root.Dir(), footstepsounds.ManifestVersion-1) },
		"ui version 0":         func() { writeUIManifest(t, root.Dir(), uisounds.ManifestVersion-1) },
		"ambience version 0":   func() { writeAmbienceManifest(t, root.Dir(), ambience.ManifestVersion-1) },
		"events version 0":     func() { writeEventsManifest(t, root.Dir(), eventsounds.ManifestVersion-1) },
		"voice version 0":      func() { writeEndMatchVoiceManifest(t, root.Dir(), endmatchvoice.ManifestVersion-1) },
	} {
		writeAnnouncerManifest(t, root.Dir(), announcer.ManifestVersion)
		writeReloadsManifest(t, root.Dir(), reloadsounds.ManifestVersion)
		writeFootstepsManifest(t, root.Dir(), footstepsounds.ManifestVersion)
		writeUIManifest(t, root.Dir(), uisounds.ManifestVersion)
		writeAmbienceManifest(t, root.Dir(), ambience.ManifestVersion)
		writeEventsManifest(t, root.Dir(), eventsounds.ManifestVersion)
		writeEndMatchVoiceManifest(t, root.Dir(), endmatchvoice.ManifestVersion)
		write()
		if jobModuleReady(root, meshjobs.JobAnnouncer) {
			t.Fatalf("%s: ready", name)
		}
		if state, built, stale := announcerState(t, h); state != "absent" || !built || !stale {
			t.Fatalf("%s: %s built %v stale %v", name, state, built, stale)
		}
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
