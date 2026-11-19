// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func del(t *testing.T, h http.Handler, path string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, path, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// cameraScriptBody is a legal script body: version 1, the route's match id, a body-side
// name (which the server must override), and n keys.
func cameraScriptBody(t *testing.T, matchID string, keys int) []byte {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"version": 1, "matchId": matchID, "name": "body-name", "keys": make([]any, keys),
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// TestCameraScriptPutThenGet — a PUT stores the script; a following GET returns it, with
// name set to the route's name even when the body named something else.
func TestCameraScriptPutThenGet(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	rec := put(t, h, "/api/matches/abc/camera-scripts/run-one", cameraScriptBody(t, "abc", 2))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var putDoc map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &putDoc); err != nil {
		t.Fatal(err)
	}
	if putDoc["name"] != "run-one" || putDoc["keys"] != float64(2) {
		t.Fatalf("PUT answer = %v, want name run-one and keys 2", putDoc)
	}

	rec2 := get(t, h, "/api/matches/abc/camera-scripts/run-one", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200; body=%s", rec2.Code, rec2.Body.String())
	}
	if ct := rec2.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	var doc map[string]any
	if err := json.Unmarshal(rec2.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if doc["name"] != "run-one" {
		t.Fatalf("name = %v, want run-one (the route's name, not the body's)", doc["name"])
	}
	if doc["matchId"] != "abc" {
		t.Fatalf("matchId = %v, want abc", doc["matchId"])
	}
	if keys, ok := doc["keys"].([]any); !ok || len(keys) != 2 {
		t.Fatalf("keys = %v, want 2 entries", doc["keys"])
	}
}

// TestCameraScriptList — the list is [] before any PUT; two scripts show with their key
// counts, sorted by name.
func TestCameraScriptList(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	rec := get(t, h, "/api/matches/abc/camera-scripts", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"scripts":[]`) {
		t.Fatalf("list = %s, want an empty list", rec.Body.String())
	}

	for name, keys := range map[string]int{"bbb": 3, "aaa": 2} {
		r := put(t, h, "/api/matches/abc/camera-scripts/"+name, cameraScriptBody(t, "abc", keys))
		if r.Code != http.StatusOK {
			t.Fatalf("PUT %s status = %d; body=%s", name, r.Code, r.Body.String())
		}
	}

	rec = get(t, h, "/api/matches/abc/camera-scripts", nil)
	var list struct {
		Scripts []struct {
			Name string `json:"name"`
			Keys int    `json:"keys"`
		} `json:"scripts"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Scripts) != 2 ||
		list.Scripts[0].Name != "aaa" || list.Scripts[0].Keys != 2 ||
		list.Scripts[1].Name != "bbb" || list.Scripts[1].Keys != 3 {
		t.Fatalf("scripts = %+v, want aaa(2) then bbb(3)", list.Scripts)
	}
}

// TestCameraScriptDelete — a DELETE removes the script (a following GET is 404
// script_not_found); a DELETE of a script that is absent is a 404 too.
func TestCameraScriptDelete(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	rec := del(t, h, "/api/matches/abc/camera-scripts/absent", nil)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "script_not_found") {
		t.Fatalf("missing DELETE = %d %s, want 404 script_not_found", rec.Code, rec.Body.String())
	}

	rec = put(t, h, "/api/matches/abc/camera-scripts/run-one", cameraScriptBody(t, "abc", 1))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d; body=%s", rec.Code, rec.Body.String())
	}

	rec = del(t, h, "/api/matches/abc/camera-scripts/run-one", nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE status = %d, want 204; body=%s", rec.Code, rec.Body.String())
	}

	rec = get(t, h, "/api/matches/abc/camera-scripts/run-one", nil)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "script_not_found") {
		t.Fatalf("GET after DELETE = %d %s, want 404 script_not_found", rec.Code, rec.Body.String())
	}
}

