// Package safefs removes a folder tree without ever following a symlink or a directory
// junction. Windows junctions look like folders, and a recursive delete that follows one
// deletes whatever it points at; every tree removal in this program goes through RemoveTree.
package safefs

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// RemoveTree removes path and everything under it, refusing to follow a symlink or a
// directory junction: any reparse point found in the walk leaves the tree untouched and the
// error says so (what names the tree in that message). A path that is itself a symlink or a
// junction is unlinked, never followed. A missing path is not an error.
func RemoveTree(path, what string) error {
	info, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if !info.Mode().IsDir() {
		// A symlink or a junction is not a directory (neither is a file): remove the link
		// itself, never what it points at.
		return os.Remove(path)
	}
	// The first walk only inspects: a symlink or junction anywhere leaves the tree
	// untouched (WalkDir reports its error, which stops the walk at that entry).
	if err := filepath.WalkDir(path, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		// Since Go 1.23 a Windows junction reports ModeIrregular rather than ModeSymlink:
		// refuse both, and any other reparse point.
		if d.Type()&(fs.ModeSymlink|fs.ModeIrregular) != 0 {
			return errors.New(what + " contains a symlink or junction (" + d.Name() + "); refusing to follow it")
		}
		return nil
	}); err != nil {
		return err
	}
	// The second walk deletes: files first, then each directory once it is empty
	// (bottom-up, because WalkDir visits a directory before its children).
	if err := filepath.WalkDir(path, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			return os.Remove(p)
		}
		return nil
	}); err != nil {
		return err
	}
	// Remove the now-empty directories, deepest first (the reverse of the walk order).
	var dirs []string
	_ = filepath.WalkDir(path, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() && p != path {
			dirs = append(dirs, p)
		}
		return nil
	})
	for i := len(dirs) - 1; i >= 0; i-- {
		if err := os.Remove(dirs[i]); err != nil {
			return err
		}
	}
	return os.Remove(path)
}
