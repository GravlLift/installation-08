// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Piece 5a-1 of the Ekur port: write the five parts the coating builders read to a
// folder, in the exact layout Ekur uses. Open the tag index on a deploy root, reproduce
// globals.json, visor_data.json, stylelists/, styles/, and materials/ from the installed
// game, and write them to disk.
//
// The stylelist display names (the `name` field) come from the game's string table; the
// current modules carry none, so names fall back to the string id as a signed decimal.
// That is the only field a strings map would change, and it is not one the builders read
// (they use the default-style reference and each style's reference, keyed by id).
package ekurport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"
)

// ExportStats reports the parts WriteExport produced: one file per entry for the three
// directories, and 1 each for the two singletons; Bytes is the total written.
type ExportStats struct {
	Globals    int   `json:"globals"`
	Visor      int   `json:"visor"`
	StyleLists int   `json:"stylelists"`
	Styles     int   `json:"styles"`
	Materials  int   `json:"materials"`
	Bytes      int64 `json:"bytes"`
}

// part indexes the per-part file counts WriteExport tallies.
const (
	partGlobals = iota
	partVisor
	partStyleLists
	partStyles
	partMaterials
	numParts
)

// Tag ids of the two singleton exports (coating globals and visor).
const (
	coatingGlobalsTagID = 680672300
	visorTagID          = -1260457915
)

// writeJob names the part it feeds and lazily produces the files it writes.
type writeJob struct {
	part  int
	files func() ([]exportFile, error)
}

// exportFile is one file a job writes: its path relative to the export dir and its bytes.
type exportFile struct {
	rel  string
	data []byte
}

