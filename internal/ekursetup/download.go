package ekursetup

// download.go — the two downloads (the pinned dumper and the lists) and the dumper's
// verification. A download lands in a .part file and is renamed into place only when it
// completed, so a cached file is always a whole one.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/safefs"
)

// maxListBytes bounds one list download (the published lists are a few megabytes).
const maxListBytes = 256 << 20

// download fetches url into dest through dest+".part", reading at most limit bytes (a
// longer body is cut, so an oversized dumper fails its size check rather than filling the
// disk). Any failure removes the partial file and wraps ErrDownload.
func download(ctx context.Context, client *http.Client, url, dest string, limit int64) error {
	part := dest + ".part"
	fail := func(err error) error {
		_ = os.Remove(part)
		return fmt.Errorf("%w: %s: %v", ErrDownload, url, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fail(err)
	}
	req.Header.Set("User-Agent", "infinite-theater-3d")
	resp, err := client.Do(req)
	if err != nil {
		return fail(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fail(fmt.Errorf("HTTP %d", resp.StatusCode))
	}
	f, err := os.Create(part)
	if err != nil {
		return fail(err)
	}
	n, copyErr := io.Copy(f, io.LimitReader(resp.Body, limit))
	closeErr := f.Close()
	if copyErr != nil {
		return fail(copyErr)
	}
	if closeErr != nil {
		return fail(closeErr)
	}
	if n == 0 {
		return fail(fmt.Errorf("empty response"))
	}
	if err := os.Rename(part, dest); err != nil {
		return fail(err)
	}
	return nil
}

// verifyFile checks that path has the pin's size and SHA-256.
func verifyFile(path string, pin Pin) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%s is not a regular file", pin.Name)
	}
	if info.Size() != pin.Size {
		return fmt.Errorf("size %d bytes, want %d", info.Size(), pin.Size)
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); !strings.EqualFold(got, pin.SHA256) {
		return fmt.Errorf("sha256 %s, want %s", got, pin.SHA256)
	}
	return nil
}

// removeTree removes a folder this package created or replaced, never following a symlink
// or junction.
func removeTree(path, what string) error {
	return safefs.RemoveTree(path, what)
}
