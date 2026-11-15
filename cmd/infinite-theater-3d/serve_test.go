package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// newFakeStore builds a temp store with one match ("abc") holding a gzip document and a
// match.json summary whose map module is "moda" (whose mesh is present).
func newFakeStore(t *testing.T) *store.Root {
	t.Helper()
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	doc := gzipJSON(t, []byte(`{"matchId":"abc","tracks":[]}`))
	replayPath, _ := root.MatchReplayPath("abc")
	if err := root.WriteFile(replayPath, doc); err != nil {
		t.Fatal(err)
	}
	if err := root.SaveMatchMeta("abc", store.Match{
		MatchID: "abc", MapName: "Test Map", MapModule: "moda", Build: "HI_1_13_0",
		DurationMS: 4200, ImportedAt: "2026-01-01T00:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}
	mesh, _ := root.MeshPath("moda")
	if err := root.WriteFile(mesh, []byte("glTF-fake-mesh-bytes")); err != nil {
		t.Fatal(err)
	}
	return root
}

func gzipJSON(t *testing.T, raw []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func get(t *testing.T, h http.Handler, path string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func post(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// writeFakeStoredAuth drops a fake signed-in credential (no real token) into the data dir's
// auth folder, so storedAuthState would report signed_in if it were read.
func writeFakeStoredAuth(t *testing.T, dir string) {
	t.Helper()
	raw, err := json.Marshal(haloauth.Credentials{Refresh: "fake-refresh-not-a-real-token", Gamertag: "FakePlayer"})
	if err != nil {
		t.Fatal(err)
	}
	if err := haloauth.Save(dir, raw); err != nil {
		t.Fatal(err)
	}
}

// TestServeHealth — /api/health answers ok and the version.
func TestServeHealth(t *testing.T) {
	h := newTestHandlers(newFakeStore(t), nil)
	rec := get(t, h, "/api/health", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"ok"`) || !strings.Contains(rec.Body.String(), `"version"`) {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

// TestServeMatches — /api/matches returns the summaries, newest first (one match here).
func TestServeMatches(t *testing.T) {
	h := newTestHandlers(newFakeStore(t), nil)
	rec := get(t, h, "/api/matches", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"abc"`) || !strings.Contains(body, `"moda"`) {
		t.Fatalf("body = %s", body)
	}
}

// TestServeReplayGzip — a gzip-accepting client gets the document with Content-Encoding
// gzip; a plain client gets it decompressed.
func TestServeReplayGzip(t *testing.T) {
	h := newTestHandlers(newFakeStore(t), nil)
	// gzip-accepting
	rec := get(t, h, "/api/matches/abc/replay", map[string]string{"Accept-Encoding": "gzip"})
	if rec.Code != http.StatusOK {
		t.Fatalf("gzip status = %d", rec.Code)
	}
	if rec.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", rec.Header().Get("Content-Encoding"))
	}
	if rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("Content-Type = %q", rec.Header().Get("Content-Type"))
	}
	if _, err := gunzipBytes(rec.Body.Bytes()); err != nil {
		t.Fatalf("gzip body did not decompress: %v", err)
	}
	// plain
	rec2 := get(t, h, "/api/matches/abc/replay", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("plain status = %d", rec2.Code)
	}
	if rec2.Header().Get("Content-Encoding") != "" {
		t.Fatalf("plain Content-Encoding = %q, want empty", rec2.Header().Get("Content-Encoding"))
	}
	if !strings.Contains(rec2.Body.String(), `"abc"`) {
		t.Fatalf("plain body not decompressed: %s", rec2.Body.String())
	}
}

// TestServeReplayInvalidID — the handler rejects a non-hex match id with a 400 (the store
// path is never reached). The ids are exercised against the handler directly: the mux
// path-walks a literal request path before dispatch, so a traversal id is refused (307 or
// 404) by the mux before it reaches the handler, which is also safe.
func TestServeReplayInvalidID(t *testing.T) {
	h := newTestHandlers(newFakeStore(t), nil)
	for _, id := range []string{"../etc", "a/b", "xyz!"} {
		req := httptest.NewRequest(http.MethodGet, "/api/matches/"+id+"/replay", nil)
		req.SetPathValue("id", id)
		rec := httptest.NewRecorder()
		h.handleReplay(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("id %q: handler status = %d, want 400", id, rec.Code)
		}
	}
}

// TestServeReplayMuxRefusesTraversal — through the full server, a traversal id is refused
// by the mux (307 or 404) and never reads a file outside the store.
func TestServeReplayMuxRefusesTraversal(t *testing.T) {
	h := newTestHandlers(newFakeStore(t), nil)
	for _, id := range []string{"../etc", "a/b"} {
		rec := get(t, h, "/api/matches/"+id+"/replay", nil)
		if rec.Code == http.StatusOK {
			t.Errorf("id %q: status = 200, want a refusal", id)
		}
	}
}

// TestServeReplayNotFound — a valid-but-absent match id is a JSON 404.
func TestServeReplayNotFound(t *testing.T) {
	h := newTestHandlers(newFakeStore(t), nil)
	rec := get(t, h, "/api/matches/fff0000/replay", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "match_not_found") {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

// TestServeMeshRange — the mesh is served with http.ServeContent: a Range request returns
// the requested slice with a 206 and the right Content-Length; a HEAD returns the full
// length.
func TestServeMeshRange(t *testing.T) {
	h := newTestHandlers(newFakeStore(t), nil)
	req := httptest.NewRequest(http.MethodGet, "/api/matches/abc/mesh.glb", nil)
	req.Header.Set("Range", "bytes=0-3")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("range status = %d, want 206", rec.Code)
	}
	if string(rec.Body.Bytes()) != "glTF" {
		t.Fatalf("range body = %q, want glTF", rec.Body.Bytes())
	}
	// HEAD: full length.
	head := httptest.NewRequest(http.MethodHead, "/api/matches/abc/mesh.glb", nil)
	recHead := httptest.NewRecorder()
	h.ServeHTTP(recHead, head)
	if recHead.Code != http.StatusOK {
		t.Fatalf("head status = %d", recHead.Code)
	}
	wantLen := "glTF-fake-mesh-bytes"
	if got := recHead.Header().Get("Content-Length"); got != strconv.Itoa(len(wantLen)) {
		t.Fatalf("head Content-Length = %q, want %d", got, len(wantLen))
	}
}

// TestServeMeshNotBuilt — a match whose module has no mesh is a JSON 404 naming the module.
func TestServeMeshNotBuilt(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// A match with a module that has no mesh file.
	if err := root.SaveMatchMeta("abc", store.Match{MatchID: "abc", MapName: "M", MapModule: "missing_mod", ImportedAt: "2026-01-01T00:00:00Z"}); err != nil {
		t.Fatal(err)
	}
	h := newTestHandlers(root, nil)
	rec := get(t, h, "/api/matches/abc/mesh.glb", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "mesh_not_built") || !strings.Contains(rec.Body.String(), "missing_mod") {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

// TestServeStaticFallback — with a web directory, an unknown non-API path falls back to
// index.html, and a traversal is refused.
func TestServeStaticFallback(t *testing.T) {
	root := newFakeStore(t)
	web := t.TempDir()
	if err := os.WriteFile(filepath.Join(web, "index.html"), []byte("<html>home</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, web, nil, weapons.Catalog{}, testLabelCatalog)
	rec := get(t, h, "/some/spa/route", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "home") {
		t.Fatalf("spa fallback: status=%d body=%s", rec.Code, rec.Body.String())
	}
	// Traversal must not escape the web directory.
	rec2 := get(t, h, "/../outside.txt", nil)
	if rec2.Code == http.StatusOK && strings.Contains(rec2.Body.String(), "outside") {
		t.Fatalf("traversal escaped the web dir: %s", rec2.Body.String())
	}
}

// TestJoinInside — joinInside refuses paths that climb out of the web root.
func TestJoinInside(t *testing.T) {
	web := t.TempDir()
	if _, ok := joinInside(web, "index.html"); !ok {
		t.Error("index.html should be inside")
	}
	if _, ok := joinInside(web, "../outside.txt"); ok {
		t.Error("../outside.txt should be refused")
	}
	if _, ok := joinInside(web, "a/../../outside.txt"); ok {
		t.Error("a/../../outside.txt should be refused")
	}
}

// TestServeReadOnlyRefusesStateChanging — with --read-only on, every state-changing
// request is refused with a 403 read_only before any route runs, while the read routes
// still answer 200.
func TestServeReadOnlyRefusesStateChanging(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)
	h.readOnly = true
	hnd := h.readOnlyHandler()
	for _, path := range []string{"/api/matches/x/fetch", "/api/auth/login", "/api/matches/x/mesh/build"} {
		rec := post(t, hnd, path)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s: status = %d, want 403", path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), `"read_only"`) {
			t.Fatalf("%s: body = %s, want read_only", path, rec.Body.String())
		}
	}
	if rec := get(t, hnd, "/api/health", nil); rec.Code != http.StatusOK {
		t.Fatalf("health status = %d, want 200", rec.Code)
	}
	if rec := get(t, hnd, "/api/matches", nil); rec.Code != http.StatusOK {
		t.Fatalf("matches status = %d, want 200", rec.Code)
	}
}

// TestServeReadOnlyAuthStateHidesAccount — with --read-only on, the auth state route
// reports signed out without reading the store, even when the data folder holds a sign-in.
func TestServeReadOnlyAuthStateHidesAccount(t *testing.T) {
	root := newFakeStore(t)
	writeFakeStoredAuth(t, root.Dir())
	h := newTestHandlers(root, nil)
	h.readOnly = true
	rec := get(t, h.readOnlyHandler(), "/api/auth/state", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var st map[string]any
	if json.Unmarshal(rec.Body.Bytes(), &st) != nil {
		t.Fatalf("state body: %s", rec.Body.String())
	}
	if st["state"] != "signed_out" || st["signedIn"] != false {
		t.Fatalf("read-only must report signed_out: %v", st)
	}
	// The viewer reads readOnly to keep the Watch list instead of a sign-in page.
	if st["readOnly"] != true {
		t.Fatalf("read-only must say so: %v", st)
	}
}

// TestServeReadOnlyOffUnchanged — with the flag off, a state-changing request is not
// refused by the read-only guard: it reaches the route and gets the route's own answer.
func TestServeReadOnlyOffUnchanged(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil) // readOnly is false
	rec := post(t, h.readOnlyHandler(), "/api/matches/x/mesh/build")
	if rec.Code == http.StatusForbidden {
		t.Fatalf("flag off must not refuse: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "builds_unavailable") {
		t.Fatalf("expected the build route's own answer, got: %s", rec.Body.String())
	}
}
