// write.go holds the small shared helpers of the library build: the atomic
// file write (temp name then rename, so a reader never sees a half-written
// GLB or a torn index), the JSON write, and the shared texture depot, where
// every GLB's images are stored once, named by the content digest.
package spartanpieces

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// axesGLB is the axis mapping published in every GLB's extras, under the
// "axes" key (the same string the map and weapon builds publish).
const axesGLB = "gltf(x, y, z) = halo(x, z, -y)"

// writeFile writes what write produces under path+".tmp" then renames it, and
// returns its size. A crash mid-write never leaves a torn file.
func writeFile(path string, write func(io.Writer) error) (int64, error) {
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

// writeJSON writes v as compact JSON to path and returns the size written.
func writeJSON(path string, v any) (int64, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	return writeFile(path, func(w io.Writer) error {
		_, err := w.Write(raw)
		return err
	})
}

// fileTexture is the depot file name of a shared image: the first 16 hex
// digits of its content digest, and its extension (png, jpg).
func fileTexture(digest [32]byte, extension string) string {
	return filePrefixTexture + hex.EncodeToString(digest[:])[:digestLength] + "." + extension
}

// textureDepot stores each image once, named by the digest of its content.
type textureDepot struct {
	dir        string
	vues       map[string]bool
	fichiers   int
	octets     int64
	references int
}

// depose stores the image (when this build has not stored it yet) and returns
// its name, a URI relative to the GLB that names it.
func (d *textureDepot) depose(data []byte, mime string) (string, error) {
	extension := map[string]string{"image/png": "png", "image/jpeg": "jpg"}[mime]
	if extension == "" {
		return "", fmt.Errorf("image of type %q: neither PNG nor JPEG", mime)
	}
	d.references++
	digest := sha256.Sum256(data)
	name := fileTexture(digest, extension)
	if d.vues[name] {
		return name, nil
	}
	n, err := writeFile(filepath.Join(d.dir, name), func(w io.Writer) error {
		_, err := w.Write(data)
		return err
	})
	if err != nil {
		return "", fmt.Errorf("image %s: %w", name, err)
	}
	d.vues[name] = true
	d.fichiers++
	d.octets += n
	return name, nil
}
