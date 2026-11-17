// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package webdist holds the built web viewer for the packaged program. The files live in
// the gitignored staging directory internal/webdist/files (a tracked placeholder keeps
// the directory present); the packaging script copies web\dist\index.html and
// web\dist\assets into it before building.
//
// The package builds in two modes:
//
//   - the default build embeds no viewer, so a plain `go build ./...` or `go test ./...`
//     never needs the web build;
//   - a build with the embedweb tag embeds the staged files.
package webdist

import "io/fs"

// indexName is the viewer's entry page; a tree without it is not a viewer.
const indexName = "index.html"

// files is the embedded tree. It stays nil without the embedweb tag.
var files fs.FS

// Open returns the embedded viewer. The boolean is false when the build embeds none, or
// when the embedded tree holds no entry page (a tagged build made without staging).
func Open() (fs.FS, bool) {
	if files == nil {
		return nil, false
	}
	if _, err := fs.Stat(files, indexName); err != nil {
		return nil, false
	}
	return files, true
}
