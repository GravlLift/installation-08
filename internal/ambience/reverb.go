// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package ambience

// reverb.go turns a zone's sound environment (`snde`, the reverb the game applies while the
// listener stands in that zone) into an impulse response the viewer can convolve with.
//
// What the game stores (probed on sgh_streets and sgh_interlock; notes in
// docs/design/zone-reverb.md):
//
//	snde  block 0 +0x14  the Wwise id of the effect share set; its one `sbnk` dependency is the
//	                     bank that holds it.
//	bank  one HIRC object of type 16 (effect share set) with that id: u32 plugin id 0x007F0003
//	      (inferred: Wwise Convolution Reverb), u32 parameter size 0x38, 14 float32 parameters
//	      (the 12th, index 11, differs per preset, -8 to -28 dB, and is read as the wet level),
//	      then u8 media count 1, u8 index, u32 media id.
//	media the impulse response, already transformed for a partitioned convolution: +0x08 sample
//	      rate (48000), +0x1c partition count P, +0x20 N, from +0x30 P u16 partition sizes summing
//	      to N, then from align16(0x30+2P) 2N float32 values: two planes of N, partition p
//	      occupying the same span in each. Partition p is the 2048-point spectrum of the IR's
//	      samples [p*1024, (p+1)*1024), low bins first, its high bins cut in later partitions.
//
// The bin order inside a partition is not fully decoded, so the game's exact waveform is not
// recovered. What is exact without it is the energy: per partition (one 21.3 ms step of the
// decay) and, reading the planes as real and imaginary parts with low bins first, per frequency.
// The synthesized response keeps that time-frequency energy and draws random phases: the same
// decay, color and loudness as the game's reverb, not its recording.

import (
	"encoding/binary"
	"fmt"
	"math"
	"math/cmplx"
	"math/rand/v2"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/wwise"
)

const (
	envOffShareSet  = 0x14
	groupBank       = "sbnk"
	hircShareSet    = 16
	pluginConvolver = 0x007F0003
	convParamSize   = 0x38
	convParamWet    = 11 // index of the wet level among the 14 float parameters
	irRate          = 48000
	irHop           = 1024 // samples per partition
	irFFT           = 2 * irHop
	irSmoothBins    = 4 // power smoothing half-width, in bins, against a single bin's noise
)

// envReverb is one sound environment's reverb as the game authors it.
type envReverb struct {
	WetDB float64
	// Bins[p][k] is the energy of bin k of partition p (|re|^2 + |im|^2); a partition is as
	// long as the game kept it.
	Bins [][]float64
}

// readEnvReverb reads a sound environment tag's reverb.
func readEnvReverb(tags tagSource, env uint32) (envReverb, error) {
	raw, err := tags.Extract(env)
	if err != nil {
		return envReverb{}, fmt.Errorf("sound environment %08x: %w", env, err)
	}
	t, err := announcer.ParseTag(raw)
	if err != nil {
		return envReverb{}, fmt.Errorf("sound environment %08x: %w", env, err)
	}
	blk := t.Block(0)
	if len(blk) < envOffShareSet+4 {
		return envReverb{}, fmt.Errorf("sound environment %08x: block of %d bytes", env, len(blk))
	}
	share := binary.LittleEndian.Uint32(blk[envOffShareSet:])
	var bankTag uint32
	for _, d := range t.Deps {
		if d.Group == groupBank {
			bankTag = d.GlobalID
			break
		}
	}
	if bankTag == 0 {
		return envReverb{}, fmt.Errorf("sound environment %08x: no bank", env)
	}
	bank, err := parseBank(tags, bankTag)
	if err != nil {
		return envReverb{}, err
	}
	return bankReverb(bank, share)
}

// bankReverb reads the convolution share set `share` of a bank and its impulse response.
func bankReverb(bank *wwise.Bank, share uint32) (envReverb, error) {
	o, ok := bank.Objects[share]
	if !ok || o.Type != hircShareSet {
		return envReverb{}, fmt.Errorf("bank %08x: no effect share set %08x", bank.ID, share)
	}
	b := o.Body
	if len(b) < 8+convParamSize+6 || binary.LittleEndian.Uint32(b) != pluginConvolver || binary.LittleEndian.Uint32(b[4:]) != convParamSize {
		return envReverb{}, fmt.Errorf("bank %08x: share set %08x is not a convolution reverb", bank.ID, share)
	}
	wet := float64(math.Float32frombits(binary.LittleEndian.Uint32(b[8+4*convParamWet:])))
	media := binary.LittleEndian.Uint32(b[8+convParamSize+2:])
	ir, ok := bank.Embedded[media]
	if !ok {
		return envReverb{}, fmt.Errorf("bank %08x: impulse response %08x not embedded", bank.ID, media)
	}
	bins, err := irBins(ir)
	if err != nil {
		return envReverb{}, fmt.Errorf("bank %08x: impulse response %08x: %w", bank.ID, media, err)
	}
	return envReverb{WetDB: wet, Bins: bins}, nil
}

