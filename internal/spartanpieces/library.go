// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// library.go — the Spartan armor piece library build (LevelUp's
// internal/mapmesh ConstruitPieces, AGPL-3.0, JGtm): every piece of the
// Spartan's `mode` (a skinned permutation of one of its regions), every
// `ocad` attachment entry that poses on one of its markers, their images once
// each (content digest), and the index that tells the viewer how to assemble
// them (Index). The index is written last: present, the library is whole. A
// piece or an entry that does not write is logged, counted and listed in the
// index (failures); the build continues.
//
// The coatings are optional: with no Ekur reference (or an invalid one) the
// library is built without them, exactly as LevelUp does (the painted
// materials stay in their neutral grey render).
package spartanpieces

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/parallel"
	"github.com/llampwall/infinite-theater-3d/internal/texcompress"
)

// Options names a library build's inputs.
type Options struct {
	// Map is the installed map whose module index the build opens (its search
	// path covers the game's globals, where the Spartan's `mode` lives).
	Map string
	// GameRoot is the deploy root; empty auto-detects it.
	GameRoot string
	// DataDir is the data directory; the library lands in
	// <DataDir>/spartan-pieces and the Ekur reference is looked up relative
	// to it (EkurEnv in front).
	DataDir string
}

// Result summarizes a library build.
type Result struct {
	Pieces      int
	Attachments int
	Failures    int
	Textures    int
	Coatings    int
	Bytes       int64
	Triangles   int
	Seconds     float64
}

// library is one build in progress.
type library struct {
	ctx       context.Context
	folder    string
	generator string
	depot     *textureDepot
	coatings  *CoatingWork
	index     Index
	bytes     int64
	// mu (LOCAL-CHANGE (infinite-theater-3d)): guards bytes, the one field writeGLB mutates
	// that the parallel piece build pool (writePieces) can reach from several goroutines at
	// once; index.Pieces/index.Failures are appended only in the single-threaded merge after
	// the pool, so they need no lock.
	mu sync.Mutex
	// ktx2 (LOCAL-CHANGE (infinite-theater-3d)): compress piece textures to KTX2 before
	// externalising them; set for the first-person arm pieces build, not the 3P main build.
	ktx2 bool
}

// Build builds the whole library into <DataDir>/spartan-pieces and writes
// index.json last. A piece or an attachment entry that cannot be written is
// recorded in the index (failures) and the build continues. announce (nil
// accepted) receives a one-line log per piece.
func Build(ctx context.Context, opts Options, announce func(string)) (Result, error) {
	if announce == nil {
		announce = func(string) {}
	}
	start := time.Now()
	gameRoot, module, err := resolveModule(ctx, opts)
	if err != nil {
		return Result{}, err
	}
	ekurDir := EkurDir(opts.DataDir)
	coatings, err := OpenCoatingWork(ekurDir)
	if err != nil {
		return Result{}, err
	}
	if coatings == nil {
		slog.WarnContext(ctx, "library without coatings: no ekur reference")
	}
	// Stamp of the export read by this build: the server compares it with the current
	// export to decide when a rebuild is due ("" when the build ran without an export).
	stamp, err := EkurStamp(ekurDir)
	if err != nil {
		slog.WarnContext(ctx, "ekur stamp could not be read", "err", err)
	}
	dir := filepath.Join(opts.DataDir, "spartan-pieces")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Result{}, fmt.Errorf("spartan-pieces directory: %w", err)
	}
	a, err := himap.OuvreArsenal(gameRoot, module)
	if err != nil {
		return Result{}, err
	}
	defer func() {
		if cerr := a.Close(); cerr != nil {
			slog.WarnContext(ctx, "closing arsenal", "err", cerr)
		}
	}()
	r, err := a.OuvreArmurerie(himap.ModeSpartan)
	if err != nil {
		return Result{}, err
	}
	b := &library{ctx: ctx, folder: dir, generator: generatorLibrary, coatings: coatings,
		depot: &textureDepot{dir: dir, seen: map[string]bool{}},
		index: Index{Schema: SchemaPieces, Mode: Identifier(himap.ModeSpartan), Generator: generatorLibrary,
			Pieces: []PieceIndex{}, Attachments: []AttachmentIndex{}, Markers: []MarkerIndex{},
			Themes: []ThemeIndex{}, Failures: []FailureIndex{}}}
	b.index.Skeleton = skeletonOf(r)
	b.writePieces(r, announce)
	b.writeAttachments(a, r)
	b.index.Markers = markersOf(r)
	b.index.Themes = themesOf(ctx, a)
	if coatings != nil {
		if b.index.Coatings, err = coatings.Finish(ctx, a, dir); err != nil {
			return b.result(), err
		}
		b.bytes += b.index.Coatings.Bytes
	}
	b.index.Textures = TexturesIndex{Files: b.depot.files, Bytes: b.depot.bytes, References: b.depot.references}
	b.index.EkurStamp = stamp
	b.bytes += b.depot.bytes
	if err := b.writeIndex(); err != nil {
		return b.result(), err
	}
	res := b.result()
	res.Seconds = time.Since(start).Seconds()
	slog.InfoContext(ctx, "spartan piece library written", "pieces", len(b.index.Pieces), "attachments", len(b.index.Attachments),
		"failures", len(b.index.Failures), "textures", b.depot.files, "textureBytes", b.depot.bytes,
		"textureReferences", b.depot.references, "bytes", res.Bytes)
	return res, nil
}

