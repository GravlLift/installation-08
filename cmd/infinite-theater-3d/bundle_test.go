// bundle_test.go — the bundle route: a batch of library files streamed in one request, one entry
// per file (a 4-byte little-endian length, a JSON header, then the file's bytes). It decodes back
// to the right bytes and statuses, refuses a path escape as a 404 entry, and answers 400 for a
// batch over the entry cap.

package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// readBundleEntry reads one entry off a bundle response stream: the 4-byte little-endian header
// length, the JSON header, then the header's size bytes of file data.
func readBundleEntry(t *testing.T, r io.Reader) (file string, status int, data []byte) {
	t.Helper()
	var lenBuf [4]byte
	if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
		t.Fatalf("read entry length: %v", err)
	}
	hdr := make([]byte, binary.LittleEndian.Uint32(lenBuf[:]))
	if _, err := io.ReadFull(r, hdr); err != nil {
		t.Fatalf("read entry header: %v", err)
	}
	var h bundleHeader
	if err := json.Unmarshal(hdr, &h); err != nil {
		t.Fatalf("decode entry header: %v", err)
	}
	data = make([]byte, h.Size)
	if _, err := io.ReadFull(r, data); err != nil {
		t.Fatalf("read entry data: %v", err)
	}
	return h.File, h.Status, data
}

// postBundle posts a bundle body to the handler and returns the recorded response.
func postBundle(t *testing.T, h http.Handler, files []string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(bundleRequest{Files: files})
	req := httptest.NewRequest(http.MethodPost, "/api/bundle", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// bundleSpartanRoot lays down a spartan-pieces library with two real files and a foreign file the
// whitelist refuses, so the bundle has good, refused and missing entries to answer.
func bundleSpartanRoot(t *testing.T) *store.Root {
	t.Helper()
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root.Dir(), "spartan-pieces")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"piece-0b7e328b-13d24f1f.glb":  "piece-bytes",
		"coating-f56eda13.json":        `{"style":"f56eda13"}`,
		"secret.txt":                   "do not serve",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// TestBundleMixed — a batch of two good files, one refused name and one missing file streams
// back in request order with the right bytes and statuses.
func TestBundleMixed(t *testing.T) {
	root := bundleSpartanRoot(t)
	h := spartanPiecesTestHandlers(t, root, nil)

	rec := postBundle(t, h, []string{
		"spartan-pieces/piece-0b7e328b-13d24f1f.glb", // present
		"spartan-pieces/coating-f56eda13.json",        // present
		"spartan-pieces/secret.txt",                   // refused by the whitelist
		"spartan-pieces/piece-ffffffff-ffffffff.glb",  // well-formed but absent
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("bundle status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/octet-stream" {
		t.Fatalf("content type = %q, want application/octet-stream", ct)
	}
	r := rec.Body
	if f, s, d := readBundleEntry(t, r); f != "spartan-pieces/piece-0b7e328b-13d24f1f.glb" || s != 200 || string(d) != "piece-bytes" {
		t.Fatalf("entry1 = %s %d %q, want the piece bytes", f, s, d)
	}
	if f, s, d := readBundleEntry(t, r); f != "spartan-pieces/coating-f56eda13.json" || s != 200 || string(d) != `{"style":"f56eda13"}` {
		t.Fatalf("entry2 = %s %d %q, want the coating bytes", f, s, d)
	}
	if f, s, d := readBundleEntry(t, r); f != "spartan-pieces/secret.txt" || s != 404 || len(d) != 0 {
		t.Fatalf("entry3 = %s %d %q, want a 404 with no bytes", f, s, d)
	}
	if f, s, d := readBundleEntry(t, r); f != "spartan-pieces/piece-ffffffff-ffffffff.glb" || s != 404 || len(d) != 0 {
		t.Fatalf("entry4 = %s %d %q, want a 404 with no bytes", f, s, d)
	}
	if _, err := io.ReadFull(r, []byte{0}); err != io.EOF {
		t.Fatalf("stream not exhausted, err=%v", err)
	}
}

// TestBundlePathEscape — a name that would climb out of the library folder is a 404 entry, never
// a read of the file above it.
func TestBundlePathEscape(t *testing.T) {
	root := bundleSpartanRoot(t)
	if err := os.WriteFile(filepath.Join(root.Dir(), "secret.txt"), []byte("above the library"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := spartanPiecesTestHandlers(t, root, nil)

	rec := postBundle(t, h, []string{"spartan-pieces/../secret.txt"})
	if rec.Code != http.StatusOK {
		t.Fatalf("bundle status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	f, s, d := readBundleEntry(t, rec.Body)
	if f != "spartan-pieces/../secret.txt" || s != 404 || len(d) != 0 {
		t.Fatalf("entry = %s %d %q, want a 404 that does not read the file", f, s, d)
	}
}

// TestBundleTooMany — a batch over the entry cap is a 400 before any file is read.
func TestBundleTooMany(t *testing.T) {
	root := bundleSpartanRoot(t)
	h := spartanPiecesTestHandlers(t, root, nil)

	files := make([]string, maxBundleFiles+1)
	for i := range files {
		files[i] = fmt.Sprintf("spartan-pieces/piece-%08x-%08x.glb", i, i)
	}
	rec := postBundle(t, h, files)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bundle status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// TestBundleForeignPrefix — an entry whose prefix is not one of the libraries is a 404 entry.
func TestBundleForeignPrefix(t *testing.T) {
	root := bundleSpartanRoot(t)
	h := spartanPiecesTestHandlers(t, root, nil)

	rec := postBundle(t, h, []string{"maps/some.glb"})
	if rec.Code != http.StatusOK {
		t.Fatalf("bundle status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	f, s, d := readBundleEntry(t, rec.Body)
	if f != "maps/some.glb" || s != 404 || len(d) != 0 {
		t.Fatalf("entry = %s %d %q, want a 404", f, s, d)
	}
}
