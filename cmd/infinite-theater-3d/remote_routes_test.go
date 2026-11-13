package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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

func TestRemoteRoutesFetchAndHistory(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/players/"):
			fmt.Fprint(w, `{"Results":[{"MatchId":"abc","MatchInfo":{"StartTime":"today","MapVariant":{"PublicName":"Arena"},"UgcGameVariant":{"PublicName":"Slayer"}}}]}`)
		default:
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	credential, _ := json.Marshal(haloauth.Credentials{Refresh: "synthetic", Gamertag: "Player"})
	if err = haloauth.Save(root.Dir(), credential); err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, "", nil, weapons.Catalog{})
	api := haloapi.New(s.Client(), haloapi.Endpoints{Stats: s.URL, Discovery: s.URL, Economy: s.URL}, "synthetic", "synthetic")
	h.remote.client = func(context.Context) (*haloapi.Client, haloauth.Credentials, error) {
		return api, haloauth.Credentials{XUID: "123"}, nil
	}
	entered := make(chan struct{})
	release := make(chan struct{})
	h.remote.fetch = func(_ context.Context, _ *store.Root, _ *haloapi.Client, _ string, progress fetchProgress) error {
		progress("downloading", 1, 2)
		close(entered)
		<-release
		progress("building", 2, 2)
		return nil
	}
	get := func(method, url string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest(method, url, nil))
		return r
	}
	if r := get("GET", "/api/auth/state"); !strings.Contains(r.Body.String(), "Player") || strings.Contains(r.Body.String(), "synthetic") {
		t.Fatal(r.Body.String())
	}
	if r := get("GET", "/api/remote/matches"); r.Code != 200 || !strings.Contains(r.Body.String(), "Arena") {
		t.Fatal(r.Code, r.Body.String())
	}
	if r := get("POST", "/api/matches/abc/fetch"); r.Code != 202 {
		t.Fatal(r.Code)
	}
	<-entered
	if r := get("POST", "/api/matches/def/fetch"); r.Code != 409 {
		t.Fatal(r.Code)
	}
	if r := get("GET", "/api/matches/abc/fetch/state"); !strings.Contains(r.Body.String(), "downloading") {
		t.Fatal(r.Body.String())
	}
	close(release)
	deadline := time.Now().Add(time.Second)
	for {
		r := get("GET", "/api/matches/abc/fetch/state")
		if strings.Contains(r.Body.String(), "ready") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal(r.Body.String())
		}
		time.Sleep(time.Millisecond)
	}
}
