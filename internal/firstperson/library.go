// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package firstperson

// library.go builds the first-person library on demand: one rig per weapon the game renders
// in first person (the arms of the Spartan's default armor and the weapon on the one
// skeleton of the weapon's own FP animation graph, every distinct animation baked on), the
// shared texture depot, the player arm pieces, then index.json last. It is the library counterpart of the
// single-weapon mapmesh.BuildFirstPerson: same himap chain (RigPremierePersonne,
// EcritGLBPeauAnime), so a library rig is what build-firstperson would have written, plus a
// content-based file name (two weapons on the same rig share a file) and the textures
// externalized to the depot.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/parallel"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
	"github.com/llampwall/infinite-theater-3d/internal/texcompress"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

// Options names a library build's inputs.
type Options struct {
	// Map is the installed map whose module index the build opens (its search path covers
	// the game's globals/common modules, where the weapons and the arms live).
	Map string
	// GameRoot is the deploy root; empty auto-detects it.
	GameRoot string
	// DataDir is the data directory; the library lands in <DataDir>/first-person.
	DataDir string
}

// Result summarizes a library build.
type Result struct {
	Built   int
	Skipped int
	Bytes   int64
	Seconds float64
}

// Build builds the whole first-person library into <DataDir>/first-person and writes
// index.json last. A weapon whose rig cannot be written is recorded in the index (failures)
// and marked with an empty <key>.none file, and the build continues; a build interrupted
// mid-way resumes over the files already present. announce (nil accepted) receives a
// one-line log at each weapon.
func Build(ctx context.Context, opts Options, announce func(string)) (Result, error) {
	if announce == nil {
		announce = func(string) {}
	}
	start := time.Now()
	gameRoot, module, err := ResolveModule(ctx, opts)
	if err != nil {
		return Result{}, err
	}
	dir := filepath.Join(opts.DataDir, "first-person")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Result{}, fmt.Errorf("first-person directory: %w", err)
	}

	a, err := himap.OuvreArsenal(gameRoot, module)
	if err != nil {
		return Result{}, err
	}
	// LOCAL-CHANGE (infinite-theater-3d): first-person rigs read hard-surface textures at 1024
	// (the weapon fills a large part of the screen in first person).
	a.SurfaceCote(1024)
	defer func() {
		if err := a.Close(); err != nil {
			slog.WarnContext(ctx, "closing arsenal", "err", err)
		}
	}()

	dep := &depot{dir: dir, seen: map[string]bool{}}
	var res Result
	idx := Index{
		Schema:    SchemaFirstPerson,
		Generator: generatorLibrary,
		Weapons:   []WeaponEntry{},
		Rigs:      []Rig{},
		Failures:  []Failure{},
	}
	seenFile := map[string]bool{}

	ekurDir := spartanpieces.EkurDir(opts.DataDir)
	coats, err := spartanpieces.OpenCoatingWork(ekurDir)
	if err != nil {
		return Result{}, err
	}
	if coats == nil {
		slog.WarnContext(ctx, "first-person rigs without weapon coatings: no ekur reference")
	}
	// Stamp of the export read by this build: the server compares it with the current
	// export to decide when a rebuild is due ("" when the build ran without an export).
	stamp, err := spartanpieces.EkurStamp(ekurDir)
	if err != nil {
		slog.WarnContext(ctx, "ekur stamp could not be read", "err", err)
	}
	weapons, withoutFP := a.ArmesPremierePersonne()
	// The rigs are the bulk of the library build; report them per unit through the runner's
	// reporter (nil out of band), leaving the tail (arms, index) to the runner's own 1 on success.
	rep := meshjobs.ProgressFromContext(ctx)
	total := len(weapons)
	// LOCAL-CHANGE (infinite-theater-3d): the rigs build on a bounded worker pool
	// (internal/parallel), not one at a time — see docs/CHANGELOG.md "Unreleased" for the
	// measurement. Each goroutine writes its outcome to its own slot of outcomes (indexed by
	// its position in weapons, never by completion order), so the merge below — which is what
	// actually appends to idx.Weapons/idx.Rigs and runs single-threaded, after every rig has
	// been attempted — walks weapons in its own original order regardless of dispatch order or
	// which worker finished first. The build's recorded output (index.json, the rig and
	// texture files) is therefore identical whatever the dispatch order is, including the
	// priority order below: a weapon the viewer is waiting on (meshjobs.PriorityFromContext,
	// set by Prioritize when a match's weapon or rig request 404s) is only reached sooner by a
	// worker, never recorded differently.
	outcomes := make([]rigOutcome, total)
	keyOf := func(i int) string { return fmt.Sprintf("%08x", weapons[i].Arme) }
	order := parallel.PriorityOrder(total, keyOf, meshjobs.PriorityFromContext(ctx))
	buildErr := parallel.Run(ctx, order, parallel.Workers(), func(done int) {
		if rep != nil {
			rep.Report(0.85*float64(done)/float64(total), fmt.Sprintf("%d/%d", done, total))
		}
	}, func(ctx context.Context, i int) error {
		s := weapons[i]
		key := keyOf(i)
		announce("building first-person rig " + key)
		file, rig, err := buildRig(ctx, a, s, key, dir, dep, coats)
		if err != nil {
			reason := "error"
			if errors.Is(err, himap.ErrSansPremierePersonne) {
				reason = "no_first_person"
			}
			slog.WarnContext(ctx, "first-person rig not written", "weapon", key, "reason", reason, "err", err)
			if merr := writeMarker(dir, key); merr != nil {
				return fmt.Errorf("marker for %s: %w", key, merr)
			}
			outcomes[i] = rigOutcome{key: key, failed: true, reason: reason}
			return nil
		}
		outcomes[i] = rigOutcome{key: key, file: file, rig: rig, markers: effectMarkers(ctx, a, s)}
		return nil
	})
	if buildErr != nil {
		return res, buildErr
	}
	for _, o := range outcomes {
		if o.failed {
			idx.Failures = append(idx.Failures, Failure{Weapon: o.key, Reason: o.reason})
			res.Skipped++
			continue
		}
		idx.Weapons = append(idx.Weapons, WeaponEntry{Weapon: o.key, File: o.file, EffectMarkers: o.markers})
		if !seenFile[o.file] {
			seenFile[o.file] = true
			idx.Rigs = append(idx.Rigs, o.rig)
			res.Bytes += o.rig.Bytes
		}
		res.Built++
	}
	slog.InfoContext(ctx, "first-person roster scanned", "weapons", len(weapons), "without_first_person_block", withoutFP)

	sort.Slice(idx.Rigs, func(i, j int) bool { return idx.Rigs[i].File < idx.Rigs[j].File })
	idx.Textures = Textures{Files: dep.files, Bytes: dep.bytes, References: dep.references}
	idx.EkurStamp = stamp
	res.Bytes += dep.bytes
	armBytes, err := spartanpieces.BuildFirstPersonArms(ctx, a, opts.DataDir, dir, announce)
	if err != nil {
		return res, err
	}
	res.Bytes += armBytes
	if err := writeIndex(dir, idx); err != nil {
		return res, err
	}
	res.Seconds = time.Since(start).Seconds()
	return res, nil
}

