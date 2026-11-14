package main

// serve_coatings.go — the coating status route: tells the viewer whether the Ekur export
// is available and valid, and per coating library whether it is built and still current.
// The response never carries a folder path or an environment value: only the status words
// and the counts, so it is safe to surface in the viewer's top bar.

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// The export states of the coating status route: "ok" when the resolved folder is a
// valid Ekur reference, "not_set" when no candidate exists at all (the IT3D_EKUR_DIR
// variable unset and no <data>/ekur folder), "invalid" when a candidate exists but does
// not carry the five contract entries.
const (
	exportOk      = "ok"
	exportNotSet  = "not_set"
	exportInvalid = "invalid"
)

// coatingsLibraryStatus is one coating library in the coating status response.
type coatingsLibraryStatus struct {
	Built            bool `json:"built"`
	Stale            bool `json:"stale"`
	MaterialsMissing int  `json:"materials_missing"`
}

// coatingsStatus is the body of GET /api/coatings/status.
type coatingsStatus struct {
	Export    string                           `json:"export"`
	Libraries map[string]coatingsLibraryStatus `json:"libraries"`
}

// handleCoatingStatus answers GET /api/coatings/status. It never reads the game
// installation and never answers an environment value or a path.
func (h serverHandlers) handleCoatingStatus(w http.ResponseWriter, r *http.Request) {
	dataDir := h.root.Dir()
	export := exportOk
	candidate := os.Getenv(spartanpieces.EkurEnv)
	if candidate == "" {
		candidate = filepath.Join(dataDir, "ekur")
	}
	if !spartanpieces.EkurValid(candidate) {
		if _, err := os.Stat(candidate); err == nil {
			export = exportInvalid
		} else {
			export = exportNotSet
		}
	}
	current := ""
	if export == exportOk {
		cur, err := spartanpieces.EkurStamp(candidate)
		if err != nil {
			slog.Error("coating status: current ekur stamp", "err", err)
		} else {
			current = cur
		}
	}
	libraries := map[string]coatingsLibraryStatus{}
	for key, module := range map[string]string{
		"spartan_pieces": meshjobs.JobSpartanPieces,
		"weapons":        meshjobs.JobWeapons,
		"first_person":   meshjobs.JobFirstPerson,
	} {
		stamp, ok := recordedEkurStamp(dataDir, module)
		libraries[key] = coatingsLibraryStatus{
			Built:            ok,
			Stale:            ok && ((current != "" && stamp != current) || !libraryIndexCurrent(dataDir, module)),
			MaterialsMissing: materialsMissing(dataDir, module),
		}
	}
	writeJSON(w, http.StatusOK, coatingsStatus{Export: export, Libraries: libraries})
}

// materialsMissing reads the "materials_missing" count of a library's index (its coatings
// section for spartan-pieces and weapons; 0 for first-person, which does not distill one).
func materialsMissing(dataDir, module string) int {
	folder, ok := coatingLibraryFolder(module)
	if !ok {
		return 0
	}
	raw, err := os.ReadFile(filepath.Join(dataDir, folder, "index.json"))
	if err != nil {
		return 0
	}
	var idx struct {
		Coatings *struct {
			Missing int `json:"materials_missing"`
		} `json:"coatings"`
	}
	if err := json.Unmarshal(raw, &idx); err != nil {
		return 0
	}
	if idx.Coatings == nil {
		return 0
	}
	return idx.Coatings.Missing
}
