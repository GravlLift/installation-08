// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// fakeDecodeEnv makes the test binary, started as a decode child, fail one way on purpose.
const fakeDecodeEnv = "IT3D_FAKE_DECODE"

// TestMain lets the test binary stand in for the app's executable: started as a decode child
// (decodechild.go), it runs the app's main, or fails the way fakeDecodeEnv asks.
func TestMain(m *testing.M) {
	if os.Getenv(decodeChildEnv) != "" {
		fakeDecodeChild(os.Getenv(fakeDecodeEnv))
		main()
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// fakeDecodeChild fails the way mode names, as a real decode child would; "" returns.
func fakeDecodeChild(mode string) {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	switch mode {
	case "oom": // the memory guard's stop, as internal/build logs it
		log.Info("infinite-theater-3d decode: memory ceiling armed for this decode")
		log.Error(build.MemoryExceededMessage, "peak_bytes", uint64(4054013952))
		os.Exit(2)
	case "panic": // a decoder bug: a Go panic, then its goroutine dump
		log.Info("replay: movement states")
		var records map[string]int
		records["chunk_00"]++
	case "access-violation": // the OS stops the process: no output at all
		os.Exit(int(uint32(0xC0000005)))
	}
}

// runFakeChild runs the test binary as a decode child failing as mode asks.
func runFakeChild(t *testing.T, mode string, args ...string) error {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return runDecodeChild(context.Background(), exe, append([]string{"build-replay"}, args...), []string{fakeDecodeEnv + "=" + mode})
}

// TestDecodeChildFailuresAreNamed — every way a decode child can die becomes an error that
// says what happened, and the parent (this process) keeps running.
func TestDecodeChildFailuresAreNamed(t *testing.T) {
	id := "1a521d10-14e8-4bd1-99c5-6c1280f626d3"
	cases := []struct {
		mode, want string
		args       []string
	}{
		{"oom", "the film decoder ran out of memory (4.05 GB used, the limit is 4.03 GB)", []string{id}},
		{"panic", "the film decoder crashed: panic: assignment to entry in nil map", []string{id}},
		{"access-violation", "the film decoder stopped unexpectedly (exit code 0xC0000005)", []string{id}},
		// No fake failure: the real child refuses the id, and its own error is the reason.
		{"", "build-replay requires a valid match id", []string{"not a match id"}},
	}
	for _, c := range cases {
		t.Run(c.mode, func(t *testing.T) {
			err := runFakeChild(t, c.mode, c.args...)
			if err == nil || err.Error() != c.want {
				t.Fatalf("got %v, want %q", err, c.want)
			}
		})
	}
}

// TestDecodeChildOutOfMemoryReachesTheFetchState — the failure the user saw as the app closing
// (2026-11-18) is now the reason the fetch state route reports, which the viewer shows as
// "Fetch failed: ...".
func TestDecodeChildOutOfMemoryReachesTheFetchState(t *testing.T) {
	childErr := runFakeChild(t, "oom", "1a521d10-14e8-4bd1-99c5-6c1280f626d3")
	if childErr == nil {
		t.Fatal("the out-of-memory child reported success")
	}
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newServerHandlers(root, "", nil, weapons.Catalog{}, testLabelCatalog)
	h.remote.client = func(context.Context) (*haloapi.Client, haloauth.Credentials, error) {
		return nil, haloauth.Credentials{}, nil
	}
	h.remote.fetch = func(context.Context, *store.Root, *haloapi.Client, string, fetchProgress) error {
		return &fetchStepError{Step: fetchStepBuild, Err: childErr}
	}
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("POST", "/api/matches/abc/fetch", nil))
	if r.Code != 202 {
		t.Fatal(r.Code)
	}
	waitFetchState(t, h, "abc", `"error":"replay build failed: the film decoder ran out of memory (4.05 GB used, the limit is 4.03 GB)"`)
}

// TestDecodeChildBuildsAStoredMatch — a real fetched match builds through the child and its
// replay lands in the store. IT3D_DECODE_CHILD_DATA names a data folder holding fetched
// matches; use a copy, since the build rewrites their replays.
func TestDecodeChildBuildsAStoredMatch(t *testing.T) {
	dir := os.Getenv("IT3D_DECODE_CHILD_DATA")
	if dir == "" {
		t.Skip("IT3D_DECODE_CHILD_DATA not set")
	}
	root, err := store.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(root.MatchesDir())
	if err != nil {
		t.Fatal(err)
	}
	built := 0
	for _, e := range entries {
		if !e.IsDir() || !store.MatchIDValid(e.Name()) {
			continue
		}
		id := e.Name()
		replayPath, _ := root.MatchReplayPath(id)
		if err := os.Remove(replayPath); err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		if err := buildStoredInChild(context.Background(), root, id); err != nil {
			t.Fatalf("%s: %v", id, err)
		}
		raw, err := root.LoadReplay(id)
		if err != nil {
			t.Fatalf("%s: no replay after the child build: %v", id, err)
		}
		doc, err := gunzipBytes(raw)
		if err != nil || !json.Valid(doc) {
			t.Fatalf("%s: the replay is not a JSON document: %v", id, err)
		}
		built++
	}
	if built == 0 {
		t.Fatalf("no match under %s", root.MatchesDir())
	}
}

// TestChildOutputKeepsTheCrashLine —lines split across writes are joined, the tail is
// bounded, and a panic's first line survives a goroutine dump longer than the tail.
func TestChildOutputKeepsTheCrashLine(t *testing.T) {
	var log strings.Builder
	o := &childOutput{log: &log}
	_, _ = o.Write([]byte("time=x level=INFO msg=start\npanic: boo"))
	_, _ = o.Write([]byte("m\r\n\ngoroutine 1 [running]:\n"))
	for i := 0; i < 3*childTailLines; i++ {
		_, _ = fmt.Fprintf(o, "main.frame%d()\n", i)
	}
	_, _ = o.Write([]byte("exit status 2"))
	o.flush()
	if len(o.last) != childTailLines || o.last[len(o.last)-1] != "exit status 2" {
		t.Fatalf("tail: %d lines, last %q", len(o.last), o.last[len(o.last)-1])
	}
	if err := o.failure(2); err == nil || err.Error() != "the film decoder crashed: panic: boom" {
		t.Fatalf("failure: %v", err)
	}
	if !strings.HasPrefix(log.String(), "time=x level=INFO msg=start\npanic: boom") {
		t.Fatalf("the output was not copied to the log: %q", log.String()[:40])
	}
	if got := exitCodeText(-1073741819); got != "0xC0000005" {
		t.Fatalf("exitCodeText: %s", got)
	}
}
