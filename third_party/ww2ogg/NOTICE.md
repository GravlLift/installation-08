# ww2ogg (ported code and embedded data)

`internal/wwvorbis` is a Go port of ww2ogg by hcs (Adam Gashlin), the Audiokinetic Wwise
RIFF Vorbis to Ogg Vorbis converter, reduced to the one layout Halo Infinite's voice media use.
The announcer build (`build-sounds`, and the server's announcer job) runs it in-process to
repack the game's voice lines into Ogg Vorbis files without decoding them. No ww2ogg source
file and no program is committed or shipped; the port is new Go code that follows ww2ogg's
`wwriff.cpp`, `codebook.cpp`, `codebook.h`, `Bit_stream.h` and `crc.c`.

- Upstream: https://github.com/hcs64/ww2ogg
- Commit: `14ed9b0dd62e815a38702b5f03c57006cbe2501b` (2024-10-12)
- License: BSD-3-Clause style, Copyright (c) 2002 Xiph.org Foundation, Copyright (c)
  2009-2016 Adam Gashlin; the exact text is in [COPYING](COPYING) and is repeated in the
  package documentation of `internal/wwvorbis`.

## Embedded data

`internal/wwvorbis/packed_codebooks_aoTuV_603.bin` is ww2ogg's packed codebook library for the
aoTuV 6.03 Vorbis encoder, copied unmodified and embedded in the binary (`go:embed`). The
stripped setup headers of the game's streams name their codebooks by index in this library.

| File | Size | SHA-256 |
| --- | --- | --- |
| `packed_codebooks_aoTuV_603.bin` | 74,387 bytes | `00A93EAB267D281401B1EFD54E888A2E183299B9E6C446C48D09F701A89D9D27` |
| `COPYING` | 1,504 bytes | `0A12F3490863FA01539F500FC74A0E8EFBFEB22852AAC087C645FBD7362D6726` |

Both were fetched from
`https://raw.githubusercontent.com/hcs64/ww2ogg/14ed9b0dd62e815a38702b5f03c57006cbe2501b/<file>`.
ww2ogg's other library, `packed_codebooks.bin`, also parses the game's setup headers but
decodes them to noise, so it is not used.

## Differences from ww2ogg

- Only the layout of the game's media is read: a little-endian RIFF with a 0x42-byte `fmt `
  chunk carrying the Vorbis fields, 2-byte packet headers, external codebooks, stripped setup.
  Other layouts (a `vorb` chunk, 6- or 8-byte packet headers, inline codebooks, a full setup or
  the header triad) are refused with an error.
- Audio packets are framed into pages of about 4 KB instead of one page per packet, and each
  page carries the granule position Vorbis defines (ww2ogg writes 0 when the media has no
  granules); the last page ends at the media header's sample count.
- No loop comments (the voice lines carry no `smpl` chunk).
