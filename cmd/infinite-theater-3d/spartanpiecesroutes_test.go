// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// spartanpiecesroutes_test.go — the Spartan piece library routes: a library
// file (index, piece GLB, texture, coating file, swatch), and the
// build/state pair. The spartan-pieces job is driven by the same mesh build
// runner as the map builds, the weapons and the first-person jobs, so a build
// and a state request share its queue. The fake build writes the index, a
// piece GLB and a texture, so the routes transition not-built -> building ->
// built exactly as the first-person routes do.

package main

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// glbFixture is the minimum GLB header (magic "glTF", version 2, total length)
// so http.ServeContent's DetectContentType reports model/gltf-binary.
var glbFixture = "glTF" + string([]byte{0x02, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00}) + "json" + `{"asset":{"version":"2.0"}}`

// spartanPiecesTestRunner wires a Runner whose fake build, for the
// spartan-pieces job only, writes the library's index.json, one piece GLB and
// one shared texture into the store (so the state reports ready once done).
// It honours its context. Other modules are left unbuilt.
func spartanPiecesTestRunner(t *testing.T, root *store.Root) *meshjobs.Runner {
	t.Helper()
	var mu sync.Mutex
	done := false
	ready := func(module string) bool {
		if module == meshjobs.JobSpartanPieces {
			mu.Lock()
			defer mu.Unlock()
			return done
		}
		return false
	}
	build := func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		if module != meshjobs.JobSpartanPieces {
			return meshjobs.BuildResult{}, context.Canceled
		}
		select {
		case <-ctx.Done():
			return meshjobs.BuildResult{}, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
		if err := writeSpartanPiecesFixtures(filepath.Join(root.Dir(), "spartan-pieces")); err != nil {
			return meshjobs.BuildResult{}, err
		}
		mu.Lock()
		done = true
		mu.Unlock()
		return meshjobs.BuildResult{Bytes: 16}, nil
	}
	r, err := meshjobs.New(build, "", ready)
	if err != nil {
		t.Fatal(err)
	}
	r.SetDest(func(module string) string { return filepath.Join(root.Dir(), "spartan-pieces") })
	r.Start()
	t.Cleanup(func() { r.Stop(2 * time.Second) })
	return r
}

// writeSpartanPiecesFixtures lays down the library files the routes serve:
// the index (the shape the viewer reads), one piece GLB, one shared texture,
// the coating table and one coating file.
func writeSpartanPiecesFixtures(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	files := map[string]string{
		spartanpieces.FileIndex:                       `{"schema":2,"mode":"3db5318c","generator":"test","skeleton":{"bones":[],"root":-1},"pieces":[{"key":"0b7e328b-13d24f1f","region":"0b7e328b","permutation":"13d24f1f","file":"piece-0b7e328b-13d24f1f.glb","triangles":1,"bbox":{"min":[0,0,0],"max":[1,1,1]},"bytes":1}],"attachments":[],"markers":[],"themes":[],"textures":{"files":1,"bytes":12,"references":1},"failures":[]}`,
		"piece-0b7e328b-13d24f1f.glb":                 glbFixture,
		"texture-" + strings.Repeat("0", 16) + ".png": "texture-bytes",
		spartanpieces.FileCoatings:                    `{"schema":2,"globals":{},"default_styles":{},"styles":{},"visors":{"patterns":{},"colors":{}}}`,
		"coating-f56eda13.json":                       `{"style":"f56eda13","lists":{},"styles":{}}`,
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			return err
		}
	}
	return nil
}

// spartanPiecesTestHandlers builds a serverHandlers wired to root and jobs.
func spartanPiecesTestHandlers(t *testing.T, root *store.Root, jobs *meshjobs.Runner) serverHandlers {
	t.Helper()
	return newServerHandlers(root, "", jobs, weapons.Catalog{}, testLabelCatalog)
}

