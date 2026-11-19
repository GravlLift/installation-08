# Zone reverb: what the game stores (research notes, 2026-11-18)

Status: the reverb data is located and partly decoded; the game's exact impulse response is not yet turned back into audio. What ships (0.1.1-test.5) is a stand-in per preset: `internal/ambience/reverb.go` keeps each partition's per-bin energy (exact whatever the bin order within a partition, as long as bins run low to high) and draws random phases, at the scale an unnormalized 2048-point FFT implies (stored energy / 1024 per partition), and the viewer (`zoneReverb.ts`) convolves world sounds with it at the share set's wet level.

Measured on the stand-ins (energy of the response plus the wet level, the reverb's level against the dry sound for a steady input): `71d2752f` -26 dB, `88f39f4a` -23 dB, `0f717847` -23 dB, `9c9aa2e8` (the outdoor fallback of Streets and Live Fire) -33 dB, Academy's `a519ed76` -37 dB. Not read: each sound's send level into the reverb bus, that bus's volume, and the share set's other parameters (indexes 0 to 2 look like a delay in ms and two widths in degrees; not applied).

## Confirmed (probed on sgh_streets and sgh_interlock)

- Each palette zone of the level tag (`levl` root +0x3d0, 276 B per zone) names a sound environment tag (`snde`) at zone +0x64, next to its looping sound at +0x28. Zones without a loop also have none.
- Streets and Live Fire use the same four `snde` tags, shared presets: `9c9aa2e8`, `88f39f4a`, `0f717847`, `71d2752f`.
- A `snde` tag (264 B, one 56 B block) references one sound bank (`sbnk`) at block +0x1c, and holds at +0x14 the Wwise id of the effect inside it, at +0x18 a small integer (8, 3, 1, 4).
- Each of those banks (v135) holds exactly one HIRC object of type 16 (an effect share set) and one embedded media. The share set's plugin id is 0x007F0003, with 0x38 bytes of float parameters, then a media count of 1 and the media id. The plugin is inferred to be Wwise Convolution Reverb (it carries an impulse response); the parameters include levels near -96 dB (inputs or dry off) and one level that differs per preset (-10, -8, -12, -28 dB), inferred to be the wet level.
- The embedded media is not RIFF. Header: +0x04 = 2048, +0x08 = 48000 (Hz), +0x1c = partition count P, +0x20 = N, then from +0x30 a table of P u16 sizes whose sum is exactly N; the data starts at align16(0x30 + 2P) and is exactly 2N float32 values (the sizes match to the byte on all four presets).
- Sizes are 1024 in early partitions and shrink in later ones on three presets (down to 16), the frequency-domain truncation the plugin page describes ("optimizing impulse response in the time and frequency domains").
- The data is two planes of N floats, [0, N) and [N, 2N); partition p occupies the same span in each plane. Within a partition, values fall off with index (low to high frequency), and more steeply in later partitions: frequency-domain data, low bins first.
- Reading the planes as real and imaginary parts of a 2048-point real spectrum, partition 0 of `7b8ad7d8` and `563bacce` comes back as a signal silent at both ends and present in the middle; later partitions come back as noise filling the whole frame, uncorrelated with their neighbors.

## Ruled out

Each tested by requiring a zero-padded partition (half the inverse transform silent), on partitions 0 to 2 of two or more presets: interleaved complex over the whole data; SIMD-4 and SIMD-8 split blocks; per-partition split re/im; per-plane interleaved complex (512 bins, 1024 point); complex-packed (Z-domain) 512 and 1024; DC/Nyquist packed in bin 0; a Hartley transform of 1024; plain stereo time-domain samples; consecutive frames overlapping by half.

## Per-sound send (found and applied 2026-11-19, 0.1.1-test.8)

- A sound's send into the zone reverb is a Wwise game-defined aux send: node property 0x17 in dB, which adds along the node chain like the volume (`wwise.MediaMix.GameAuxSendDB`). Summed, it is large and positive on world sounds: median +20 dB over 3439 foot step, movement and shot takes, quartiles +18 and +24. The Bandit's third-person shot layers send +18 and +23; its first-person shot sends -60 (dry, the tail is in the stereo take), while the thump and click of that shot send 0.
- On the shots and foot steps probed, the attenuation's game-aux curve (curve use 1) is curve 0, the volume curve: the send falls with distance exactly as the dry sound does, which the viewer already gets by sending post-falloff.
- Applied relative to the median (`zoneReverb.REVERB_SEND_REFERENCE_DB` = 20): a sound sending +20 keeps the level tuned in test.5, others differ by their difference, sounds without data send at the reference. The absolute level of the game's reverb bus is not read, so the reference stands in for it.

## Mix buses (read 2026-11-19, 0.1.1-test.9)

- A node routes to the first non-zero bus id up its chain (the u32 after the attachment flag, before the parent id). Buses (HIRC type 8) all live in bank `0x3b14`. Bus head, v135: parent u32 (a master adds a device share set u32), a property bundle, positioning bits, aux bits (with 16 bytes of aux ids when bit 3 is set), the reflections aux bus u32, then advanced settings (bits u8, max instances u16, channel config u32, HDR bits u8), recovery time u32, max duck volume f32, the ducks (count u32, then 18 bytes each: target bus u32, duck volume f32, fade out and fade in ms, curve u8, target property u8), then the effect slots (count u8, bypass u8, 7 bytes each: slot u8, share set id u32, two flags).
- Two master buses: `44148a3c` (the world; the Bandit's third-person layers go through weapon bus `0dd329b0`) and `624ab2d3` (the Bandit's first-person take, thump and click). Bus volumes (property 0x05) are -2 on both masters and -3 on the category buses. Nearly every sound sums to -5 dB (18,689 sounds on one such chain; the shot, foley and first-person buses all at -5). The exceptions found: `ba569fe0` (867 sounds) at +5, `ece88820` (602) at -1. The viewer's gains leave the bus chain out, so its mix sits 5 dB above the game's.
- Both masters carry effect share set `480f6a5a`, plugin `0x006C0003`, 22 bytes: threshold -17, ratio 7, attack 0, release 0.5, output +0.5. The plugin is inferred to be the Wwise Compressor (that layout and size). Applied in the viewer (`masterBus.ts`), with the threshold at -12 for the 5 dB above, in front of the volume. Chromium's compressor adds a make-up gain, measured at +6.17 dB for that curve in Chromium's headless shell, which the trim takes back out.
- The third-person weapon buses (`0dd329b0`, `494386a4`, `8165b6c5`, and others) carry `3a0286ea`, plugin `0x006E0003` (inferred to be the Peak Limiter): -0.1 dB, ratio 10, look-ahead 0.01 s, release 0.01 s. Not applied: at -0.1 dBFS it only catches peaks over full scale. Two Meter effects (`0x00810003`) follow it on the same buses; they drive game parameters (inferred to be side-chain ducking through RTPCs). Not read.
- Many buses duck others (for example, `4bce441a` under the weapon group ducks `6b9a0348` by 3 dB, fading out over 1 s and back in over 3 s). Not applied.
- HDR: the HDR bits read 0x02 on all 241 buses. If bit 0 is the HDR-bus flag, as in the Wwise layout, then no bus is HDR. That is inferred, not confirmed. Either way the compressor, not HDR, is what evens the game's mix.

## Next ideas

- A fixed permutation of bins (an FFT's native output order) within each partition.
- Frames that are not zero-padded at the front but at both ends (partition 0 suggests a centered window).
- Failing a decode, a synthetic reverb per preset from the share set's parameters (wet level, and decay read from the partition energy envelope), which keeps the per-zone switching and the game's relative levels.
