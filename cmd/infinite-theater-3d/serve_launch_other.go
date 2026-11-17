// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build !windows

package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"syscall"
)

// lockFile takes an exclusive, non-blocking advisory lock on path; the system releases it
// when the process ends.
func lockFile(path string) (io.Closer, error) {
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return nil, fmt.Errorf("lock the data folder: %w", err)
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, errDataDirBusy
		}
		return nil, fmt.Errorf("lock the data folder: %w", err)
	}
	return f, nil
}
