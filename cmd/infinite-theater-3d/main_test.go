// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestRun(t *testing.T) {
	if err := run([]string{"decode-info", filepath.Join("..", "..", "third_party", "film-decoder", "replay", "testdata", "minifilm_fb1a1a72")}); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"decode-info"}); err == nil || !strings.Contains(err.Error(), "usage:") {
		t.Fatalf("missing argument: %v", err)
	}
	if err := run([]string{"decode-info", "missing-directory"}); err == nil {
		t.Fatal("missing directory succeeded")
	}
}
