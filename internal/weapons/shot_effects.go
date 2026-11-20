// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// shot_effects.go — what the game draws when a weapon fires, read from its tags: the effect its
// barrel plays at the weapon's markers, the effects its projectile carries in flight, the effect
// its projectile plays where it hits, and how fast and far the projectile flies.
//
// THE CHAIN (the Shock Rifle, weap 1a22fee6, measured on the installed game 2026-11-20):
//
//	weap barrels[0]            projectile proj 96555d72; firing effects[0] effe 136580d8; a
//	                           burst of 3 shots at 60 a second, 1 projectile each, error angle 0
//	                           (weaponicons.ReadBarrelShot)
//	proj 96555d72 root         object/attachments: effe 9f69be2d (the flight effect, at the
//	                           projectile's `root`), lsnd 7bab12d7 (its sound, not read here);
//	                           object/material effects foot 6bb1cc8c; maximum range 500;
//	                           initial and final velocity 5000 world units a second; impact effect
//	                           and detonation effects none
//	foot 6bb1cc8c              per material, the effect a hit plays: `default_material` names effe
//	                           3b3d55b3 (in both of its slots that name that material)
//
// The projectile's other references are left out and named here: its submunitions (proj 232cea71,
// spawned on a hit on a valid target toward the nearest enemy within 3.5 units, draws effe b76936d8
// between the two through its `chaining attach effect`; c489908c, 1fb5f098, cb508a1a on charged or
// super-combine hits), whose targets a film does not give.
//
// THE LAYOUTS: the proj, foot and effe offsets below are the live tags' (the proj root is 3256
// bytes, 40 more than the reference layout: fields were added since). They were measured by
// aligning the community reference layout's block and reference fields on each live tag's own
// struct and tag-reference tables, and by reading the projectile's physics run (air gravity 0, air
// damage range 0..40, water gravity 0, water damage range 0..10, initial and final velocity 5000)
// whose order matches the reference exactly. Every read checks the group of the reference it
// reads, and the proj and effe roots' sizes, refusing (logged) rather than reading a moved field.
//
// SCOPE: the projectiles of `shotProjectiles` (the Shock Rifle's and its parent), not every
// weapon: the view draws the game's shot for the Shock Rifle; another weapon is added by its
// projectile once the view draws its effects.
package weapons

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-map-images/himap"

	"github.com/llampwall/infinite-theater-3d/internal/ekurport"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

// shotProjectiles are the projectiles whose weapons' shot effects the library reads: the Shock
// Rifle's (96555d72), and its parent (e9536695), which the 9ee5ff15 variant fires.
var shotProjectiles = map[uint32]bool{0x96555d72: true, 0xe9536695: true}

// The live `proj` layout (see the header).
const (
	projRootSize        = 3256
	projOffMaterialFx   = 316 // object/material effects (foot)
	projOffAttachments  = 584 // object/attachments (208 bytes an element: the type at +4)
	attachStride        = 208
	attachOffType       = 4
	projOffMaxRange     = 1832 // maximum range (world units)
	projOffDetonationA  = 1900 // detonation effect (airborne)
	projOffDetonationG  = 1928 // detonation effect (ground)
	projOffImpactEffect = 2504 // impact effect
	projOffInitialSpeed = 2784 // initial velocity (world units a second)
	projOffFinalSpeed   = 2788 // final velocity
)

// The live `foot` layout: the root's effect slots (40 bytes each: a sounds block, then an effects
// block of 72-byte entries: the effect at +0, the material name at +56).
const (
	footOffSlots     = 16
	footSlotStride   = 40
	footSlotEffects  = 20
	footEntryStride  = 72
	footEntryOffName = 56
)

// The live `effe` root: 136 bytes, its death delay (seconds the effect lives on once its owner is
// gone) at +52.
const (
	effeRootSize      = 136
	effeOffDeathDelay = 52
)

// Groups of the references read.
const (
	groupEffect          = "effe"
	groupMaterialEffects = "foot"
)