// WriteExport opens the tag index on deployRoot, reproduces the five Ekur export parts,
// and writes them under dir in the layout the builders read: globals.json,
// visor_data.json, stylelists/<id>.json, styles/<ref>.json, materials/<id>.json. The
// material files carry only textures and style_info, the two fields the builders read.
//
// dir must be empty or absent; it is created otherwise refused. The ~52,000 small files
// are written by a small worker pool so the run is fast without saturating the machine.
// ctx is honored between files: a cancelled ctx stops the write and returns ctx.Err().
func WriteExport(ctx context.Context, deployRoot, dir string) (ExportStats, error) {
	if err := prepareExportDir(dir); err != nil {
		return ExportStats{}, err
	}
	idx, err := OpenTagIndex(deployRoot)
	if err != nil {
		return ExportStats{}, err
	}
	defer idx.Close()

	cmsw, err := decodeCoatingSwatches(idx)
	if err != nil {
		return ExportStats{}, err
	}
	mwsw, err := decodeMaterialSwatches(idx)
	if err != nil {
		return ExportStats{}, err
	}
	mwpl, err := decodePalettes(idx)
	if err != nil {
		return ExportStats{}, err
	}

	jobs := make([]writeJob, 0, 52000)
	jobs = append(jobs,
		writeJob{partGlobals, func() ([]exportFile, error) {
			root, err := rootOf(idx, coatingGlobalsTagID)
			if err != nil {
				return nil, err
			}
			lay, err := ReadCoatingGlobals(root)
			if err != nil {
				return nil, err
			}
			v, err := ProcessCoatingGlobals(lay, cmsw)
			if err != nil {
				return nil, err
			}
			return oneFile("globals.json", v)
		}},
		writeJob{partVisor, func() ([]exportFile, error) {
			root, err := rootOf(idx, visorTagID)
			if err != nil {
				return nil, err
			}
			lay, err := ReadVisor(root)
			if err != nil {
				return nil, err
			}
			v, err := ProcessVisor(lay, mwsw)
			if err != nil {
				return nil, err
			}
			return oneFile("visor_data.json", v)
		}},
	)

	for _, id := range idx.IDs("rucs") {
		jobs = append(jobs, writeJob{partStyleLists, func() ([]exportFile, error) {
			root, err := rootOf(idx, id)
			if err != nil {
				return nil, err
			}
			lay, err := ReadRuntimeCoatingStyles(root)
			if err != nil {
				return nil, err
			}
			return oneFile("stylelists/"+idName(id)+".json", ProcessRuntimeCoatingStyles(lay, nil))
		}})
	}
	for _, id := range idx.IDs("mwsy") {
		jobs = append(jobs, writeJob{partStyleLists, func() ([]exportFile, error) {
			root, err := rootOf(idx, id)
			if err != nil {
				return nil, err
			}
			lay, err := ReadMaterialStyles(root)
			if err != nil {
				return nil, err
			}
			list, _, err := ProcessMaterialCoatings(id, lay, mwpl, mwsw, nil)
			if err != nil {
				return nil, err
			}
			return oneFile("stylelists/"+idName(id)+".json", list)
		}})
	}

	for _, id := range idx.IDs("rucy") {
		jobs = append(jobs, writeJob{partStyles, func() ([]exportFile, error) {
			root, err := rootOf(idx, id)
			if err != nil {
				return nil, err
			}
			lay, err := ReadRuntimeCoatingStyle(root)
			if err != nil {
				return nil, err
			}
			co, err := ProcessRuntimeCoatings(lay, cmsw)
			if err != nil {
				return nil, err
			}
			return oneFile("styles/"+idName(id)+".json", co)
		}})
	}
	for _, id := range idx.IDs("mwsy") {
		jobs = append(jobs, writeJob{partStyles, func() ([]exportFile, error) {
			root, err := rootOf(idx, id)
			if err != nil {
				return nil, err
			}
			lay, err := ReadMaterialStyles(root)
			if err != nil {
				return nil, err
			}
			_, styles, err := ProcessMaterialCoatings(id, lay, mwpl, mwsw, nil)
			if err != nil {
				return nil, err
			}
			out := make([]exportFile, 0, len(styles))
			for ref, co := range styles {
				data, err := json.Marshal(co)
				if err != nil {
					return nil, err
				}
				out = append(out, exportFile{rel: "styles/" + ref + ".json", data: data})
			}
			return out, nil
		}})
	}

	for _, id := range idx.IDs("mat ") {
		jobs = append(jobs, writeJob{partMaterials, func() ([]exportFile, error) {
			root, err := rootOf(idx, id)
			if err != nil {
				return nil, err
			}
			lay, err := ReadMaterial(root)
			if err != nil {
				return nil, err
			}
			co, err := ProcessMaterial(lay)
			if err != nil {
				return nil, err
			}
			return oneFile("materials/"+idName(id)+".json", co)
		}})
	}

	counts, bytes, err := runWriterPool(ctx, dir, jobs, 4)
	if err != nil {
		return ExportStats{}, err
	}
	return ExportStats{
		Globals:    counts[partGlobals],
		Visor:      counts[partVisor],
		StyleLists: counts[partStyleLists],
		Styles:     counts[partStyles],
		Materials:  counts[partMaterials],
		Bytes:      bytes,
	}, nil
}

// prepareExportDir creates dir (and its parents) when absent, or refuses it when it
// exists and is not an empty directory.
func prepareExportDir(dir string) error {
	info, err := os.Stat(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return os.MkdirAll(dir, 0o755)
		}
		return fmt.Errorf("ekurport: stat %s: %w", dir, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("ekurport: %s is not a directory", dir)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("ekurport: read %s: %w", dir, err)
	}
	if len(entries) > 0 {
		return fmt.Errorf("ekurport: export dir %s must be empty", dir)
	}
	return nil
}

