// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package meshopt is the cgo binding of the meshoptimizer codecs that glTF's
// EXT_meshopt_compression carries: the vertex buffer codec, the index buffer and index sequence
// codecs, and the exponential vertex filter. three.js's MeshoptDecoder (the viewer's
// `meshopt_decoder.module.js`) decodes them.
//
// The library is Arseny Kapoulkine's meshoptimizer (third_party/meshoptimizer, MIT, v1.3,
// unmodified), compiled by cgo from the u_*.cpp files of this package, one per upstream
// translation unit, the way internal/basisu builds Basis Universal. Only the codec sources are
// vendored: allocator, vertex codec, index codec and vertex filters.
//
// EXT_meshopt_compression is specified on the codecs' original formats: vertex data is encoded
// at format version 0 (every decoder since meshoptimizer 0.14 reads it; three r170's decoder
// predates version 1), index data at version 1 (0.14+). The v1 vertex format belongs to
// KHR_meshopt_compression, which the viewer's three does not read.
package meshopt

/*
#cgo CXXFLAGS: -O2 -std=c++11 -w
#cgo LDFLAGS: -static-libstdc++ -static-libgcc
#include <stdlib.h>
#include "../../third_party/meshoptimizer/src/meshoptimizer.h"
*/
import "C"

import (
	"errors"
	"fmt"
	"unsafe"
)

// ErrEncode: the encoder refused its input (a size the codec does not take).
var ErrEncode = errors.New("meshopt: encode failed")

// ErrDecode: the bytes are not a valid encoding of the stated size.
var ErrDecode = errors.New("meshopt: decode failed")

// vertexVersion is the vertex codec format version EXT_meshopt_compression carries.
const vertexVersion = 0

func ptr(b []byte) unsafe.Pointer {
	if len(b) == 0 {
		return nil
	}
	return unsafe.Pointer(&b[0])
}

// EncodeVertexBuffer encodes `count` vertices of `stride` bytes (a multiple of 4, at most 256)
// from `data` (count*stride bytes) with the vertex codec at format version 0.
func EncodeVertexBuffer(data []byte, count, stride int) ([]byte, error) {
	if stride <= 0 || stride%4 != 0 || stride > 256 || len(data) != count*stride {
		return nil, fmt.Errorf("%w: vertex buffer of %d bytes as %d x %d", ErrEncode, len(data), count, stride)
	}
	bound := int(C.meshopt_encodeVertexBufferBound(C.size_t(count), C.size_t(stride)))
	out := make([]byte, bound)
	n := C.meshopt_encodeVertexBufferLevel((*C.uchar)(ptr(out)), C.size_t(bound), ptr(data), C.size_t(count), C.size_t(stride), 2, vertexVersion)
	if n == 0 {
		return nil, fmt.Errorf("%w: vertex buffer", ErrEncode)
	}
	return out[:n], nil
}

// DecodeVertexBuffer decodes what EncodeVertexBuffer wrote: `count` vertices of `stride` bytes.
func DecodeVertexBuffer(enc []byte, count, stride int) ([]byte, error) {
	out := make([]byte, count*stride)
	if r := C.meshopt_decodeVertexBuffer(ptr(out), C.size_t(count), C.size_t(stride), (*C.uchar)(ptr(enc)), C.size_t(len(enc))); r != 0 {
		return nil, fmt.Errorf("%w: vertex buffer (%d)", ErrDecode, int(r))
	}
	return out, nil
}

// EncodeIndexBuffer encodes a triangle list (len divisible by 3) with the index codec.
// `vertexCount` bounds the indices (the encoder's worst-case size uses it).
func EncodeIndexBuffer(indices []uint32, vertexCount int) ([]byte, error) {
	if len(indices)%3 != 0 {
		return nil, fmt.Errorf("%w: %d indices is not a triangle list", ErrEncode, len(indices))
	}
	bound := int(C.meshopt_encodeIndexBufferBound(C.size_t(len(indices)), C.size_t(vertexCount)))
	out := make([]byte, bound)
	var ip *C.uint
	if len(indices) > 0 {
		ip = (*C.uint)(unsafe.Pointer(&indices[0]))
	}
	n := C.meshopt_encodeIndexBuffer((*C.uchar)(ptr(out)), C.size_t(bound), ip, C.size_t(len(indices)))
	if n == 0 {
		return nil, fmt.Errorf("%w: index buffer", ErrEncode)
	}
	return out[:n], nil
}

