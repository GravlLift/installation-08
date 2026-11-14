package webdist

import (
	"io"
	"io/fs"
)

// readFile reads the whole embedded file.
func readFile(f fs.File) ([]byte, error) {
	b, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}
	return b, nil
}
