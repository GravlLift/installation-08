// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package soundtags follows a `snd!` tag to the media its events play. A sound tag names two
// Wwise events, each with its bank: the event at +0x14 of the tag data (bank tag at +0x2c) and
// the one at +0x18 (bank tag at +0x48). Measured on the installed game: where a weapon's sound
// has both, the media of the first are mono and those of the second stereo, and some sounds have
// only the second. The first is the third-person event (a positioned voice, what the game plays
// for a player other than the camera's own first-person view); the second is the first-person
// one. The replay hears every player from outside, so it reads the first.
//
// The package is shared by the sound extractions that need it (internal/reloadsounds,
// internal/footstepsounds): the same tag layout, the same banks, the same streamed media.
package soundtags

import (
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/wwise"
)

const (
	// ThirdPersonEventOff is the offset of the third-person event in the tag data.
	ThirdPersonEventOff = 0x14
	// ThirdPersonBankOff is the offset of that event's bank tag in the tag data.
	ThirdPersonBankOff = 0x2c
	// FirstPersonEventOff, FirstPersonBankOff: the first-person event and its bank tag.
	FirstPersonEventOff = 0x18
	FirstPersonBankOff  = 0x48
)

// TagSource is the module index the build reads tags from (himap.ModuleIndex).
type TagSource interface {
	Extract(id uint32) ([]byte, error)
}

// BankLister is a TagSource that can list a module group's tags; himap.ModuleIndex is one. A
// Media given a BankLister can resolve a media against every bank of the game (the pool below).
type BankLister interface {
	TagSource
	EntreesDuGroupe(group string) []uint32
}

// Event returns the third-person event of a sound tag and the tag of its bank; false when the
// sound has no third-person event.
func Event(t *announcer.Tag) (event, bank uint32, ok bool) {
	return eventAt(t, ThirdPersonEventOff, ThirdPersonBankOff)
}

// FirstPersonEvent returns the first-person event of a sound tag (what the camera's own player
// hears) and the tag of its bank; false when the sound has none.
func FirstPersonEvent(t *announcer.Tag) (event, bank uint32, ok bool) {
	return eventAt(t, FirstPersonEventOff, FirstPersonBankOff)
}

// eventAt reads the event at evOff of the tag data and its bank tag at bankOff, the bank one of
// the tag's dependencies.
func eventAt(t *announcer.Tag, evOff, bankOff int) (event, bank uint32, ok bool) {
	data := t.TagData()
	if len(data) < bankOff+4 {
		return 0, 0, false
	}
	event = binary.LittleEndian.Uint32(data[evOff:])
	bank = binary.LittleEndian.Uint32(data[bankOff:])
	for _, d := range t.Deps {
		if d.Group == announcer.GroupBank && d.GlobalID == bank {
			return event, bank, event != 0
		}
	}
	return 0, 0, false
}

// Media reads banks from the tags on demand and the streamed media from the game's SFX file
// packages, opened the first time a media is not embedded in its bank.
type Media struct {
	tags     TagSource
	lister   BankLister
	sfxDir   string
	banks    map[uint32]*wwise.Bank
	streamed map[uint64]streamRef
	pool     map[uint32]uint32 // media id -> the tag of the bank that embeds it
	objPool  map[uint32]uint32 // HIRC object id -> the tag of the bank that has it
	attens   map[uint32]wwise.Attenuation
}

type streamRef struct {
	pack  *wwise.Package
	entry wwise.PackageEntry
}

// NewMedia reads the media whose banks come from tags and whose streams live in the SFX packages
// of the deploy root's sound folder.
func NewMedia(tags TagSource, deployRoot string) *Media {
	m := &Media{tags: tags, sfxDir: filepath.Join(announcer.SoundRoot(deployRoot), "SFX"), banks: map[uint32]*wwise.Bank{}}
	if l, ok := tags.(BankLister); ok {
		m.lister = l
	}
	return m
}

// Bank returns the parsed bank of a bank tag.
func (m *Media) Bank(tag uint32) (*wwise.Bank, error) {
	if b, ok := m.banks[tag]; ok {
		return b, nil
	}
	raw, err := m.tags.Extract(tag)
	if err != nil {
		return nil, fmt.Errorf("soundtags: bank %08x: %w", tag, err)
	}
	at := wwise.IndexBKHD(raw)
	if at < 0 {
		return nil, fmt.Errorf("soundtags: bank %08x has no BKHD", tag)
	}
	b, err := wwise.ParseBank(raw[at:])
	if err != nil {
		return nil, fmt.Errorf("soundtags: bank %08x: %w", tag, err)
	}
	m.banks[tag] = b
	return b, nil
}

// Bytes returns a media's bytes: embedded in its bank, else streamed from an SFX package, else
// embedded in another bank of the game. An event's media can span banks: the event's own bank
// embeds the first of them, and the rest live in a bank the game loads alongside it (measured on
// the foot step sounds, one shared bank per character). The Wwise runtime resolves media ids
// against the pool of every loaded bank, and so does the pool: on a first miss, the media id of
// every bank tag of the game is indexed, and the owning bank is read on demand (cached in
// m.banks).
func (m *Media) Bytes(b *wwise.Bank, id uint32) ([]byte, error) {
	if raw, ok := b.Embedded[id]; ok {
		return raw, nil
	}
	if m.streamed == nil {
		if err := m.openPackages(); err != nil {
			return nil, err
		}
	}
	if r, ok := m.streamed[uint64(id)]; ok {
		return r.pack.ReadEntry(r.entry)
	}
	if m.lister != nil {
		m.ensurePools()
		if owner, ok := m.pool[id]; ok {
			owned, err := m.Bank(owner)
			if err != nil {
				return nil, err
			}
			if raw, ok := owned.Embedded[id]; ok {
				return raw, nil
			}
		}
	}
	return nil, fmt.Errorf("soundtags: media %d is in no bank and no package", id)
}