// EncodeIndexSequence encodes an index sequence of any topology with the index sequence codec.
func EncodeIndexSequence(indices []uint32, vertexCount int) ([]byte, error) {
	bound := int(C.meshopt_encodeIndexSequenceBound(C.size_t(len(indices)), C.size_t(vertexCount)))
	out := make([]byte, bound)
	var ip *C.uint
	if len(indices) > 0 {
		ip = (*C.uint)(unsafe.Pointer(&indices[0]))
	}
	n := C.meshopt_encodeIndexSequence((*C.uchar)(ptr(out)), C.size_t(bound), ip, C.size_t(len(indices)))
	if n == 0 {
		return nil, fmt.Errorf("%w: index sequence", ErrEncode)
	}
	return out[:n], nil
}

// DecodeIndexBuffer decodes `count` indices of `size` bytes (2 or 4) written by EncodeIndexBuffer.
func DecodeIndexBuffer(enc []byte, count, size int) ([]byte, error) {
	out := make([]byte, count*size)
	if r := C.meshopt_decodeIndexBuffer(ptr(out), C.size_t(count), C.size_t(size), (*C.uchar)(ptr(enc)), C.size_t(len(enc))); r != 0 {
		return nil, fmt.Errorf("%w: index buffer (%d)", ErrDecode, int(r))
	}
	return out, nil
}

// DecodeIndexSequence decodes `count` indices of `size` bytes written by EncodeIndexSequence.
func DecodeIndexSequence(enc []byte, count, size int) ([]byte, error) {
	out := make([]byte, count*size)
	if r := C.meshopt_decodeIndexSequence(ptr(out), C.size_t(count), C.size_t(size), (*C.uchar)(ptr(enc)), C.size_t(len(enc))); r != 0 {
		return nil, fmt.Errorf("%w: index sequence (%d)", ErrDecode, int(r))
	}
	return out, nil
}

// ExpMode is how the exponential filter shares exponents (meshopt_EncodeExpMode).
type ExpMode int

const (
	// ExpSeparate keeps one exponent per value (relative precision).
	ExpSeparate ExpMode = C.meshopt_EncodeExpSeparate
	// ExpSharedVector shares one exponent per vector.
	ExpSharedVector ExpMode = C.meshopt_EncodeExpSharedVector
	// ExpSharedComponent shares one exponent per component over the whole buffer: fixed point
	// at the resolution of the largest magnitude of that component.
	ExpSharedComponent ExpMode = C.meshopt_EncodeExpSharedComponent
)

// EncodeFilterExp encodes `count` vectors of stride/4 floats from `data` with the exponential
// filter (8-bit exponent, `bits`-bit mantissa, 1..24), returning count*stride bytes that the
// vertex codec then compresses. The decoder (meshopt_decodeFilterExp) yields 32-bit floats.
func EncodeFilterExp(data []float32, count, stride, bits int, mode ExpMode) ([]byte, error) {
	if stride <= 0 || stride%4 != 0 || stride > 256 || len(data) != count*stride/4 || bits < 1 || bits > 24 {
		return nil, fmt.Errorf("%w: exponential filter over %d floats as %d x %d at %d bits", ErrEncode, len(data), count, stride, bits)
	}
	out := make([]byte, count*stride)
	var dp *C.float
	if len(data) > 0 {
		dp = (*C.float)(unsafe.Pointer(&data[0]))
	}
	C.meshopt_encodeFilterExp(ptr(out), C.size_t(count), C.size_t(stride), C.int(bits), dp, C.enum_meshopt_EncodeExpMode(mode))
	return out, nil
}

// DecodeFilterExp decodes the exponential filter in place: count*stride bytes become floats.
func DecodeFilterExp(buf []byte, count, stride int) {
	if len(buf) < count*stride || count == 0 {
		return
	}
	C.meshopt_decodeFilterExp(ptr(buf), C.size_t(count), C.size_t(stride))
}
