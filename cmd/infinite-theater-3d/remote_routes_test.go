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
	"sync"
	"testing"
	"time"
)

func TestRemoteRoutes(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	h.auth.steps = loginFlow{
		start: func(context.Context, string) (*haloauth.DeviceCode, error) { return nil, context.Canceled },
		poll: func(*haloauth.DeviceCode, string) (*haloauth.OAuthToken, time.Duration, error) {
			return nil, 0, context.Canceled
		},
		done: func(context.Context, string, *haloauth.OAuthToken) (haloauth.Credentials, error) {
			return haloauth.Credentials{}, context.Canceled
		},
		logout: func() error { return nil },
	}
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
	h := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	h.auth.steps = loginFlow{
		start: func(context.Context, string) (*haloauth.DeviceCode, error) { return nil, context.Canceled },
		poll: func(*haloauth.DeviceCode, string) (*haloauth.OAuthToken, time.Duration, error) {
			return nil, 0, context.Canceled
		},
		done: func(context.Context, string, *haloauth.OAuthToken) (haloauth.Credentials, error) {
			return haloauth.Credentials{}, context.Canceled
		},
		logout: func() error { return nil },
	}
	api := haloapi.New(s.Client(), haloapi.Endpoints{Stats: s.URL, Discovery: s.URL, Economy: s.URL}, "synthetic", "synthetic")
	h.remote.client = func(context.Context) (*haloapi.Client, haloauth.Credentials, error) {
		return api, haloauth.Credentials{XUID: "123"}, nil
	}
	entered := make(chan struct{})
	release := make(chan struct{})
	var enteredOnce sync.Once
	h.remote.fetch = func(_ context.Context, _ *store.Root, _ *haloapi.Client, _ string, progress fetchProgress) error {
		progress("downloading", 1, 2)
		enteredOnce.Do(func() { close(entered) })
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
	// A second fetch is queued, not refused: it waits its turn behind abc.
	if r := get("POST", "/api/matches/def/fetch"); r.Code != 202 || !strings.Contains(r.Body.String(), `"queued"`) {
		t.Fatal(r.Code, r.Body.String())
	}
	if r := get("GET", "/api/matches/abc/fetch/state"); !strings.Contains(r.Body.String(), "downloading") {
		t.Fatal(r.Body.String())
	}
	if r := get("GET", "/api/matches/def/fetch/state"); !strings.Contains(r.Body.String(), `"queued"`) {
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
	// abc finished, so the queued def now runs and becomes ready too.
	for {
		r := get("GET", "/api/matches/def/fetch/state")
		if strings.Contains(r.Body.String(), "ready") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal(r.Body.String())
		}
		time.Sleep(time.Millisecond)
	}
}

// TestRemoteMatchesByGamertag — ?gamertag= resolves the player through the profile service
// and lists that player's history (not the signed-in account's); an unknown gamertag is a
// 404 "gamertag not found", a malformed one a 400 before any service call, and the
// read-only mode still refuses the route as if signed out.
func TestRemoteMatchesByGamertag(t *testing.T) {
	var calls []string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path)
		switch r.URL.Path {
		case "/users/gt(Other Player)":
			fmt.Fprint(w, `{"xuid":"999","gamertag":"Other Player"}`)
		case "/players/xuid(999)/matches":
			fmt.Fprint(w, `{"Results":[{"MatchId":"theirs","MatchInfo":{"StartTime":"today","MapVariant":{"PublicName":"Streets"},"UgcGameVariant":{"PublicName":"Slayer"}}}]}`)
		case "/players/xuid(123)/matches":
			fmt.Fprint(w, `{"Results":[{"MatchId":"mine","MatchInfo":{"StartTime":"today","MapVariant":{"PublicName":"Arena"},"UgcGameVariant":{"PublicName":"Slayer"}}}]}`)
		default:
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	api := haloapi.New(s.Client(), haloapi.Endpoints{Stats: s.URL, Discovery: s.URL, Economy: s.URL, Profile: s.URL}, "synthetic", "synthetic")
	h.remote.client = func(context.Context) (*haloapi.Client, haloauth.Credentials, error) {
		return api, haloauth.Credentials{XUID: "123"}, nil
	}
	get := func(url string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", url, nil))
		return r
	}
	if r := get("/api/remote/matches?gamertag=Other%20Player&count=5"); r.Code != 200 || !strings.Contains(r.Body.String(), "theirs") || strings.Contains(r.Body.String(), "mine") {
		t.Fatal(r.Code, r.Body.String())
	}
	if r := get("/api/remote/matches"); r.Code != 200 || !strings.Contains(r.Body.String(), "mine") {
		t.Fatal(r.Code, r.Body.String())
	}
	if r := get("/api/remote/matches?gamertag=Nobody"); r.Code != 404 || !strings.Contains(r.Body.String(), "gamertag not found") {
		t.Fatal(r.Code, r.Body.String())
	}
	before := len(calls)
	for _, bad := range []string{"", "%20%20", "a/b", "x(1)", "ThisNameIsWayTooLong"} {
		if r := get("/api/remote/matches?gamertag=" + bad); r.Code != 400 || !strings.Contains(r.Body.String(), "invalid gamertag") {
			t.Fatalf("%q: %d %s", bad, r.Code, r.Body.String())
		}
	}
	if len(calls) != before {
		t.Fatalf("an invalid gamertag reached the service: %v", calls[before:])
	}
	if r := get("/api/remote/matches?gamertag=Other%20Player&count=0"); r.Code != 400 {
		t.Fatal(r.Code)
	}
	h.readOnly = true
	r := httptest.NewRecorder()
	h.readOnlyHandler().ServeHTTP(r, httptest.NewRequest("GET", "/api/remote/matches?gamertag=Other%20Player", nil))
	if r.Code != 401 {
		t.Fatal(r.Code, r.Body.String())
	}
}

func TestGamertagValid(t *testing.T) {
	for _, gt := range []string{"A", "Some Player", "Name#1234", "Ünïcødé", "123456789012#123"} {
		if !gamertagValid(gt) {
			t.Errorf("%q rejected", gt)
		}
	}
	for _, gt := range []string{"", "a/b", "a?b", "a(b)", "tab\there", "12345678901234567"} {
		if gamertagValid(gt) {
			t.Errorf("%q accepted", gt)
		}
	}
}

func TestRemoteFetchExpiredFilm(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	h.auth.steps = loginFlow{
		start: func(context.Context, string) (*haloauth.DeviceCode, error) { return nil, context.Canceled },
		poll: func(*haloauth.DeviceCode, string) (*haloauth.OAuthToken, time.Duration, error) {
			return nil, 0, context.Canceled
		},
		done: func(context.Context, string, *haloauth.OAuthToken) (haloauth.Credentials, error) {
			return haloauth.Credentials{}, context.Canceled
		},
		logout: func() error { return nil },
	}
	h.remote.client = func(context.Context) (*haloapi.Client, haloauth.Credentials, error) {
		return nil, haloauth.Credentials{}, nil
	}
	h.remote.fetch = func(context.Context, *store.Root, *haloapi.Client, string, fetchProgress) error {
		return &haloapi.FilmUnavailableError{}
	}
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("POST", "/api/matches/abc/fetch", nil))
	if r.Code != 202 {
		t.Fatal(r.Code)
	}
	deadline := time.Now().Add(time.Second)
	for {
		r = httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", "/api/matches/abc/fetch/state", nil))
		if strings.Contains(r.Body.String(), "film not available") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal(r.Body.String())
		}
		time.Sleep(time.Millisecond)
	}
}