// defaultMaterial is the StringID of the material a hit on an unknown surface uses.
var defaultMaterial = uint32(mapvar.LabelHash("default_material"))

// ShotTable is the shot effects of the library: per weapon key, what its shot plays; per effect
// id, the effect (shared by the weapons that play it).
type ShotTable struct {
	Weapons map[string]WeaponShot `json:"weapons"`
	Effects map[string]ShotEffect `json:"effects"`
	// Grenades: per grenade rank (the film's and `GrenadeKey`'s, "1" the plasma grenade), the
	// effects its thrown projectile carries (its attachments), drawn on it in flight and stuck.
	Grenades map[string]GrenadeShot `json:"grenades"`
}

// GrenadeShot is what a thrown grenade's projectile carries: its `proj` tag and its attached
// effects (the plasma grenade, proj 6071a622: effe 5740a83d, a looping flow-mapped glow sprite).
type GrenadeShot struct {
	Projectile string   `json:"projectile"`
	Flight     []string `json:"flight"`
}

// WeaponShot is what a weapon's shot plays.
type WeaponShot struct {
	// Projectile: the barrel's projectile; its velocities (world units a second) and its range.
	Projectile      string  `json:"projectile"`
	InitialVelocity float32 `json:"initialVelocity"`
	FinalVelocity   float32 `json:"finalVelocity"`
	MaxRange        float32 `json:"maxRange"`
	// The barrel's burst (weaponicons.BarrelShot): the shots one trigger pull fires (bounds), the
	// rate they are fired at (rounds a second, bounds), the projectiles each fires, the error angle
	// (radians, bounds) and the seconds before the next pull.
	ShotsPerFire       [2]int     `json:"shotsPerFire"`
	RoundsPerSecond    [2]float32 `json:"roundsPerSecond"`
	ProjectilesPerShot int        `json:"projectilesPerShot"`
	ErrorAngle         [2]float32 `json:"errorAngle"`
	FireRecovery       float32    `json:"fireRecovery"`
	// Firing: the barrel's firing effect, played at the weapon's markers ("" without one);
	// Markers, MarkerRotations: those markers on the weapon's third-person model (as an idle
	// effect's: model space at the rest pose, GLB axes).
	Firing          string                  `json:"firing,omitempty"`
	Markers         map[string][][3]float64 `json:"markers"`
	MarkerRotations map[string][][4]float64 `json:"markerRotations"`
	// Flight: the effects the projectile carries (its attachments), at its own frame.
	Flight []string `json:"flight"`
	// Impact: the effect a hit plays ("" without one), and where it was read: "impact effect" or
	// "detonation effect" (the projectile's own), or "material effects" (its `default_material`).
	Impact     string `json:"impact,omitempty"`
	ImpactFrom string `json:"impactFrom,omitempty"`
}

// ShotEffect is one effect a shot plays: its camera distance range (the view feeds the camera
// distance input over it), its death delay, and its readable particle systems.
type ShotEffect struct {
	Effect      string       `json:"effect"`
	CameraRange [2]float32   `json:"cameraRange"`
	DeathDelay  float32      `json:"deathDelay"`
	Systems     []IdleSystem `json:"systems"`
}

// projectileShot is what the `proj` tag says of a shot.
type projectileShot struct {
	initial, final, maxRange float32
	flight                   []uint32
	impact                   uint32 // the projectile's own impact or detonation effect
	impactFrom               string
	materialFx               uint32
}

// errLayout: a tag whose layout is not the measured one.
var errLayout = errors.New("weapons: tag layout not the measured one")

