package ekurport

import (
	"os"
	"path/filepath"
	"testing"
)

// TestIsModulePath pins the inclusion/exclusion rule straight from Ekur's load_modules:
// the name must end in ".module" and the full path must not contain "ds".
func TestIsModulePath(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{`C:\g\deploy\pc\globals\common.module`, true},
		{`C:\g\deploy\any\levels\multi\ridgeline-rtx-new.module`, true},
		{`C:\g\deploy\pc\globals\models.module`, true},      // "models" has no "ds" substring
		{`C:\g\deploy\pc\globals\common.module_hd1`, false}, // not a .module
		{`C:\g\deploy\pc\globals\notes.txt`, false},
		{`C:\g\deploy\ds\servers\x.module`, false},       // under deploy/ds
		{`C:\g\deploy\pc\models\dsmodule.module`, false}, // "ds" anywhere in the path
		{`C:\g\deploy\pc\ds.module`, false},
		{`C:\g\deploy\pc\.module`, true}, // edge: empty name before ".module"
	}
	for _, c := range cases {
		if got := isModulePath(c.path); got != c.want {
			t.Errorf("isModulePath(%q) = %v, want %v", c.path, got, c.want)
		}
	}
}

// TestModulePathsOrderAndExclusion builds a real tree and checks both the visit order
// (lexical within each directory) and that everything under a "ds" path is dropped.
func TestModulePathsOrderAndExclusion(t *testing.T) {
	root := t.TempDir()
	mk := func(rel string) {
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatalf("MkdirAll %s: %v", p, err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatalf("WriteFile %s: %v", p, err)
		}
	}
	mk("b.module")
	mk("a.module")
	mk("a.module_hd1")
	mk("notes.txt")
	mk("sub\\z.module")
	mk("sub\\ds\\hidden.module")
	mk("ds\\alsohidden.module")

	got, err := modulePaths(root)
	if err != nil {
		t.Fatalf("modulePaths: %v", err)
	}
	want := []string{
		filepath.Join(root, "a.module"),
		filepath.Join(root, "b.module"),
		filepath.Join(root, filepath.Join("sub", "z.module")),
	}
	if len(got) != len(want) {
		t.Fatalf("modulePaths returned %d paths, want %d:\n got %v\nwant %v", len(got), len(want), got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("modulePaths[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestWinner pins Ekur's last-copy-wins duplicate rule: for each id, the final occurrence
// in visit order is the one that survives.
func TestWinner(t *testing.T) {
	got := winner([]int32{5, 9, 5, 3, 9, 5})
	want := map[int32]int{5: 5, 9: 4, 3: 3}
	if len(got) != len(want) {
		t.Fatalf("winner returned %d entries, want %d: %v", len(got), len(want), got)
	}
	for id, pos := range want {
		if got[id] != pos {
			t.Errorf("winner[%d] = %d, want %d", id, got[id], pos)
		}
	}
}
