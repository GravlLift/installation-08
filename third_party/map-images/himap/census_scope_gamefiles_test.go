// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

// LOCAL-CHANGE (infinite-theater-3d): the census scope of The Library's himap copy, ported
// (2026-11-21) with the bitmap census and trimmed to what that census reads.
//
// census_scope_gamefiles_test.go — the scope a census reads: the whole installation. The base
// modules (default and Forge) stay open in one ModuleIndex; every other module of the installation
// (map modules under `levels`, the `compositions` modules, the dedicated-server `ds/globals`) is
// opened one at a time, read-only, as a module file: its index and the extraction of the tags a
// census reads, nothing that renders. Each is closed before the next opens, and none is opened
// while free physical memory is under censusMinFreeRAM.
package himap

import (
	"io/fs"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

// censusMinFreeRAM is the free physical memory under which a census opens no other module: the
// test is skipped instead.
const censusMinFreeRAM = 12 << 30

// censusNullGlobalID is the GlobalID of a resource entry (not a tag).
const censusNullGlobalID = 0xffffffff

// censusVariants are the deploy variants walked for other modules, in the order their copies are
// preferred: the `pc` copy of a tag is the one read, then `any`, then the stripped `ds` build.
var censusVariants = []string{"pc", "any", "ds"}

// scopeTag is what the scope knows of one GlobalID across every module.
type scopeTag struct {
	groups []string // distinct groups its copies carry, the first copy's first
	module int      // index in censusScope.modules of the module holding the first copy
}

// censusScope indexes every tag of every module of the installation by GlobalID. The base modules
// are modules[:nBase] and stay open in base; the others are opened only while scanned or read.
// Base modules are registered first, so a tag whose first copy is outside them has none in them.
type censusScope struct {
	deploy  string
	base    *ModuleIndex
	nBase   int
	modules []string
	tags    map[uint32]*scopeTag
	// opened counts the openings of other modules (index scan and tag reads together).
	opened int
}

// censusModules returns the default and Forge modules: the top-level modules of `pc/globals`,
// every module under `any/globals`, and the modules of `pc/globals/forge`.
func censusModules(t *testing.T, deploy string) []string {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(deploy, "pc", "globals", "*.module"))
	if err != nil {
		t.Fatal(err)
	}
	err = filepath.WalkDir(filepath.Join(deploy, "any", "globals"), func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && filepath.Ext(p) == ".module" {
			paths = append(paths, p)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	forge, err := filepath.Glob(filepath.Join(deploy, "pc", "globals", "forge", "*.module"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(forge)
	return append(paths, forge...)
}

// openWholeScope opens the census scope over the base modules of censusModules, skipping the test
// when no installation is found.
func openWholeScope(t *testing.T) *censusScope {
	t.Helper()
	deploy, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	return openCensusScope(t, deploy, censusModules(t, deploy))
}

// openCensusScope opens the base modules basePaths in one index and scans the index of every
// other module of the installation, one at a time. It skips the test when free memory is short,
// and closes the base index when the test ends.
func openCensusScope(t *testing.T, deploy string, basePaths []string) *censusScope {
	t.Helper()
	base, err := NewModuleIndex(basePaths...)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Close() })
	s := &censusScope{deploy: deploy, base: base, nBase: len(basePaths), tags: map[uint32]*scopeTag{}}
	for i, m := range base.modules {
		s.modules = append(s.modules, basePaths[i])
		s.register(i, m.Files(""))
	}
	for _, p := range otherModules(t, deploy, basePaths) {
		s.modules = append(s.modules, p)
		i := len(s.modules) - 1
		s.withModule(t, i, func(m *himodule.Module) { s.register(i, m.Files("")) })
	}
	return s
}

// otherModules lists every `.module` under the deploy variants that is not a base module, each
// variant's files in path order.
func otherModules(t *testing.T, deploy string, basePaths []string) []string {
	t.Helper()
	isBase := map[string]bool{}
	for _, p := range basePaths {
		isBase[strings.ToLower(filepath.Clean(p))] = true
	}
	var out []string
	for _, v := range censusVariants {
		err := filepath.WalkDir(filepath.Join(deploy, v), func(p string, d fs.DirEntry, err error) error {
			if err == nil && !d.IsDir() && filepath.Ext(p) == ".module" && !isBase[strings.ToLower(filepath.Clean(p))] {
				out = append(out, p)
			}
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	return out
}

// withModule checks free memory, opens module i of the scope, hands it to fn and closes it.
func (s *censusScope) withModule(t *testing.T, i int, fn func(m *himodule.Module)) {
	t.Helper()
	free, err := freePhysicalRAM()
	if err != nil {
		t.Skipf("free physical memory unknown (%v): no other module opened", err)
	}
	if free < censusMinFreeRAM {
		t.Skipf("free physical memory %.1f GB, under %d GB: %s not opened", float64(free)/(1<<30), censusMinFreeRAM>>30, s.rel(i))
	}
	m, err := himodule.Open(s.modules[i])
	if err != nil {
		t.Fatalf("open %s: %v", s.rel(i), err)
	}
	s.opened++
	defer func() { _ = m.Close() }()
	fn(m)
}

// register records the tag entries of module i: a new GlobalID gets its first copy, a known one
// adds the group of its copy when it differs. Entries with no printable group or a null GlobalID
// are resource entries, not tags, and are left out.
func (s *censusScope) register(i int, files []himodule.File) {
	for _, f := range files {
		if f.Group == "" || f.GlobalID == censusNullGlobalID {
			continue
		}
		e := s.tags[f.GlobalID]
		if e == nil {
			s.tags[f.GlobalID] = &scopeTag{groups: []string{f.Group}, module: i}
			continue
		}
		if !slices.Contains(e.groups, f.Group) {
			e.groups = append(e.groups, f.Group)
		}
	}
}

// rel is the path of module i relative to the deploy root, with forward slashes.
func (s *censusScope) rel(i int) string {
	r, err := filepath.Rel(s.deploy, s.modules[i])
	if err != nil {
		return s.modules[i]
	}
	return filepath.ToSlash(r)
}

// area is the first two path components of module i ("pc/levels", "ds/globals"...).
func (s *censusScope) area(i int) string {
	if i < s.nBase {
		return "default+Forge"
	}
	parts := strings.SplitN(s.rel(i), "/", 3)
	if len(parts) < 2 {
		return parts[0]
	}
	return parts[0] + "/" + parts[1]
}

// groupCount returns the number of distinct GlobalIDs of group g in the scope.
func (s *censusScope) groupCount(g string) int {
	n := 0
	for _, e := range s.tags {
		if e.groups[0] == g {
			n++
		}
	}
	return n
}
