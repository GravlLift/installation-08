// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build embedweb

package webdist

import (
	"embed"
	"io/fs"
)

// staged is the staged web viewer: index.html and assets, copied from web\dist by
// tools\package.ps1 before the tagged build. The gitignored directory holds a tracked
// placeholder, so the embed never fails on a clean checkout.
//
//go:embed files
var staged embed.FS

func init() {
	sub, err := fs.Sub(staged, "files")
	if err != nil {
		panic("webdist: embedded tree has no files directory: " + err.Error())
	}
	files = sub
}
