package weapons

// write.go holds the small shared helpers the library build uses: an atomic file write (temp
// name then rename, so a reader never sees a half-written GLB) and the GLB extras the view
// expects (the axes mapping, matching the single-weapon build).

import (
	"fmt"
	"os"
	"path/filepath"
)

// ioWriter is the slice of the write target writeFile needs.
type ioWriter = interface{ Write([]byte) (int, error) }

// axesGLB is the axis mapping the view reads from every GLB's extras, under the key "axes"
// (the same string the map and weapon single-builds publish).
const axesGLB = "gltf(x, y, z) = halo(x, z, -y)"

// withAxes returns extras with the axes mapping added, so every library GLB carries it.
func withAxes(extras map[string]any) map[string]any {
	out := make(map[string]any, len(extras)+1)
	for k, v := range extras {
		out[k] = v
	}
	out["axes"] = axesGLB
	return out
}

// writeFile writes what `write` produces under path+".tmp" then renames it, and returns its
// size. A crash mid-write never leaves a torn file.
func writeFile(path string, write func(ioWriter) error) (int64, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, fmt.Errorf("directory: %w", err)
	}
	tmp := path + ".tmp"
	f, err := os.Create(tmp) //nolint:gosec // cache path, set by the caller
	if err != nil {
		return 0, fmt.Errorf("create: %w", err)
	}
	if err := write(f); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return 0, err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return 0, fmt.Errorf("close: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return 0, fmt.Errorf("rename: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return 0, fmt.Errorf("written file unreadable: %w", err)
	}
	return info.Size(), nil
}