// irBins reads the per-bin energy of every partition of an impulse response media.
func irBins(m []byte) ([][]float64, error) {
	if len(m) < 0x30 {
		return nil, fmt.Errorf("%d bytes", len(m))
	}
	if rate := binary.LittleEndian.Uint32(m[0x08:]); rate != irRate {
		return nil, fmt.Errorf("sample rate %d", rate)
	}
	parts := int(binary.LittleEndian.Uint32(m[0x1c:]))
	n := int(binary.LittleEndian.Uint32(m[0x20:]))
	data := (0x30 + 2*parts + 15) &^ 15
	if parts <= 0 || n <= 0 || data+8*n != len(m) {
		return nil, fmt.Errorf("%d partitions of %d bins in %d bytes", parts, n, len(m))
	}
	f := func(i int) float64 { return float64(math.Float32frombits(binary.LittleEndian.Uint32(m[data+4*i:]))) }
	out := make([][]float64, parts)
	start := 0
	for p := range out {
		k := int(binary.LittleEndian.Uint16(m[0x30+2*p:]))
		if k > irHop || start+k > n {
			return nil, fmt.Errorf("partition %d of %d bins", p, k)
		}
		e := make([]float64, k)
		for i := range e {
			re, im := f(start+i), f(n+start+i)
			e[i] = re*re + im*im
		}
		out[p] = e
		start += k
	}
	if start != n {
		return nil, fmt.Errorf("partitions sum to %d of %d bins", start, n)
	}
	return out, nil
}

// synthIR builds a stereo impulse response at 48 kHz with the time-frequency energy of r: each
// partition becomes a frame of random-phase noise whose bins carry the partition's (lightly
// smoothed) energy, the frames overlap-added with a sine window at a hop of one partition. The
// two channels draw independent phases; seed fixes them, so a rebuild writes the same file.
//
// Scale: a 2048-point unnormalized FFT of a block x keeps sum|X|^2 over its first 1024 bins at
// about 1024 * sum x^2 (Parseval), so each frame here carries 1/1024 of its partition's stored
// energy, in each channel. The viewer must convolve with it unnormalized.
func synthIR(r envReverb, seed uint64) [2][]float32 {
	length := (len(r.Bins) + 1) * irHop
	var out [2][]float32
	rng := rand.New(rand.NewPCG(seed, 0x9e3779b97f4a7c15))
	// A sine window: overlapping frames' squares sum to 1, so independent noise frames keep a
	// steady power. Each frame spreads one partition's energy over two hops, so it carries sqrt(2)
	// to put the whole of it back.
	win := make([]float64, irFFT)
	for i := range win {
		win[i] = math.Sqrt2 * math.Sin(math.Pi*(float64(i)+0.5)/irFFT)
	}
	for c := range out {
		acc := make([]float64, length)
		for p, bins := range r.Bins {
			spec := make([]complex128, irFFT)
			for k := 1; k < len(bins); k++ {
				lo, hi := max(0, k-irSmoothBins), min(len(bins), k+irSmoothBins+1)
				var e float64
				for j := lo; j < hi; j++ {
					e += bins[j]
				}
				mag := math.Sqrt(e / float64(hi-lo))
				z := cmplx.Rect(mag, 2*math.Pi*rng.Float64())
				spec[k] = z
				spec[irFFT-k] = cmplx.Conj(z)
			}
			frame := ifft(spec)
			// The frame is centered on its partition: it starts half a hop early.
			at := p*irHop - irHop/2
			for i, v := range frame {
				if j := at + i; j >= 0 && j < length {
					acc[j] += real(v) * win[i]
				}
			}
		}
		out[c] = make([]float32, length)
		for i, v := range acc {
			out[c][i] = float32(v)
		}
	}
	return out
}

// ifft is the inverse discrete Fourier transform, normalized by 1/n; n is a power of two.
func ifft(x []complex128) []complex128 {
	n := len(x)
	a := make([]complex128, n)
	copy(a, x)
	for i, j := 1, 0; i < n; i++ {
		bit := n >> 1
		for ; j&bit != 0; bit >>= 1 {
			j ^= bit
		}
		j ^= bit
		if i < j {
			a[i], a[j] = a[j], a[i]
		}
	}
	for size := 2; size <= n; size <<= 1 {
		w := cmplx.Rect(1, 2*math.Pi/float64(size))
		for start := 0; start < n; start += size {
			wk := complex(1, 0)
			for k := 0; k < size/2; k++ {
				u, v := a[start+k], a[start+k+size/2]*wk
				a[start+k], a[start+k+size/2] = u+v, u-v
				wk *= w
			}
		}
	}
	for i := range a {
		a[i] /= complex(float64(n), 0)
	}
	return a
}

// wavFloat32 encodes channels as a 32-bit float WAV (format 3) at 48 kHz.
func wavFloat32(ch [2][]float32) []byte {
	frames := len(ch[0])
	dataLen := frames * 2 * 4
	b := make([]byte, 0, 44+dataLen)
	le32 := func(v uint32) { b = binary.LittleEndian.AppendUint32(b, v) }
	le16 := func(v uint16) { b = binary.LittleEndian.AppendUint16(b, v) }
	b = append(b, "RIFF"...)
	le32(uint32(36 + dataLen))
	b = append(b, "WAVEfmt "...)
	le32(16)
	le16(3) // IEEE float
	le16(2)
	le32(irRate)
	le32(irRate * 2 * 4)
	le16(2 * 4)
	le16(32)
	b = append(b, "data"...)
	le32(uint32(dataLen))
	for i := 0; i < frames; i++ {
		le32(math.Float32bits(ch[0][i]))
		le32(math.Float32bits(ch[1][i]))
	}
	return b
}
