# Decoding effects and shaders from the game

How the equipment pad's glow was decoded end to end (2026-11-21), written so another agent can
apply the same path to any effect, material or HUD element. Every value the viewer draws should
come from the game's own tags or shader bytecode, never tuned by eye.

## Tools

- Tag readers: `third_party/map-images/himap` (`meilleurTagInfo`, `rootBlockIndex`,
  `subBlockTarget(block, recordIndex*stride + fieldOffset)`, `blockAbs`, `donneesDuChamp`) and
  `internal/ekurport` (`ParseTag`, `Root`, `Block`, `U8`, `Bytes`, `TagRef`).
- Community tag layouts (field names and order): Z-15 Halo-Infinite-Tag-Editor,
  `gh api repos/Z-15/Halo-Infinite-Tag-Editor/contents/Halo-Infinite-Tag-Editor/Tag_Structures/<group>.xml -H "Accept: application/vnd.github.raw"`.
  Sizes are not in the XML: confirm offsets against a live tag (a known value, a block stride,
  two references a fixed distance apart).
- Every module of the install: `himodule.Open(path)` then `m.Files("")` lists every tag. A needle
  search for a GlobalID's 4 bytes over all modules finds who references a tag (that is how the pad
  effect's owner, Forge kit `foki e444bcc9` in `forge_objects-rtx-new.module`, was found: no object
  tag references it).
- DXC 1.9.2609 (Microsoft's release, signed): `data\tools\dxc\x\bin\x64\dxc.exe -dumpbin <file> -Fc <out.txt>`
  disassembles a DXIL container to LLVM IR with the resource and constant buffer layouts.

## Shaders: from a tag to readable math

1. A material or generator names a shader tag `shdv`.
2. The `shdv` holds no bytecode. It references `shbc` tags (the bytes "cbhs" in the tag are the
   group fourCC; the referenced GlobalID sits 12 bytes before it). The `shbc` tags live in
   `common-rtx-new.module`, not in the map's search path.
3. Each `shbc` holds one DXBC container (magic "DXBC", total size at +24). Write it to a file and
   disassemble it with DXC. The header lists the input/output signatures, every constant buffer
   with field names and byte offsets (the material's constants follow `$Globals` exactly), and the
   bindless texture table.
4. Stages are told apart by their constant buffers: compute stages read
   `cbGeneratorComputeConstants` and `cbPropertiesConstants`, vertex stages
   `cbGeneratorRendererConstants`, pixel stages `cbDepthFadeConstants`.

## GPU properties (generators)

A generator's float4 property descriptor in the material constants
(`internal/weapons/shield_hit.go` `generatorProperty`):
- a constant when bit 21 of uint(y) is set (value in x);
- otherwise a function of compute input `(uint(w) >> 17) & 31`, curve number `(uint(z) >> 17) & 31`
  (a single curve only when `uint(y) & 31 == 0` and `uint(z) & 3 == 0`).
- Curves are records in the post-process's property buffer (`cbPropertiesConstants`): record k at
  register 4k+1 (type, domainMax, rangeMin, rangeMax), (flags, ...), then coefficients
  (`readCurve`; types 0 identity, 1 constant, 4 linear, 7 cubic, 9 power). Register 0's x names
  the register before the two colors of a color property.
- The input list is the compute stage's own: read where it fills its `[9 x float]` array. The
  shield generator's and the light volume's differ (`generatorInputs`, `lightVolumeInputs`).

## Effects (`effe`)

`third_party/map-images/himap/lens_flare.go` `EffectEventsOf`:
- root +0x24 flags (bit 6 force looping); levels of detail at +0x5c (140 bytes each, camera range
  at +36, flags at +74: bit 0 non-rendering, bit 1 events in parallel);
- events at level +0x64 (0x5c bytes: delay bounds +0x0c, duration bounds +0x14, parts +0x20);
- parts 0x8c bytes: type GlobalID +0x38, group fourCC +0x44, radius modifier bounds +0x60,
  relative offset +0x68.
- Part types seen: `lens` (lens flare), `gldf` (cheap light), `efge` (effect generator), particle
  systems (event +0x48), sounds. A part may name a tag that is in no module (the pad's event 1
  names two generators that did not ship): skip it.

## What is decoded and reusable

| Piece | Code | Reusable for |
| --- | --- | --- |
| Lens flares (`lens`) | `himap.LensFlareTag`, `padGlow3d.ts` | any light glint, map light flares |
| Cheap lights (`gldf`) | `himap.CheapLightTag` (read, not drawn yet) | effect-driven point lights |
| Light volumes (`efge` with `shdv e11fafc2`) | `weapons.readLightVolumes`, `lightVolume3d.ts` | beams, cones, light shafts |
| Shield generator (`efge` 70e04608) | `weapons/shield_hit.go` | other mesh-redraw generators |
| Object-driven glow colors | `objectGlow3d.ts` | devices whose lights follow a function (switches, spawn pads) |
| Forge kits (`foki`) | needle search | which effect a Forge object plays |

## Open questions worth an agent each

- Which other `efge` tags use the light volume shader (search every module's `efge` tags for a
  `shdv e11fafc2` reference): teleporters, beacons and map light shafts are likely candidates.
- An effect's location marker when the object's model does not carry it (the pad's 54b94882):
  find which model does, to read the emitter's real frame instead of assuming world up.
- The HUD's colors: `docs/briefs/hud-colors-from-game.md`.
- The cheap lights' radius and how the viewer should light the scene with them.
