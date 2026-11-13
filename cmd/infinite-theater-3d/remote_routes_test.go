package main

import (
	"encoding/json"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRemoteRoutes(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, "", nil, weapons.Catalog{})
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("GET", "/api/auth/state", nil))
	if r.Code != 200 {
		t.Fatal(r.Code)
	}
	var state map[string]any
	if json.Unmarshal(r.Body.Bytes(), &state) != nil || state["signedIn"] != false {
		t.Fatal(r.Body.String())
	}
	req := httptest.NewRequest("POST", "/api/matches/abc/fetch", nil)
	req.Header.Set("Origin", "https://evil.example")
	r = httptest.NewRecorder()
	h.ServeHTTP(r, req)
	if r.Code != http.StatusForbidden {
		t.Fatal(r.Code)
	}
	r = httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("GET", "/api/matches/abc/fetch/state", nil))
	if r.Code != 200 || !strings.Contains(r.Body.String(), "idle") {
		t.Fatal(r.Code, r.Body.String())
	}
}