// rootOfSize parses a tag and returns its root, refusing a root of another size than `size`.
func rootOfSize(raw []byte, size int) (ekurport.Struct, error) {
	t, err := ekurport.ParseTag(raw)
	if err != nil {
		return ekurport.Struct{}, err
	}
	root, err := t.Root()
	if err != nil {
		return ekurport.Struct{}, err
	}
	if _, err := root.Bytes(size-1, 1); err != nil {
		return ekurport.Struct{}, fmt.Errorf("%w: root shorter than %d bytes", errLayout, size)
	}
	if _, err := root.Bytes(size, 1); err == nil {
		return ekurport.Struct{}, fmt.Errorf("%w: root longer than %d bytes", errLayout, size)
	}
	return root, nil
}

// refOf reads the reference at `off` of s: its id when it names a tag of group `group`, 0 when it
// is null, an error when it names another group.
func refOf(s ekurport.Struct, off int, group string) (uint32, error) {
	id, g, ok := s.TagRef(off)
	if !ok {
		return 0, nil
	}
	if g != group {
		return 0, fmt.Errorf("%w: reference at +%d names a %q, %q expected", errLayout, off, g, group)
	}
	return uint32(id), nil
}

// readProjectile reads the `proj` tag raw (see the header).
func readProjectile(raw []byte) (projectileShot, error) {
	root, err := rootOfSize(raw, projRootSize)
	if err != nil {
		return projectileShot{}, err
	}
	var p projectileShot
	f := func(off int) (float32, error) {
		v, err := root.F32(off)
		if err == nil && (math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) || v < 0) {
			err = fmt.Errorf("%w: %g at +%d", errLayout, v, off)
		}
		return v, err
	}
	if p.initial, err = f(projOffInitialSpeed); err != nil {
		return projectileShot{}, err
	}
	if p.final, err = f(projOffFinalSpeed); err != nil {
		return projectileShot{}, err
	}
	if p.maxRange, err = f(projOffMaxRange); err != nil {
		return projectileShot{}, err
	}
	atts, err := root.Block(projOffAttachments, attachStride)
	if err != nil {
		return projectileShot{}, err
	}
	for i := 0; i < atts.Len(); i++ {
		id, g, ok := atts.At(i).TagRef(attachOffType)
		if ok && g == groupEffect {
			p.flight = append(p.flight, uint32(id))
		}
	}
	for _, src := range []struct {
		off  int
		from string
	}{{projOffImpactEffect, "impact effect"}, {projOffDetonationG, "detonation effect"}, {projOffDetonationA, "detonation effect"}} {
		id, err := refOf(root, src.off, groupEffect)
		if err != nil {
			return projectileShot{}, err
		}
		if id != 0 {
			p.impact, p.impactFrom = id, src.from
			break
		}
	}
	if p.materialFx, err = refOf(root, projOffMaterialFx, groupMaterialEffects); err != nil {
		return projectileShot{}, err
	}
	return p, nil
}

// readDefaultMaterialEffect reads, in the `foot` tag raw, the effect its slots name for the
// `default_material`: 0 when none does, an error when two slots name different effects (which one
// a hit plays is then not known: the engine's slot for an impact is not decoded).
func readDefaultMaterialEffect(raw []byte) (uint32, error) {
	t, err := ekurport.ParseTag(raw)
	if err != nil {
		return 0, err
	}
	root, err := t.Root()
	if err != nil {
		return 0, err
	}
	slots, err := root.Block(footOffSlots, footSlotStride)
	if err != nil {
		return 0, err
	}
	var found uint32
	for i := 0; i < slots.Len(); i++ {
		entries, err := slots.At(i).Block(footSlotEffects, footEntryStride)
		if err != nil {
			return 0, err
		}
		for k := 0; k < entries.Len(); k++ {
			e := entries.At(k)
			name, err := e.StringID(footEntryOffName)
			if err != nil {
				return 0, err
			}
			if name != defaultMaterial {
				continue
			}
			id, err := refOf(e, 0, groupEffect)
			if err != nil || id == 0 {
				continue
			}
			if found != 0 && found != id {
				return 0, fmt.Errorf("default material: effects %08x and %08x", found, id)
			}
			found = id
		}
	}
	return found, nil
}

