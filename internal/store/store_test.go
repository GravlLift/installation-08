// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package store

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
)

// TestMatchIDValid — the match-id guard: hex and dashes are legal, anything else (a
// separator, a letter, a dot) is not, so no id can steer a path out of the data directory.
func TestMatchIDValid(t *testing.T) {
	yes := []string{
		"7d798138",
		"7d798138-77d2-41be-b1a3-bdf9fa38395c",
		"ABCDEF-01",
	}
	no := []string{
		"",
		"sgh_interlock", // a module key, not a match id
		"../etc",
		"a/b",
		"a\\b",
		"a b",
		"a.b",
		"abc!",
	}
	for _, s := range yes {
		if !MatchIDValid(s) {
			t.Errorf("MatchIDValid(%q) = false, want true", s)
		}
	}
	for _, s := range no {
		if MatchIDValid(s) {
			t.Errorf("MatchIDValid(%q) = true, want false", s)
		}
	}
}

// TestModuleKeyValid — the module-key guard: module keys (letters, digits, underscores)
// are legal, but a path separator, a volume colon, or NUL is not.
func TestModuleKeyValid(t *testing.T) {
	yes := []string{"sgh_interlock", "fo11_blank", "ctf_aquarius"}
	no := []string{"", "../evil", "a/b", "a\\b", "a:b", "a\x00b"}
	for _, s := range yes {
		if !ModuleKeyValid(s) {
			t.Errorf("ModuleKeyValid(%q) = false, want true", s)
		}
	}
	for _, s := range no {
		if ModuleKeyValid(s) {
			t.Errorf("ModuleKeyValid(%q) = true, want false", s)
		}
	}
}

// TestLayoutPaths — the documented layout: matches/<id>/{chunks,manifest.json,stats.json,
// replay.json.gz,match.json} and maps/<module>.glb.
func TestLayoutPaths(t *testing.T) {
	root, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const id = "7d798138"
	want := map[string]string{
		"chunks":   filepath.Join(root.Dir(), "matches", id, "chunks"),
		"manifest": filepath.Join(root.Dir(), "matches", id, "manifest.json"),
		"stats":    filepath.Join(root.Dir(), "matches", id, "stats.json"),
		"replay":   filepath.Join(root.Dir(), "matches", id, "replay.json.gz"),
		"meta":     filepath.Join(root.Dir(), "matches", id, "match.json"),
		"mesh":     filepath.Join(root.Dir(), "maps", "sgh_interlock.glb"),
	}
	got, err := matchPaths(root, id)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("path %s = %q, want %q", k, got[k], v)
		}
	}
	// The data directory was created with its two subfolders.
	if _, err := os.Stat(filepath.Join(root.Dir(), "matches")); err != nil {
		t.Errorf("matches/ not created: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root.Dir(), "maps")); err != nil {
		t.Errorf("maps/ not created: %v", err)
	}
}

func matchPaths(r *Root, id string) (map[string]string, error) {
	ch, e1 := r.MatchChunksDir(id)
	man, e2 := r.MatchManifestPath(id)
	st, e3 := r.MatchStatsPath(id)
	rep, e4 := r.MatchReplayPath(id)
	meta, e5 := r.MatchMetaPath(id)
	for _, e := range []error{e1, e2, e3, e4, e5} {
		if e != nil {
			return nil, e
		}
	}
	mesh, e6 := r.MeshPath("sgh_interlock", meshjobs.QualityStandard)
	if e6 != nil {
		return nil, e6
	}
	return map[string]string{"chunks": ch, "manifest": man, "stats": st, "replay": rep, "meta": meta, "mesh": mesh}, nil
}

// TestPathTraversal — a match id (or module key) with a separator is rejected, so no path
// can escape the data directory.
func TestPathTraversal(t *testing.T) {
	root, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"../etc", "a/b", "a\\b", ".."} {
		if _, err := root.MatchReplayPath(id); err == nil {
			t.Errorf("MatchReplayPath(%q) succeeded, want an error", id)
		}
		if _, err := root.MatchMetaPath(id); err == nil {
			t.Errorf("MatchMetaPath(%q) succeeded, want an error", id)
		}
	}
	if _, err := root.MeshPath("../evil", meshjobs.QualityStandard); err == nil {
		t.Error("MeshPath with a traversal succeeded, want an error")
	}
}

// TestMeshPathQuality — standard keeps the <module>.glb name, high gets its own file
// (<module>.high.glb) beside it.
func TestMeshPathQuality(t *testing.T) {
	root, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	std, err := root.MeshPath("sgh_interlock", meshjobs.QualityStandard)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(root.MapsDir(), "sgh_interlock.glb"); std != want {
		t.Errorf("standard path = %q, want %q", std, want)
	}
	high, err := root.MeshPath("sgh_interlock", meshjobs.QualityHigh)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(root.MapsDir(), "sgh_interlock.high.glb"); high != want {
		t.Errorf("high path = %q, want %q", high, want)
	}
}

// TestWriteFileAtomic — WriteFile writes the bytes, overwrites in place, leaves no temp
// files behind, and creates parent directories.
func TestWriteFileAtomic(t *testing.T) {
	root, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root.Dir(), "matches", "abc", "replay.json.gz")
	if err := root.WriteFile(target, []byte("first")); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(target); string(b) != "first" {
		t.Fatalf("content = %q, want first", b)
	}
	// Overwrite.
	if err := root.WriteFile(target, []byte("second-longer")); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(target); string(b) != "second-longer" {
		t.Fatalf("overwrite = %q, want second-longer", b)
	}
	// No stray temp files.
	entries, _ := os.ReadDir(filepath.Dir(target))
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".tmp-") {
			t.Errorf("stray temp file left behind: %s", e.Name())
		}
	}
}

