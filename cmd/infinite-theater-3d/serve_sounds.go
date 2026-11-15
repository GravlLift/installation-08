package main

// serve_sounds.go — the replay sound route.
//
// The viewer addresses /static/sounds/halo_infinite/<stem>.ogg, and the announcer
// extraction's manifest /static/sounds/halo_infinite/announcer.json and takes
// (announcer_<line>_<nn>.ogg, data directory only). The set is
// built into the binary (internal/sounds, from JGtm's LevelUp), so the viewer
// is not silent on a fresh install. The route serves a file from the user's
// data directory when it is there, so an imported file wins over the built-in
// one; otherwise it answers from the embedded set. A request never imports or
// enqueues anything: a name that is in neither set, or that would escape the
// folder, is a 404.

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/ambience"
	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/reloadsounds"
	"github.com/llampwall/infinite-theater-3d/internal/sounds"
)

// soundsDir is the replay sound folder below the data directory.
func soundsDir(dataDir string) string {
	return filepath.Join(dataDir, "assets", "sounds", "halo_infinite")
}

// soundFile is a file name the sound route may serve: an .ogg file (the sound
// set, an announcer, reload or ambience take), or the announcer.json, reloads.json
// and ambience.json manifests of the extractions (written by build-sounds or the announcer job into
// the data directory only). A name that passes this check but is in neither the
// data directory nor the built-in set still gets a 404, and a name that would
// escape the folder is refused by joinInside.
func soundFile(name string) bool {
	return strings.HasSuffix(name, ".ogg") || soundManifest(name)
}

// soundManifest says whether name is one of the extractions' manifests.
func soundManifest(name string) bool {
	return name == announcer.ManifestName || name == reloadsounds.ManifestName || name == ambience.ManifestName
}

// soundContentType is the media type of a sound route file.
func soundContentType(name string) string {
	if soundManifest(name) {
		return "application/json"
	}
	return "audio/ogg"
}

// embeddedSounds is the built-in sound set the route falls back to. It is
// open once: the set is compiled into the binary and never changes.
var embeddedSounds = sounds.Open()

// handleSoundFile answers GET /static/sounds/halo_infinite/{file} with the
// sound, range-capable via http.ServeContent: the file in the data directory
// when it exists (an imported file wins), otherwise the built-in one. A name
// in neither set, a name that is not an .ogg, or a name that would escape the
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
	if err != nil && !os.IsNotExist(err) {
		slog.Error("open sound", "err", err, "file", name)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if f != nil {
		defer f.Close()
		w.Header().Set("Content-Type", soundContentType(name))
		http.ServeContent(w, r, name, time.Time{}, f)
		return
	}
	serveEmbeddedSound(w, r, name)
}

// serveEmbeddedSound answers a sound request from the built-in set: the named
// file's bytes, range-capable via http.ServeContent (an in-memory reader, the
// same capability as the data-directory path), or a 404 when the set has no
// such name.
func serveEmbeddedSound(w http.ResponseWriter, r *http.Request, name string) {
	f, err := embeddedSounds.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	raw, err := io.ReadAll(f)
	_ = f.Close()
	if err != nil {
		slog.Error("read embedded sound", "err", err, "file", name)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "audio/ogg")
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(raw))
}
