package grammar

// projectile_attaches.go — LOCAL-CHANGE (infinite-theater-3d): THE PROJECTILE THAT STICKS, read by
// the frame walk.
//
// WHAT THE FILM WRITES. A plasma or spike grenade that sticks to a player stops replicating its
// position: its last delta record carries no `object-position-component` (i0) but i1, i3,
// `object-parent-state-component` (i10) with its "attached" gate open, and `projectile-at-rest-state`
// (i18). The i10 attached branch names the PARENT (category 1 of `FUN_1406d3140`, base 0x200: the
// same handle the vehicle occupancy and the carried equipment read, [parentHandleBase]) and a pose
// relative to it. After that record the entity is silent until it is deleted at its detonation.
//
// The bit scan behind the projectile tracks ([echantillonDuRecord]) needs i0 and so never sees this
// record. The frame walk does: it reads the record list after an event list and walks every
// component at its ported width (i3 is `FUN_140d70998`, R(1) gate then R(19) + R(8), the biped's
// own deser), and its capture layer already hands back the i10 reading ([CompResult.ParentOf]).
//
// WHAT THIS CHANNEL RETURNS: the raw attach reads, one per ti=41 record whose i10 opens the attached
// gate, in stream order. No interpretation of the pose happens here.
//
// WHY THE COOK DOES NOT CALL IT (measured 2026-11-16, replay/projectiles_attaches_research_test.go):
// the pose is relative to a NODE of the parent (`Node` groups the detonation heights by body part),
// and no single dequantization of it fits the grenade's observed place on the parent. Composing the
// world position needs that node's transform, which the record does not carry.

import (
	"cmp"
	"slices"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar/lecture"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// ProjectileAttach is ONE attach read of a projectile: the ti=41 record whose i10 opens the attached
// gate.
type ProjectileAttach struct {
	// TimestampUS is the carrying packet's timestamp (same clock as ProjectileSample).
	TimestampUS uint64
	// Life is the projectile (slot, generation): the key of its ProjectileTrack.
	Life types.LifeKey
	// Parent is the object the projectile is attached to: the handle value plus the category base,
	// the same slot space as BipedPosition.Slot.
	Parent types.LifeKey
	// Node is the R(16) that follows the parent handle (ObjectParentState.Word16), raw.
	Node uint32
	// Pose is the 3 x R(16) triplet of the attached branch (ObjectParentState.Mtx), raw.
	Pose [3]uint32
	// HasOrient / Orient: the R(19) the attached branch reads when its sign bit is 0, raw.
	HasOrient bool
	Orient    uint32
	// Byte8 is the R(8) at the end of the attached branch, raw.
	Byte8 uint32
}

// projectileAttachesLus is what the channel read, kept in the film context.
type projectileAttachesLus struct {
	lectures []ProjectileAttach
}

// canalDesProjectilesAttaches reads the ti=41 records that carry an attached i10 ([CanalDesTrames]).
type canalDesProjectilesAttaches struct {
	fc *FilmContext
	m  *MarcheDistribuee
	lu projectileAttachesLus
}

func nouveauCanalDesProjectilesAttaches(fc *FilmContext) *canalDesProjectilesAttaches {
	return &canalDesProjectilesAttaches{fc: fc}
}

// Interets: the projectile archetype's i10.
func (c *canalDesProjectilesAttaches) Interets() []Interet {
	return []Interet{{Phase: PhaseTrames, TI: ProjectileTypeIndex, Composant: compObjectParentState}}
}

// Brancher keeps what the walk exposes; the channel sets no hook.
func (c *canalDesProjectilesAttaches) Brancher(_ *Observation, m *MarcheDistribuee) { c.m = m }

// Clore stores what the channel read in the context.
func (c *canalDesProjectilesAttaches) Clore(BilanDeMarche) {
	slices.SortStableFunc(c.lu.lectures, func(a, b ProjectileAttach) int {
		return cmp.Or(cmp.Compare(a.TimestampUS, b.TimestampUS), cmp.Compare(a.Life.Slot, b.Life.Slot))
	})
	c.fc.recup.projectilesAttaches = &c.lu
}

// Trame reads one delta frame: the records the walk read or, for a list it did not locate, the
// recovered view B (as the death channel does, [MarcheDistribuee.recupererLaListe]).
func (c *canalDesProjectilesAttaches) Trame(p *lecture.Paquet) {
	recs, lus := c.m.recordsDeLaTrame()
	if !lus && listeAnnoncee(&p.VueA) {
		recs, lus, _ = c.m.recupererLaListe()
	}
	if !lus {
		return
	}
	for i := range recs {
		r := &recs[i]
		// Only a record walked to its end: a reading before a desync has no proven alignment.
		if r.TypeIndex != ProjectileTypeIndex || r.Type != recDelta || r.DesyncAt != -1 {
			continue
		}
		st, ok := parentDuRecord(r)
		if !ok || !st.Attached {
			continue
		}
		c.lu.lectures = append(c.lu.lectures, ProjectileAttach{
			TimestampUS: p.TS,
			Life:        types.LifeKey{Slot: r.Slot, Gen: r.ID >> 30},
			Parent:      types.LifeKey{Slot: (st.Quant16 & parentHandleValueMask) + parentHandleBase, Gen: st.Quant16 >> 30},
			Node:        st.Word16, Pose: st.Mtx, HasOrient: st.HasVel, Orient: st.Vel, Byte8: st.Byte8,
		})
	}
}

// ScanProjectileAttaches returns the attach reads of a film ALREADY LOADED, in stream order: those the
// cooking's walk collected ([ScanMarcheDesTramesAvec]) when it ran, otherwise a walk made for them.
func ScanProjectileAttaches(fc *FilmContext) ([]ProjectileAttach, error) {
	if fc.recup.projectilesAttaches == nil {
		if err := Distribuer(fc, nouveauCanalDesProjectilesAttaches(fc)); err != nil {
			return nil, err
		}
	}
	return slices.Clone(fc.recup.projectilesAttaches.lectures), nil
}