// result is the build summary of b so far.
func (b *library) result() Result {
	var coats int
	if b.index.Coatings != nil {
		coats = b.index.Coatings.Coatings
	}
	return Result{Pieces: len(b.index.Pieces), Attachments: len(b.index.Attachments), Failures: len(b.index.Failures),
		Textures: b.depot.files, Coatings: coats, Bytes: b.bytes}
}

// pieceOutcome is one piece's result from the parallel build pool, keyed by its position in
// the armory's piece list (never by completion order), so the merge after the pool appends to
// index.Pieces/index.Failures in that same original order regardless of dispatch order.
type pieceOutcome struct {
	key    string
	piece  PieceIndex
	failed bool
	err    error
}

// writePieces writes every piece of the armory on a bounded worker pool (internal/parallel): a
// piece that cannot be written is recorded in index.Failures (not a pool-level error) and the
// build continues, as it did sequentially.
func (b *library) writePieces(r *himap.Armurerie, announce func(string)) {
	pieces := r.Pieces()
	total := len(pieces)
	outcomes := make([]pieceOutcome, total)
	rep := meshjobs.ProgressFromContext(b.ctx)
	keyOf := func(i int) string { return PieceKey(Identifier(pieces[i].Region), Identifier(pieces[i].Permutation)) }
	order := parallel.PriorityOrder(total, keyOf, meshjobs.PriorityFromContext(b.ctx))
	_ = parallel.Run(b.ctx, order, parallel.Workers(), func(done int) {
		if rep != nil {
			rep.Report(0.7*float64(done)/float64(total), fmt.Sprintf("%d/%d", done, total))
		}
	}, func(ctx context.Context, i int) error {
		key := keyOf(i)
		announce("building piece " + key)
		p, err := b.writePiece(r, pieces[i], key)
		if err != nil {
			outcomes[i] = pieceOutcome{key: key, failed: true, err: err}
			return nil // a piece that cannot be written is recorded, never fatal to the build
		}
		outcomes[i] = pieceOutcome{key: key, piece: p}
		return nil
	})
	for _, o := range outcomes {
		if o.failed {
			b.failure(o.key, o.err)
			continue
		}
		b.index.Pieces = append(b.index.Pieces, o.piece)
	}
}

// writePiece writes the piece c and returns its index entry.
func (b *library) writePiece(r *himap.Armurerie, c himap.CleArmure, key string) (PieceIndex, error) {
	m, err := r.Piece(b.ctx, c)
	if err != nil {
		return PieceIndex{}, err
	}
	extras := map[string]any{"model": "spartan-piece", "region": Identifier(c.Region),
		"permutation": Identifier(c.Permutation), "axes": axesGLB}
	var buf bytes.Buffer
	if err := himap.EcritGLBPeau(&buf, m, b.generator, extras); err != nil {
		return PieceIndex{}, err
	}
	n, err := b.writeGLB(FilePiece(key), buf.Bytes())
	if err != nil {
		return PieceIndex{}, err
	}
	return PieceIndex{Key: key, Region: Identifier(c.Region), Permutation: Identifier(c.Permutation),
		File: FilePiece(key), Triangles: m.Maillage.Structure.Triangles(), Box: gltfBox(&m.Maillage.Structure), Bytes: n}, nil
}

