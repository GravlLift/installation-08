// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
)

func put(t *testing.T, h http.Handler, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, path, bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// TestMeshBVHPutThenGet — a PUT stores the sidecar, a following GET returns the same bytes.
func TestMeshBVHPutThenGet(t *testing.T) {
	root := newFakeStore(t) // match "abc", module "moda", mesh already on disk
	h := newTestHandlers(root, nil)

	payload := []byte("fake-bvh-sidecar-bytes")
	rec := put(t, h, "/api/matches/abc/mesh/bvh", payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	rec2 := get(t, h, "/api/matches/abc/mesh/bvh", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200; body=%s", rec2.Code, rec2.Body.String())
	}
	if rec2.Body.String() != string(payload) {
		t.Fatalf("GET body = %q, want %q", rec2.Body.String(), string(payload))
	}
}

// TestMeshBVHGetAbsent404s — a GET before any PUT is a 404.
func TestMeshBVHGetAbsent404(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	rec := get(t, h, "/api/matches/abc/mesh/bvh", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "bvh_not_built") {
		t.Fatalf("body = %s, want bvh_not_built", rec.Body.String())
	}
}

// TestMeshBVHStaleAfterRebuild — a sidecar older than a rebuilt mesh is refused (404), as if
// absent: the mtime check, not a content comparison, is what the server does.
func TestMeshBVHStaleAfterRebuild(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	if rec := put(t, h, "/api/matches/abc/mesh/bvh", []byte("stale-sidecar")); rec.Code != http.StatusOK {
		t.Fatalf("initial PUT status = %d", rec.Code)
	}
	// Rebuild the mesh (a later mtime): sleep to guarantee the rewritten file's mtime moves
	// forward on filesystems with coarse mtime resolution.
	time.Sleep(20 * time.Millisecond)
	meshPath, err := root.MeshPath("moda", meshjobs.QualityStandard)
	if err != nil {
		t.Fatal(err)
	}
	if err := root.WriteFile(meshPath, []byte("glTF-rebuilt-mesh-bytes")); err != nil {
		t.Fatal(err)
	}

	rec := get(t, h, "/api/matches/abc/mesh/bvh", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status after rebuild = %d, want 404 (stale); body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "bvh_stale") {
		t.Fatalf("body = %s, want bvh_stale", rec.Body.String())
	}
}

// TestMeshBVHPutOversizeRefused — a body over the cap is refused (413), and nothing is written.
func TestMeshBVHPutOversizeRefused(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	orig := maxBVHSidecarBytes
	maxBVHSidecarBytes = 16
	t.Cleanup(func() { maxBVHSidecarBytes = orig })

	big := bytes.Repeat([]byte("x"), int(maxBVHSidecarBytes)+1)
	rec := put(t, h, "/api/matches/abc/mesh/bvh", big)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413; body=%s", rec.Code, rec.Body.String())
	}
	bvhPath, err := root.BVHPath("moda", meshjobs.QualityStandard)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(bvhPath); !os.IsNotExist(err) {
		t.Fatalf("oversize PUT left a file on disk (err=%v)", err)
	}
}

// TestMeshBVHPutNoMesh — a PUT before the mesh itself exists is refused (409): nothing to be a
// sidecar of yet.
func TestMeshBVHPutNoMesh(t *testing.T) {
	root := meshTestStore(t) // match "abc"/"def", no mesh files on disk
	h := newTestHandlers(root, nil)

	rec := put(t, h, "/api/matches/abc/mesh/bvh", []byte("too-early"))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
}

// TestMeshBVHPathNotFromClient — the sidecar's path is derived only from the server's own
// module key (via the match's own stored MapModule), never from anything in the request: a
// match id is validated the same way the mesh route itself validates it, and the module key
// comes from the store, not the URL or body.
func TestMeshBVHPathNotFromClient(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	// An invalid match id (path-separator-bearing) is refused before any file path is built.
	rec := put(t, h, "/api/matches/..%2f..%2fetc/mesh/bvh", []byte("x"))
	if rec.Code == http.StatusOK {
		t.Fatalf("PUT with a path-traversal match id was accepted")
	}
	rec2 := get(t, h, "/api/matches/..%2f..%2fetc/mesh/bvh", nil)
	if rec2.Code == http.StatusOK {
		t.Fatalf("GET with a path-traversal match id was accepted")
	}
}

// TestVariantBVHPutThenGet — the variant layer's sidecar follows the same contract as the
// map's, at its own route and path.
func TestVariantBVHPutThenGet(t *testing.T) {
	root := meshTestStore(t) // match "abc", module "moda"
	h := newTestHandlers(root, nil)

	variantGLB := variantPath(root, "abc", variantGLBName(meshjobs.QualityStandard))
	if err := root.WriteFile(variantGLB, []byte("glTF-fake-variant-bytes")); err != nil {
		t.Fatal(err)
	}

	payload := []byte("fake-variant-bvh-sidecar")
	rec := put(t, h, "/api/matches/abc/variant/bvh", payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	rec2 := get(t, h, "/api/matches/abc/variant/bvh", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200; body=%s", rec2.Code, rec2.Body.String())
	}
	if rec2.Body.String() != string(payload) {
		t.Fatalf("GET body = %q, want %q", rec2.Body.String(), string(payload))
	}
}

// TestVariantBVHGetAbsent404 — a GET before the variant layer exists is a 404.
func TestVariantBVHGetAbsent404(t *testing.T) {
	root := meshTestStore(t)
	h := newTestHandlers(root, nil)

	rec := get(t, h, "/api/matches/abc/variant/bvh", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}
