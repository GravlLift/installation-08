//go:build embedweb

package webdist

import (
	"embed"
	"io/fs"
)

// files is the staged web viewer: index.html and assets, copied from web\dist by
// tools\package.ps1 before the tagged build. The gitignored directory holds a tracked
// placeholder, so the embed never fails on a clean checkout.
//
//go:embed files
var files embed.FS

func init() {
	Files, _ = fs.Sub(files, "files")
}
