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
func (l *buildLabeler) label(key string) string {
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
		if m.MapModule == key && m.MapName != "" {
			return m.MapName + " map"
		}
	}
	return key
}

// handleBuilds answers GET /api/builds with {"active": {key, label, elapsedMs} | null,
// "queued": [{key, label}...]}; with no build runner, nothing is active and nothing queued.
func (h serverHandlers) handleBuilds(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"active": nil, "queued": []map[string]any{}}
	if h.jobs == nil {
		writeJSON(w, http.StatusOK, out)
		return
	}
	active, queued := h.jobs.Activity()
	l := &buildLabeler{root: h.root}
	if active != nil {
		out["active"] = map[string]any{"key": active.ModuleKey, "label": l.label(active.ModuleKey), "elapsedMs": active.ElapsedMs}
	}
	list := make([]map[string]any, 0, len(queued))
	for _, k := range queued {
		list = append(list, map[string]any{"key": k, "label": l.label(k)})
	}
	out["queued"] = list
	writeJSON(w, http.StatusOK, out)
}
