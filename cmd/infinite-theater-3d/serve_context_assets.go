// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"net/http"
	"path/filepath"
	"strings"
)

func (h serverHandlers) serveContextAsset(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) != 5 || parts[3] != "halo_infinite" || (!strings.HasSuffix(parts[4], ".png") && !strings.HasSuffix(parts[4], ".jpg")) || strings.ContainsAny(parts[4], "/\\:") || strings.HasPrefix(parts[4], ".") {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filepath.Join(h.root.Dir(), "static", parts[2], parts[3], parts[4]))
}
