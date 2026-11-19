// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package ambience

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/wwise"
)

// testIR builds an impulse response media in the game's layout: the header, the partition sizes,
// then the two planes; plane values are re = a, im = b for every kept bin of partition p.
func testIR(sizes []int, re, im func(p, k int) float32) []byte {
	le := binary.LittleEndian
	n := 0
	for _, s := range sizes {
		n += s
	}
	data := (0x30 + 2*len(sizes) + 15) &^ 15
	m := make([]byte, data+8*n)
	le.PutUint32(m[0x04:], irFFT)
	le.PutUint32(m[0x08:], irRate)
	le.PutUint32(m[0x1c:], uint32(len(sizes)))
	le.PutUint32(m[0x20:], uint32(n))
	start := 0
	for p, s := range sizes {
		le.PutUint16(m[0x30+2*p:], uint16(s))
		for k := 0; k < s; k++ {
			le.PutUint32(m[data+4*(start+k):], math.Float32bits(re(p, k)))
			le.PutUint32(m[data+4*(n+start+k):], math.Float32bits(im(p, k)))
		}
		start += s
	}
	return m
}

// testShareSet builds a convolution share set body naming media with wet level wet.
func testShareSet(wet float32, media uint32) []byte {
	le := binary.LittleEndian
	b := make([]byte, 8+convParamSize+6+4)
	le.PutUint32(b, pluginConvolver)
	le.PutUint32(b[4:], convParamSize)
	le.PutUint32(b[8+4*convParamWet:], math.Float32bits(wet))
	b[8+convParamSize] = 1
	le.PutUint32(b[8+convParamSize+2:], media)
	return b
}

func TestIRBinsReadsBothPlanes(t *testing.T) {
	m := testIR([]int{4, 2}, func(p, k int) float32 { return float32(p + k) }, func(p, k int) float32 { return 1 })
	bins, err := irBins(m)
	if err != nil {
		t.Fatal(err)
	}
	if len(bins) != 2 || len(bins[0]) != 4 || len(bins[1]) != 2 {
		t.Fatalf("shape %v", bins)
	}
	// re = p + k, im = 1: energy (p+k)^2 + 1.
	if bins[0][3] != 10 || bins[1][1] != 5 {
		t.Fatalf("bins %v", bins)
	}
}

func TestIRBinsRefusesABadLayout(t *testing.T) {
	m := testIR([]int{4}, func(int, int) float32 { return 0 }, func(int, int) float32 { return 0 })
	binary.LittleEndian.PutUint32(m[0x08:], 44100)
	if _, err := irBins(m); err == nil {
		t.Fatal("a 44.1 kHz response was read")
	}
	if _, err := irBins(m[:len(m)-4]); err == nil {
		t.Fatal("a truncated response was read")
	}
}

func TestBankReverbReadsTheWetLevelAndMedia(t *testing.T) {
	m := testIR([]int{8}, func(int, int) float32 { return 1 }, func(int, int) float32 { return 0 })
	bank := &wwise.Bank{
		ID:       7,
		Embedded: map[uint32][]byte{0x55: m},
		Objects:  map[uint32]wwise.HircObject{0x99: {Type: hircShareSet, ID: 0x99, Body: testShareSet(-12, 0x55)}},
	}
	r, err := bankReverb(bank, 0x99)
	if err != nil {
		t.Fatal(err)
	}
	if r.WetDB != -12 || len(r.Bins) != 1 || len(r.Bins[0]) != 8 {
		t.Fatalf("reverb %+v", r)
	}
	if _, err := bankReverb(bank, 0x98); err == nil {
		t.Fatal("a missing share set was read")
	}
	body := testShareSet(-12, 0x55)
	binary.LittleEndian.PutUint32(body, 0x00640003) // another plugin
	bank.Objects[0x99] = wwise.HircObject{Type: hircShareSet, ID: 0x99, Body: body}
	if _, err := bankReverb(bank, 0x99); err == nil {
		t.Fatal("a share set of another plugin was read")
	}
}

