// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// putExport is a PUT with headers, for the export routes (the shared put helper carries no
// headers, and these need a Content-Type and, in one test, an Origin).
func putExport(t *testing.T, h http.Handler, path string, body []byte, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, path, bytes.NewReader(body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// TestExportPutThenGet — a PUT stores the clip's bytes; the answer names the stored file;
// a following GET returns the same bytes with Content-Type video/mp4.
func TestExportPutThenGet(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	payload := []byte("fake-mp4-bytes")
	rec := putExport(t, h, "/api/matches/abc/exports/run-one", payload,
		map[string]string{"Content-Type": "video/mp4"})
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	wantPath, err := root.MatchExportPath("abc", "run-one")
	if err != nil {
		t.Fatal(err)
	}
	var putDoc map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &putDoc); err != nil {
		t.Fatal(err)
	}
	if putDoc["name"] != "run-one" || putDoc["bytes"] != float64(14) {
		t.Fatalf("PUT answer = %s, want name run-one and bytes 14", rec.Body.String())
	}
	if putDoc["path"] != wantPath {
		t.Fatalf("PUT answer path = %v, want the absolute path %s", putDoc["path"], wantPath)
	}
	if b, err := os.ReadFile(wantPath); err != nil || !bytes.Equal(b, payload) {
		t.Fatalf("stored file = %q (err=%v), want the PUT's bytes", b, err)
	}

	rec2 := get(t, h, "/api/matches/abc/exports/run-one", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200; body=%s", rec2.Code, rec2.Body.String())
	}
	if ct := rec2.Header().Get("Content-Type"); ct != "video/mp4" {
		t.Fatalf("Content-Type = %q, want video/mp4", ct)
	}
	if !bytes.Equal(rec2.Body.Bytes(), payload) {
		t.Fatalf("GET body = %q, want the PUT's bytes", rec2.Body.String())
	}
}

// TestExportBadName — an illegal clip name is a 400 invalid_name (before anything else).
func TestExportBadName(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	rec := putExport(t, h, "/api/matches/abc/exports/Run-One", []byte("x"),
		map[string]string{"Content-Type": "video/mp4"})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid_name") {
		t.Fatalf("PUT = %d %s, want 400 invalid_name", rec.Code, rec.Body.String())
	}
}

// TestExportUnknownMatch — a match with no summary is a 404 match_not_found.
func TestExportUnknownMatch(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	rec := putExport(t, h, "/api/matches/abcdef/exports/run-one", []byte("x"),
		map[string]string{"Content-Type": "video/mp4"})
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "match_not_found") {
		t.Fatalf("PUT = %d %s, want 404 match_not_found", rec.Code, rec.Body.String())
	}
}

// TestExportForeignOrigin — a non-loopback Origin is a 403 origin_not_allowed.
func TestExportForeignOrigin(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	rec := putExport(t, h, "/api/matches/abc/exports/run-one", []byte("x"),
		map[string]string{"Content-Type": "video/mp4", "Origin": "https://example.com"})
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "origin_not_allowed") {
		t.Fatalf("PUT = %d %s, want 403 origin_not_allowed", rec.Code, rec.Body.String())
	}
}

// TestExportWrongContentType — a body that is not video/mp4 is a 415
// unsupported_media_type, and nothing is stored.
func TestExportWrongContentType(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	rec := putExport(t, h, "/api/matches/abc/exports/run-one", []byte("x"),
		map[string]string{"Content-Type": "application/octet-stream"})
	if rec.Code != http.StatusUnsupportedMediaType || !strings.Contains(rec.Body.String(), "unsupported_media_type") {
		t.Fatalf("PUT = %d %s, want 415 unsupported_media_type", rec.Code, rec.Body.String())
	}
	p, err := root.MatchExportPath("abc", "run-one")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p); err == nil {
		t.Fatal("a file was stored for a 415 request")
	}
}

// TestExportTooLarge — a body over the (lowered) cap is a 413 export_too_large, and the
// exports folder holds no file afterward (no temp, no partial).
func TestExportTooLarge(t *testing.T) {
	old := maxExportBytes
	maxExportBytes = 16
	defer func() { maxExportBytes = old }()

	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	rec := putExport(t, h, "/api/matches/abc/exports/run-one", bytes.Repeat([]byte("x"), 32),
		map[string]string{"Content-Type": "video/mp4"})
	if rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), "export_too_large") {
		t.Fatalf("PUT = %d %s, want 413 export_too_large", rec.Code, rec.Body.String())
	}
	dir, err := root.MatchExportsDir("abc")
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	for _, e := range entries {
		t.Fatalf("file left behind in exports/ after a 413: %s", e.Name())
	}
}