// readDeathDelay reads an `effe` tag's death delay.
func readDeathDelay(raw []byte) (float32, error) {
	root, err := rootOfSize(raw, effeRootSize)
	if err != nil {
		return 0, err
	}
	return root.F32(effeOffDeathDelay)
}

// shotReader reads the shot effects of one build.
type shotReader struct {
	w  effectWriter
	ix *himap.ModuleIndex
}

// readShotEffects reads the shot effects of the weapons of keys whose barrel fires one of
// `shotProjectiles`, and writes their files into dir. Never nil; a weapon whose shot cannot be read
// is left out (logged).
func readShotEffects(ctx context.Context, a *himap.Arsenal, gameRoot, module, dir string, keys []string) (*ShotTable, error) {
	paths, err := himap.GeometrySearchPathMonde(gameRoot, module)
	if err != nil {
		return nil, err
	}
	ix, err := himap.NewModuleIndex(paths...)
	if err != nil {
		return nil, fmt.Errorf("shot tag index: %w", err)
	}
	defer func() {
		if err := ix.Close(); err != nil {
			slog.WarnContext(ctx, "closing shot tag index", "err", err)
		}
	}()
	r := shotReader{w: effectWriter{a: a, dir: dir, written: map[string]bool{}}, ix: ix}
	out := &ShotTable{Weapons: map[string]WeaponShot{}, Effects: map[string]ShotEffect{}, Grenades: map[string]GrenadeShot{}}
	for _, key := range keys {
		id, err := parseKey(key)
		if err != nil {
			return nil, err
		}
		raw, err := ix.Extract(id)
		if err != nil {
			continue
		}
		shot, err := weaponicons.ReadBarrelShot(raw)
		if err != nil || !shotProjectiles[shot.Projectile] {
			continue
		}
		ws, err := r.weapon(ctx, id, shot, out.Effects)
		if err != nil {
			slog.WarnContext(ctx, "weapon shot effects unreadable", "weapon", key, "err", err)
			continue
		}
		out.Weapons[key] = ws
	}
	if err := r.grenades(ctx, out); err != nil {
		slog.WarnContext(ctx, "grenade flight effects unreadable", "err", err)
	}
	slog.InfoContext(ctx, "weapon shot effects read", "weapons", len(out.Weapons), "grenades", len(out.Grenades), "effects", len(out.Effects))
	return out, nil
}

// weapon reads one weapon's shot, adding the effects it plays to `effects`.
func (r shotReader) weapon(ctx context.Context, weap uint32, shot weaponicons.BarrelShot, effects map[string]ShotEffect) (WeaponShot, error) {
	praw, err := r.ix.Extract(shot.Projectile)
	if err != nil {
		return WeaponShot{}, err
	}
	p, err := readProjectile(praw)
	if err != nil {
		return WeaponShot{}, fmt.Errorf("projectile %08x: %w", shot.Projectile, err)
	}
	ws := WeaponShot{Projectile: fmt.Sprintf("%08x", shot.Projectile), InitialVelocity: p.initial, FinalVelocity: p.final,
		MaxRange: p.maxRange, ShotsPerFire: shot.ShotsPerFire, RoundsPerSecond: shot.RoundsPerSecond,
		ProjectilesPerShot: shot.ProjectilesPerShot, ErrorAngle: shot.ErrorAngle, FireRecovery: shot.FireRecovery,
		Flight: []string{}, Markers: map[string][][3]float64{}, MarkerRotations: map[string][][4]float64{}}
	if shot.FiringEffect != 0 {
		fx, err := r.effect(ctx, shot.FiringEffect, effects)
		if err != nil {
			return WeaponShot{}, err
		}
		if fx != nil {
			mode, ok := r.w.a.ModeleDeLArme(weap)
			if !ok {
				return WeaponShot{}, fmt.Errorf("weapon %08x without a model", weap)
			}
			if ws.Markers, ws.MarkerRotations, err = r.w.modelMarkers(mode, fx); err != nil {
				return WeaponShot{}, err
			}
			ws.Firing = fmt.Sprintf("%08x", shot.FiringEffect)
		}
	}
	for _, id := range p.flight {
		fx, err := r.effect(ctx, id, effects)
		if err != nil {
			return WeaponShot{}, err
		}
		if fx != nil {
			ws.Flight = append(ws.Flight, fmt.Sprintf("%08x", id))
		}
	}
	impact, from := p.impact, p.impactFrom
	if impact == 0 && p.materialFx != 0 {
		fraw, err := r.ix.Extract(p.materialFx)
		if err != nil {
			return WeaponShot{}, err
		}
		if impact, err = readDefaultMaterialEffect(fraw); err != nil {
			return WeaponShot{}, fmt.Errorf("material effects %08x: %w", p.materialFx, err)
		}
		from = "material effects"
	}
	if impact != 0 {
		fx, err := r.effect(ctx, impact, effects)
		if err != nil {
			return WeaponShot{}, err
		}
		if fx != nil {
			ws.Impact, ws.ImpactFrom = fmt.Sprintf("%08x", impact), from
		}
	}
	return ws, nil
}

