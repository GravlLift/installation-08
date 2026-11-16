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

	dep := &depot{dir: dir, vues: map[string]bool{}}
	var res Result
	idx := Index{
		Schema:    SchemaFirstPerson,
		Generator: generatorLibrary,
		Weapons:   []Arme{},
		Rigs:      []Rig{},
		Failures:  []Echec{},
	}
	parFichier := map[string]bool{}

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
	armes, sans := a.ArmesPremierePersonne()
	// The rigs are the bulk of the library build; report them per unit through the runner's
	// reporter (nil out of band), leaving the tail (arms, index) to the runner's own 1 on success.
	rep := meshjobs.ProgressFromContext(ctx)
	total := len(armes)
	for i, s := range armes {
		if rep != nil {
			rep.Report(0.85*float64(i)/float64(total), "rigs")
		}
		key := fmt.Sprintf("%08x", s.Arme)
		announce("building first-person rig " + key)
		fichier, rig, err := buildRig(ctx, a, s, key, dir, dep, coats)
		if err != nil {
			raison := "error"
			if errors.Is(err, himap.ErrSansPremierePersonne) {
				raison = "no_first_person"
			}
			slog.WarnContext(ctx, "first-person rig not written", "weapon", key, "reason", raison, "err", err)
			idx.Failures = append(idx.Failures, Echec{Weapon: key, Reason: raison})
			if merr := writeMarker(dir, key); merr != nil {
				return res, fmt.Errorf("marker for %s: %w", key, merr)
			}
			res.Skipped++
			continue
		}
		idx.Weapons = append(idx.Weapons, Arme{Weapon: key, File: fichier, EffectMarkers: effectMarkers(ctx, a, s)})
		if !parFichier[fichier] {
			parFichier[fichier] = true
			idx.Rigs = append(idx.Rigs, rig)
			res.Bytes += rig.Bytes
		}
		res.Built++
	}
	slog.InfoContext(ctx, "first-person roster scanned", "weapons", len(armes), "without_first_person_block", sans)

	sort.Slice(idx.Rigs, func(i, j int) bool { return idx.Rigs[i].File < idx.Rigs[j].File })
	idx.Textures = Textures{Files: dep.fichiers, Bytes: dep.octets, References: dep.references}
	idx.EkurStamp = stamp
	res.Bytes += dep.octets
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
	painted, _, err = texcompress.CompressGLB(ctx, painted, texcompress.Options{})
	if err != nil {
		return "", Rig{}, fmt.Errorf("ktx2: %w", err)
	}
	glb, _, err := himap.ExterniseImagesGLB(painted, dep.depose)
	if err != nil {
		return "", Rig{}, err
	}
	fichier := FichierRig(glb)
	rig := rigIndex(r, fichier)
	if _, err := writeFileIfAbsent(filepath.Join(dir, fichier), glb); err != nil {
		return "", Rig{}, err
	}
	rig.Bytes = int64(len(glb))
	return fichier, rig, nil
}

// rigIndex rend l'entrée d'index d'un rig: l'empreinte du squelette et des triangles, la
// pose de repos (quand le graphe porte un clip idle), et un clip par animation distincte.
func rigIndex(r *himap.RigPremierePersonne, fichier string) Rig {
	out := Rig{
		File:        fichier,
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
	premiere := map[string]himap.ActionRig{}
	for _, ac := range r.Actions {
		if _, vu := premiere[ac.Clip]; !vu {
			premiere[ac.Clip] = ac
		}
	}
	for _, c := range r.Clips {
		an, ac := c.Clip.Animation, premiere[c.Nom]
		cadence := himap.CadenceAnimation(an)
		out.Clips = append(out.Clips, Clip{
			Name:            c.Nom,
			Action:          ac.Action,
			Variant:         ac.Variante,
			Type:            himap.NomTypeAnimation(an.Type),
			Overlay:         an.Type == himap.AnimationSurcouche,
			FrameCount:      c.Clip.Images,
			FrameRate:       cadence,
			DurationSeconds: float64(c.Clip.Images) / float64(cadence),
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
	var effets []uint32
	for _, at := range atts {
		if at.PrimaryScale != 0 {
			effets = append(effets, at.Effect)
		}
	}
	noms := a.EmplacementsDesEffets(effets)
	if len(noms) == 0 {
		return out
	}
	ms, err := a.MarqueursDuModele(s.Mode, noms)
	if err != nil {
		slog.WarnContext(ctx, "first-person effect markers unreadable", "weapon", fmt.Sprintf("%08x", s.Arme), "err", err)
		return out
	}
	for _, m := range ms {
		if m.NomNoeud == "" {
			continue
		}
		out = append(out, EffectMarker{Marker: fmt.Sprintf("%08x", m.Nom), Bone: m.NomNoeud, Position: axesGLTFFirstPerson(m.Translation)})
	}
	return out
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
	_, err = writeFile(filepath.Join(dir, FichierIndex), func(w ioWriter) error {
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