// TestExportEmptyBody — a zero-byte body is a 400 empty_body, and no file is left behind.
func TestExportEmptyBody(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	rec := putExport(t, h, "/api/matches/abc/exports/run-one", nil,
		map[string]string{"Content-Type": "video/mp4"})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "empty_body") {
		t.Fatalf("PUT = %d %s, want 400 empty_body", rec.Code, rec.Body.String())
	}
	p, err := root.MatchExportPath("abc", "run-one")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatalf("a file was stored for an empty body (stat err=%v)", err)
	}
}

// TestExportEmptyBodyKeepsStoredClip — an empty PUT to a name that already holds a clip is
// a 400 empty_body and leaves the stored clip intact (it must not be replaced by an empty
// file and deleted).
func TestExportEmptyBodyKeepsStoredClip(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	payload := []byte("first-clip-bytes")
	rec := putExport(t, h, "/api/matches/abc/exports/run-one", payload,
		map[string]string{"Content-Type": "video/mp4"})
	if rec.Code != http.StatusOK {
		t.Fatalf("first PUT status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	rec = putExport(t, h, "/api/matches/abc/exports/run-one", nil,
		map[string]string{"Content-Type": "video/mp4"})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "empty_body") {
		t.Fatalf("empty PUT = %d %s, want 400 empty_body", rec.Code, rec.Body.String())
	}

	rec2 := get(t, h, "/api/matches/abc/exports/run-one", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("GET after empty PUT status = %d, want 200; body=%s", rec2.Code, rec2.Body.String())
	}
	if !bytes.Equal(rec2.Body.Bytes(), payload) {
		t.Fatalf("GET after empty PUT body = %q, want the first clip's bytes", rec2.Body.String())
	}
}

// TestExportGetAbsent — a GET for a clip that was never stored is a 404 export_not_found.
func TestExportGetAbsent(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	rec := get(t, h, "/api/matches/abc/exports/run-one", nil)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "export_not_found") {
		t.Fatalf("GET = %d %s, want 404 export_not_found", rec.Code, rec.Body.String())
	}
}

// TestExportCameraTrack — the camera track is stored beside the clip as <name>.camera.json,
// served back as application/json; a non-JSON Content-Type is a 415; the clip is untouched.
func TestExportCameraTrack(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	clip := []byte("fake-mp4-bytes")
	if rec := putExport(t, h, "/api/matches/abc/exports/run-one", clip, map[string]string{"Content-Type": "video/mp4"}); rec.Code != http.StatusOK {
		t.Fatalf("clip PUT = %d %s", rec.Code, rec.Body.String())
	}
	track := []byte(`{"version":1,"samples":[]}`)
	if rec := putExport(t, h, "/api/matches/abc/exports/run-one/camera", track, map[string]string{"Content-Type": "video/mp4"}); rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("camera PUT as video/mp4 = %d, want 415", rec.Code)
	}
	rec := putExport(t, h, "/api/matches/abc/exports/run-one/camera", track, map[string]string{"Content-Type": "application/json"})
	if rec.Code != http.StatusOK {
		t.Fatalf("camera PUT = %d %s", rec.Code, rec.Body.String())
	}
	want, err := root.MatchExportCameraPath("abc", "run-one")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(want, "run-one.camera.json") {
		t.Fatalf("camera path = %s, want ...run-one.camera.json", want)
	}
	if b, err := os.ReadFile(want); err != nil || !bytes.Equal(b, track) {
		t.Fatalf("stored track = %q (err=%v)", b, err)
	}
	got := get(t, h, "/api/matches/abc/exports/run-one/camera", nil)
	if got.Code != http.StatusOK || got.Header().Get("Content-Type") != "application/json" || !bytes.Equal(got.Body.Bytes(), track) {
		t.Fatalf("camera GET = %d %q %q", got.Code, got.Header().Get("Content-Type"), got.Body.String())
	}
	if c := get(t, h, "/api/matches/abc/exports/run-one", nil); !bytes.Equal(c.Body.Bytes(), clip) {
		t.Fatalf("clip changed after the track PUT: %q", c.Body.String())
	}
	if a := get(t, h, "/api/matches/abc/exports/other/camera", nil); a.Code != http.StatusNotFound || !strings.Contains(a.Body.String(), "export_camera_not_found") {
		t.Fatalf("absent track GET = %d %s", a.Code, a.Body.String())
	}
}