//go:build windows

// Package haloauth stores Halo credentials for the current Windows user.
package haloauth

import (
	"fmt"
	"os"
	"path/filepath"
	"unsafe"

	"github.com/llampwall/infinite-theater-3d/internal/store"
	"golang.org/x/sys/windows"
)

// Save encrypts credentials with the current Windows user's DPAPI key.
func Save(dir string, credentials []byte) error {
	if len(credentials) == 0 {
		return fmt.Errorf("credentials are empty")
	}
	in := windows.DataBlob{Size: uint32(len(credentials)), Data: &credentials[0]}
	var out windows.DataBlob
	if err := windows.CryptProtectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return fmt.Errorf("encrypt credentials: %w", err)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	root, err := store.New(dir)
	if err != nil {
		return err
	}
	return root.WriteFile(filepath.Join(dir, "auth", "tokens.dat"), unsafe.Slice(out.Data, out.Size))
}

// Load decrypts credentials previously saved by the same Windows user.
func Load(dir string) ([]byte, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "auth", "tokens.dat"))
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("encrypted credentials are empty")
	}
	in := windows.DataBlob{Size: uint32(len(raw)), Data: &raw[0]}
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, fmt.Errorf("decrypt credentials: %w", err)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...), nil
}
