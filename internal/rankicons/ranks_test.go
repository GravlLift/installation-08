package rankicons

import (
	"os"
	"path/filepath"
	"testing"
)

// TestIconName — the badge file names: the context's own naming rule, Onyx without a
// sub-tier, a zero sub-tier mapping to Onyx.
func TestIconName(t *testing.T) {
	cases := []struct {
		tier string
		sub  int
		want string
	}{
		{"Bronze", 1, "120px-HINF-CSR_Bronze1.png"},
		{"Bronze", 6, "120px-HINF-CSR_Bronze6.png"},
		{"Silver", 3, "120px-HINF-CSR_Silver3.png"},
		{"Gold", 2, "120px-HINF-CSR_Gold2.png"},
		{"Platinum", 5, "120px-HINF-CSR_Platinum5.png"},
		{"Diamond", 6, "120px-HINF-CSR_Diamond6.png"},
		{"Onyx", 0, "120px-HINF-CSR_Onyx.png"},
		{"Onyx", 3, "120px-HINF-CSR_Onyx.png"},
		{"Bronze", 0, "120px-HINF-CSR_Onyx.png"},
	}
	for _, c := range cases {
		if got := IconName(c.tier, c.sub); got != c.want {
			t.Errorf("IconName(%q, %d) = %q, want %q", c.tier, c.sub, got, c.want)
		}
	}
}

// TestNames — the set: 31 names, in atlas order, Bronze1 first and Onyx last.
func TestNames(t *testing.T) {
	names := Names()
	if len(names) != 31 {
		t.Fatalf("len = %d, want 31", len(names))
	}
	if names[0] != "120px-HINF-CSR_Bronze1.png" || names[30] != "120px-HINF-CSR_Onyx.png" {
		t.Fatalf("first/last = %q / %q", names[0], names[30])
	}
	seen := map[string]bool{}
	for _, n := range names {
		if seen[n] {
			t.Fatalf("duplicate name %q", n)
		}
		seen[n] = true
		if !FileValid(n) {
			t.Fatalf("FileValid(%q) = false, want true", n)
		}
	}
}

// TestFileValid — the route's allowlist.
func TestFileValid(t *testing.T) {
	for name, want := range map[string]bool{
		"120px-HINF-CSR_Bronze1.png": true,
		"120px-HINF-CSR_Onyx.png":    true,
		"120px-HINF-CSR_onyx.png":    false,
		"120px-HINF-CSR_Bronze7.png": false,
		"120px-HINF-CSR_Bronze1.PNG": false,
		"nope.png":                   false,
		"..%2f..%2findex.json":       false,
	} {
		if got := FileValid(name); got != want {
			t.Errorf("FileValid(%q) = %v, want %v", name, got, want)
		}
	}
}

// TestSetReady — every badge on disk is ready; one missing is not.
func TestSetReady(t *testing.T) {
	dataDir := t.TempDir()
	if SetReady(dataDir) {
		t.Fatal("SetReady(empty) = true")
	}
	dir := OutDir(dataDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	for _, name := range Names() {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if !SetReady(dataDir) {
		t.Fatal("SetReady(full set) = false")
	}
	if err := os.Remove(filepath.Join(dir, "120px-HINF-CSR_Gold4.png")); err != nil {
		t.Fatal(err)
	}
	if SetReady(dataDir) {
		t.Fatal("SetReady(one missing) = true")
	}
}
