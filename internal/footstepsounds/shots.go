// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package footstepsounds

// shots.go finds each weapon's own shot sound and extracts it with the same take, volume, falloff
// and layer reading as the foot steps.
//
// What the game stores (probed on every weapon of internal/refdata, 2026-11-19): a weapon tag
// names its sound tags as dependencies. For most semi-automatic weapons one of them is the shot:
// its third-person event plays a layer container of three random containers (near, mid and far),
// each 4 to 6 takes with an attenuation of its own that ends at 90 units (the Bandit's: 5 takes
// each, the far layer silent under 17 units). The other dependencies are short or quiet (a
// mechanism switch ending at 4 units, a shared single sound at -29 dB). The automatic weapons and
// a few others have no such dependency (their fire goes through effects not read here), and some
// have several (the Sidekick's and the Plasma Pistol's alternate or charged shots): those keep the
// shipped sound rather than a guess.
//
// The same sound tag also names a FIRST-PERSON event, what the shooter hears (probed on the
// Bandit and the S7, 2026-11-19): a random pick among 30 takes plus two single sounds, with no
// attenuation (heard in 2D), at higher volumes than the third-person layers (Bandit +4.5 dB, S7
// +13 dB). It is extracted next to the shot (Manifest.ShotsFirstPerson) for the followed
// player's own shots.

import (
	"fmt"
	"sort"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/refdata"
	"github.com/llampwall/infinite-theater-3d/internal/wwise"
)

// A shot plays at least this many layers, at least this many of them reaching this far.
const (
	shotMinLayers     = 3
	shotMinFarLayers  = 3
	shotMinReachUnits = 60
)

// Reasons a weapon gets no shot, counted in Result.Silent as "shot_<reason>".
const (
	ShotNone      = "shot_none"      // no dependency plays a layered, far-reaching shot
	ShotAmbiguous = "shot_ambiguous" // several do
	// ShotLoopUnreadable: the weapon's shot is a looping sound one of whose media this install
	// does not have; the weapon keeps its shipped sound.
	ShotLoopUnreadable = "shot_loop_unreadable"
)

// shots extracts the shot of every weapon key that has exactly one, into the manifest.
func (b *builder) shots() error {
	byKey := map[string][]uint32{}
	for id, key := range refdata.WeaponKeys() {
		byKey[key] = append(byKey[key], id)
	}
	keys := make([]string, 0, len(byKey))
	for key := range byKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		ids := byKey[key]
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		found := map[uint32]bool{}
		for _, id := range ids {
			cands, err := b.shotCandidates(id, key)
			if err != nil {
				return err
			}
			for _, c := range cands {
				found[c] = true
			}
		}
		var snd uint32
		switch len(found) {
		case 0:
			b.res.Silent[ShotNone] = append(b.res.Silent[ShotNone], key)
			continue
		case 1:
			for s := range found {
				snd = s
			}
		default:
			snd = b.primaryShot(ids, found)
			if snd == 0 {
				b.res.Silent[ShotAmbiguous] = append(b.res.Silent[ShotAmbiguous], key)
				continue
			}
		}
		f, err := b.soundTakes(snd)
		if err != nil && b.loops[snd] {
			b.res.Silent[ShotLoopUnreadable] = append(b.res.Silent[ShotLoopUnreadable], fmt.Sprintf("%s:%v", key, err))
			continue
		}
		if err != nil {
			return err
		}
		if len(f.Takes) == 0 {
			continue
		}
		fp, err := b.firstPersonTakes(snd)
		if err != nil && b.loops[snd] {
			b.res.Silent[ShotLoopUnreadable] = append(b.res.Silent[ShotLoopUnreadable], fmt.Sprintf("%s:%v", key, err))
			continue
		}
		if err != nil {
			return err
		}
		if b.res.Manifest.Shots == nil {
			b.res.Manifest.Shots = map[string]Footstep{}
		}
		b.res.Manifest.Shots[key] = f
		if len(fp.Takes) > 0 {
			if b.res.Manifest.ShotsFirstPerson == nil {
				b.res.Manifest.ShotsFirstPerson = map[string]Footstep{}
			}
			b.res.Manifest.ShotsFirstPerson[key] = fp
		}
	}
	return nil
}

// loopShots are the weapon keys whose shot may be a looping sound (`lsnd`). The Shock Rifle fires
// through one (7da2a96a, measured 2026-11-20): its play event starts two near/mid/far layers of
// three 0.5 to 0.7 s takes each, its first-person play event the shooter's takes, and no sound
// tag of the weapon holds a shot. The Needler's and the Sentinel Beam's loops pass the same layer
// test but start held sounds (83 ms grains, 3 s beam loops) that would be wrong played once a
// shot, and the game's loop flag is not decoded to tell them apart, so they are not listed.
//
// The automatic rifles (MA40, MA5K, Commando) fire through looping sounds too, but their loops
// switch between first-round, sustained and tail containers on game states not decoded here (the
// MA40's shooter pool mixes 83 ms grains with 3 s tails, the Commando's two layer sets share
// takes), so they are not listed either.
var loopShots = map[string]bool{"hinf_shock_rifle": true}