// decodeCoatingSwatches decodes every "cmsw" tag in the index.
func decodeCoatingSwatches(idx *TagIndex) (map[int32]*CoatingSwatchLayout, error) {
	ids := idx.IDs("cmsw")
	out := make(map[int32]*CoatingSwatchLayout, len(ids))
	for _, id := range ids {
		root, err := rootOf(idx, id)
		if err != nil {
			return nil, fmt.Errorf("ekurport: cmsw %d: %w", id, err)
		}
		lay, err := ReadCoatingSwatch(root)
		if err != nil {
			return nil, fmt.Errorf("ekurport: cmsw %d: %w", id, err)
		}
		out[id] = lay
	}
	return out, nil
}

// decodeMaterialSwatches decodes every "mwsw" tag in the index.
func decodeMaterialSwatches(idx *TagIndex) (map[int32]*MaterialSwatchLayout, error) {
	ids := idx.IDs("mwsw")
	out := make(map[int32]*MaterialSwatchLayout, len(ids))
	for _, id := range ids {
		root, err := rootOf(idx, id)
		if err != nil {
			return nil, fmt.Errorf("ekurport: mwsw %d: %w", id, err)
		}
		lay, err := ReadMaterialSwatch(root)
		if err != nil {
			return nil, fmt.Errorf("ekurport: mwsw %d: %w", id, err)
		}
		out[id] = lay
	}
	return out, nil
}

// decodePalettes decodes every "mwpl" tag in the index.
func decodePalettes(idx *TagIndex) (map[int32]*MaterialPaletteLayout, error) {
	ids := idx.IDs("mwpl")
	out := make(map[int32]*MaterialPaletteLayout, len(ids))
	for _, id := range ids {
		root, err := rootOf(idx, id)
		if err != nil {
			return nil, fmt.Errorf("ekurport: mwpl %d: %w", id, err)
		}
		lay, err := ReadMaterialPalette(root)
		if err != nil {
			return nil, fmt.Errorf("ekurport: mwpl %d: %w", id, err)
		}
		out[id] = lay
	}
	return out, nil
}

// rootOf extracts id, parses it, and returns the main struct.
func rootOf(idx *TagIndex, id int32) (Struct, error) {
	raw, err := idx.Extract(id)
	if err != nil {
		return Struct{}, err
	}
	tag, err := ParseTag(raw)
	if err != nil {
		return Struct{}, err
	}
	return tag.Root()
}

// idName is a tag id's file-name stem: the id as a signed decimal.
func idName(id int32) string { return strconv.FormatInt(int64(id), 10) }

// oneFile marshals v compactly and names the single file a job writes.
func oneFile(rel string, v any) ([]exportFile, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return []exportFile{{rel: rel, data: data}}, nil
}

// runWriterPool writes every job's files from at most workers concurrent goroutines. It
// honors ctx between files, and returns the per-part file counts and total bytes written.
func runWriterPool(ctx context.Context, dir string, jobs []writeJob, workers int) ([numParts]int, int64, error) {
	var mu sync.Mutex
	var counts [numParts]int
	var bytes int64
	var firstErr error
	setErr := func(e error) {
		mu.Lock()
		if firstErr == nil {
			firstErr = e
		}
		mu.Unlock()
	}

	jobCh := make(chan writeJob, len(jobs))
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobCh {
				files, err := job.files()
				if err != nil {
					setErr(err)
					return
				}
				for _, f := range files {
					if ctx.Err() != nil {
						return
					}
					p := filepath.Join(dir, f.rel)
					if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
						setErr(err)
						return
					}
					if err := os.WriteFile(p, f.data, 0o644); err != nil {
						setErr(err)
						return
					}
					mu.Lock()
					counts[job.part]++
					bytes += int64(len(f.data))
					mu.Unlock()
				}
			}
		}()
	}

	var feedErr error
	for _, j := range jobs {
		select {
		case jobCh <- j:
		case <-ctx.Done():
			feedErr = ctx.Err()
		}
		if feedErr != nil {
			break
		}
	}
	close(jobCh)
	wg.Wait()

	if feedErr != nil {
		return counts, bytes, feedErr
	}
	return counts, bytes, firstErr
}
