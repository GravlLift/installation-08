// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package announcer

import (
	"context"
	"encoding/binary"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/JGtm/halo-infinite-files-reader/himodule"

	"github.com/llampwall/infinite-theater-3d/internal/wwise"
)

// PackPrefix is the start of every announcer file package name: the packages are named after
// their sound bank, `sb_001_vo_ai_mp_announcer` and its per-mode and patch siblings.
const PackPrefix = "sb_001_vo_"

// packIsAnnouncer keeps the announcer's packages among a language folder's voice packages.
func packIsAnnouncer(name string) bool {
	n := strings.ToLower(name)
	return strings.HasPrefix(n, PackPrefix) && strings.Contains(n, "_mp_announcer")
}

// Take is one recording of a vocalization: its sound tag, the Wwise event that tag posts, the
// bank holding the event, and the media the event plays.
type Take struct {
	Sound    uint32
	Bank     string
	Event    uint32
	MediaIDs []uint32
}

// Line is a vocalization of the announcer and its takes.
type Line struct {
	Vocalization uint32
	Takes        []Take
}

// Catalog is the announcer as the game ships it: every vocalization of its dialogue tag, and
// the language packages that hold the media.
type Catalog struct {
	Lines  map[uint32]Line
	Packs  []*wwise.Package
	Banks  []string
	Sounds int
	// embedded is the media the banks carry themselves (most lines stream from the packages).
	embedded map[uint32][]byte
}

// Lookup returns the line of a vocalization name ("doublekill").
func (c *Catalog) Lookup(name string) (Line, bool) {
	l, ok := c.Lines[StringID(name)]
	return l, ok
}

// SoundRoot is the game's Wwise folder next to its deploy root.
func SoundRoot(deployRoot string) string {
	return filepath.Join(filepath.Dir(deployRoot), "Sound", "win")
}

// Discover builds the catalog from a game install: the announcer's packages in packDir (a
// language folder of SoundRoot), its banks in the platform globals modules, its sound and
// dialogue tags in the shared globals modules.
func Discover(ctx context.Context, deployRoot, packDir string) (*Catalog, error) {
	packs, banksWanted, err := readPacks(packDir)
	if err != nil {
		return nil, err
	}
	banks, err := readBanks(filepath.Join(deployRoot, "pc", "globals"), banksWanted)
	if err != nil {
		return nil, err
	}
	if len(banks) == 0 {
		return nil, fmt.Errorf("announcer: no announcer sound bank found under %s", filepath.Join(deployRoot, "pc", "globals"))
	}
	c := &Catalog{Lines: map[uint32]Line{}, Packs: packs, embedded: map[uint32][]byte{}}
	for _, b := range banks {
		c.Banks = append(c.Banks, b.name)
		for id, m := range b.bank.Embedded {
			c.embedded[id] = m
		}
	}
	sort.Strings(c.Banks)
	if err := c.readTags(filepath.Join(deployRoot, "any", "globals"), banks); err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "announcer catalog", "packs", len(packs), "banks", len(banks), "sounds", c.Sounds, "lines", len(c.Lines))
	return c, nil
}

// HasPackages reports whether a language folder holds an announcer package.
func HasPackages(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if !e.IsDir() && strings.EqualFold(filepath.Ext(e.Name()), ".pck") && packIsAnnouncer(e.Name()) {
			return true
		}
	}
	return false
}

// readPacks parses the announcer packages of a language folder and returns the bank ids their
// names give (a package is named after its bank, and a bank's id is the hash of its name).
func readPacks(dir string) ([]*wwise.Package, map[uint32]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, nil, fmt.Errorf("announcer: %w", err)
	}
	var packs []*wwise.Package
	wanted := map[uint32]string{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.EqualFold(filepath.Ext(name), ".pck") || !packIsAnnouncer(name) {
			continue
		}
		p, err := wwise.ReadPackageFile(filepath.Join(dir, name))
		if err != nil {
			return nil, nil, err
		}
		packs = append(packs, p)
		base := strings.TrimSuffix(name, filepath.Ext(name))
		wanted[wwise.ID(base)] = strings.ToLower(base)
	}
	if len(packs) == 0 {
		return nil, nil, fmt.Errorf("announcer: no announcer package in %s", dir)
	}
	return packs, wanted, nil
}

