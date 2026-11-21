// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// writeReplayWithSchema writes a gzip document that records schemaVersion for match id,
// with matchId so a document that is read back is one the route can serve.
func writeReplayWithSchema(t *testing.T, root *store.Root, id string, schemaVersion int) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"matchId": id, "schemaVersion": schemaVersion})
	if err != nil {
		t.Fatal(err)
	}
	gz := gzipJSON(t, raw)
	path, err := root.MatchReplayPath(id)
	if err != nil {
		t.Fatal(err)
	}
	if err := root.WriteFile(path, gz); err != nil {
		t.Fatal(err)
	}
}

// TestStoredReplaySchemaVersion — the "behind" check reads the schemaVersion of the stored
// document: a document at the current version is current, one below it is behind, and a
// document that is absent or carries no schemaVersion is not a re-code target (ok false).
func TestStoredReplaySchemaVersion(t *testing.T) {
	root := newFakeStore(t) // writes a document without a schemaVersion for "abc"
	if sv, ok := storedReplaySchemaVersion(root, "abc"); ok {
		t.Fatalf("no schemaVersion: ok = true, sv = %d, want ok false", sv)
	}
	writeReplayWithSchema(t, root, "abc", replay.SchemaVersion)
	if sv, ok := storedReplaySchemaVersion(root, "abc"); !ok || sv != replay.SchemaVersion {
		t.Fatalf("current document: sv = %d ok = %v, want %d true", sv, ok, replay.SchemaVersion)
	}
	writeReplayWithSchema(t, root, "abc", replay.SchemaVersion-1)
	if sv, ok := storedReplaySchemaVersion(root, "abc"); !ok || sv != replay.SchemaVersion-1 {
		t.Fatalf("old document: sv = %d ok = %v, want %d true", sv, ok, replay.SchemaVersion-1)
	}
}

// TestRecodeReady — ready says the stored document is at the current schema (or above).
func TestRecodeReady(t *testing.T) {
	root := newFakeStore(t)
	if recodeReady(root, "abc") {
		t.Fatal("a document without a schemaVersion is not ready")
	}
	writeReplayWithSchema(t, root, "abc", replay.SchemaVersion-1)
	if recodeReady(root, "abc") {
		t.Fatal("a document below the current schema is not ready")
	}
	writeReplayWithSchema(t, root, "abc", replay.SchemaVersion)
	if !recodeReady(root, "abc") {
		t.Fatal("a document at the current schema is ready")
	}
}

// TestRecodeJobKey — the job key names the match and only the match.
func TestRecodeJobKey(t *testing.T) {
	for _, id := range []string{"abc", "0ace97d0-b1d1-4dba-bfe0-713e93c4db98"} {
		key := recodeJobKey(id)
		got, ok := recodeJobID(key)
		if !ok || got != id {
			t.Fatalf("recodeJobID(%q) = %q %v, want %q true", key, got, ok, id)
		}
	}
	if _, ok := recodeJobID("variant:abc"); ok {
		t.Fatal("a variant key is not a re-code key")
	}
	if _, ok := recodeJobID("recode:not a match id"); ok {
		t.Fatal("an invalid match id is not a re-code key")
	}
}

// fakeRecodeStore builds a store with one match ("abc") whose film chunks folder exists
// (enough for the re-code to find it; the build itself is faked in the tests that need it)
// and a document behind the decoder.
func fakeRecodeStore(t *testing.T) *store.Root {
	t.Helper()
	root := newFakeStore(t)
	writeReplayWithSchema(t, root, "abc", replay.SchemaVersion-1)
	chunks, err := root.MatchChunksDir("abc")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(chunks, 0o755); err != nil {
		t.Fatal(err)
	}
	return root
}

// TestRecodeMatchEnqueues — a behind match with chunks is enqueued as a re-code job; a
// match without chunks is not (the document is served as-is instead, and a warning is
// logged).
func TestRecodeMatchEnqueues(t *testing.T) {
	root := fakeRecodeStore(t)
	jobs, err := meshjobs.New(func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		return meshjobs.BuildResult{}, nil
	}, "", jobModuleReadyFor(root))
	if err != nil {
		t.Fatal(err)
	}
	jobs.SetDest(recodeDestFor(root))
	jobs.SetOutdated(jobModuleOutdatedFor(root))
	jobs.Start()
	defer jobs.Stop(time.Second)
	h := newTestHandlers(root, jobs)
	if _, ok := h.recodeMatch("abc"); !ok {
		t.Fatal("a match with chunks is enqueued")
	}
	// A match with no chunks at all is not enqueued.
	if _, ok := h.recodeMatch("fff0000"); ok {
		t.Fatal("a match without chunks is not enqueued")
	}
}