// TestWriteCopy — WriteCopy streams a file to its destination atomically.
func TestWriteCopy(t *testing.T) {
	root, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(t.TempDir(), "chunk_00.bin")
	if err := os.WriteFile(src, []byte{1, 2, 3, 4, 5}, 0o644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(root.Dir(), "matches", "abc", "chunks", "chunk_00.bin")
	if err := root.WriteCopy(dst, src); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(dst); !reflect.DeepEqual(b, []byte{1, 2, 3, 4, 5}) {
		t.Fatalf("copied = %v, want 1..5", b)
	}
}

// TestWriteStream — WriteStream streams a reader to its destination atomically, returns
// the byte count, and a mid-copy failure leaves no file behind (no temp, no partial).
func TestWriteStream(t *testing.T) {
	root, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("streamed-clip-bytes")
	dst := filepath.Join(root.MatchesDir(), "abc", "exports", "run-one.mp4")
	n, err := root.WriteStream(dst, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if n != int64(len(payload)) {
		t.Fatalf("bytes written = %d, want %d", n, len(payload))
	}
	if b, err := os.ReadFile(dst); err != nil || !reflect.DeepEqual(b, payload) {
		t.Fatalf("content = %q (err=%v), want the streamed bytes", b, err)
	}
	// No stray temp files.
	entries, _ := os.ReadDir(filepath.Dir(dst))
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".tmp-") {
			t.Errorf("stray temp file left behind: %s", e.Name())
		}
	}
}

// TestWriteStreamFailure — a reader that fails mid-copy leaves no file at the destination
// and no temp file in its directory.
func TestWriteStreamFailure(t *testing.T) {
	root, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(root.MatchesDir(), "abc", "exports", "run-one.mp4")
	_, err = root.WriteStream(dst, &failingReader{failAt: 4})
	if err == nil {
		t.Fatal("WriteStream with a failing reader succeeded, want an error")
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("destination file exists after a failed stream (stat err=%v)", err)
	}
	dir := filepath.Dir(dst)
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.Name() == "run-one.mp4" || strings.HasPrefix(e.Name(), ".tmp-") {
			t.Errorf("file left behind after a failed stream: %s", e.Name())
		}
	}
}

// failingReader reads failAt bytes and then fails, to drive WriteStream into a mid-copy
// error.
type failingReader struct {
	read   int
	failAt int
}

func (f *failingReader) Read(p []byte) (int, error) {
	if f.read >= f.failAt {
		return 0, errors.New("stream failed mid-copy")
	}
	n := len(p)
	if n > f.failAt-f.read {
		n = f.failAt - f.read
	}
	copy(p, []byte("abcdefg"))
	f.read += n
	return n, nil
}

// TestListMatchesOrder — the listing is newest-import first, skips folders without a
// summary, and an empty store lists nothing.
func TestListMatchesOrder(t *testing.T) {
	root, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if ms, err := root.ListMatches(); err != nil || len(ms) != 0 {
		t.Fatalf("empty store: %d matches, err=%v", len(ms), err)
	}
	old := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	new := old.Add(2 * time.Hour)
	// "old" imports first, "new" later; a folder with no summary is present but must be skipped.
	if err := root.SaveMatchMeta("aaa", Match{MatchID: "aaa", ImportedAt: old.Format(time.RFC3339)}); err != nil {
		t.Fatal(err)
	}
	if err := root.SaveMatchMeta("bbb", Match{MatchID: "bbb", ImportedAt: new.Format(time.RFC3339)}); err != nil {
		t.Fatal(err)
	}
	_ = os.MkdirAll(filepath.Join(root.MatchesDir(), "ccc"), 0o755) // no match.json
	ms, err := root.ListMatches()
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 2 {
		t.Fatalf("listed %d matches, want 2 (the summary-less folder is skipped)", len(ms))
	}
	if ms[0].MatchID != "bbb" || ms[1].MatchID != "aaa" {
		t.Fatalf("order = [%s %s], want newest first [bbb aaa]", ms[0].MatchID, ms[1].MatchID)
	}
}

// TestMatchMetaAndReplay — the per-match readers round-trip, and a missing match is
// ErrNotFound (not a raw os error).
func TestMatchMetaAndReplay(t *testing.T) {
	root, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	m := Match{MatchID: "abc", MapName: "Live Fire", MapModule: "sgh_interlock", Build: "HI_1_13_0",
		DurationMS: 120000, Players: []Player{{Name: "jordan", TeamID: 0}}, ImportedAt: "2026-01-01T00:00:00Z"}
	if err := root.SaveMatchMeta("abc", m); err != nil {
		t.Fatal(err)
	}
	got, err := root.MatchMeta("abc")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, m) {
		t.Fatalf("meta = %+v, want %+v", got, m)
	}
	if err := root.WriteFile(mustReplayPath(t, root, "abc"), []byte("gz-bytes")); err != nil {
		t.Fatal(err)
	}
	if b, err := root.LoadReplay("abc"); err != nil || string(b) != "gz-bytes" {
		t.Fatalf("replay = %q, err=%v", b, err)
	}
	if _, err := root.MatchMeta("missing"); err == nil {
		t.Error("missing match: expected an error")
	}
}

func mustReplayPath(t *testing.T, r *Root, id string) string {
	t.Helper()
	p, err := r.MatchReplayPath(id)
	if err != nil {
		t.Fatal(err)
	}
	return p
}
