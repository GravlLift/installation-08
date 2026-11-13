package main

// serve_sounds.go — the replay sound route.
//
// The viewer addresses /static/sounds/halo_infinite/<stem>.ogg. That set cannot
// be rebuilt from the game install: the files are hand-produced and their
// inputs are lost. It therefore lands in the gitignored data directory by the
// `import-sounds` subcommand, and this route serves only what the import
// wrote. A request never imports or enqueues anything: a missing file is a
// 404, and the startup (serve.go) logs one line naming the import command.

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// soundsDir is the replay sound folder below the data directory.
func soundsDir(dataDir string) string {
	return filepath.Join(dataDir, "assets", "sounds", "halo_infinite")
}

// soundFile is a file name the sound route may serve: an .ogg file of the
// imported set. A name that passes this check but is not on disk still gets
// a 404, and a name that would escape the folder is refused by joinInside.
func soundFile(name string) bool {
	return strings.HasSuffix(name, ".ogg")
}

// handleSoundFile answers GET /static/sounds/halo_infinite/{file} with one
// imported sound (range-capable via http.ServeContent). A file the import
// did not write, a name that is not an .ogg, or a name that would escape the
// set's folder is a 404. Nothing is imported or enqueued here.
func (h serverHandlers) handleSoundFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	if !soundFile(name) {
		http.NotFound(w, r)
		return
	}
	full, ok := joinInside(soundsDir(h.root.Dir()), name)
	if !ok {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(full)
	if err != nil {
		if os.IsNotExist(err) {
			http.NotFound(w, r)
			return
		}
		slog.Error("open sound", "err", err, "file", name)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "audio/ogg")
	http.ServeContent(w, r, name, time.Time{}, f)
}

// soundsPresent says whether the sound folder holds at least one top-level
// .ogg file (the shape the route serves). A missing folder is false.
func soundsPresent(dataDir string) bool {
	entries, err := os.ReadDir(soundsDir(dataDir))
	if err != nil {
		return false
	}
	for _, e := range entries {
		if !e.IsDir() && soundFile(e.Name()) {
			return true
		}
	}
	return false
}

// logSoundsMissing is the serve startup check: when the sound folder holds
// no .ogg, it logs one line saying the replay sounds are missing and naming
// the import command. It never copies anything and never enqueues a job.
func logSoundsMissing(dataDir string) {
	if soundsPresent(dataDir) {
		return
	}
	slog.Info("replay sounds missing; import them to hear the replay",
		"dir", soundsDir(dataDir),
		"command", "infinite-theater-3d import-sounds --from <sounds-dir>")
}
