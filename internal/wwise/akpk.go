// Package wwise reads the Audiokinetic Wwise files Halo Infinite ships its audio in: the file
// packages (`.pck`, magic AKPK), the sound banks inside them (`.bnk`, chunk BKHD/DIDX/DATA/HIRC)
// and the media header of a `.wem` (a RIFF/WAVE container). It reads only; decoding the audio
// codec is not done here.
package wwise

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"unicode/utf16"
)

// Package table kinds: a package carries up to three file tables after its language map.
const (
	TableBanks     = "banks"     // sound banks (.bnk)
	TableStreams   = "streams"   // streamed media (.wem)
	TableExternals = "externals" // external sources (.wem, 64-bit ids)
)

// PackageEntry is one file inside a package: its Wwise id, the table it is listed in, its
// language (by name, from the package's language map; "" when the map has no such id), and
// where its bytes are.
type PackageEntry struct {
	ID       uint64
	Table    string
	Language string
	Offset   int64
	Size     int64
}

// Package is a parsed file package. Path is kept so entries can be read later.
type Package struct {
	Path      string
	Version   uint32
	Languages map[uint32]string
	Entries   []PackageEntry
}

// akpkHeaderSize is the fixed header: magic, header size, version, then the four table sizes.
const akpkHeaderSize = 0x1C

// ReadPackageFile parses the header and tables of the package at path. It reads only the
// header bytes, not the media.
func ReadPackageFile(path string) (*Package, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	head := make([]byte, 8)
	if _, err := io.ReadFull(f, head); err != nil {
		return nil, fmt.Errorf("wwise: %s: %w", path, err)
	}
	if string(head[:4]) != "AKPK" {
		return nil, fmt.Errorf("wwise: %s: not a file package (magic %q)", path, head[:4])
	}
	size := int64(binary.LittleEndian.Uint32(head[4:])) + 8
	buf := make([]byte, size)
	if _, err := f.ReadAt(buf, 0); err != nil {
		return nil, fmt.Errorf("wwise: %s: header: %w", path, err)
	}
	p, err := ParsePackage(buf)
	if err != nil {
		return nil, fmt.Errorf("wwise: %s: %w", path, err)
	}
	p.Path = path
	return p, nil
}

// ParsePackage parses the header block of a package (from its first byte to the end of its
// last table).
func ParsePackage(b []byte) (*Package, error) {
	if len(b) < akpkHeaderSize || string(b[:4]) != "AKPK" {
		return nil, errors.New("not a file package")
	}
	le := binary.LittleEndian
	p := &Package{Version: le.Uint32(b[8:])}
	sizes := []int{int(le.Uint32(b[0x0C:])), int(le.Uint32(b[0x10:])), int(le.Uint32(b[0x14:])), int(le.Uint32(b[0x18:]))}
	off := akpkHeaderSize
	if off+sizes[0] > len(b) {
		return nil, errors.New("language map out of bounds")
	}
	langs, err := parseLanguageMap(b[off : off+sizes[0]])
	if err != nil {
		return nil, err
	}
	p.Languages = langs
	off += sizes[0]
	for i, table := range []string{TableBanks, TableStreams, TableExternals} {
		n := sizes[i+1]
		if off+n > len(b) {
			return nil, fmt.Errorf("%s table out of bounds", table)
		}
		entries, err := parseFileTable(b[off:off+n], table, langs)
		if err != nil {
			return nil, err
		}
		p.Entries = append(p.Entries, entries...)
		off += n
	}
	return p, nil
}

// parseLanguageMap reads {count, then count x (string offset, id)} followed by the strings,
// offsets relative to the start of the map. Strings are UTF-16LE on Windows builds, 8-bit on
// others: a zero second byte tells which.
func parseLanguageMap(b []byte) (map[uint32]string, error) {
	out := map[uint32]string{}
	if len(b) < 4 {
		return out, nil
	}
	n := int(binary.LittleEndian.Uint32(b))
	if 4+8*n > len(b) {
		return nil, errors.New("language map entries out of bounds")
	}
	for i := 0; i < n; i++ {
		at := 4 + 8*i
		strOff := int(binary.LittleEndian.Uint32(b[at:]))
		id := binary.LittleEndian.Uint32(b[at+4:])
		if strOff >= len(b) {
			return nil, errors.New("language name out of bounds")
		}
		out[id] = readName(b[strOff:])
	}
	return out, nil
}

// readName reads a null-terminated name, UTF-16LE when its second byte is zero.
func readName(b []byte) string {
	if len(b) >= 2 && b[1] == 0 {
		var u []uint16
		for i := 0; i+1 < len(b); i += 2 {
			c := binary.LittleEndian.Uint16(b[i:])
			if c == 0 {
				break
			}
			u = append(u, c)
		}
		return string(utf16.Decode(u))
	}
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}

// parseFileTable reads {count, then count x (id, block size, file size, start block, language
// id)}. The externals table carries 64-bit ids, the others 32-bit ones.
func parseFileTable(b []byte, table string, langs map[uint32]string) ([]PackageEntry, error) {
	if len(b) < 4 {
		return nil, nil
	}
	le := binary.LittleEndian
	n := int(le.Uint32(b))
	idSize := 4
	if table == TableExternals {
		idSize = 8
	}
	stride := idSize + 16
	if 4+stride*n > len(b) {
		return nil, fmt.Errorf("%s table: %d entries overflow the table", table, n)
	}
	out := make([]PackageEntry, 0, n)
	for i := 0; i < n; i++ {
		at := 4 + stride*i
		var id uint64
		if idSize == 8 {
			id = le.Uint64(b[at:])
		} else {
			id = uint64(le.Uint32(b[at:]))
		}
		q := at + idSize
		block := int64(le.Uint32(b[q:]))
		if block == 0 {
			block = 1
		}
		out = append(out, PackageEntry{
			ID: id, Table: table,
			Size:     int64(le.Uint32(b[q+4:])),
			Offset:   int64(le.Uint32(b[q+8:])) * block,
			Language: langs[le.Uint32(b[q+12:])],
		})
	}
	return out, nil
}

// ReadEntry returns the bytes of one entry of the package.
func (p *Package) ReadEntry(e PackageEntry) ([]byte, error) {
	f, err := os.Open(p.Path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	out := make([]byte, e.Size)
	if _, err := f.ReadAt(out, e.Offset); err != nil {
		return nil, fmt.Errorf("wwise: %s: entry %d: %w", p.Path, e.ID, err)
	}
	return out, nil
}

// SortEntries orders entries by table then id, for stable listings.
func SortEntries(es []PackageEntry) {
	sort.Slice(es, func(i, j int) bool {
		if es[i].Table != es[j].Table {
			return es[i].Table < es[j].Table
		}
		return es[i].ID < es[j].ID
	})
}
