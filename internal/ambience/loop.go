package ambience

// loop.go follows a looping sound tag (`lsnd`) to the media it plays. Measured on the background
// sounds of the eight maps level.go names: the tag data holds the play event at +0x10, its stop
// event at +0x14, and the global id of its bank tag (`sbnk`) at +0x28. The play event targets a
// Sound or a random container of one quad media, 16 to 63 s long, in Wwise Vorbis.

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
	loopOffPlay = 0x10
	loopOffBank = 0x28
)

// tagSource is the module index the build reads tags from (himap.ModuleIndex).
type tagSource interface {
	Extract(id uint32) ([]byte, error)
}

// loopEvent returns the play event of a looping sound tag and the tag of its bank; false when
// the tag names no event or its bank is not one of its dependencies.
func loopEvent(t *announcer.Tag) (event, bank uint32, ok bool) {
	data := t.TagData()
	if len(data) < loopOffBank+4 {
		return 0, 0, false
	}
	event = binary.LittleEndian.Uint32(data[loopOffPlay:])
	bank = binary.LittleEndian.Uint32(data[loopOffBank:])
	for _, d := range t.Deps {
		if d.Group == announcer.GroupBank && d.GlobalID == bank {
			return event, bank, event != 0
		}
	}
	return 0, 0, false
}

// parseBank reads a bank tag's Wwise bank.
func parseBank(tags tagSource, tag uint32) (*wwise.Bank, error) {
	raw, err := tags.Extract(tag)
	if err != nil {
		return nil, fmt.Errorf("bank %08x: %w", tag, err)
	}
	at := wwise.IndexBKHD(raw)
	if at < 0 {
		return nil, fmt.Errorf("bank %08x has no BKHD", tag)
	}
	b, err := wwise.ParseBank(raw[at:])
	if err != nil {
		return nil, fmt.Errorf("bank %08x: %w", tag, err)
	}
	return b, nil
}

// streams indexes the media of the game's SFX file packages, opened the first time a media is
// not embedded in its bank, and kept across maps.
type streams struct {
	dir     string
	entries map[uint64]streamRef
}

type streamRef struct {
	pack  *wwise.Package
	entry wwise.PackageEntry
}

// mediaBytes returns a media's bytes: embedded in its bank, else streamed from an SFX package.
func (s *streams) mediaBytes(b *wwise.Bank, id uint32) ([]byte, error) {
	if raw, ok := b.Embedded[id]; ok {
		return raw, nil
	}
	if s.entries == nil {
		if err := s.open(); err != nil {
			return nil, err
		}
	}
	if r, ok := s.entries[uint64(id)]; ok {
		return r.pack.ReadEntry(r.entry)
	}
	return nil, fmt.Errorf("media %d is in no bank and no package", id)
}

func (s *streams) open() error {
	list, err := os.ReadDir(s.dir)
	if err != nil {
		return fmt.Errorf("ambience: %w", err)
	}
	s.entries = map[uint64]streamRef{}
	for _, e := range list {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".pck") {
			continue
		}
		p, err := wwise.ReadPackageFile(filepath.Join(s.dir, e.Name()))
		if err != nil {
			return err
		}
		for _, pe := range p.Entries {
			if _, dup := s.entries[pe.ID]; !dup && pe.Table != wwise.TableBanks {
				s.entries[pe.ID] = streamRef{p, pe}
			}
		}
	}
	return nil
}
