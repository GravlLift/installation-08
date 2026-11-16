// wrapper.cpp: the small C surface this package calls, over Basis Universal's encoder and KTX2
// transcoder (third_party/basisu, Apache-2.0, unmodified).

#include "../../third_party/basisu/encoder/basisu_comp.h"
#include "../../third_party/basisu/transcoder/basisu_transcoder.h"

#include <cstdlib>
#include <cstring>

#include "wrapper.h"

using namespace basisu;

extern "C" void it3d_basis_init(void)
{
	basisu_encoder_init(false, false);
	basist::basisu_transcoder_init();
}

extern "C" int it3d_basis_encode(const uint8_t* rgba, uint32_t w, uint32_t h, const it3d_basis_opts* o, uint8_t** out, size_t* out_len)
{
	*out = nullptr;
	*out_len = 0;
	if (!rgba || !w || !h || !o)
		return 1;

	job_pool jp(o->threads > 0 ? (uint32_t)o->threads : 1);

	basis_compressor_params p;
	p.set_format_mode(o->uastc ? basist::basis_tex_format::cUASTC_LDR_4x4 : basist::basis_tex_format::cETC1S);
	p.m_pJob_pool = &jp;
	p.m_multithreading = o->threads > 1;
	p.m_read_source_images = false;
	p.m_write_output_basis_or_ktx2_files = false;
	p.m_create_ktx2_file = true;
	p.m_status_output = false;
	p.m_print_stats = false;
	p.m_debug = false;
	p.m_compute_stats = false;

	p.m_source_images.resize(1);
	image& img = p.m_source_images[0];
	img.resize(w, h);
	memcpy(img.get_ptr(), rgba, (size_t)w * h * 4);

	const bool srgb = o->srgb != 0;
	p.set_srgb_options(srgb);
	p.set_ldr_srgb_channel_weights(srgb);

	p.m_mip_gen = o->mipmaps != 0;
	p.m_mip_wrapping = o->mip_wrap != 0;
	p.m_mip_renormalize = o->normal_map != 0;

	if (o->uastc)
	{
		p.m_pack_uastc_ldr_4x4_flags = (uint32_t)o->uastc_level;
		if (o->uastc_rdo > 0.0f)
		{
			p.m_rdo_uastc_ldr_4x4 = true;
			p.m_rdo_uastc_ldr_4x4_quality_scalar = o->uastc_rdo;
		}
		if (o->zstd_level > 0)
		{
			p.m_ktx2_uastc_supercompression = basist::KTX2_SS_ZSTANDARD;
			p.m_ktx2_zstd_supercompression_level = o->zstd_level;
		}
	}
	else
	{
		p.m_quality_level = o->etc1s_quality;
		p.m_etc1s_compression_level = o->etc1s_effort;
		if (o->normal_map)
		{
			p.m_no_selector_rdo = true;
			p.m_no_endpoint_rdo = true;
		}
	}


	basis_compressor c;
	if (!c.init(p))
		return 2;
	if (c.process() != basis_compressor::cECSuccess)
		return 3;

	const uint8_vec& file = c.get_output_ktx2_file();
	if (file.empty())
		return 4;
	uint8_t* buf = (uint8_t*)malloc(file.size());
	if (!buf)
		return 5;
	memcpy(buf, file.get_ptr(), file.size());
	*out = buf;
	*out_len = file.size();
	return 0;
}

extern "C" int it3d_basis_decode(const uint8_t* ktx2, size_t len, uint32_t level, uint8_t** rgba, uint32_t* w, uint32_t* h)
{
	*rgba = nullptr;
	*w = *h = 0;
	basist::ktx2_transcoder t;
	if (!t.init(ktx2, (uint32_t)len))
		return 1;
	if (level >= t.get_levels())
		return 2;
	if (!t.start_transcoding())
		return 3;
	basist::ktx2_image_level_info info;
	if (!t.get_image_level_info(info, level, 0, 0))
		return 4;
	const size_t n = (size_t)info.m_orig_width * info.m_orig_height;
	uint8_t* buf = (uint8_t*)malloc(n * 4);
	if (!buf)
		return 5;
	if (!t.transcode_image_level(level, 0, 0, buf, (uint32_t)n, basist::transcoder_texture_format::cTFRGBA32))
	{
		free(buf);
		return 6;
	}
	*rgba = buf;
	*w = info.m_orig_width;
	*h = info.m_orig_height;
	return 0;
}

extern "C" void it3d_basis_free(void* p)
{
	free(p);
}
