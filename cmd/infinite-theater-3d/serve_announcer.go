package main

// serve_announcer.go — the announcer sound library: the build job's body (the same extraction
// build-sounds runs), its readiness, and the state/build route pair. The job shares the mesh
// build runner's queue with the other one-time builds; the Origin loopback check and the state
// JSON are the mesh routes' own.

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// announcerJobLanguage is the language the server's announcer job extracts: the CLI default,
// which falls back to English anyway when the install has no other announcer.
const announcerJobLanguage = "en"

// announcerReady is the announcer library's readiness: its manifest is in the sound folder and
// is not stale (a manifest of an older format version is rebuilt).
func announcerReady(dataDir string) bool {
	built, stale := announcer.ManifestStatus(soundsDir(dataDir))
	return built && !stale
}

// buildAnnouncer runs the announcer extraction into the store's sound folder. It is the
// announcer job's body in the mesh build runner.
func buildAnnouncer(ctx context.Context, root *store.Root, gameRoot string) (meshjobs.BuildResult, error) {
	res, folder, err := buildAnnouncerSounds(ctx, gameRoot, root.Dir(), announcerJobLanguage)
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	slog.InfoContext(ctx, "announcer sounds built", "language", folder, "lines", len(res.Manifest.Lines), "files", res.Files, "bytes", res.Bytes)
	return meshjobs.BuildResult{Bytes: res.Bytes, Triangles: 0}, nil
}

// handleAnnouncerState answers GET /api/announcer/state with the announcer library's build
// state, plus whether its manifest is built and whether it is stale.
func (h serverHandlers) handleAnnouncerState(w http.ResponseWriter, r *http.Request) {
	if h.jobs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
	out := meshStateJSON(h.jobs.Snapshot(meshjobs.JobAnnouncer))
	out["built"], out["stale"] = announcer.ManifestStatus(soundsDir(h.root.Dir()))
	writeJSON(w, http.StatusOK, out)
}

// handleAnnouncerBuild answers POST /api/announcer/build: it starts or joins the announcer
// library build and answers 202 with the state JSON (200 when it is already ready). A
// non-loopback Origin is refused with 403; the read-only mode refuses the POST before it gets here.
func (h serverHandlers) handleAnnouncerBuild(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	if h.jobs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
	snap := h.jobs.Enqueue(meshjobs.JobAnnouncer)
	status := http.StatusAccepted
	if snap.Ready() {
		status = http.StatusOK
	}
	writeJSON(w, status, meshStateJSON(snap))
}