// ensurePools indexes, the first time they are needed, the media id and the HIRC object id of
// every bank tag of the game; a bank that fails to read is skipped (its ids are simply unowned).
func (m *Media) ensurePools() {
	if m.pool != nil || m.lister == nil {
		return
	}
	m.pool = map[uint32]uint32{}
	m.objPool = map[uint32]uint32{}
	for _, tag := range m.lister.EntreesDuGroupe(announcer.GroupBank) {
		raw, err := m.tags.Extract(tag)
		if err != nil {
			continue
		}
		at := wwise.IndexBKHD(raw)
		if at < 0 {
			continue
		}
		b, err := wwise.ParseBank(raw[at:])
		if err != nil {
			continue
		}
		for id := range b.Embedded {
			if _, dup := m.pool[id]; !dup {
				m.pool[id] = tag
			}
		}
		for id := range b.Objects {
			if _, dup := m.objPool[id]; !dup {
				m.objPool[id] = tag
			}
		}
	}
}

// EventMedia returns the media ids an event plays. An event's Play actions can target containers
// that live in a bank the runtime loads alongside the event's own (measured on the foot step
// sounds: every take of a movement sound sits in a bank of its own); the banks that own the
// targets are linked into the event's bank through the game's bank pool, and the walk follows.
func (m *Media) EventMedia(b *wwise.Bank, event uint32) []uint32 {
	m.resolveEvent(b, event)
	return b.EventMedia(event)
}

// EventTargetTypes is EventTargetTypes of the event's bank, with the same cross-bank link.
func (m *Media) EventTargetTypes(b *wwise.Bank, event uint32) []byte {
	m.resolveEvent(b, event)
	return b.EventTargetTypes(event)
}

// Falloff is the part of a Wwise attenuation the viewer applies: the dry volume by distance to
// the listener, in the game's distance units. Each point is (distance, value, interpolation to
// the next point), the value being linear amplitude minus one (0 is 0 dB, -1 silence) and the
// interpolation Wwise's curve shape (wwise.CurvePoint).
type Falloff struct {
	Volume [][3]float64 `json:"volume"`
}

// FalloffOf returns the falloff of an attenuation; false when it has no dry volume curve.
func FalloffOf(a wwise.Attenuation) (Falloff, bool) {
	c, ok := a.Curve(wwise.AttenVolumeDry)
	if !ok || c.Scaling != wwise.ScalingDB || len(c.Points) == 0 {
		return Falloff{}, false
	}
	f := Falloff{Volume: make([][3]float64, len(c.Points))}
	for i, p := range c.Points {
		f.Volume[i] = [3]float64{round6(float64(p.Distance)), round6(float64(p.Value)), float64(p.Interp)}
	}
	return f, true
}

// round6 keeps six decimals, so a float32 read back as float64 writes short JSON.
func round6(v float64) float64 { return math.Round(v*1e6) / 1e6 }

// EventLayers is EventLayers of the event's bank, with the same cross-bank link.
func (m *Media) EventLayers(b *wwise.Bank, event uint32) [][]uint32 {
	m.resolveEvent(b, event)
	return b.EventLayers(event)
}

// EventMediaMix is EventMediaMix of the event's bank, with the same cross-bank link.
func (m *Media) EventMediaMix(b *wwise.Bank, event uint32) map[uint32]wwise.MediaMix {
	m.resolveEvent(b, event)
	return b.EventMediaMix(event)
}

// Attenuation returns the attenuation id, read from bank b's objects or, failing that, from the
// bank of the game that has it (the shared attenuations live in a bank of their own).
func (m *Media) Attenuation(b *wwise.Bank, id uint32) (wwise.Attenuation, bool) {
	if a, ok := m.attens[id]; ok {
		return a, true
	}
	o, ok := b.Objects[id]
	if !ok && m.lister != nil {
		m.ensurePools()
		if owner, found := m.objPool[id]; found {
			if owned, err := m.Bank(owner); err == nil {
				o, ok = owned.Objects[id]
			}
		}
	}
	if !ok {
		return wwise.Attenuation{}, false
	}
	a, err := wwise.ParseAttenuation(o)
	if err != nil {
		return wwise.Attenuation{}, false
	}
	if m.attens == nil {
		m.attens = map[uint32]wwise.Attenuation{}
	}
	m.attens[id] = a
	return a, true
}

// resolveEvent links the banks that own an event's Play targets into the event's bank. Idempotent:
// the banks are cached and LinkObjects keeps the union.
func (m *Media) resolveEvent(b *wwise.Bank, event uint32) {
	if m.lister == nil {
		return
	}
	m.ensurePools()
	for _, target := range b.PlayTargets(event) {
		owner, ok := m.objPool[target]
		if !ok {
			continue
		}
		owned, err := m.Bank(owner)
		if err != nil {
			continue
		}
		b.LinkObjects(owned.Objects)
	}
}

// openPackages indexes the media of every SFX file package.
func (m *Media) openPackages() error {
	entries, err := os.ReadDir(m.sfxDir)
	if err != nil {
		return fmt.Errorf("soundtags: %w", err)
	}
	m.streamed = map[uint64]streamRef{}
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".pck") {
			continue
		}
		p, err := wwise.ReadPackageFile(filepath.Join(m.sfxDir, e.Name()))
		if err != nil {
			return err
		}
		for _, pe := range p.Entries {
			if _, dup := m.streamed[pe.ID]; !dup && pe.Table != wwise.TableBanks {
				m.streamed[pe.ID] = streamRef{p, pe}
			}
		}
	}
	return nil
}
