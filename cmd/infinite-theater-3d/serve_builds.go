// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_builds.go — GET /api/builds: what the build runner is doing right now (the active
// build and the queue, in order), each named in plain words, for the header's activity
// indicator. Read-only: it changes nothing, so the read-only mode serves it.

import (
	"net/http"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// libraryLabels names the library jobs.
var libraryLabels = map[string]string{
	meshjobs.JobWeapons:       "Weapons",
	meshjobs.JobSpartanPieces: "Armor",
	meshjobs.JobFirstPerson:   "First-person arms",
	meshjobs.JobAnnouncer:     "Announcer sounds",
	meshjobs.JobWeaponIcons:   "Weapon icons",
	meshjobs.JobHudIcons:      "HUD icons",
	meshjobs.JobRanks:         "Rank badges",
	meshjobs.JobBackdrop:      "Home backdrop",
}

// buildLabeler names build keys, reading the stored matches at most once per request.
type buildLabeler struct {
	root    *store.Root
	matches []store.Match
	read    bool
}

func (l *buildLabeler) stored() []store.Match {
	if !l.read {
		l.read = true
		if ms, err := l.root.ListMatches(); err == nil {
			l.matches = ms
		}
	}
	return l.matches
}

// label names one build key: a library by name, "variant:<match>" as "<map> Forge layer", a
// map module as "<map> map" (the name of any stored match on that module), anything else as
// the key itself.
//
// A High build's key carries the quality suffix (meshjobs.JobKey); it is named like its
// Standard key with " (HQ)" after it, never shown raw. A bare match ID (a build keyed by its
// match) is named by that match's map.
func (l *buildLabeler) label(key string) string {
	base, q := meshjobs.SplitQuality(key)
	name := l.baseLabel(base)
	if q == meshjobs.QualityHigh {
		name += " (HQ)"
	}
	return name
}

func (l *buildLabeler) baseLabel(key string) string {
	if s, ok := libraryLabels[key]; ok {
		return s
	}
	if id, ok := strings.CutPrefix(key, variantPrefix); ok {
		for _, m := range l.stored() {
			if m.MatchID == id && m.MapName != "" {
				return m.MapName + " Forge layer"
			}
		}
		return "Forge layer"
	}
	for _, m := range l.stored() {
		if (m.MapModule == key || m.MatchID == key) && m.MapName != "" {
			return m.MapName + " map"
		}
	}
	return key
}

// handleBuilds answers GET /api/builds with {"active": {key, label, elapsedMs, step} | null,
// "queued": [{key, label}...], "overall": {done, total, fraction}}; with no build runner,
// nothing is active and nothing queued, and overall is zero. "overall" (LOCAL-CHANGE
// (infinite-theater-3d)) is what the top-of-page "Optimizing assets" banner reads
// (web/src/ui/OptimizeBanner.tsx): fraction folds in the active job's own progress (Runner.
// Progress for the completed job count, active.Progress for the one in flight), so it moves
// smoothly within a single big library build, not just between jobs. step is the active job's
// label plus its own unit count when the build reports one ("Weapons 84/190"), read from
// active.Stage (set by a library's own progress reporter, e.g. weapons.buildWeapons) when it
// looks like "<done>/<total>"; otherwise step is just the label.
func (h serverHandlers) handleBuilds(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"active": nil, "queued": []map[string]any{}, "overall": overallProgressJSON(0, 0, nil)}
	if h.jobs == nil {
		writeJSON(w, http.StatusOK, out)
		return
	}
	active, queued := h.jobs.Activity()
	l := &buildLabeler{root: h.root}
	if active != nil {
		label := l.label(active.ModuleKey)
		out["active"] = map[string]any{"key": active.ModuleKey, "label": label, "elapsedMs": active.ElapsedMs, "step": stepLabel(label, active.Stage)}
	}
	list := make([]map[string]any, 0, len(queued))
	for _, k := range queued {
		list = append(list, map[string]any{"key": k, "label": l.label(k)})
	}
	out["queued"] = list
	done, total := h.jobs.Progress()
	out["overall"] = overallProgressJSON(done, total, active)
	writeJSON(w, http.StatusOK, out)
}

// stepLabel is label, with active's own unit count appended when stage looks like "<n>/<m>"
// (set by a library build's progress reporter): "Weapons" + "84/190" -> "Weapons 84/190".
// Any other stage (or none) leaves label unchanged.
func stepLabel(label, stage string) string {
	a, b, ok := strings.Cut(stage, "/")
	if !ok || a == "" || b == "" || strings.ContainsFunc(a, notDigit) || strings.ContainsFunc(b, notDigit) {
		return label
	}
	return label + " " + stage
}

func notDigit(r rune) bool { return r < '0' || r > '9' }

// overallProgressJSON is the "overall" field of GET /api/builds: fraction is 0 when total is 0
// (nothing has ever been enqueued), else (done + the active job's own fraction) / total,
// clamped to [0,1] (a job enqueued after done was read could otherwise round fraction over 1
// for an instant).
func overallProgressJSON(done, total int, active *meshjobs.Snapshot) map[string]any {
	fraction := 0.0
	if total > 0 {
		f := float64(done)
		if active != nil {
			f += active.Progress
		}
		fraction = f / float64(total)
		if fraction > 1 {
			fraction = 1
		}
		if fraction < 0 {
			fraction = 0
		}
	}
	return map[string]any{"done": done, "total": total, "fraction": fraction}
}
