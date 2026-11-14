// Package webdist serves the built web viewer. The files live in the gitignored
// staging directory internal/webdist/files (a tracked placeholder keeps the directory
// present); the packaging script copies web\dist\index.html and web\dist\assets into it
// before building.
//
// The package builds in two modes:
//
//   - the default build embeds no viewer. Open and File report "no embedded viewer",
//     and a plain `go build ./...` or `go test ./...` never needs the web build.
//   - a build with the embedweb tag embeds the staged files.
package webdist

import (
	"fmt"
	"io/fs"
	"os"
	"path"
	"sort"
	"strings"
)

// ErrNotEmbedded is the error File and Index return when the build embeds no viewer.
var ErrNotEmbedded = fmt.Errorf("webdist: no embedded viewer")

// Files is the embedded web viewer. Without the embedweb tag it is nil.
var Files fs.FS

// Open opens the embedded viewer. The boolean is false when the build embeds no
// viewer.
func Open() (fs.FS, bool) {
	return Files, Files != nil
}

// Available reports whether this build embeds a viewer.
func Available() bool {
	return Files != nil
}

// File returns the embedded file named by name, or ErrNotEmbedded when the build
// embeds no viewer, or os.ErrNotExist when the tree holds no such file.
func File(name string) ([]byte, error) {
	if Files == nil {
		return nil, ErrNotEmbedded
	}
	f, err := Files.Open(name)
	if err != nil {
		return nil, os.ErrNotExist
	}
	defer f.Close()
	return readFile(f)
}

// Index returns the embedded index.html, or ErrNotEmbedded when the build embeds no
// viewer.
func Index() ([]byte, error) {
	return File("index.html")
}

// List returns the embedded file names, sorted; nil when the build embeds no viewer.
// Directory entries are not listed.
func List() []string {
	if Files == nil {
		return nil
	}
	var names []string
	err := fs.WalkDir(Files, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			names = append(names, path.Clean(p))
		}
		return nil
	})
	if err != nil {
		return nil
	}
	sort.Strings(names)
	return names
}

// IsClientRoute reports whether name is a client-side path the viewer's index.html
// must answer: a non-API, non-file path. The prefixes the server keeps for itself
// (/api/ and /static/) are never client routes, and neither is a path that names a
// file of the embedded tree. Every other path, including the root and unknown
// deep links, is a client route.
func IsClientRoute(name string, files []string) bool {
	if strings.HasPrefix(name, "/api/") || strings.HasPrefix(name, "/static/") {
		return false
	}
	clean := path.Clean("/" + strings.TrimPrefix(name, "/"))
	if clean == "/" {
		return true
	}
	for _, f := range files {
		if clean == "/"+f {
			return false
		}
	}
	return true
}
