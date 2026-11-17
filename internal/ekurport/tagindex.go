// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package ekurport is piece 1 of the Ekur port: a deploy-wide index of every tag in
// the game's .module archives, so the coating builders need no second program.
//
// Ekur (TheHaloArchive, GPL-3.0-or-later) is the reference; this package reproduces the
// two decisions that later pieces depend on, and nothing else: which modules to open, and
// which copy of a duplicated tag to keep.
//
// It walks the deploy folder and opens every .module the way Ekur does
// (crates/ekur/src/utils.rs load_modules, GPL-3.0-or-later, Copyright (c) 2026 The
// Halo Archive): a recursive walk of regular files whose name ends in ".module", skipping
// any path that contains the substring "ds" (Ekur's way of dropping the dedicated-server
// build under deploy/ds). A module that cannot be opened is an error, never a silent skip:
// Ekur propagates the open failure up the whole load (utils.rs load_modules uses `?`).
//
// One deliberate deviation from Ekur: the "ds" test is applied to each path relative to
// the deploy root, not to the full path. Ekur's full-path test drops every module when the
// install location itself contains "ds" (a drive folder like D:\, a user name like
// "Edson", D:\Games\Mods), so real users would index nothing. The relative test keeps the
// set of modules opened inside the deploy identical to Ekur's; only <deploy>\ds is
// dropped. See isModulePath in walk.go.
//
// For a tag duplicated across modules Ekur keeps the LAST copy it sees: get_tags walks the
// modules in order and overwrites a HashMap keyed by tag id (utils.rs:33-51). This index
// does the same, assigning entries in walk order so the final occurrence wins.
//
// Ekur walks with walkdir in default (operating-system) order. This index uses
// filepath.Walk, which lists each directory in lexical order; on Windows/NTFS the
// enumeration order is name-ordered too, so a sorted walk is the closest deterministic
// match. The walk order only decides which copy of a duplicated tag wins; it never changes
// the set of ids a group contains, which is what the tests compare against.
package ekurport

import (
	"fmt"
	"sort"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

// TagIndex indexes every entry of the deploy's .module files by (signed) GlobalID, keeping
// for each id the module and entry Ekur would read.
type TagIndex struct {
	modules []*himodule.Module
	paths   []string
	entries map[int32]entryRef
}

// entryRef names the module that owns a GlobalID and the entry to read from it.
type entryRef struct {
	module int
	file   himodule.File
}

// OpenTagIndex walks deployRoot, opens every .module Ekur would open (see package doc),
// and indexes their entries by GlobalID with Ekur's last-copy-wins rule. It fails on the
// first unreadable module, after closing the ones already opened.
func OpenTagIndex(deployRoot string) (*TagIndex, error) {
	paths, err := modulePaths(deployRoot)
	if err != nil {
		return nil, fmt.Errorf("ekurport: walk %s: %w", deployRoot, err)
	}
	idx := &TagIndex{entries: make(map[int32]entryRef)}
	for _, p := range paths {
		m, err := himodule.Open(p)
		if err != nil {
			_ = idx.Close()
			return nil, fmt.Errorf("ekurport: open %s: %w", p, err)
		}
		i := len(idx.modules)
		idx.modules = append(idx.modules, m)
		idx.paths = append(idx.paths, p)
		for _, f := range m.Files("") {
			// Assign in visit order; the last occurrence of an id overwrites the earlier
			// ones, matching Ekur's get_tags HashMap insert.
			idx.entries[int32(f.GlobalID)] = entryRef{module: i, file: f}
		}
	}
	return idx, nil
}

// IDs returns every GlobalID in group (a four-char tag group such as "mat "), sorted
// ascending as a signed int32. The set is deduplicated: one id per tag.
func (idx *TagIndex) IDs(group string) []int32 {
	ids := make([]int32, 0, len(idx.entries))
	for id, e := range idx.entries {
		if e.file.Group == group {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(a, b int) bool { return ids[a] < ids[b] })
	return ids
}

// Group returns the four-char group of id, and whether id is present in the index.
func (idx *TagIndex) Group(id int32) (string, bool) {
	e, ok := idx.entries[id]
	if !ok {
		return "", false
	}
	return e.file.Group, true
}

// Extract returns the decompressed bytes of id (header, tag data, and resource data, as
// laid out in the entry) -- the same bytes himap's ModuleIndex.Extract returns.
func (idx *TagIndex) Extract(id int32) ([]byte, error) {
	e, ok := idx.entries[id]
	if !ok {
		return nil, fmt.Errorf("ekurport: id %d not present in the index", id)
	}
	return idx.modules[e.module].Extract(e.file)
}

// Close releases every module and returns the first error encountered, after attempting
// to close all of them. The index is empty and must not be used afterwards.
func (idx *TagIndex) Close() error {
	var first error
	for _, m := range idx.modules {
		if err := m.Close(); err != nil && first == nil {
			first = err
		}
	}
	idx.modules, idx.paths, idx.entries = nil, nil, nil
	return first
}