// The synthesized response keeps each partition's energy: stored / 1024 per channel (Parseval for
// an unnormalized 2048-point FFT of a 1024-sample block), decaying where the stored data decays.
func TestSynthIRKeepsThePartitionEnergy(t *testing.T) {
	parts := 12
	sizes := make([]int, parts)
	for i := range sizes {
		sizes[i] = irHop
	}
	// Each partition 6 dB below the one before; flat over its bins.
	amp := func(p, _ int) float32 { return float32(math.Pow(10, -6*float64(p)/20)) }
	er := envReverb{}
	bins, err := irBins(testIR(sizes, amp, func(int, int) float32 { return 0 }))
	if err != nil {
		t.Fatal(err)
	}
	er.Bins = bins
	ir := synthIR(er, 1)
	if len(ir[0]) != (parts+1)*irHop || len(ir[1]) != len(ir[0]) {
		t.Fatalf("length %d", len(ir[0]))
	}
	var total, stored float64
	for _, row := range bins {
		for _, e := range row {
			stored += e
		}
	}
	for _, v := range ir[0] {
		total += float64(v) * float64(v)
	}
	if got, want := 10*math.Log10(total), 10*math.Log10(stored/irHop); math.Abs(got-want) > 1 {
		t.Fatalf("energy %.2f dB, want %.2f dB", got, want)
	}
	// The decay: partition 2's span carries about 6 dB less than partition 1's, partition 8's
	// about 42 dB less than partition 1's.
	span := func(p int) float64 {
		var e float64
		for _, v := range ir[0][p*irHop : (p+1)*irHop] {
			e += float64(v) * float64(v)
		}
		return 10 * math.Log10(e)
	}
	if d := span(1) - span(2); math.Abs(d-6) > 2 {
		t.Fatalf("partition 1 to 2: %.1f dB", d)
	}
	if d := span(1) - span(8); math.Abs(d-42) > 3 {
		t.Fatalf("partition 1 to 8: %.1f dB", d)
	}
	// The channels are decorrelated, and the same seed writes the same response.
	var dot, n0, n1 float64
	for i := range ir[0] {
		dot += float64(ir[0][i]) * float64(ir[1][i])
		n0 += float64(ir[0][i]) * float64(ir[0][i])
		n1 += float64(ir[1][i]) * float64(ir[1][i])
	}
	if c := dot / math.Sqrt(n0*n1); math.Abs(c) > 0.2 {
		t.Fatalf("channel correlation %.2f", c)
	}
	if again := synthIR(er, 1); again[0][100] != ir[0][100] || again[1][5000] != ir[1][5000] {
		t.Fatal("the same seed wrote another response")
	}
}

func TestWavFloat32Header(t *testing.T) {
	w := wavFloat32([2][]float32{{0.5, -1}, {0.25, 0}})
	le := binary.LittleEndian
	if string(w[:4]) != "RIFF" || string(w[8:16]) != "WAVEfmt " || string(w[36:40]) != "data" {
		t.Fatalf("header %q", w[:44])
	}
	if le.Uint16(w[20:]) != 3 || le.Uint16(w[22:]) != 2 || le.Uint32(w[24:]) != irRate || le.Uint16(w[34:]) != 32 {
		t.Fatal("format fields")
	}
	if le.Uint32(w[40:]) != 16 || len(w) != 44+16 {
		t.Fatalf("data length %d", le.Uint32(w[40:]))
	}
	if math.Float32frombits(le.Uint32(w[44+4:])) != 0.25 || math.Float32frombits(le.Uint32(w[44+8:])) != -1 {
		t.Fatal("samples are not interleaved L, R")
	}
}

func TestZoneEnvsReadsReverbOnlyZones(t *testing.T) {
	tt := testLevel(t)
	tt.zoneShape(2, 1, 5, [][2]float32{{0, 0}, {4, 0}, {4, 4}})
	got := zoneEnvs(tt.parse(t))
	if len(got) != 1 || got[0].Zone != 2 || got[0].Env != 0xE || got[0].Height != 5 || len(got[0].Points) != 3 || got[0].Floor != 1 {
		t.Fatalf("envs %+v", got)
	}
}

func TestLayoutAndStaleRemovalKeepTheReverbs(t *testing.T) {
	dir := t.TempDir()
	m := &Manifest{Version: ManifestVersion, Maps: map[string]Bed{"m": {
		Loop:           "0000000a",
		Takes:          []Take{{File: takeName(1)}},
		Loops:          map[string][]Take{"0000000a": {{File: takeName(1)}}},
		Reverbs:        map[string]Reverb{"0000000e": {File: reverbName(0xE), WetDB: -10}},
		FallbackReverb: "0000000e",
	}}}
	for _, f := range []string{takeName(1), reverbName(0xE), reverbName(0xF), "reverb_notes.txt"} {
		if err := os.WriteFile(filepath.Join(dir, f), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	removed, err := removeStaleTakes(dir, m)
	if err != nil || removed != 1 {
		t.Fatalf("removed %d, %v", removed, err)
	}
	if _, err := os.Stat(filepath.Join(dir, reverbName(0xF))); !os.IsNotExist(err) {
		t.Fatal("an unlisted response was kept")
	}
	for _, f := range []string{reverbName(0xE), "reverb_notes.txt"} {
		if _, err := os.Stat(filepath.Join(dir, f)); err != nil {
			t.Fatalf("%s removed", f)
		}
	}
	lay, ok := m.Layout("m")
	if !ok || lay.FallbackReverb != "0000000e" || lay.Reverbs["0000000e"].WetDB != -10 {
		t.Fatalf("layout %+v", lay)
	}
}
