// hmod.go — a standalone .module archive reader.
//
// Why local: the vendored himodule reader reads `data_offset` as a u32 at +0x18. That is
// correct for archives under 4 GiB, but `pc/globals/globals-rtx-new.module` is 7.78 GiB:
// the field is really a 48-bit integer (two bytes of flags in the high part). Measured
// symptom: extraction fails (ooz return -1) on every entry of that archive. So the
// header is read by hand here, and blocks are accessed by ReadAt (a 7.78 GiB archive is
// never loaded into memory).
//
// Header (0x48 bytes): magic 'mohd' | +0x04 version | +0x08 moduleId | +0x10 fileCount
//
//	+0x14..+0x1C manifests | +0x20 resourceIndex | +0x24 stringsSize | +0x28 resourceCount
//	+0x2C blockCount | +0x30 buildVersion | +0x38 hd1Delta | +0x40 dataSize
//
// File entry (0x58): +0x0A blockCount u16 | +0x0C firstBlock u32 | +0x14 group fourCC
//
//	+0x18 dataOffset 48b (+ flags 16b) | +0x20 compSize u32 | +0x24 uncompSize u32
//	+0x28 globalTagId u32 | +0x2C assetId u64
//
// Block (20 bytes): +0 compOff (relative to dataOffset) +4 compSize +8 decompOff
//
//	+12 decompSize +16 bCompressed
//
// Consistency check (measured, not postulated): the data base computed by the tables
// (`alignEnd`) must equal the one computed by the entries
// (`fileSize - max(dataOffset+compSize)`), up to alignment.

package weaponicons

import (
	"encoding/binary"
	"fmt"
	"os"

	"github.com/JGtm/halo-infinite-files-reader/ooz"
)

type hmHeader struct {
	Version       int32
	FileCount     int
	StringsSize   int
	ResourceCount int
	BlockCount    int
}

type hmFile struct {
	Index      int
	Group      string
	FirstBlock int
	BlockCount int
	DataOffset int64
	Flags      uint16
	CompSize   int
	UncompSize int
	GlobalID   uint32
	AssetID    uint64
}

type hmod struct {
	path           string
	f              *os.File
	size           int64
	hdr            hmHeader
	entries        []byte // file entry table
	blocks         []byte // block table
	dataBase       int64
	blocksDoubtful bool
}

func hmOpen(path string) (*hmod, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	fi, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, err
	}
	head := make([]byte, 0x48)
	if _, err := f.ReadAt(head, 0); err != nil {
		_ = f.Close()
		return nil, err
	}
	if string(head[:4]) != "mohd" {
		_ = f.Close()
		return nil, fmt.Errorf("magic mohd absent")
	}
	m := &hmod{path: path, f: f, size: fi.Size()}
	m.hdr = hmHeader{
		Version:       int32(binary.LittleEndian.Uint32(head[0x04:])),
		FileCount:     int(binary.LittleEndian.Uint32(head[0x10:])),
		StringsSize:   int(binary.LittleEndian.Uint32(head[0x24:])),
		ResourceCount: int(binary.LittleEndian.Uint32(head[0x28:])),
		BlockCount:    int(binary.LittleEndian.Uint32(head[0x2C:])),
	}
	entOff := int64(0x48)
	entLen := int64(m.hdr.FileCount) * 0x58
	m.entries = make([]byte, entLen)
	if _, err := f.ReadAt(m.entries, entOff); err != nil {
		_ = f.Close()
		return nil, err
	}
	// TABLE ORDER — measured, not postulated (hexdump + sweep):
	//
	//	[file entries] [2 u32 sentinels 00000000 ffffffff] [resources u32] [blocks 20b]
	//
	// The sentinel pair (the 8 bytes) is present on every `globals-rtx-new` examined;
	// without it the block table does not decode at all. Validation: `blocksPlausible`
	// must pass, and `dataBase` must match `size - max(dataOffset+compSize)` up to
	// alignment.
	resLen := int64(m.hdr.ResourceCount) * 4
	blkLen := int64(m.hdr.BlockCount) * 20
	filesEnd := entOff + entLen + int64(m.hdr.StringsSize)
	blkOff := filesEnd + 8 + resLen
	buf := make([]byte, blkLen)
	if _, err := f.ReadAt(buf, blkOff); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("block table unreadable: %w", err)
	}
	m.blocks = buf
	m.blocksDoubtful = !blocksPlausible(buf)
	m.dataBase = (blkOff + blkLen + 0xFFF) &^ 0xFFF
	return m, nil
}