// shotCandidates lists the sound tags a weapon tag depends on whose event reads as a shot. A
// weapon of loopShots none of whose sound tags does is read through its looping sounds the same
// way, and only then.
func (b *builder) shotCandidates(weapon uint32, key string) ([]uint32, error) {
	tag, err := b.tag(weapon)
	if err != nil {
		return nil, nil //nolint:nilerr // a weapon key whose tag this install lacks has no shot
	}
	groups := []string{"snd!"}
	if loopShots[key] {
		groups = append(groups, "lsnd")
	}
	for _, group := range groups {
		var out []uint32
		for _, d := range tag.Deps {
			if d.Group != group {
				continue
			}
			if group == "lsnd" {
				b.loops[d.GlobalID] = true
			}
			ok, err := b.isShot(d.GlobalID)
			if err != nil {
				return nil, err
			}
			if ok {
				out = append(out, d.GlobalID)
			} else if group == "lsnd" {
				delete(b.loops, d.GlobalID)
			}
		}
		if len(out) > 0 {
			return out, nil
		}
	}
	return nil, nil
}

// The weapon tag's fire sounds table, measured on the Sidekick, Plasma Pistol, Ravager, Mutilator
// and Bandit (2026-11-20): a block at root +0x1100 of one 96-B element per fire mode, the first
// the weapon's normal fire (the Plasma Pistol's, Ravager's and Mutilator's second is the charged
// or alternate shot). An element's +0xc is a block of 28-B entries, each a shot sound reference at
// +0; the Sidekick's and the Plasma Pistol's first mode list three, the Bandit's one.
const (
	fireTableOff  = 0x1100
	fireModeShots = 0xc
)

// primaryShot resolves a weapon key with several shot candidates to the first shot its tags'
// first fire mode lists, among the candidates; 0 when none does. INFERRED: the game draws among a
// mode's listed shots (the entries carry no weight or condition); one of them plays here, at its
// exact layer levels, rather than a mix of the three.
func (b *builder) primaryShot(ids []uint32, found map[uint32]bool) uint32 {
	for _, id := range ids {
		tag, err := b.tag(id)
		if err != nil {
			continue
		}
		for _, snd := range firstModeShots(tag) {
			if found[snd] {
				return snd
			}
		}
	}
	return 0
}

// firstModeShots lists, in order, the shot sounds of the first element of a weapon tag's fire
// sounds table.
func firstModeShots(t *announcer.Tag) []uint32 {
	root := -1
	for _, s := range t.Structs {
		if s.FieldBlock == -1 && s.Target >= 0 {
			root = s.Target
			break
		}
	}
	table := childBlock(t, root, fireTableOff)
	list := childBlock(t, table, fireModeShots)
	if list < 0 {
		return nil
	}
	byOff := map[int]uint32{}
	var offs []int
	for _, r := range t.Refs {
		if r.FieldBlock != list || r.Dep < 0 || r.Dep >= len(t.Deps) {
			continue
		}
		if g := t.Deps[r.Dep].Group; g != "snd!" && g != "lsnd" {
			continue
		}
		byOff[r.FieldOffset] = t.Deps[r.Dep].GlobalID
		offs = append(offs, r.FieldOffset)
	}
	sort.Ints(offs)
	out := make([]uint32, 0, len(offs))
	for _, o := range offs {
		out = append(out, byOff[o])
	}
	return out
}

// childBlock returns the block the field at (owner, field) points to, or -1.
func childBlock(t *announcer.Tag, owner, field int) int {
	if owner < 0 {
		return -1
	}
	for _, s := range t.Structs {
		if s.FieldBlock == owner && s.FieldOffset == field && s.Target >= 0 {
			return s.Target
		}
	}
	return -1
}

// isShot reports whether a sound tag's third-person event plays a layer container whose layers
// reach far: shotMinLayers or more layers, shotMinFarLayers of them with a falloff ending at
// shotMinReachUnits or beyond.
func (b *builder) isShot(snd uint32) (bool, error) {
	tag, err := b.tag(snd)
	if err != nil {
		return false, nil //nolint:nilerr // a dependency the index lacks is not a shot
	}
	event, bankTag, ok := b.events(snd, false)(tag)
	if !ok {
		return false, nil
	}
	bk, err := b.media.Bank(bankTag)
	if err != nil {
		return false, fmt.Errorf("footstepsounds: shot %08x: %w", snd, err)
	}
	types := b.media.EventTargetTypes(bk, event)
	if len(types) == 0 || types[0] != wwise.HircLayer {
		return false, nil
	}
	layers := b.media.EventLayers(bk, event)
	if len(layers) < shotMinLayers {
		return false, nil
	}
	mix := b.media.EventMediaMix(bk, event)
	far := 0
	for _, l := range layers {
		a, ok := b.media.Attenuation(bk, mix[l[0]].Attenuation)
		if ok && a.MaxDistance() >= shotMinReachUnits {
			far++
		}
	}
	return far >= shotMinFarLayers, nil
}
