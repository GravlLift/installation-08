// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build windows

package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"syscall"
)

// errorSharingViolation is ERROR_SHARING_VIOLATION: another handle holds the file without
// sharing it.
const errorSharingViolation syscall.Errno = 32

// lockFile opens path with no sharing at all, so a second open (from any process) fails
// until this handle closes; Windows closes it when the process ends, even when killed.
func lockFile(path string) (io.Closer, error) {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil,
		syscall.OPEN_ALWAYS, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		if errors.Is(err, errorSharingViolation) {
			return nil, errDataDirBusy
		}
		return nil, fmt.Errorf("lock the data folder: %w", err)
	}
	return os.NewFile(uintptr(h), path), nil
}
