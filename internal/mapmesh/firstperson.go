// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package mapmesh

// firstperson.go ports the single-weapon build path of LevelUp's internal/mapmesh/premiere_personne.go
// (AGPL-3.0, JGtm): one weapon's first-person rig, arms and weapon on the one skeleton of the
// weapon's own FP animation graph, with every distinct animation in that graph baked on
// (himap.Arsenal.RigPremierePersonne, himap.EcritGLBPeauAnime). The arms are the Spartan's
// default armor (himap.VarianteModele nil); --no-arms keeps the skeleton and clips without the
// arm geometry (himap.Arsenal.RigPremierePersonneSansBras), for a viewer that poses its own arms.
//
// Not ported: LevelUp builds every first-person-capable weapon's rig at once into a library
// folder (an index.json plus a shared texture depot) and applies the Ekur coating annotation to
// painted materials (internal/mapmesh/revetements.go) — same scope cut as pieces.go, for the same
// reason: this CLI builds one self-contained GLB per asset.

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// FirstPersonTarget is one weapon's first-person rig to build.
type FirstPersonTarget struct {
	// Module is the `.module` whose index covers the game's weapons and globals (arms live
	// there, like the Spartan body).
	Module string
	// WeaponID is the weapon's `weap` tag GlobalID.
	WeaponID uint32
	// Key is published in the GLB's extras (the hex id, or a friendlier name the caller knows).
	Key string
	// NoArms keeps the skeleton and clips without the arm geometry (RigPremierePersonneSansBras).
	NoArms bool
}

// BuildFirstPerson writes the weapon's first-person rig GLB to `path`, built in-process from the
// local game installation. `announce` (nil accepted) receives each step at its start.
func BuildFirstPerson(ctx context.Context, gameRoot string, t FirstPersonTarget, path, generator string, announce func(Step)) (Summary, error) {
	if announce == nil {
		announce = func(Step) {}
	}
	announce(StepGeometry)
	a, err := himap.OuvreArsenal(gameRoot, t.Module)
	if err != nil {
		return Summary{}, err
	}
	defer func() {
		if cerr := a.Close(); cerr != nil {
			slog.WarnContext(ctx, "closing arsenal", "err", cerr)
		}
	}()
	r, err := firstPersonRig(ctx, a, t)
	if err != nil {
		return Summary{}, err
	}
	announce(StepWriting)
	extras := firstPersonExtras(t, r)
	n, err := writeFile(path, func(w io.Writer) error { return himap.EcritGLBPeauAnime(w, r.Modele, r.Clips, generator, extras) })
	if err != nil {
		return Summary{}, err
	}
	s := Summary{Triangles: r.Modele.Maillage.Structure.Triangles(), Bytes: n}
	slog.InfoContext(ctx, "first-person rig written", "weapon", t.Key, "arms", !t.NoArms, "clips", len(r.Clips),
		"absentActions", len(r.Absentes), "triangles", s.Triangles, "bytes", n, "file", filepath.Base(path))
	return s, nil
}

// firstPersonRig reads the weapon's first-person rig, with or without arm geometry per
// t.NoArms.
func firstPersonRig(ctx context.Context, a *himap.Arsenal, t FirstPersonTarget) (*himap.RigPremierePersonne, error) {
	if t.NoArms {
		return a.RigPremierePersonneSansBras(ctx, t.WeaponID)
	}
	return a.RigPremierePersonne(ctx, t.WeaponID, nil)
}

// firstPersonExtras builds the GLB extras: the weapon key, whether arms are included, each
// baked action's clip (ActionRig) and, when the rig reports one, the weapon's at-rest pose.
func firstPersonExtras(t FirstPersonTarget, r *himap.RigPremierePersonne) map[string]any {
	extras := map[string]any{"model": "first-person-rig", "weapon": t.Key, "arms": !t.NoArms, axesGLBKey: axesGLB}
	actions := make([]map[string]any, 0, len(r.Actions))
	for _, ac := range r.Actions {
		actions = append(actions, map[string]any{"action": ac.Action, "variant": ac.Variante, "clip": ac.Clip})
	}
	extras["actions"] = actions
	if len(r.Absentes) > 0 {
		extras["missingActions"] = r.Absentes
	}
	if pos, forward, ok := r.ArmeEnAttente(); ok {
		extras["restPose"] = map[string]any{"position": axesGLTFFirstPerson(pos), "forward": axesGLTFFirstPerson(forward)}
	}
	return extras
}

// axesGLTFFirstPerson: (x, y, z) Halo -> (x, z, -y) glTF, as mapmesh.axesGLTF in LevelUp's
// premiere_personne.go.
func axesGLTFFirstPerson(v [3]float64) [3]float32 {
	return [3]float32{float32(v[0]), float32(v[2]), float32(-v[1])}
}
