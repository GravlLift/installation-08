package ekurport

import (
	"os"
	"path/filepath"
	"strings"
)

// isModulePath reports whether the deploy-relative path p is one Ekur opens: the name
// ends in ".module" and the path does not contain the substring "ds".
//
// Ekur (crates/ekur/src/utils.rs load_modules) applies the "ds" test to the full path,
// which drops everything when the deploy root itself contains "ds" -- a drive folder like
// D:\, a user name like "Edson", a path like D:\Games\Mods. We deliberately deviate here
// and test the path relative to the deploy root instead, so an install location with "ds"
// in it no longer silently skips every module. The relative path is still a plain
// substring test, so which modules are opened inside the deploy is unchanged from Ekur:
// only the dedicated-server build under <deploy>\ds is dropped.
func isModulePath(p string) bool {
	return strings.HasSuffix(p, ".module") && !strings.Contains(p, "ds")
}

// modulePaths walks root depth-first and returns the .module files Ekur would open, in
// visit order. It is the deterministic stand-in for walkdir's default order: filepath.Walk
// lists each directory in lexical order, which on Windows/NTFS mirrors the name-ordered
// enumeration walkdir sees. See the package doc for why the ordering only affects which
// duplicate wins, never the id set. The "ds" filter is applied to each path relative to
// root (see isModulePath), so a root whose own path contains "ds" does not drop modules.
func modulePaths(root string) ([]string, error) {
	var paths []string
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if isModulePath(rel) {
			paths = append(paths, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return paths, nil
}

// winner returns, for each id in order, the 0-based position of the entry that wins under
// Ekur's last-copy-wins rule: the final occurrence. It is the pure form of the indexing
// step in OpenTagIndex, extracted so the rule is testable without opening modules.
func winner(order []int32) map[int32]int {
	out := make(map[int32]int, len(order))
	for i, id := range order {
		out[id] = i
	}
	return out
}