// TestSpartanPiecesBuildThenServe — POST build answers 202; the state route
// transitions to ready; the index and a piece are served with their bytes; a
// coating file is served; a second POST answers 200.
func TestSpartanPiecesBuildThenServe(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	jobs := spartanPiecesTestRunner(t, root)
	h := spartanPiecesTestHandlers(t, root, jobs)

	rec := postMesh(t, h, "/api/spartan-pieces/build", nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("build status = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	waitMeshReady(t, h, "/api/spartan-pieces/state")

	idx := get(t, h, "/api/spartan-pieces/index.json", nil)
	if idx.Code != http.StatusOK || !strings.Contains(idx.Body.String(), `"schema":2`) {
		t.Fatalf("index = %d %s, want 200 schema 2", idx.Code, idx.Body.String())
	}
	piece := get(t, h, "/api/spartan-pieces/piece-0b7e328b-13d24f1f.glb", nil)
	if piece.Code != http.StatusOK || !strings.HasPrefix(piece.Body.String(), "glTF") {
		t.Fatalf("piece = %d %s, want 200 piece bytes", piece.Code, piece.Body.String())
	}
	if ct := piece.Header().Get("Content-Type"); ct != "model/gltf-binary" {
		t.Fatalf("piece content type = %q, want model/gltf-binary", ct)
	}
	coat := get(t, h, "/api/spartan-pieces/coating-f56eda13.json", nil)
	if coat.Code != http.StatusOK || !strings.Contains(coat.Body.String(), `"style"`) {
		t.Fatalf("coating = %d %s, want 200 coating", coat.Code, coat.Body.String())
	}
	rec2 := postMesh(t, h, "/api/spartan-pieces/build", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second build status = %d, want 200 (ready); body=%s", rec2.Code, rec2.Body.String())
	}
}

// TestSpartanPiecesFileValidation — a file name that is not one of the
// library's own is a JSON 404, a path that would escape the library folder is
// refused, and an unknown but well-formed name is a 404 when the file is
// absent.
func TestSpartanPiecesFileValidation(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := writeSpartanPiecesFixtures(filepath.Join(root.Dir(), "spartan-pieces")); err != nil {
		t.Fatal(err)
	}
	secret := "secret.txt"
	if err := os.WriteFile(filepath.Join(root.Dir(), "spartan-pieces", secret), []byte("do not serve"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := spartanPiecesTestHandlers(t, root, nil)

	bad := get(t, h, "/api/spartan-pieces/secret.txt", nil)
	if bad.Code != http.StatusNotFound || !strings.Contains(bad.Body.String(), "spartan_pieces_file_not_available") {
		t.Fatalf("foreign file = %d %s, want 404 spartan_pieces_file_not_available", bad.Code, bad.Body.String())
	}
	escape := get(t, h, "/api/spartan-pieces/..%2fsecret.txt", nil)
	if escape.Code != http.StatusNotFound {
		t.Fatalf("escape = %d, want 404", escape.Code)
	}
	// A well-formed name for a file the build has not written is a 404.
	absent := get(t, h, "/api/spartan-pieces/piece-ffffffff-ffffffff.glb", nil)
	if absent.Code != http.StatusNotFound {
		t.Fatalf("absent piece = %d, want 404", absent.Code)
	}
	// A malformed piece name (one key part) is refused by the whitelist.
	malformed := get(t, h, "/api/spartan-pieces/piece-0b7e328b.glb", nil)
	if malformed.Code != http.StatusNotFound {
		t.Fatalf("malformed piece = %d, want 404", malformed.Code)
	}
}

// TestSpartanPiecesOriginCheck — a POST from a non-loopback Origin is refused
// with 403; a loopback Origin is allowed.
func TestSpartanPiecesOriginCheck(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	jobs := spartanPiecesTestRunner(t, root)
	h := spartanPiecesTestHandlers(t, root, jobs)

	rec := postMesh(t, h, "/api/spartan-pieces/build", map[string]string{"Origin": "https://evil.example.com"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin build status = %d, want 403; body=%s", rec.Code, rec.Body.String())
	}
	r2 := postMesh(t, h, "/api/spartan-pieces/build", map[string]string{"Origin": "http://localhost:8177"})
	if r2.Code == http.StatusForbidden {
		t.Fatal("loopback origin refused with 403")
	}
}

// TestSpartanPiecesStateUnavailable — with no runner, the state route is 503
// and the build route is 503.
func TestSpartanPiecesStateUnavailable(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := spartanPiecesTestHandlers(t, root, nil)

	rec := get(t, h, "/api/spartan-pieces/state", nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("no-runner state = %d, want 503", rec.Code)
	}
	rec = postMesh(t, h, "/api/spartan-pieces/build", nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("no-runner build = %d, want 503", rec.Code)
	}
}

// TestSpartanPiecesStateAbsent — with a runner but no build yet, the state
// reports absent.
func TestSpartanPiecesStateAbsent(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	jobs := spartanPiecesTestRunner(t, root)
	h := spartanPiecesTestHandlers(t, root, jobs)

	rec := get(t, h, "/api/spartan-pieces/state", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"absent"`) {
		t.Fatalf("pre-build state = %d %s, want 200 absent", rec.Code, rec.Body.String())
	}
}
