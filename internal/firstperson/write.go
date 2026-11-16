package firstperson

// write.go holds the small shared helpers the library build uses: an atomic file write
// (temp name then rename, so a reader never sees a half-written GLB or a torn index) and
// the shared texture depot, where every rig's images are stored once, named by the content
// digest.

import (
	"fmt"
	"os"
	"path/filepath"
)

// ioWriter is the slice of the write target writeFile needs.
type ioWriter = interface{ Write([]byte) (int, error) }

// axesGLB is the axis mapping the view reads from every GLB's extras, under the key "axes"
// (the same string the map and weapon builds publish).
const axesGLB = "gltf(x, y, z) = halo(x, z, -y)"

// axesGLBKey is the extras key of the axis mapping.
const axesGLBKey = "axes"

// RigWeaponKey is the material extras key a rig sets (true) on its weapon's raw, styled
// hard surfaces: the viewer paints them with the weapon's coating and tells them from the
// arms (also raw) by it.
const RigWeaponKey = "rigWeapon"

// writeFile writes what `write` produces under path+".tmp" then renames it, and returns
// its size. A crash mid-write never leaves a torn file.
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

// writeFileIfAbsent atomically writes data to path only when path is not present; it
// returns whether it wrote. A file from a previous (possibly interrupted) build is kept
// as is, so a build is resumable: the files already built are the ones on disk.
func writeFileIfAbsent(path string, data []byte) (bool, error) {
	if _, err := os.Stat(path); err == nil {
		return false, nil
	}
	_, err := writeFile(path, func(w ioWriter) error {
		_, werr := w.Write(data)
		return werr
	})
	return err == nil, err
}

// depot range chaque image du rig une fois, nommée par l'empreinte de son contenu : deux
// rigs qui partagent une image (les masques des bras, les textures de l'arme) partagent
// le fichier.
type depot struct {
	dir        string
	vues       map[string]bool
	fichiers   int
	octets     int64
	references int
}

// depose écrit l'image (si elle n'est pas déjà écrite) et rend son nom, URI relative au
// GLB qui la nomme : la vue la résout contre l'URL du rig, sur la même route.
func (d *depot) depose(data []byte, mime string) (string, error) {
	// LOCAL-CHANGE (infinite-theater-3d): KTX2 images from the KTX2 pass.
	extension := map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/ktx2": "ktx2"}[mime]
	if extension == "" {
		return "", fmt.Errorf("image de type %q : ni PNG, JPEG ni KTX2", mime)
	}
	d.references++
	nom := fichierTexture(data, extension)
	if d.vues[nom] {
		return nom, nil
	}
	octets, err := writeFile(filepath.Join(d.dir, nom), func(w ioWriter) error {
		_, werr := w.Write(data)
		return werr
	})
	if err != nil {
		return "", fmt.Errorf("image %s : %w", nom, err)
	}
	d.vues[nom] = true
	d.fichiers++
	d.octets += octets
	return nom, nil
}
