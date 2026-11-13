package main

// import_sounds.go — the `import-sounds` subcommand: copy a folder of replay
// sound .ogg files into the data directory, where the sound route serves
// them.
//
// The set cannot be rebuilt from the game install: the files are
// hand-produced (decoded, assembled, picked by ear) and their inputs are
// lost. The command copies whatever the folder holds, keeping any subfolder
// structure, skips files already present and identical, and logs the counts.
// The copy lands in the gitignored data directory; it is never committed.

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// importSoundsFlags is the parsed form of the `import-sounds` arguments.
type importSoundsFlags struct {
	from    string
	dataDir string
}

// parseImportSoundsFlags turns `import-sounds` arguments into
// importSoundsFlags. The source folder is required; the data directory
// resolves the usual way (--data, then IT3D_DATA_DIR, then the checkout).
func parseImportSoundsFlags(args []string) (importSoundsFlags, error) {
	fs := flag.NewFlagSet("import-sounds", flag.ContinueOnError)
	var f importSoundsFlags
	fs.StringVar(&f.from, "from", "", "folder holding the replay sound .ogg files (required)")
	fs.StringVar(&f.dataDir, "data", "", dataDirHelp)
	err := fs.Parse(args)
	if err != nil {
		return f, err
	}
	if f.from == "" {
		return f, fmt.Errorf("--from is required")
	}
	return f, nil
}

// runImportSounds copies the .ogg set from the folder the user points at
// into the data directory and logs the counts (copied, skipped identical).
func runImportSounds(args []string) error {
	f, err := parseImportSoundsFlags(args)
	if err != nil {
		return err
	}
	dataDir, err := dataDirFor(f.dataDir)
	if err != nil {
		return err
	}
	root, err := store.New(dataDir)
	if err != nil {
		return err
	}
	copied, skipped, err := copySounds(root, f.from, soundsDir(dataDir))
	if err != nil {
		return err
	}
	slog.Info("import-sounds: sounds imported",
		"from", f.from, "to", soundsDir(dataDir), "copied", copied, "skipped", skipped)
	return nil
}

// copySounds walks srcDir and copies every .ogg file into dstDir, keeping
// any subfolder structure the source has. A file already present in dstDir
// and identical byte for byte is skipped (a re-run of the import therefore
// copies nothing); a present but different file replaces it, atomically
// (the store's temp-file-then-rename), so a half-written sound is never
// served. It returns the number of files copied and the number skipped.
func copySounds(root *store.Root, srcDir, dstDir string) (copied, skipped int, err error) {
	err = filepath.WalkDir(srcDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() || !soundFile(d.Name()) {
			return nil
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		dst := filepath.Join(dstDir, rel)
		same, err := sameFile(path, dst)
		if err != nil {
			return fmt.Errorf("compare %s: %w", rel, err)
		}
		if same {
			skipped++
			return nil
		}
		if err := root.WriteCopy(dst, path); err != nil {
			return fmt.Errorf("copy %s: %w", rel, err)
		}
		copied++
		return nil
	})
	return copied, skipped, err
}

// sameFile says whether two files exist and hold identical bytes. A missing
// file on either side is not identical (no error); a file that exists but
// cannot be read is an error.
func sameFile(a, b string) (bool, error) {
	fa, err := os.Stat(a)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	fb, err := os.Stat(b)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	if fa.Size() != fb.Size() {
		return false, nil
	}
	ra, err := os.Open(a)
	if err != nil {
		return false, err
	}
	defer ra.Close()
	rb, err := os.Open(b)
	if err != nil {
		return false, err
	}
	defer rb.Close()
	rawA, err := io.ReadAll(ra)
	if err != nil {
		return false, err
	}
	rawB, err := io.ReadAll(rb)
	if err != nil {
		return false, err
	}
	return bytes.Equal(rawA, rawB), nil
}
