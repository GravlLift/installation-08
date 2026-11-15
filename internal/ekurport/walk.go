package ekurport

import (
	"os"
	"path/filepath"
	"strings"
)

// isModulePath reports whether the file at p is one Ekur opens, matching
// crates/ekur/src/utils.rs load_modules exactly: the name ends in ".module" and the full
// path does not contain the substring "ds". The "ds" test is on the whole path (not just a
// directory component), which is how Ekur writes it -- so a deploy root whose own path
// contains "ds" would exclude everything, and this reproduces that faithfully.
func isModulePath(p string) bool {
	return strings.HasSuffix(p, ".module") && !strings.Contains(p, "ds")
}

// modulePaths walks root depth-first and returns the .module files Ekur would open, in
// visit order. It is the deterministic stand-in for walkdir's default order: filepath.Walk
// lists each directory in lexical order, which on Windows/NTFS mirrors the name-ordered
// enumeration walkdir sees. See the package doc for why the ordering only affects which
// duplicate wins, never the id set.
func modulePaths(root string) ([]string, error) {
	var paths []string
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		if isModulePath(path) {
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
