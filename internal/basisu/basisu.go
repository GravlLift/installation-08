// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package basisu encodes images into KTX2 files with Basis Universal (ETC1S or UASTC LDR 4x4),
// the supercompressed GPU texture formats glTF's KHR_texture_basisu carries and three.js's
// KTX2Loader transcodes to the GPU's own block format (BC7 on desktop).
//
// The encoder is Binomial's C++ library (third_party/basisu, Apache-2.0, unmodified), compiled
// by cgo from the u_*.cpp files of this package, one per upstream translation unit. It needs
// CGO_ENABLED=1 and a C++ toolchain (mingw-w64 g++), like third_party/files-reader/ooz. The
// first build of this package compiles about 10 MB of C++ and takes about a minute; Go caches
// it. The encoder's threads come from mingw's winpthread, linked statically so a test binary does
// not pick up another program's libwinpthread-1.dll from PATH (the release exe links everything
// statically anyway, tools/package.ps1).
package basisu

/*
#cgo CXXFLAGS: -O2 -std=c++17 -msse4.1 -fno-strict-aliasing -w -DBASISU_SUPPORT_SSE=1 -DBASISU_SUPPORT_OPENCL=0 -DBASISU_SUPPORT_ASTCENC=0 -DBASISU_DISABLE_ANDROID_ASTC_DECOMP=0 -DBASISD_SUPPORT_KTX2=1 -DBASISD_SUPPORT_KTX2_ZSTD=1
#cgo CFLAGS: -O2 -w -DZSTD_DISABLE_ASM=1
#cgo LDFLAGS: -static-libstdc++ -static-libgcc
#cgo windows LDFLAGS: -static
#include <stdlib.h>
#include "wrapper.h"
*/
import "C"

import (
	"errors"
	"fmt"
	"image"
	"image/draw"
	"sync"
	"unsafe"
)

// Codec is the Basis Universal texture format of an encoded image.
type Codec int

const (
	// ETC1S is the small, lossy codec (about 1 to 2 bits per texel on disk); desktop GPUs receive it
	// transcoded to BC7 (or BC1/BC3).
	ETC1S Codec = iota
	// UASTC is the high-quality codec (8 bits per texel before Zstandard), transcoded near-losslessly
	// to BC7.
	UASTC
)

// Options are one image's encoding settings.
type Options struct {
	Codec Codec
	// SRGB marks color data: the KTX2 transfer function is sRGB (the viewer samples it through an
	// sRGB format), the encoder uses perceptual metrics and mipmaps are filtered in linear light.
	// False is data (masks, control maps, normals): linear everything.
	SRGB bool
	// NormalMap renormalizes the mip levels' vectors (RGB in [-1, 1]) and, for ETC1S, turns off the
	// rate-distortion passes that bend them.
	NormalMap bool
	// Mipmaps generates the full mip chain (compressed textures cannot be mipmapped on the GPU).
	Mipmaps bool
	// MipWrap filters mip levels as a tiled texture (wrap-around edges).
	MipWrap bool
	// ETC1SQuality is ETC1S's quality, 1 to 255 (codebook sizes); 0 is 128, the encoder's default.
	ETC1SQuality int
	// ETC1SEffort is ETC1S's compression level, 0 to 6 (speed versus quality at a given size).
	ETC1SEffort int
	// UASTCLevel is UASTC's pack level, 0 (fastest) to 4 (very slow); 2 is the default.
	UASTCLevel int
	// UASTCRDO is UASTC's rate-distortion lambda (smaller Zstandard output for a little more
	// error); 0 turns it off.
	UASTCRDO float32
	// ZstdLevel is the Zstandard supercompression level of a UASTC file; 0 writes it raw.
	ZstdLevel int
	// Threads is the encoder's own thread count for this image; 0 or 1 is single-threaded (the
	// caller encodes several images at once instead).
	Threads int
}

var initOnce sync.Once

func initLib() { initOnce.Do(func() { C.it3d_basis_init() }) }

// ErrEncode is returned when the encoder refuses or fails an image.
var ErrEncode = errors.New("basisu: encode failed")

// Encode encodes `img` into a KTX2 file. Its alpha is kept when any texel is not opaque.
func Encode(img image.Image, o Options) ([]byte, error) {
	initLib()
	src := toNRGBA(img)
	w, h := src.Rect.Dx(), src.Rect.Dy()
	if w <= 0 || h <= 0 {
		return nil, fmt.Errorf("%w: empty image", ErrEncode)
	}
	q := o.ETC1SQuality
	if q <= 0 {
		q = 128
	}
	opts := C.it3d_basis_opts{
		uastc:         cBool(o.Codec == UASTC),
		srgb:          cBool(o.SRGB),
		normal_map:    cBool(o.NormalMap),
		mipmaps:       cBool(o.Mipmaps),
		mip_wrap:      cBool(o.MipWrap),
		etc1s_quality: C.int(min(q, 255)),
		etc1s_effort:  C.int(min(max(o.ETC1SEffort, 0), 6)),
		uastc_level:   C.int(min(max(o.UASTCLevel, 0), 4)),
		uastc_rdo:     C.float(o.UASTCRDO),
		zstd_level:    C.int(max(o.ZstdLevel, 0)),
		threads:       C.int(max(o.Threads, 1)),
	}
	pix := C.CBytes(src.Pix)
	defer C.free(pix)
	var out *C.uint8_t
	var n C.size_t
	if rc := C.it3d_basis_encode((*C.uint8_t)(pix), C.uint32_t(w), C.uint32_t(h), &opts, &out, &n); rc != 0 {
		return nil, fmt.Errorf("%w: %dx%d, code %d", ErrEncode, w, h, int(rc))
	}
	defer C.it3d_basis_free(unsafe.Pointer(out))
	return C.GoBytes(unsafe.Pointer(out), C.int(n)), nil
}

// Decode transcodes mip level `level` of a Basis KTX2 file back to RGBA texels (for tests and
// quality measurements; the viewer transcodes on its own).
func Decode(ktx2 []byte, level int) (*image.NRGBA, error) {
	initLib()
	if len(ktx2) == 0 {
		return nil, errors.New("basisu: empty file")
	}
	data := C.CBytes(ktx2)
	defer C.free(data)
	var px *C.uint8_t
	var w, h C.uint32_t
	if rc := C.it3d_basis_decode((*C.uint8_t)(data), C.size_t(len(ktx2)), C.uint32_t(level), &px, &w, &h); rc != 0 {
		return nil, fmt.Errorf("basisu: decode failed, code %d", int(rc))
	}
	defer C.it3d_basis_free(unsafe.Pointer(px))
	img := image.NewNRGBA(image.Rect(0, 0, int(w), int(h)))
	copy(img.Pix, unsafe.Slice((*byte)(unsafe.Pointer(px)), len(img.Pix)))
	return img, nil
}

// toNRGBA returns `img` as straight-alpha RGBA texels with a zero origin and a tight stride.
func toNRGBA(img image.Image) *image.NRGBA {
	if n, ok := img.(*image.NRGBA); ok && n.Rect.Min == (image.Point{}) && n.Stride == 4*n.Rect.Dx() {
		return n
	}
	b := img.Bounds()
	n := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(n, n.Rect, img, b.Min, draw.Src)
	return n
}

func cBool(b bool) C.int {
	if b {
		return 1
	}
	return 0
}