// namedBank is an announcer bank and the tag that holds it.
type namedBank struct {
	name string
	tag  uint32
	bank *wwise.Bank
}

// readBanks finds the wanted banks among the `sbnk` tags of a modules folder.
func readBanks(dir string, wanted map[uint32]string) (map[uint32]*namedBank, error) {
	out := map[uint32]*namedBank{}
	err := eachModule(dir, func(m *himodule.Module) error {
		for _, f := range m.Files(GroupBank) {
			data, err := m.Extract(f)
			if err != nil {
				return err
			}
			at := wwise.IndexBKHD(data)
			if at < 0 {
				continue
			}
			bk, err := wwise.ParseBank(data[at:])
			if err != nil {
				continue
			}
			if name, ok := wanted[bk.ID]; ok {
				out[f.GlobalID] = &namedBank{name: name, tag: f.GlobalID, bank: bk}
			}
		}
		return nil
	})
	return out, err
}

// eachModule opens every module of a folder in turn.
func eachModule(dir string, fn func(*himodule.Module) error) error {
	paths, err := filepath.Glob(filepath.Join(dir, "*.module"))
	if err != nil {
		return err
	}
	for _, p := range paths {
		m, err := himodule.Open(p)
		if err != nil {
			return fmt.Errorf("announcer: %s: %w", p, err)
		}
		ferr := fn(m)
		cerr := m.Close()
		if ferr != nil {
			return ferr
		}
		if cerr != nil {
			return cerr
		}
	}
	return nil
}

// readTags reads the sound tags that post an announcer event, then the dialogue tags that use
// those sounds, and fills the catalog's lines.
func (c *Catalog) readTags(dir string, banks map[uint32]*namedBank) error {
	takes := map[uint32]Take{}
	var dialogues [][]byte
	err := eachModule(dir, func(m *himodule.Module) error {
		for _, f := range m.Files(GroupSound) {
			data, err := m.Extract(f)
			if err != nil {
				return err
			}
			if t, ok := soundTake(data, banks); ok {
				t.Sound = f.GlobalID
				takes[f.GlobalID] = t
			}
		}
		for _, f := range m.Files("udlg") {
			data, err := m.Extract(f)
			if err != nil {
				return err
			}
			dialogues = append(dialogues, data)
		}
		return nil
	})
	if err != nil {
		return err
	}
	c.Sounds = len(takes)
	for _, raw := range dialogues {
		t, err := ParseTag(raw)
		if err != nil {
			continue
		}
		for _, v := range Vocalizations(t) {
			line := c.Lines[v.Name]
			line.Vocalization = v.Name
			for _, s := range v.Sounds {
				if take, ok := takes[s]; ok {
					line.Takes = append(line.Takes, take)
				}
			}
			if len(line.Takes) > 0 {
				c.Lines[v.Name] = line
			}
		}
	}
	return nil
}

// soundTake reads a sound tag: the announcer bank it depends on, and the event it posts (the
// tag-data value that is an event of that bank).
func soundTake(data []byte, banks map[uint32]*namedBank) (Take, bool) {
	t, err := ParseTag(data)
	if err != nil {
		return Take{}, false
	}
	for _, d := range t.Deps {
		nb, ok := banks[d.GlobalID]
		if d.Group != GroupBank || !ok {
			continue
		}
		body := t.TagData()
		for o := 0; o+4 <= len(body); o += 4 {
			ev := binary.LittleEndian.Uint32(body[o:])
			if media := nb.bank.EventMedia(ev); len(media) > 0 {
				return Take{Bank: nb.name, Event: ev, MediaIDs: media}, true
			}
		}
	}
	return Take{}, false
}
