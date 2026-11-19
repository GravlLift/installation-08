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

	"github.com/llampwall/infinite-theater-3d/internal/refdata"
	"github.com/llampwall/infinite-theater-3d/internal/soundtags"
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
			cands, err := b.shotCandidates(id)
			if err != nil {
				return err
			}
			for _, c := range cands {
				found[c] = true
			}
		}
		switch len(found) {
		case 0:
			b.res.Silent[ShotNone] = append(b.res.Silent[ShotNone], key)
			continue
		case 1:
		default:
			b.res.Silent[ShotAmbiguous] = append(b.res.Silent[ShotAmbiguous], key)
			continue
		}
		var snd uint32
		for s := range found {
			snd = s
		}
		f, err := b.soundTakes(snd)
		if err != nil {
			return err
		}
		if len(f.Takes) == 0 {
			continue
		}
		if b.res.Manifest.Shots == nil {
			b.res.Manifest.Shots = map[string]Footstep{}
		}
		b.res.Manifest.Shots[key] = f
		fp, err := b.firstPersonTakes(snd)
		if err != nil {
			return err
		}
		if len(fp.Takes) > 0 {
			if b.res.Manifest.ShotsFirstPerson == nil {
				b.res.Manifest.ShotsFirstPerson = map[string]Footstep{}
			}
			b.res.Manifest.ShotsFirstPerson[key] = fp
		}
	}
	return nil
}

// shotCandidates lists the sound tags a weapon tag depends on whose event reads as a shot.
func (b *builder) shotCandidates(weapon uint32) ([]uint32, error) {
	tag, err := b.tag(weapon)
	if err != nil {
		return nil, nil //nolint:nilerr // a weapon key whose tag this install lacks has no shot
	}
	var out []uint32
	for _, d := range tag.Deps {
		if d.Group != "snd!" {
			continue
		}
		ok, err := b.isShot(d.GlobalID)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, d.GlobalID)
		}
	}
	return out, nil
}

// isShot reports whether a sound tag's third-person event plays a layer container whose layers
// reach far: shotMinLayers or more layers, shotMinFarLayers of them with a falloff ending at
// shotMinReachUnits or beyond.
func (b *builder) isShot(snd uint32) (bool, error) {
	tag, err := b.tag(snd)
	if err != nil {
		return false, nil //nolint:nilerr // a dependency the index lacks is not a shot
	}
	event, bankTag, ok := soundtags.Event(tag)
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
