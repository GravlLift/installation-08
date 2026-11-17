// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build windows

package haloauth

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestStorageRoundTrip(t *testing.T) {
	dir := t.TempDir()
	secret := []byte(`{"refresh_token":"storage-test-secret"}`)
	if err := Save(dir, secret); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "auth", "tokens.dat"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, secret) || bytes.Contains(raw, []byte("storage-test-secret")) {
		t.Fatal("credentials are not encrypted")
	}
	got, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, secret) {
		t.Fatal("stored credentials changed")
	}
}
