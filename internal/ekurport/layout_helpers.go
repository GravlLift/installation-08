// Raw-value helpers shared by the piece 3 layout readers.
package ekurport

import "encoding/binary"

// littleUint64 decodes 8 bytes as a little-endian unsigned 64-bit integer (the encoding of
// a FieldInt64Integer).
func littleUint64(b []byte) uint64 { return binary.LittleEndian.Uint64(b) }

// refID returns the signed global id of the tag reference at field offset off, exactly as
// stored (a null reference is -1). A FieldReference is laid out (common_types.rs
// FieldReference) as a u64 type pointer, the signed global id, a u64 asset id, a 4-byte
// group, and a local handle; the global id sits at off+8. The read is bounds-checked.
func refID(s Struct, off int) (int32, error) {
	return s.I32(off + 8)
}

// sid returns the signed string id at field offset off, exactly as stored (a Murmur3 hash
// written to tooling as a signed decimal). The read is bounds-checked.
func sid(s Struct, off int) (int32, error) {
	u, err := s.StringID(off)
	return int32(u), err
}

// rgb returns the three float32 components of a FieldRealRGBColor at offset off, in
// r, g, b order. The read is bounds-checked.
func rgb(s Struct, off int) (r, g, b float32, err error) {
	if r, err = s.F32(off); err != nil {
		return
	}
	if g, err = s.F32(off + 4); err != nil {
		return
	}
	if b, err = s.F32(off + 8); err != nil {
		return
	}
	return
}

// vec2 returns the two float32 components of a FieldRealVector2D at offset off, in x, y
// order. The read is bounds-checked.
func vec2(s Struct, off int) (x, y float32, err error) {
	if x, err = s.F32(off); err != nil {
		return
	}
	if y, err = s.F32(off + 4); err != nil {
		return
	}
	return
}