// grenades reads the effects each grenade type's projectile carries, by rank (himap's
// `ProjectilesDeGrenade`, the `gggl` order the film uses). A rank whose projectile or effects cannot
// be read is left out (logged); its look stays the view's own.
func (r shotReader) grenades(ctx context.Context, out *ShotTable) error {
	projs, err := r.w.a.ProjectilesDeGrenade()
	if err != nil {
		return err
	}
	for rank, id := range projs {
		raw, err := r.ix.Extract(id)
		if err != nil {
			slog.WarnContext(ctx, "grenade projectile unreadable", "rank", rank, "err", err)
			continue
		}
		p, err := readProjectile(raw)
		if err != nil {
			slog.WarnContext(ctx, "grenade projectile layout", "rank", rank, "projectile", fmt.Sprintf("%08x", id), "err", err)
			continue
		}
		g := GrenadeShot{Projectile: fmt.Sprintf("%08x", id), Flight: []string{}}
		for _, fid := range p.flight {
			fx, err := r.effect(ctx, fid, out.Effects)
			if err != nil {
				return err
			}
			if fx != nil {
				g.Flight = append(g.Flight, fmt.Sprintf("%08x", fid))
			}
		}
		if len(g.Flight) > 0 {
			out.Grenades[fmt.Sprint(rank)] = g
		}
	}
	return nil
}

// effect reads the effect `id` into `effects` once (its files written), and returns its particle
// systems as read; nil (logged) for an effect without a readable system.
func (r shotReader) effect(ctx context.Context, id uint32, effects map[string]ShotEffect) (*himap.EffetParticules, error) {
	fx, err := r.w.a.EffetDeParticules(id)
	if err != nil {
		slog.WarnContext(ctx, "shot effect without a readable system", "effect", fmt.Sprintf("%08x", id), "err", err)
		return nil, nil //nolint:nilerr // an effect the view cannot draw is left out, not fatal
	}
	key := fmt.Sprintf("%08x", id)
	if _, ok := effects[key]; ok {
		return fx, nil
	}
	for _, s := range fx.Skipped {
		slog.WarnContext(ctx, "shot effect system left out", "effect", key, "why", s)
	}
	raw, err := r.ix.Extract(id)
	if err != nil {
		return nil, err
	}
	delay, err := readDeathDelay(raw)
	if err != nil {
		return nil, fmt.Errorf("effect %s: %w", key, err)
	}
	e := ShotEffect{Effect: key, CameraRange: fx.CameraRange, DeathDelay: delay, Systems: []IdleSystem{}}
	for _, s := range fx.Systems {
		sys, err := r.w.system(s)
		if err != nil {
			return nil, err
		}
		e.Systems = append(e.Systems, sys)
	}
	effects[key] = e
	return fx, nil
}