// writeGLB puts the coating style on the painted materials (coatingwork.go),
// takes the images out of the GLB into the depot, and writes the file into the
// library; it returns its size.
func (b *library) writeGLB(file string, glb []byte) (int64, error) {
	if b.coatings != nil {
		var err error
		if glb, err = himap.AnnoteMateriauxGLB(glb, b.coatings.Annotate(b.ctx)); err != nil {
			return 0, err
		}
	}
	// LOCAL-CHANGE (infinite-theater-3d): first-person arm pieces get KTX2-compressed textures.
	if b.ktx2 {
		var err error
		glb, _, err = texcompress.CompressGLB(b.ctx, glb, texcompress.Options{})
		if err != nil {
			return 0, fmt.Errorf("ktx2: %w", err)
		}
	}
	sans, _, err := himap.ExterniseImagesGLB(glb, b.depot.depose)
	if err != nil {
		return 0, err
	}
	n, err := writeFile(filepath.Join(b.folder, file), func(w io.Writer) error {
		_, err := w.Write(sans)
		return err
	})
	if err != nil {
		return 0, err
	}
	b.mu.Lock()
	b.bytes += n
	b.mu.Unlock()
	return n, nil
}

// failure logs, counts and stores in the index a piece or entry not written.
func (b *library) failure(key string, err error) {
	reason := "error"
	switch {
	case errors.Is(err, himap.ErrPieceSansGeometrie):
		reason = "no_geometry"
	case errors.Is(err, himap.ErrSansModele):
		reason = "no_model"
	}
	slog.WarnContext(b.ctx, "library entry not written", "key", key, "reason", reason, "err", err)
	b.index.Failures = append(b.index.Failures, FailureIndex{Key: key, Reason: reason})
}

// writeIndex writes the library's index, last.
func (b *library) writeIndex() error {
	raw, err := json.Marshal(b.index)
	if err != nil {
		return fmt.Errorf("library index: %w", err)
	}
	n, err := writeFile(filepath.Join(b.folder, FileIndex), func(w io.Writer) error {
		_, err := w.Write(raw)
		return err
	})
	b.bytes += n
	return err
}

// gltfBox is the bounding box of a group in glTF axes: (x, z, -y) of the Halo
// frame.
func gltfBox(g *himap.GroupeMaillage) BBox {
	lo, hi, _ := g.Borne()
	return BBox{Min: [3]float32{lo[0], lo[2], -hi[1]}, Max: [3]float32{hi[0], hi[2], -lo[1]}}
}

// resolveModule returns the game's deploy root (opts.GameRoot, else
// auto-detected) and the module file of the map whose index the build opens
// (opts.Map, else the first installed map: any installed map's module index
// covers the game's globals).
func resolveModule(ctx context.Context, opts Options) (string, string, error) {
	gameRoot := opts.GameRoot
	if gameRoot == "" {
		root, err := himap.DeployRoot()
		if err != nil {
			return "", "", fmt.Errorf("game install: %w", err)
		}
		gameRoot = root
	}
	mapKey := opts.Map
	if mapKey == "" {
		key, ok := firstInstalledMap(gameRoot)
		if !ok {
			return "", "", fmt.Errorf("spartanpieces: no installed map found (pass --map <module-key>)")
		}
		slog.InfoContext(ctx, "no map given; using the first installed map", "map", key)
		mapKey = key
	}
	module := filepath.Join(gameRoot, "pc", "levels", "multi", mapKey, mapKey+"-rtx-new.module")
	if _, err := os.Stat(module); err != nil {
		return "", "", fmt.Errorf("map %q is not installed", mapKey)
	}
	return gameRoot, module, nil
}

// firstInstalledMap is the module key of the first installed map (in
// directory order) whose -rtx-new.module is present, and whether one was
// found.
func firstInstalledMap(gameRoot string) (string, bool) {
	multi := filepath.Join(gameRoot, "pc", "levels", "multi")
	entries, err := os.ReadDir(multi)
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		module := filepath.Join(multi, e.Name(), e.Name()+"-rtx-new.module")
		if _, err := os.Stat(module); err == nil {
			return e.Name(), true
		}
	}
	return "", false
}

// sortedKeys is the keys of a table, sorted.
func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// generatorLibrary is the generator tag written into every library file's
// extras and the index, naming the chain that produced it.
const generatorLibrary = "infinite-theater-3d spartan-pieces (halo-infinite-map-images, spartan piece library)"
