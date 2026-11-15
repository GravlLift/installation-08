package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// waitFetchState polls the fetch state route until its body contains want, or fails.
func waitFetchState(t *testing.T, h serverHandlers, id, want string) string {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", "/api/matches/"+id+"/fetch/state", nil))
		if strings.Contains(r.Body.String(), want) {
			return r.Body.String()
		}
		if time.Now().After(deadline) {
			t.Fatalf("fetch state never contained %q: %s", want, r.Body.String())
		}
		time.Sleep(time.Millisecond)
	}
}

// TestRemoteFetchFailureIsLoggedAndReported — a failed fetch logs an error naming the match
// and the failing step, and the state route reports the step and its cause instead of a bare
// "fetch failed"; a sign-in failure is named as such.
func TestRemoteFetchFailureIsLoggedAndReported(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	defer slog.SetDefault(previous)
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	h.remote.client = func(context.Context) (*haloapi.Client, haloauth.Credentials, error) {
		return nil, haloauth.Credentials{}, nil
	}
	h.remote.fetch = func(context.Context, *store.Root, *haloapi.Client, string, fetchProgress) error {
		return &fetchStepError{Step: fetchStepBuild, Err: errors.New("map asset id x is not in the identity table")}
	}
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("POST", "/api/matches/abc/fetch", nil))
	if r.Code != 202 {
		t.Fatal(r.Code)
	}
	waitFetchState(t, h, "abc", `"error":"replay build failed: map asset id x is not in the identity table"`)
	line := logs.String()
	for _, want := range []string{"level=ERROR", "match fetch failed", "match_id=abc", `step="replay build"`, "identity table"} {
		if !strings.Contains(line, want) {
			t.Fatalf("log lacks %q: %s", want, line)
		}
	}

	h.remote.client = func(context.Context) (*haloapi.Client, haloauth.Credentials, error) {
		return nil, haloauth.Credentials{}, errors.New("not signed in")
	}
	r = httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("POST", "/api/matches/def/fetch", nil))
	if r.Code != 202 {
		t.Fatal(r.Code)
	}
	waitFetchState(t, h, "def", `"error":"sign-in failed: not signed in"`)
	if !strings.Contains(logs.String(), "match_id=def step=sign-in") {
		t.Fatalf("sign-in failure not logged: %s", logs.String())
	}
}