// blocksPlausible: a structural validity criterion for a block table.
func blocksPlausible(buf []byte) bool {
	n := len(buf) / 20
	if n == 0 {
		return false
	}
	for i := 0; i < n; i++ {
		b := i * 20
		if binary.LittleEndian.Uint32(buf[b+16:]) > 1 {
			return false
		}
		if cs := binary.LittleEndian.Uint32(buf[b+4:]); cs == 0 || cs > 0x4000000 {
			return false
		}
	}
	return true
}

func (m *hmod) close() { _ = m.f.Close() }

func (m *hmod) file(i int) hmFile {
	e := i * 0x58
	b := m.entries
	raw := binary.LittleEndian.Uint64(b[e+0x18:])
	return hmFile{
		Index:      i,
		Group:      fourCCLE(binary.LittleEndian.Uint32(b[e+0x14:])),
		BlockCount: int(binary.LittleEndian.Uint16(b[e+0x0A:])),
		FirstBlock: int(binary.LittleEndian.Uint32(b[e+0x0C:])),
		DataOffset: int64(raw & 0x0000FFFFFFFFFFFF),
		Flags:      uint16(raw >> 48),
		CompSize:   int(binary.LittleEndian.Uint32(b[e+0x20:])),
		UncompSize: int(binary.LittleEndian.Uint32(b[e+0x24:])),
		GlobalID:   binary.LittleEndian.Uint32(b[e+0x28:]),
		AssetID:    binary.LittleEndian.Uint64(b[e+0x2C:]),
	}
}

// dataBaseByEntries: the base deduced from the NON-hd1 entries (cross-check of dataBase).
// Entries with the UseHd1 flag bit0 set point into the companion `.module_hd1` file and
// have nothing to do with the main file's base.
func (m *hmod) dataBaseByEntries() (base int64, nHd1 int) {
	var maxEnd int64
	for i := 0; i < m.hdr.FileCount; i++ {
		f := m.file(i)
		if f.Flags&1 != 0 {
			nHd1++
			continue
		}
		if end := f.DataOffset + int64(f.CompSize); end > maxEnd {
			maxEnd = end
		}
	}
	return m.size - maxEnd, nHd1
}

func (m *hmod) readAt(off int64, n int) ([]byte, error) {
	if off < 0 || off+int64(n) > m.size {
		return nil, fmt.Errorf("read out of bounds (off=%d n=%d size=%d)", off, n, m.size)
	}
	buf := make([]byte, n)
	if _, err := m.f.ReadAt(buf, off); err != nil {
		return nil, err
	}
	return buf, nil
}

// extract assembles an entry's blocks (or reads the single blob when BlockCount==0).
func (m *hmod) extract(f hmFile) ([]byte, error) {
	if f.UncompSize <= 0 {
		return nil, fmt.Errorf("uncompSize=%d", f.UncompSize)
	}
	if f.BlockCount == 0 {
		src, err := m.readAt(m.dataBase+f.DataOffset, f.CompSize)
		if err != nil {
			return nil, err
		}
		if f.CompSize == f.UncompSize {
			return src, nil
		}
		return ooz.Decompress(src, f.UncompSize)
	}
	out := make([]byte, f.UncompSize)
	for i := f.FirstBlock; i < f.FirstBlock+f.BlockCount; i++ {
		b := i * 20
		if b+20 > len(m.blocks) {
			return nil, fmt.Errorf("block %d out of table", i)
		}
		co := int64(binary.LittleEndian.Uint32(m.blocks[b:]))
		cs := int(binary.LittleEndian.Uint32(m.blocks[b+4:]))
		dorel := int(binary.LittleEndian.Uint32(m.blocks[b+8:]))
		ds := int(binary.LittleEndian.Uint32(m.blocks[b+12:]))
		comp := binary.LittleEndian.Uint32(m.blocks[b+16:])
		if dorel+ds > len(out) {
			return nil, fmt.Errorf("block %d overflows the output", i)
		}
		src, err := m.readAt(m.dataBase+f.DataOffset+co, cs)
		if err != nil {
			return nil, fmt.Errorf("block %d: %w", i, err)
		}
		if comp == 0 {
			copy(out[dorel:dorel+ds], src)
			continue
		}
		dec, err := ooz.Decompress(src, ds)
		if err != nil {
			return nil, fmt.Errorf("block %d: %w", i, err)
		}
		copy(out[dorel:dorel+ds], dec)
	}
	return out, nil
}
