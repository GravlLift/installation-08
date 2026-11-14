package reloadsounds

// sound.go follows a `snd!` tag to the media it plays. A sound tag names two Wwise events, each
// with its bank: the event at +0x14 of the tag data (bank tag at +0x2c) and the one at +0x18
// (bank tag at +0x48). Measured on the reload sounds of the installed game: where a weapon's
// sound has both, the media of the first are mono and those of the second stereo, and some
// sounds have only the second. The first is the third-person event (a positioned voice, what
// the game plays for a player other than the camera's own first-person view); the second is the
// first-person one. The replay hears every player from outside, so it reads the first.

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/wwise"
)

const (
	soundOffThirdPersonEvent = 0x14
	soundOffThirdPersonBank  = 0x2c
)

// tagSource is the module index the build reads tags from (himap.ModuleIndex).
type tagSource interface {
	Extract(id uint32) ([]byte, error)
}

// thirdPersonEvent returns the third-person event of a sound tag and the tag of its bank;
// false when the sound has no third-person event.
func thirdPersonEvent(t *announcer.Tag) (event, bank uint32, ok bool) {
	data := t.TagData()
	if len(data) < soundOffThirdPersonBank+4 {
		return 0, 0, false
	}
	event = binary.LittleEndian.Uint32(data[soundOffThirdPersonEvent:])
	bank = binary.LittleEndian.Uint32(data[soundOffThirdPersonBank:])
	for _, d := range t.Deps {
		if d.Group == announcer.GroupBank && d.GlobalID == bank {
			return event, bank, event != 0
		}
	}
	return 0, 0, false
}

// media reads banks from the tags on demand and the streamed media from the game's SFX file
// packages, opened the first time a media is not embedded in its bank.
type media struct {
	tags     tagSource
	sfxDir   string
	banks    map[uint32]*wwise.Bank
	streamed map[uint64]streamRef
}

type streamRef struct {
	pack  *wwise.Package
	entry wwise.PackageEntry
}

func newMedia(tags tagSource, deployRoot string) *media {
	return &media{tags: tags, sfxDir: filepath.Join(announcer.SoundRoot(deployRoot), "SFX"), banks: map[uint32]*wwise.Bank{}}
}

// bank returns the parsed bank of a bank tag.
func (m *media) bank(tag uint32) (*wwise.Bank, error) {
	if b, ok := m.banks[tag]; ok {
		return b, nil
	}
	raw, err := m.tags.Extract(tag)
	if err != nil {
		return nil, fmt.Errorf("reloadsounds: bank %08x: %w", tag, err)
	}
	at := wwise.IndexBKHD(raw)
	if at < 0 {
		return nil, fmt.Errorf("reloadsounds: bank %08x has no BKHD", tag)
	}
	b, err := wwise.ParseBank(raw[at:])
	if err != nil {
		return nil, fmt.Errorf("reloadsounds: bank %08x: %w", tag, err)
	}
	m.banks[tag] = b
	return b, nil
}

// bytes returns a media's bytes: embedded in its bank, else streamed from an SFX package.
func (m *media) bytes(b *wwise.Bank, id uint32) ([]byte, error) {
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
	return nil, fmt.Errorf("reloadsounds: media %d is in no bank and no package", id)
}

// openPackages indexes the media of every SFX file package.
func (m *media) openPackages() error {
	entries, err := os.ReadDir(m.sfxDir)
	if err != nil {
		return fmt.Errorf("reloadsounds: %w", err)
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