// jobModuleReadyFor / recodeDestFor / jobModuleOutdatedFor are the runner's callbacks
// wired to a store in a test (the same wiring meshJobsFor does, without the game root).
func jobModuleReadyFor(root *store.Root) func(string) bool {
	return func(module string) bool { return jobModuleReady(root, module) }
}
func jobModuleOutdatedFor(root *store.Root) func(string) bool {
	return func(module string) bool { return jobModuleOutdated(root, module) }
}
func recodeDestFor(root *store.Root) func(string) string {
	return func(module string) string {
		module, _ = meshjobs.SplitQuality(module)
		if id, ok := recodeJobID(module); ok {
			p, _ := root.MatchReplayPath(id)
			return p
		}
		return module + ".glb"
	}
}

// TestRecodeJobFailedLeavesDocument — a re-code job whose build fails leaves the stored
// document in place (it is never left half-written), and the match records the failure in
// this process (so the next open serves the stored document without re-queuing).
func TestRecodeJobFailedLeavesDocument(t *testing.T) {
	root := fakeRecodeStore(t)
	// A build that fails on purpose: the stored document must survive it. The fake stands in
	// for the server's build closure, so it records the failure the way serve_jobs.go does
	// (noteRecodeFailed), which is the behavior the test asserts.
	failing := func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		err := os.ErrNotExist
		if id, ok := recodeJobID(module); ok {
			noteRecodeFailed(id, err)
		}
		return meshjobs.BuildResult{}, err
	}
	jobs, err := meshjobs.New(failing, "", jobModuleReadyFor(root))
	if err != nil {
		t.Fatal(err)
	}
	jobs.SetDest(recodeDestFor(root))
	jobs.SetOutdated(jobModuleOutdatedFor(root))
	jobs.Start()
	defer jobs.Stop(time.Second)
	h := newTestHandlers(root, jobs)
	if _, ok := h.recodeMatch("abc"); !ok {
		t.Fatal("enqueued")
	}
	// Wait for the job to fail.
	deadline := time.Now().Add(5 * time.Second)
	var snap meshjobs.Snapshot
	for time.Now().Before(deadline) {
		snap = jobs.Snapshot(recodeJobKey("abc"))
		if snap.State == meshjobs.StateFailed {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if snap.State != meshjobs.StateFailed {
		t.Fatalf("state = %s, want failed", snap.State)
	}
	// The stored document is still the old one, untouched.
	sv, ok := storedReplaySchemaVersion(root, "abc")
	if !ok || sv != replay.SchemaVersion-1 {
		t.Fatalf("document after a failed re-code: sv = %d ok = %v, want %d true", sv, ok, replay.SchemaVersion-1)
	}
	if !recodeFailedInProcess("abc") {
		t.Fatal("the failed re-code is recorded in this process")
	}
}

// TestRecodeWaitServesStoredOnCancel — a re-code that is cancelled (a server shutdown in
// flight) leaves the open to serve the stored document, not to wait forever.
func TestRecodeWaitServesStoredOnCancel(t *testing.T) {
	root := fakeRecodeStore(t)
	// A build that does not finish on its own: it stays building until its context is
	// cancelled (the runner's Cancel), which ends it the way a real decode ends on a
	// shutdown in flight.
	started := make(chan struct{})
	blocking := func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		close(started)
		<-ctx.Done()
		return meshjobs.BuildResult{}, ctx.Err()
	}
	jobs, err := meshjobs.New(blocking, "", jobModuleReadyFor(root))
	if err != nil {
		t.Fatal(err)
	}
	jobs.SetDest(recodeDestFor(root))
	jobs.SetOutdated(jobModuleOutdatedFor(root))
	jobs.Start()
	defer jobs.Stop(2 * time.Second)
	h := newTestHandlers(root, jobs)
	if _, ok := h.recodeMatch("abc"); !ok {
		t.Fatal("enqueued")
	}
	<-started
	// Cancel the build (a shutdown in flight), then the open must not wait forever: it
	// gets the stored document.
	if !jobs.Cancel(recodeJobKey("abc")) {
		t.Fatal("the build did not cancel")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		h.waitForRecode(ctx, "abc")
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("the open waited on a cancelled re-code")
	}
}

