// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_announcer.go — the extracted sound library (the announcer's voice lines, the weapons'
// reload sounds, the Spartan's foot and movement sounds, the interface sounds and the maps'
// ambient beds): the build job's body (the same extractions build-sounds runs), its readiness,
// and the state/build route pair. The job shares the mesh build runner's queue with the other
// one-time builds; the Origin loopback check and the state JSON are the mesh routes' own.

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/llampwall/infinite-theater-3d/internal/ambience"
	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/endmatchvoice"
	"github.com/llampwall/infinite-theater-3d/internal/eventsounds"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/footstepsounds"
	"github.com/llampwall/infinite-theater-3d/internal/reloadsounds"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/uisounds"
)

// announcerJobLanguage is the language the server's announcer job extracts: the CLI default,
// which falls back to English anyway when the install has no other announcer.
const announcerJobLanguage = "en"

// announcerReady is the sound library's readiness: the announcer's, the reloads' and the
// interface sounds' and the ambience's manifests are all in the sound folder and none is stale (a
// manifest of an older format version, or one missing, has the job run again).
func announcerReady(dataDir string) bool {
	built, stale := soundLibraryStatus(soundsDir(dataDir))
	return built && !stale
}

// soundLibraryStatus is built when every manifest of the sound library is there, stale when any is old.
func soundLibraryStatus(dir string) (built, stale bool) {
	built, stale = true, false
	for _, status := range []func(string) (bool, bool){announcer.ManifestStatus, reloadsounds.ManifestStatus, footstepsounds.ManifestStatus, uisounds.ManifestStatus, ambience.ManifestStatus, eventsounds.ManifestStatus, endmatchvoice.ManifestStatus} {
		b, s := status(dir)
		built = built && b
		stale = stale || s
	}
	return built, stale
}

// buildAnnouncer runs the announcer, reload, foot step, interface and ambience extractions into
// the store's sound folder. It is the announcer job's body in the mesh build runner.
func buildAnnouncer(ctx context.Context, root *store.Root, gameRoot string) (meshjobs.BuildResult, error) {
	res, folder, err := buildAnnouncerSounds(ctx, gameRoot, root.Dir(), announcerJobLanguage)
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	slog.InfoContext(ctx, "announcer sounds built", "language", folder, "lines", len(res.Manifest.Lines), "files", res.Files, "bytes", res.Bytes)
	reloads, err := buildReloadSounds(ctx, gameRoot, root.Dir())
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	footsteps, err := buildFootstepSounds(ctx, gameRoot, root.Dir())
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	ui, err := buildUISounds(ctx, gameRoot, root.Dir())
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	beds, err := buildAmbienceSounds(ctx, gameRoot, root.Dir())
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	events, err := buildEventSounds(ctx, gameRoot, root.Dir())
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	voice, err := buildEndMatchVoice(ctx, gameRoot, root.Dir())
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	return meshjobs.BuildResult{Bytes: res.Bytes + reloads.Bytes + footsteps.Bytes + ui.Bytes + beds.Bytes + events.Bytes + voice.Bytes, Triangles: 0}, nil
}

// handleAnnouncerState answers GET /api/announcer/state with the sound library's build state,
// plus whether its manifests are all built and whether any is stale.
func (h serverHandlers) handleAnnouncerState(w http.ResponseWriter, r *http.Request) {
	if h.jobs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
	out := meshStateJSON(h.jobs.Snapshot(meshjobs.JobAnnouncer))
	out["built"], out["stale"] = soundLibraryStatus(soundsDir(h.root.Dir()))
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
