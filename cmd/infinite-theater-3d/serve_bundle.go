// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// serve_bundle.go — the bundle route: POST /api/bundle streams a batch of library files in one
// request so the browser needs one connection (and one round trip) for many of the small armor,
// first-person and weapon files that would otherwise each take a request of their own. Each
// entry resolves through the same functions the GET routes use, so a bundle entry can never read
// outside the libraries any more than a GET could.
package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// maxBundleFiles caps the number of files one bundle request may name.
const maxBundleFiles = 256

// bundleRequest is the POST /api/bundle body: a list of library files, each a library prefix
// (spartan-pieces, first-person, weapons) plus the file's own name.
type bundleRequest struct {
	Files []string `json:"files"`
}

// bundleHeader is one entry's JSON header in the bundle response: the entry the client sent, its
// status, and the byte count that follows it (0 for a 404).
type bundleHeader struct {
	File   string `json:"file"`
	Status int    `json:"status"`
	Size   int64  `json:"size"`
}

// resolveBundleEntry resolves one bundle entry (a library prefix plus a file name) to the full
// path the matching GET route would serve, or not-found. A foreign prefix, a name a GET route
// would refuse, and a path that would escape the library are all not-found.
func resolveBundleEntry(root *store.Root, entry string) (string, bool) {
	prefix, name, ok := strings.Cut(entry, "/")
	if !ok {
		return "", false
	}
	switch prefix {
	case "spartan-pieces":
		return resolveSpartanPiecesFile(root, name)
	case "first-person":
		return resolveFirstPersonFile(root, name)
	case "weapons":
		return resolveWeaponFile(root, name)
	default:
		return "", false
	}
}

// handleBundle answers POST /api/bundle: it streams one entry per requested file, in request
// order. Each entry is a 4-byte little-endian length, the JSON header (file, status, size), then
// exactly size bytes of the file (none for a 404). Files are opened and streamed one at a time,
// so only one file sits in memory at once; a request names at most maxBundleFiles files.
func (h serverHandlers) handleBundle(w http.ResponseWriter, r *http.Request) {
	var req bundleRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad_bundle_request"})
		return
	}
	if len(req.Files) > maxBundleFiles {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "too_many_bundle_files", "max": fmt.Sprintf("%d", maxBundleFiles)})
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	for _, entry := range req.Files {
		full, ok := resolveBundleEntry(h.root, entry)
		if !ok {
			h.writeBundleEntry(w, entry, http.StatusNotFound, 0, nil)
			continue
		}
		info, err := os.Stat(full)
		if err != nil || info.IsDir() {
			h.writeBundleEntry(w, entry, http.StatusNotFound, 0, nil)
			continue
		}
		f, err := os.Open(full)
		if err != nil {
			// A path that resolved but cannot be opened is a server-side problem: answer it as a
			// 404 entry so the stream stays aligned, and log it.
			slog.Error("open bundle file", "err", err, "file", entry)
			h.writeBundleEntry(w, entry, http.StatusNotFound, 0, nil)
			continue
		}
		h.writeBundleEntry(w, entry, http.StatusOK, info.Size(), f)
	}
}

// writeBundleEntry streams one bundle entry: the 4-byte little-endian header length, the JSON
// header, then exactly size bytes of the file. f is nil for a 404 entry (zero bytes follow).
func (h serverHandlers) writeBundleEntry(w http.ResponseWriter, entry string, status int, size int64, f *os.File) {
	if f != nil {
		defer f.Close()
	}
	hdr, _ := json.Marshal(bundleHeader{File: entry, Status: status, Size: size})
	var lenBuf [4]byte
	binary.LittleEndian.PutUint32(lenBuf[:], uint32(len(hdr)))
	if _, err := w.Write(lenBuf[:]); err != nil {
		return
	}
	if _, err := w.Write(hdr); err != nil {
		return
	}
	if f != nil {
		_, _ = io.Copy(w, f)
	}
}