// TestCameraScriptInvalidName — a name outside [a-z0-9_-]{1,64} is a 400 on GET, PUT and
// DELETE.
func TestCameraScriptInvalidName(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	for _, rawName := range []string{"Bad Name", "../x", strings.Repeat("a", 65)} {
		path := "/api/matches/abc/camera-scripts/" + url.PathEscape(rawName)
		rec := get(t, h, path, nil)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("GET %q: status = %d, want 400; body=%s", rawName, rec.Code, rec.Body.String())
		}
		rec = put(t, h, path, cameraScriptBody(t, "abc", 1))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("PUT %q: status = %d, want 400; body=%s", rawName, rec.Code, rec.Body.String())
		}
		rec = del(t, h, path, nil)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("DELETE %q: status = %d, want 400; body=%s", rawName, rec.Code, rec.Body.String())
		}
	}
}

// TestCameraScriptPutShape — the light shape check: the body must be a JSON object whose
// matchId matches the route, version is 1, and keys is an array of at most 512 entries.
func TestCameraScriptPutShape(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	bad := []struct {
		what string
		body []byte
	}{
		{"matchId from a different match", []byte(`{"version":1,"matchId":"def","keys":[]}`)},
		{"version 2", []byte(`{"version":2,"matchId":"abc","keys":[]}`)},
		{"keys not an array", []byte(`{"version":1,"matchId":"abc","keys":{}}`)},
		{"keys null", []byte(`{"version":1,"matchId":"abc","keys":null}`)},
		{"513 keys", keysArrayBody(513)},
		{"not a JSON object", []byte(`[1,2,3]`)},
	}
	for _, c := range bad {
		rec := put(t, h, "/api/matches/abc/camera-scripts/bad", c.body)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid_script") {
			t.Fatalf("%s: status = %d, want 400 invalid_script; body=%s", c.what, rec.Code, rec.Body.String())
		}
	}
}

// keysArrayBody is a shape-legal body carrying n keys (n > 512 breaks the cap).
func keysArrayBody(n int) []byte {
	parts := make([]string, n)
	for i := range parts {
		parts[i] = "null"
	}
	return []byte(`{"version":1,"matchId":"abc","keys":[` + strings.Join(parts, ",") + `]}`)
}

// TestCameraScriptPutOrigin — a PUT from a foreign Origin is 403 origin_not_allowed; one
// from a loopback Origin succeeds.
func TestCameraScriptPutOrigin(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	req := httptest.NewRequest(http.MethodPut, "/api/matches/abc/camera-scripts/foreign", bytes.NewReader(cameraScriptBody(t, "abc", 1)))
	req.Header.Set("Origin", "https://example.com")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "origin_not_allowed") {
		t.Fatalf("foreign PUT = %d %s, want 403 origin_not_allowed", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPut, "/api/matches/abc/camera-scripts/local", bytes.NewReader(cameraScriptBody(t, "abc", 1)))
	req.Header.Set("Origin", "http://127.0.0.1:8177")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("loopback PUT = %d %s, want 200", rec.Code, rec.Body.String())
	}
}

// TestCameraScriptPutTooLarge — a body over the 256 KiB cap is 413 script_too_large.
func TestCameraScriptPutTooLarge(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	rec := put(t, h, "/api/matches/abc/camera-scripts/big", bytes.Repeat([]byte("x"), int(maxCameraScriptBytes)+1))
	if rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), "script_too_large") {
		t.Fatalf("large PUT = %d %s, want 413 script_too_large", rec.Code, rec.Body.String())
	}
}

// TestCameraScriptUnknownMatch — a valid-hex id with no match.json is a 404 match_not_found
// on the list and on PUT.
func TestCameraScriptUnknownMatch(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)

	rec := get(t, h, "/api/matches/fff/camera-scripts", nil)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "match_not_found") {
		t.Fatalf("list = %d %s, want 404 match_not_found", rec.Code, rec.Body.String())
	}
	rec = put(t, h, "/api/matches/fff/camera-scripts/any", cameraScriptBody(t, "fff", 1))
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "match_not_found") {
		t.Fatalf("PUT = %d %s, want 404 match_not_found", rec.Code, rec.Body.String())
	}
}
