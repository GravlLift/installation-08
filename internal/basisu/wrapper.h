// wrapper.h: the C surface of wrapper.cpp, shared with the cgo preamble of basisu.go.
#ifndef IT3D_BASISU_WRAPPER_H
#define IT3D_BASISU_WRAPPER_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
	int uastc;         // 1: UASTC LDR 4x4, 0: ETC1S
	int srgb;          // sRGB transfer function, perceptual metrics and sRGB-correct mip filtering
	int normal_map;    // tangent-space normals: renormalized mips (and no ETC1S RDO)
	int mipmaps;       // generate the full mip chain
	int mip_wrap;      // mip filtering wraps around the edges (tiled textures)
	int etc1s_quality; // ETC1S: 1..255
	int etc1s_effort;  // ETC1S: compression level 0..6
	int uastc_level;   // UASTC: pack level 0..4
	float uastc_rdo;   // UASTC: RDO lambda, 0 = off
	int zstd_level;    // UASTC: Zstandard supercompression level, 0 = none
	int threads;       // encoder job pool threads (1 = single-threaded)
} it3d_basis_opts;

void it3d_basis_init(void);
int it3d_basis_encode(const uint8_t* rgba, uint32_t w, uint32_t h, const it3d_basis_opts* o, uint8_t** out, size_t* out_len);
int it3d_basis_decode(const uint8_t* ktx2, size_t len, uint32_t level, uint8_t** rgba, uint32_t* w, uint32_t* h);
void it3d_basis_free(void* p);

#ifdef __cplusplus
}
#endif

#endif