// ResolveModule returns the game's deploy root (opts.GameRoot, else auto-detected) and the
// module file of the map whose index the build opens (opts.Map, else the first installed
// map: any installed map's module index covers the game's weapons and globals). Other builds
// that read the weapons and the Spartan (the reload sounds) resolve their module here too.
func ResolveModule(ctx context.Context, opts Options) (string, string, error) {
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
			return "", "", errors.New("firstperson: no installed map found (pass --map <module-key>)")
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

// rigOutcome is one weapon's result from the parallel build pool: either a written rig
// (file, rig, markers) or a failure (reason), keyed by the weapon's key for the merge that
// follows the pool.
type rigOutcome struct {
	key     string
	file    string
	rig     Rig
	markers []EffectMarker
	failed  bool
	reason  string
}

// buildRig writes one weapon's rig (sharing a file by content digest when already written
// in this run, or already on disk from a previous run) and returns its file name and index
// entry. The file name is the content digest of the written rig, so the same index is
// rebuilt over the same files on a resume.
func buildRig(ctx context.Context, a *himap.Arsenal, s himap.SourcesArme, key, dir string, dep *depot,
	coats *spartanpieces.CoatingWork) (string, Rig, error) {
	r, err := a.RigPremierePersonne(ctx, s.Arme, nil)
	if err != nil {
		return "", Rig{}, err
	}
	extras := map[string]any{"model": "first-person-rig", "weapon": key, axesGLBKey: axesGLB}
	// The vendored reader writes the arms raw and bakes the weapon; the weapon's styled
	// hard surfaces are written raw and styled too (marked rigWeapon, so the viewer tells
	// them from the arms), so the held gun takes its player's coating like the
	// third-person model.
	painted, err := coats.PaintableGLB(ctx, r.Modele.Maillage, func() ([]byte, error) {
		var buf bytes.Buffer
		err := himap.EcritGLBPeauAnime(&buf, r.Modele, r.Clips, generatorLibrary, extras)
		return buf.Bytes(), err
	}, func(extras map[string]any) { extras[RigWeaponKey] = true })
	if err != nil {
		return "", Rig{}, err
	}
	// LOCAL-CHANGE (infinite-theater-3d): compress the rig's textures to KTX2 before externalising
	// the images, so the depot stores KTX2 (not PNG) and the GLB references KHR_texture_basisu.
	// Workers: 1 — the Build loop above already runs many rigs at once on its own worker pool;
	// texcompress's own internal pool would otherwise oversubscribe the same cores underneath it.
	painted, _, err = texcompress.CompressGLB(ctx, painted, texcompress.Options{Workers: 1})
	if err != nil {
		return "", Rig{}, fmt.Errorf("ktx2: %w", err)
	}
	glb, _, err := himap.ExterniseImagesGLB(painted, dep.store)
	if err != nil {
		return "", Rig{}, err
	}
	file := RigFile(glb)
	rig := rigIndex(r, file)
	if _, err := writeFileIfAbsent(filepath.Join(dir, file), glb); err != nil {
		return "", Rig{}, err
	}
	rig.Bytes = int64(len(glb))
	return file, rig, nil
}

// rigIndex returns a rig's index entry: the skeleton and triangle digest, the rest pose
// (when the graph carries an idle clip), and one clip per distinct animation.
func rigIndex(r *himap.RigPremierePersonne, file string) Rig {
	out := Rig{
		File:        file,
		Bones:       len(r.Modele.Noeuds),
		Triangles:   r.Modele.Maillage.Structure.Triangles(),
		Clips:       []Clip{},
		Actions:     []Action{},
		MissingActs: r.Absentes,
	}
	if out.MissingActs == nil {
		out.MissingActs = []string{}
	}
	if pos, forward, ok := r.ArmeEnAttente(); ok {
		out.IdleWeapon = &Pose{Position: axesGLTFFirstPerson(pos), Forward: axesGLTFFirstPerson(forward)}
	}
	firstByClip := map[string]himap.ActionRig{}
	for _, ac := range r.Actions {
		if _, seen := firstByClip[ac.Clip]; !seen {
			firstByClip[ac.Clip] = ac
		}
	}
	for _, c := range r.Clips {
		an, ac := c.Clip.Animation, firstByClip[c.Nom]
		frameRate := himap.CadenceAnimation(an)
		out.Clips = append(out.Clips, Clip{
			Name:            c.Nom,
			Action:          ac.Action,
			Variant:         ac.Variante,
			Type:            himap.NomTypeAnimation(an.Type),
			Overlay:         an.Type == himap.AnimationSurcouche,
			FrameCount:      c.Clip.Images,
			FrameRate:       frameRate,
			DurationSeconds: float64(c.Clip.Images) / float64(frameRate),
		})
	}
	for _, ac := range r.Actions {
		out.Actions = append(out.Actions, Action{Action: ac.Action, Variant: ac.Variante, Clip: ac.Clip})
	}
	return out
}

// effectMarkers reads the markers the weapon's idle effects emit at (the effects its attachments
// scale by a weapon function, like the weapons library's idle_effects) on its first-person model:
// the rig carries that model's nodes as bones of the same name, and a bone's local frame is its
// node's in GLB axes (the rig conjugates every node pose by the axis change). Never nil.
func effectMarkers(ctx context.Context, a *himap.Arsenal, s himap.SourcesArme) []EffectMarker {
	out := []EffectMarker{}
	raw, err := a.TagArme(s.Arme)
	if err != nil {
		return out
	}
	atts, err := weaponicons.ReadEffectAttachments(raw)
	if err != nil {
		return out
	}
	var effects []uint32
	for _, at := range atts {
		if at.PrimaryScale != 0 {
			effects = append(effects, at.Effect)
		}
	}
	names := a.EmplacementsDesEffets(effects)
	if len(names) == 0 {
		return out
	}
	ms, err := a.MarqueursDuModele(s.Mode, names)
	if err != nil {
		slog.WarnContext(ctx, "first-person effect markers unreadable", "weapon", fmt.Sprintf("%08x", s.Arme), "err", err)
		return out
	}
	for _, m := range ms {
		if m.NomNoeud == "" {
			continue
		}
		out = append(out, EffectMarker{Marker: fmt.Sprintf("%08x", m.Nom), Bone: m.NomNoeud, Position: axesGLTFFirstPerson(m.Translation),
			Rotation: quatGLTFFirstPerson(m.Rotation)})
	}
	return out
}

// quatGLTFFirstPerson: a quaternion (x, y, z, w) in Halo axes -> glTF axes, (x, z, -y, w); a zero
// quaternion (no rotation read) is the identity.
func quatGLTFFirstPerson(q [4]float64) [4]float32 {
	if q == ([4]float64{}) {
		return [4]float32{0, 0, 0, 1}
	}
	return [4]float32{float32(q[0]), float32(q[2]), float32(-q[1]) + 0, float32(q[3])}
}

// axesGLTFFirstPerson: (x, y, z) Halo -> (x, z, -y) glTF.
func axesGLTFFirstPerson(v [3]float64) [3]float32 {
	return [3]float32{float32(v[0]), float32(v[2]), float32(-v[1])}
}

// writeIndex writes the library's index.json atomically, last.
func writeIndex(dir string, idx Index) error {
	raw, err := json.MarshalIndent(idx, "", "  ")
	if err != nil {
		return err
	}
	_, err = writeFile(filepath.Join(dir, IndexFile), func(w ioWriter) error {
		_, werr := w.Write(raw)
		return werr
	})
	return err
}

// writeMarker writes the empty <key>.none file for a weapon with no readable rig, so a
// resumed build does not retry it (the weapons library's own convention).
func writeMarker(dir, key string) error {
	return os.WriteFile(filepath.Join(dir, key+".none"), nil, 0o644) //nolint:gosec // cache marker, set by the caller
}

// firstInstalledMap is the module key of the first installed map (in directory order) whose
// `-rtx-new.module` is present, and whether one was found.
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

// generatorLibrary is the generator tag written into every library rig GLB's extras and the
// index, naming the chain that produced it.
const generatorLibrary = "cmd/infinite-theater-3d build-firstperson-library (halo-infinite-map-images, first-person library)"
