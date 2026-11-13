package mapmesh

// spartan.go ports LevelUp's internal/mapmesh/animations.go body-animation logic (AGPL-3.0,
// JGtm) and builds the Spartan body in its default armor as an animated glTF skin: squelette,
// geometry and influences (himap.Arsenal.ModeleAPeau), with the posture/class-agnostic body
// animations baked onto it (idle, locomotion, airborne, dodge, melee, death).
//
// Not ported: LevelUp also bakes each weapon's own reload/fire/vent clips onto the same model,
// named by the held weapon's `weap` tag (internal/mapmesh/meshproto's ClipsDesArmes and
// ClipsDesClasses catalogs). That is weapon-specific wiring for the viewer's own animation
// selection logic, which this standalone repo does not have yet; BodyAnimations below covers
// every weapon class's idle/locomotion/melee/death set, which is independent of them.

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// BodyAnimations are the Spartan's posture/class animations that do not depend on the weapon
// held: idle, locomotion (walk/run, eight directions), crouch, slide, airborne, landing, climb,
// thruster dodge, melee strikes and death. Ported verbatim (names are the game's own animation
// identifiers) from LevelUp's internal/mapmesh/meshproto/armes.go `animationsDuCorps`, the
// body-only prefix of its AnimationsSpartan list.
var BodyAnimations = []string{
	// rifle: idle, walk and run in eight directions, turns, sprint
	"combat:rifle:idle",
	"combat:rifle:locomote_walk_front", "combat:rifle:locomote_walk_back", "combat:rifle:locomote_walk_left",
	"combat:rifle:locomote_walk_right", "combat:rifle:locomote_walk_frontleft", "combat:rifle:locomote_walk_frontright",
	"combat:rifle:locomote_walk_backleft", "combat:rifle:locomote_walk_backright",
	"combat:rifle:locomote_run_front", "combat:rifle:locomote_run_back", "combat:rifle:locomote_run_left",
	"combat:rifle:locomote_run_right", "combat:rifle:locomote_run_frontleft", "combat:rifle:locomote_run_frontright",
	"combat:rifle:locomote_run_backleft", "combat:rifle:locomote_run_backright",
	"combat:rifle:turn_left_slow", "combat:rifle:turn_right_slow", "sprint:rifle:locomote",
	// rifle crouched, slide
	"crouch:rifle:idle", "crouch:rifle:locomote_walk_front", "crouch:rifle:locomote_walk_back",
	"crouch:rifle:locomote_walk_left", "crouch:rifle:locomote_walk_right", "crouch:rifle:slide",
	// rifle: airborne, hard landing, clamber, thruster dodge
	"combat:rifle:airborne_arc", "combat:rifle:land_hard", "combat:rifle:clamber_enter", "combat:rifle:clamber_exit",
	"combat:rifle:dodge_front", "combat:rifle:dodge_back", "combat:rifle:dodge_left", "combat:rifle:dodge_right",
	// rifle: replacement actions
	"combat:rifle:melee_strike_1", "combat:rifle:melee_strike_2", "combat:rifle:reload_1",
	"combat:rifle:put_away", "combat:rifle:ready", "combat:rifle:throw_grenade",
	// pistol
	"combat:pistol:idle",
	"combat:pistol:locomote_walk_front", "combat:pistol:locomote_walk_back", "combat:pistol:locomote_walk_left",
	"combat:pistol:locomote_walk_right",
	"combat:pistol:locomote_run_front", "combat:pistol:locomote_run_back", "combat:pistol:locomote_run_left",
	"combat:pistol:locomote_run_right",
	"sprint:pistol:locomote", "crouch:pistol:idle",
	"combat:pistol:melee_strike_1", "combat:pistol:throw_grenade", "combat:pistol:put_away", "combat:pistol:ready",
	// other classes: idle, walk and run forward
	"combat:missile:idle", "combat:missile:locomote_walk_front", "combat:missile:locomote_run_front",
	"combat:sword:idle", "combat:sword:locomote_walk_front", "combat:sword:locomote_run_front",
	"combat:hammer:idle", "combat:hammer:locomote_walk_front", "combat:hammer:locomote_run_front",
	"combat:ball:idle", "combat:ball:locomote_walk_front", "combat:ball:locomote_run_front",
	"combat:turret:idle", "combat:turret:locomote_run_front",
	// deaths: falling (front, back), landing (front, back)
	"combat:any:airborne_dead", "combat:airborne_dead_back", "combat:any:landing_dead", "combat:landing_dead_back",
}

// SpartanTarget is the Spartan body (default armor) to build.
type SpartanTarget struct {
	// Module is the `.module` whose index covers the game's globals (every installed map's own
	// module does; the Spartan render_model and its animation graphs live in `pc/globals/globals`).
	Module string
}

// BuildSpartan writes the Spartan body's animated GLB (default armor, BodyAnimations baked on)
// to `path`, built in-process from the local game installation. `announce` (nil accepted)
// receives each step at its start. Animation is best-effort: an unreadable graph chain leaves
// the body written without any clip.
func BuildSpartan(ctx context.Context, gameRoot string, t SpartanTarget, path, generator string, announce func(Step)) (Summary, error) {
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
	m, err := a.ModeleAPeau(ctx, himap.ModeSpartan)
	if err != nil {
		return Summary{}, err
	}
	clips := bodyAnimationClips(ctx, a, m.Noeuds)
	announce(StepWriting)
	extras := map[string]any{"model": "spartan-body", axesGLBKey: axesGLB}
	n, err := writeFile(path, func(w io.Writer) error { return himap.EcritGLBPeauAnime(w, m, clips, generator, extras) })
	if err != nil {
		return Summary{}, err
	}
	s := Summary{Triangles: m.Maillage.Structure.Triangles(), Bytes: n}
	slog.InfoContext(ctx, "spartan body written", "triangles", s.Triangles, "animations", len(clips), "bytes", n, "file", filepath.Base(path))
	return s, nil
}

// bodyAnimationClips decodes BodyAnimations from the Spartan's animation graph chain, on its
// model's skeleton (noeuds). A missing animation, or one from a graph whose skeleton does not
// match (himap.GrapheAnimation.MemeSquelette), is logged and dropped; the model is still written.
func bodyAnimationClips(ctx context.Context, a *himap.Arsenal, noeuds []himap.Noeud) []himap.ClipGLB {
	gs, err := a.GraphesDuSpartan(ctx)
	if err != nil {
		slog.WarnContext(ctx, "spartan animation graphs unreadable: body written without animation", "err", err)
		return nil
	}
	squelette := map[uint32]error{}
	for _, g := range gs.Tous() {
		squelette[g.ID] = g.MemeSquelette(noeuds)
	}
	var out []himap.ClipGLB
	missing := 0
	for _, nom := range BodyAnimations {
		c, err := gs.ClipNomme(nom)
		if err == nil {
			err = squelette[c.Graphe]
		}
		if err != nil {
			slog.WarnContext(ctx, "spartan body animation not baked", "name", nom, "err", err)
			missing++
			continue
		}
		out = append(out, himap.ClipGLB{Nom: nom, Clip: c, Chemin: nom, Cadence: himap.CadenceAnimation(c.Animation)})
	}
	slog.InfoContext(ctx, "spartan body animations", "baked", len(out), "missing", missing)
	return out
}