// TestRecodeAllSkipsCurrentAndNamesMissing — recode-all (runRecodeAll) re-codes only the
// matches whose document is behind the decoder: a current one is left exactly as it is,
// and a match whose film is missing is named as skipped, not failed.
func TestRecodeAllSkipsCurrentAndNamesMissing(t *testing.T) {
	root := fakeRecodeStore(t)
	// "abc" has no film at all (no chunks folder): it is skipped, not failed.
	// A second match with a current document: it is left alone, not even named.
	if err := root.SaveMatchMeta("def", store.Match{
		MatchID: "def", MapName: "M2", MapModule: "modb", ImportedAt: "2026-01-01T00:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}
	writeReplayWithSchema(t, root, "def", replay.SchemaVersion)
	beforeDef, err := os.ReadFile(func() string { p, _ := root.MatchReplayPath("def"); return p }())
	if err != nil {
		t.Fatal(err)
	}
	// "abc" has no chunks folder at all: recode-all skips it (the film is missing).
	// Remove the chunks folder fakeRecodeStore made, so the skip is the honest case.
	chunks, _ := root.MatchChunksDir("abc")
	if err := os.Remove(chunks); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	// Run the subcommand and read its one-line-per-match report (it goes to the test's
	// stdout, as a real CLI run's would; the test only needs the bytes, captured here).
	report := captureRunRecodeAll(t, root.Dir())
	if !strings.Contains(report, "abc: skipped (film chunks missing)") {
		t.Fatalf("the report did not name the missing film: %q", report)
	}
	if strings.Contains(report, "def:") {
		t.Fatalf("a current match was named in the report: %q", report)
	}
	afterDef, err := os.ReadFile(func() string { p, _ := root.MatchReplayPath("def"); return p }())
	if err != nil {
		t.Fatal(err)
	}
	if string(beforeDef) != string(afterDef) {
		t.Fatal("recode-all touched a current document")
	}
}

// captureRunRecodeAll runs runRecodeAll and returns its stdout (the one-line-per-match
// report), restoring the test's stdout afterward.
func captureRunRecodeAll(t *testing.T, dataDir string) string {
	t.Helper()
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	err = runRecodeAll([]string{"--data", dataDir})
	w.Close()
	os.Stdout = old
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	_, _ = io.Copy(&out, r)
	return out.String()
}

// TestRecodeJobWritesNewDocument — a re-code job whose build succeeds writes the new
// document at the current schema (a fake build that stands in for the decoder).
func TestRecodeJobWritesNewDocument(t *testing.T) {
	root := fakeRecodeStore(t)
	// A fake decoder: it writes the document the way buildStored would (a temp file and a
	// rename, via the store), at the current schema.
	fake := func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		if _, ok := recodeJobID(module); !ok {
			return meshjobs.BuildResult{}, os.ErrNotExist
		}
		gz := gzipJSON(t, mustJSON(map[string]any{"matchId": "abc", "schemaVersion": replay.SchemaVersion}))
		return meshjobs.BuildResult{Bytes: int64(len(gz))}, root.WriteFile(out, gz)
	}
	jobs, err := meshjobs.New(fake, "", jobModuleReadyFor(root))
	if err != nil {
		t.Fatal(err)
	}
	jobs.SetDest(recodeDestFor(root))
	jobs.SetOutdated(jobModuleOutdatedFor(root))
	jobs.Start()
	defer jobs.Stop(time.Second)
	h := newTestHandlers(root, jobs)
	if _, ok := h.recodeMatch("abc"); !ok {
		t.Fatal("enqueued")
	}
	deadline := time.Now().Add(5 * time.Second)
	var snap meshjobs.Snapshot
	for time.Now().Before(deadline) {
		snap = jobs.Snapshot(recodeJobKey("abc"))
		if snap.State == meshjobs.StateReady || snap.State == meshjobs.StateFailed {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if snap.State != meshjobs.StateReady {
		t.Fatalf("state = %s (error %s), want ready", snap.State, snap.Error)
	}
	if sv, ok := storedReplaySchemaVersion(root, "abc"); !ok || sv != replay.SchemaVersion {
		t.Fatalf("document after the re-code: sv = %d ok = %v, want %d true", sv, ok, replay.SchemaVersion)
	}
}

// mustJSON marshals v for a test helper.
func mustJSON(v any) []byte {
	raw, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return raw
}

// TestRecodeReadyIgnoresOtherFiles — the ready check reads the match's own document;
// another match's document does not make it ready.
func TestRecodeReadyIgnoresOtherFiles(t *testing.T) {
	root := newFakeStore(t)
	writeReplayWithSchema(t, root, "abc", replay.SchemaVersion)
	if !recodeReady(root, "abc") {
		t.Fatal("a current document is ready")
	}
	// A different match id with no document is not ready, even though "abc" is.
	if recodeReady(root, "fff0000") {
		t.Fatal("a match with no document is not ready")
	}
}

// TestRecodeMatchNoRunner — with no build runner (a server that started without one), a
// behind match is not re-coded: the stored document is served as-is.
func TestRecodeMatchNoRunner(t *testing.T) {
	root := fakeRecodeStore(t)
	h := newTestHandlers(root, nil)
	if _, ok := h.recodeMatch("abc"); ok {
		t.Fatal("no runner: nothing is enqueued")
	}
}

// build is imported for its error in the fake builds; silence the linter.
var _ = build.ErrUnreadable
