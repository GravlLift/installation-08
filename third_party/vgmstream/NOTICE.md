# vgmstream (bundled program)

The packaged build carries `vgmstream-cli` in `tools\vgmstream\` next to
`infinite-theater-3d.exe`. The announcer build (`build-sounds`, and the server's announcer
job) runs it as a separate program to decode the game's Wwise Vorbis voice lines to WAV.
Nothing from it is linked into this program; it is shipped beside it, unmodified.

No binary is committed to this repository. `tools\package.ps1` takes the official release
below, refuses it unless its SHA-256 matches, and copies the files listed here out of it.

- Release: vgmstream r2168, `vgmstream-win64.zip`
- URL: https://github.com/vgmstream/vgmstream/releases/download/r2168/vgmstream-win64.zip
- Size: 4,574,355 bytes
- SHA-256: `692D45070852A35C1FA42726AA3C9DE528E44EEC925D37D99B1074256B99A229`
- Source: https://github.com/vgmstream/vgmstream/tree/r2168
  (commit `d9875b1fff307e4759dfb85e49e3d5e6fb196f7c`)

## Bundled files

`vgmstream-cli.exe` imports every DLL below (no delay-loaded imports), so all of them are
needed for it to start. `swresample-vgmstream-7.dll` is imported by nothing and is left out;
the decode of all 168 announcer lines runs without it. The zip's `README.md` and `USAGE.md`
are not shipped.

| File | Component and version | License | License text |
| --- | --- | --- | --- |
| `vgmstream-cli.exe` | vgmstream r2168 | ISC-style (vgmstream) | `COPYING` |
| `libvorbis.dll` | libvorbis 1.3.7 (with libvorbisfile) and libogg 1.3.5 | BSD-3-Clause | `LICENSE-libvorbis.txt`, `LICENSE-libogg.txt` |
| `libspeex-1.dll` | Speex 1.2.1 | BSD-3-Clause | `LICENSE-speex.txt` |
| `libcelt-0061.dll` | CELT 0.6.1 | BSD-3-Clause | `LICENSE-celt.txt` |
| `libcelt-0110.dll` | CELT 0.11.0 | BSD-3-Clause | `LICENSE-celt.txt` |
| `libmpg123-0.dll` | mpg123 1.33.7 (libmpg123) | LGPL-2.1 | `LICENSE-mpg123.txt` |
| `avcodec-vgmstream-63.dll` | FFmpeg n9.0.2 (libavcodec), libopus 1.6.1 linked in | LGPL-2.1-or-later; libopus BSD-3-Clause | `LICENSE-ffmpeg.md`, `LICENSE-ffmpeg-LGPLv2.1.txt`, `LICENSE-opus.txt` |
| `avformat-vgmstream-63.dll` | FFmpeg n9.0.2 (libavformat) | LGPL-2.1-or-later | `LICENSE-ffmpeg.md`, `LICENSE-ffmpeg-LGPLv2.1.txt` |
| `avutil-vgmstream-61.dll` | FFmpeg n9.0.2 (libavutil) | LGPL-2.1-or-later | `LICENSE-ffmpeg.md`, `LICENSE-ffmpeg-LGPLv2.1.txt` |

The versions are the ones the files report themselves (`vgmstream CLI decoder r2168`,
`Xiph.Org libVorbis 1.3.7`, `FFmpeg version n9.0.2`, `libopus 1.6.1`, the mpg123 and Speex
version strings) and the ones vgmstream's `doc/BUILD.md` and `ext_libs/licenses/` name at
r2168 (libogg 1.3.5, CELT 0.6.1 and 0.11.0).

## Where the license texts come from

Each file is a byte-for-byte copy of the upstream file at the release tag. Each one also
matches, byte for byte, the copy vgmstream keeps in `ext_libs/licenses/` at r2168.

| File here | Upstream file | Tag (commit) |
| --- | --- | --- |
| `COPYING` | https://github.com/vgmstream/vgmstream/blob/r2168/COPYING | `r2168` (`d9875b1fff307e4759dfb85e49e3d5e6fb196f7c`) |
| `LICENSE-libvorbis.txt` | https://gitlab.xiph.org/xiph/vorbis/-/blob/v1.3.7/COPYING | `v1.3.7` (`0657aee69dec8508a0011f47f3b69d7538e9d262`) |
| `LICENSE-libogg.txt` | https://gitlab.xiph.org/xiph/ogg/-/blob/v1.3.5/COPYING | `v1.3.5` (`e1774cd77f471443541596e09078e78fdc342e4f`) |
| `LICENSE-speex.txt` | https://gitlab.xiph.org/xiph/speex/-/blob/Speex-1.2.1/COPYING | `Speex-1.2.1` (`5dceaaf3e23ee7fd17c80cb5f02a838fd6c18e01`) |
| `LICENSE-celt.txt` | https://gitlab.xiph.org/xiph/celt/-/blob/v0.6.1/COPYING and https://gitlab.xiph.org/xiph/celt/-/blob/v0.11/COPYING (the two are identical) | `v0.6.1` (`8ccf148573277b983692e15d5f0753081f806bea`), `v0.11` = 0.11.0 (`0b405d1170122c859faab435405666506d52fa2e`) |
| `LICENSE-opus.txt` | https://gitlab.xiph.org/xiph/opus/-/blob/v1.6.1/COPYING | `v1.6.1` (`22244de5a79bd1d6d623c32e72bf1954b56235be`) |
| `LICENSE-mpg123.txt` | https://scm.orgis.org/view/mpg123/tags/1.33.7/COPYING (mpg123's SVN) | `tags/1.33.7` |
| `LICENSE-ffmpeg.md` | https://github.com/FFmpeg/FFmpeg/blob/n9.0.2/LICENSE.md | `n9.0.2` (`946fcce07b6dcd0331c8cc609192aeff5e1924f8`) |
| `LICENSE-ffmpeg-LGPLv2.1.txt` | https://github.com/FFmpeg/FFmpeg/blob/n9.0.2/COPYING.LGPLv2.1 | `n9.0.2` (`946fcce07b6dcd0331c8cc609192aeff5e1924f8`) |

`LICENSE-mpg123.txt` holds the LGPL 2.1 and, after it, the GPL 2 for parts of mpg123 that are
not the library; `libmpg123-0.dll` is the library, under the LGPL 2.1.

## FFmpeg build configuration

vgmstream builds the FFmpeg DLLs with the options in
https://github.com/vgmstream/vgmstream/blob/r2168/ext_libs/extra/ffmpeg_options.txt, passed
to FFmpeg's `configure` as described in the FFmpeg section of
https://github.com/vgmstream/vgmstream/blob/r2168/doc/BUILD-LIB.md: `--build-suffix=-vgmstream`,
`--disable-everything` with a list of audio decoders, demuxers and parsers re-enabled,
`--enable-libopus`, `--enable-swresample`. `--enable-gpl` is present only as a comment, and
neither `--enable-version3` nor `--enable-nonfree` appears. The configure line embedded in the
three DLLs agrees (no `--enable-gpl`, `--enable-version3` or `--enable-nonfree`), and each
reports `license: LGPL version 2.1 or later`.

The libjpeg-derived files that FFmpeg's `LICENSE.md` names (`jfdctfst.c`,
`jfdctint_template.c`, `jrevdct.c`) are built only with `fdctdsp` or `idctdsp`
(`libavcodec/Makefile`), which none of the enabled components selects in n9.0.2's
`configure`; the IJG credit requirement therefore does not apply to these DLLs.

## G.722.1 annex C and G.719 (Polycom Siren) decoders

`vgmstream-cli.exe` contains both decoders: the release workflow
(`.github/workflows/vs-win.yml`, through `msvc-build.ps1`) builds with
`vgmstream_msvc.props`, which defines `VGM_USE_G7221` and `VGM_USE_G719`, and the exe lists
`ITU G.722.1 annex C (Polycom Siren 14)` and `ITU G.719 annex B (Polycom Siren 22)`. Neither
is an external library; both are compiled from vgmstream's own tree.

- G.722.1 annex C (`src/coding/libs/g7221_lib.c`, `g7221_aes.c`, `g7221_data.h`): vgmstream's
  own decoder, reverse engineered from game executables with reference to Polycom's
  reference decoder. It carries no other copyright notice and is covered by `COPYING`.
- G.719 (`src/coding/libs/g719_dec.c`, `g719_tables.c`, `g719_transform.c`,
  `g719_unpack.c`, `g719_internal.h`): by its own header, it follows Namco's bitstream,
  "in practice being a cleaned up ref decoder" (the ITU-T G.719 reference decoder). It keeps the reference code's notice, reproduced here:

  ```
  ITU-T G.722.1 Fullband Extension Annex X. Source Code
  (c) 2008 Ericsson AB. and Polycom Inc.
  All rights reserved.
  ```

  vgmstream's tree carries no license from Ericsson or Polycom for this code:
  `ext_libs/licenses/` has no entry for it and `COPYING` does not name them. No file in
  vgmstream's tree states that the terms under which ITU-T publishes the reference code
  allow redistributing it in a binary.

Patent licensing of either codec is a separate question this notice does not address.

## Corresponding source (LGPL components)

mpg123 and the FFmpeg libraries are LGPL-2.1: whoever distributes their binaries must also
make their corresponding source available (LGPL-2.1 section 4), and that source includes the
scripts used to control the build (section 0). Their sources are:

- mpg123 1.33.7: https://www.mpg123.de/download/mpg123-1.33.7.tar.bz2 (built with plain
  `configure`, see vgmstream's `doc/BUILD-LIB.md` at r2168)
- FFmpeg n9.0.2: https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz (git tag `n9.0.2`), with
  vgmstream's `ext_libs/extra/ffmpeg_options.txt` and `doc/BUILD-LIB.md` at r2168 as the
  build configuration
- libopus 1.6.1 (BSD, linked into `avcodec`, needed to rebuild it as configured):
  https://downloads.xiph.org/releases/opus/opus-1.6.1.tar.gz

`vgmstream-cli.exe` loads the LGPL libraries as separate DLLs at run time, so a user can
replace them with interface-compatible builds (LGPL-2.1 section 6 b).

A published release of this program that carries `tools\vgmstream` must offer the mpg123 and
FFmpeg archives, and the two vgmstream build files, from the same place as the release (for
example as assets of the same release).
