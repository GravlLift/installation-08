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

## Bundled files

`vgmstream-cli.exe` imports every DLL below (no delay-loaded imports), so all of them are
needed for it to start. `swresample-vgmstream-7.dll` is imported by nothing and is left out;
the decode of all 168 announcer lines runs without it. The zip's `README.md` and `USAGE.md`
are not shipped.

| File | Component and version | License | License text |
| --- | --- | --- | --- |
| `vgmstream-cli.exe` | vgmstream r2168 | ISC-style (vgmstream) | `COPYING` |
| `libvorbis.dll` | libvorbis 1.3.7 with libogg | BSD-3-Clause (Xiph.Org) | `LICENSE-xiph-vorbis-ogg.txt` |
| `libspeex-1.dll` | Speex 1.2.1 | BSD-3-Clause (Xiph.Org and others) | `LICENSE-speex.txt` |
| `libcelt-0061.dll` | CELT 0.6.1 | BSD-3-Clause | `LICENSE-celt.txt` |
| `libcelt-0110.dll` | CELT 0.11.0 | BSD-3-Clause | `LICENSE-celt.txt` |
| `libmpg123-0.dll` | mpg123 1.33.7 | LGPL-2.1 | `LICENSE-LGPL-2.1.txt` |
| `avcodec-vgmstream-63.dll` | FFmpeg n9.0.2 (libavcodec), with libopus 1.6.1 inside | LGPL-2.1-or-later; libopus BSD-3-Clause | `LICENSE-LGPL-2.1.txt`, `LICENSE-opus.txt` |
| `avformat-vgmstream-63.dll` | FFmpeg n9.0.2 (libavformat) | LGPL-2.1-or-later | `LICENSE-LGPL-2.1.txt` |
| `avutil-vgmstream-61.dll` | FFmpeg n9.0.2 (libavutil) | LGPL-2.1-or-later | `LICENSE-LGPL-2.1.txt` |

The versions are the ones the files report themselves (`vgmstream CLI decoder r2168`,
`Xiph.Org libVorbis 1.3.7`, `FFmpeg version n9.0.2`, the mpg123 and Speex version strings).
The FFmpeg DLLs state their own license (`libavcodec license: LGPL version 2.1 or later`, the
same for libavformat and libavutil) and carry their configure line (`--build-suffix=-vgmstream
... --disable-everything ... --enable-libopus`, no `--enable-gpl`, no `--enable-nonfree`).

`vgmstream-cli.exe` also names the ITU G.722.1 annex C and G.719 annex B (Polycom Siren)
decoders among its formats. The release's only license file for the exe is `COPYING`; this
notice makes no further claim about the origin of that decoder code.

## Corresponding source (LGPL components)

mpg123 and the FFmpeg libraries are LGPL-2.1: whoever distributes their binaries must also
make their corresponding source available (LGPL-2.1 section 4). Their sources are:

- mpg123 1.33.7: https://www.mpg123.de/download/mpg123-1.33.7.tar.bz2
- FFmpeg n9.0.2: https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz (git tag `n9.0.2`),
  configured with the line the DLLs carry (vgmstream's own build, `--build-suffix=-vgmstream`)

A published release of this program that carries `tools\vgmstream` must offer these two
archives from the same place as the release (for example as assets of the same release).
