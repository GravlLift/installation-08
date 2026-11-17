// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build ktx2bench

package texcompress

// bench_test.go measures encoder presets on the images of a real built GLB (never committed:
// it is read from the cache). Run:
//
//	$env:IT3D_KTX2_BENCH_GLB = "<cache>\maps\sgh_streets.high.glb"
//	go test -tags ktx2bench -run TestPresetBench -v ./internal/texcompress/

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/draw"
	"math"
	"os"
	"runtime"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/basisu"
)

type benchPreset struct {
	name string
	o    basisu.Options
}

func TestPresetBench(t *testing.T) {
	path := os.Getenv("IT3D_KTX2_BENCH_GLB")
	if path == "" {
		t.Skip("IT3D_KTX2_BENCH_GLB not set")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	info, _ := f.Stat()
	g, err := openGLB(f, info.Size())
	if err != nil {
		t.Fatal(err)
	}
	classes := classify(g.doc)
	images, _ := g.doc["images"].([]any)
	rawViews, _ := g.doc["bufferViews"].([]any)
	perClass := map[Class][]int{}
	for i, iv := range images {
		img := iv.(map[string]any)
		bv, _ := entier(img["bufferView"])
		v, _ := viewOf(rawViews[bv], g.binLen)
		if v.n < 20000 {
			continue
		}
		perClass[classes[i]] = append(perClass[classes[i]], i)
	}
	mips := func(o basisu.Options) basisu.Options { o.Mipmaps, o.MipWrap = true, true; return o }
	var presets map[Class][]benchPreset
	presets = map[Class][]benchPreset{
		ClassColor: {
			{"etc1s q128", mips(basisu.Options{Codec: basisu.ETC1S, SRGB: true, ETC1SQuality: 128, ETC1SEffort: 2})},
			{"etc1s q255", mips(basisu.Options{Codec: basisu.ETC1S, SRGB: true, ETC1SQuality: 255, ETC1SEffort: 2})},
			{"uastc l1 rdo1 z9", mips(basisu.Options{Codec: basisu.UASTC, SRGB: true, UASTCLevel: 1, UASTCRDO: 1, ZstdLevel: 9})},
			{"uastc l1 rdo3 z9", mips(basisu.Options{Codec: basisu.UASTC, SRGB: true, UASTCLevel: 1, UASTCRDO: 3, ZstdLevel: 9})},
		},
		ClassData: {
			{"etc1s q255", mips(basisu.Options{Codec: basisu.ETC1S, ETC1SQuality: 255, ETC1SEffort: 2})},
			{"uastc l1 z9", mips(basisu.Options{Codec: basisu.UASTC, UASTCLevel: 1, ZstdLevel: 9})},
			{"uastc l1 rdo1 z9", mips(basisu.Options{Codec: basisu.UASTC, UASTCLevel: 1, UASTCRDO: 1, ZstdLevel: 9})},
			{"uastc l1 rdo3 z9", mips(basisu.Options{Codec: basisu.UASTC, UASTCLevel: 1, UASTCRDO: 3, ZstdLevel: 9})},
			{"uastc l1 rdo6 z9", mips(basisu.Options{Codec: basisu.UASTC, UASTCLevel: 1, UASTCRDO: 6, ZstdLevel: 9})},
		},
		ClassNormal: {
			{"etc1s q255", mips(basisu.Options{Codec: basisu.ETC1S, NormalMap: true, ETC1SQuality: 255, ETC1SEffort: 2})},
			{"uastc l1 z9", mips(basisu.Options{Codec: basisu.UASTC, NormalMap: true, UASTCLevel: 1, ZstdLevel: 9})},
			{"uastc l1 rdo1 z9", mips(basisu.Options{Codec: basisu.UASTC, NormalMap: true, UASTCLevel: 1, UASTCRDO: 1, ZstdLevel: 9})},
			{"uastc l1 rdo3 z9", mips(basisu.Options{Codec: basisu.UASTC, NormalMap: true, UASTCLevel: 1, UASTCRDO: 3, ZstdLevel: 9})},
		},
	}
	sample := 24
	if os.Getenv("IT3D_KTX2_BENCH_ROUND") == "2" {
		sample = 12
		presets = map[Class][]benchPreset{
			ClassColor:  {{"uastc l1 z19", mips(basisu.Options{Codec: basisu.UASTC, SRGB: true, UASTCLevel: 1, ZstdLevel: 19})}, {"uastc l1 rdo1 z19", mips(basisu.Options{Codec: basisu.UASTC, SRGB: true, UASTCLevel: 1, UASTCRDO: 1, ZstdLevel: 19})}},
			ClassData:   {{"uastc l1 z19", mips(basisu.Options{Codec: basisu.UASTC, UASTCLevel: 1, ZstdLevel: 19})}, {"uastc l1 z9", mips(basisu.Options{Codec: basisu.UASTC, UASTCLevel: 1, ZstdLevel: 9})}, {"uastc l1 z15", mips(basisu.Options{Codec: basisu.UASTC, UASTCLevel: 1, ZstdLevel: 15})}},
			ClassNormal: {{"uastc l1 z19", mips(basisu.Options{Codec: basisu.UASTC, NormalMap: true, UASTCLevel: 1, ZstdLevel: 19})}},
		}
	}
	workers := max(1, runtime.NumCPU()/2)
	for _, c := range []Class{ClassColor, ClassData, ClassNormal} {
		ids := perClass[c]
		step := max(1, len(ids)/sample)
		var pick []int
		for k := 0; k < len(ids) && len(pick) < sample; k += step {
			pick = append(pick, ids[k])
		}
		srcs := make([]*image.NRGBA, len(pick))
		var inBytes, texels int64
		for k, i := range pick {
			img := images[i].(map[string]any)
			bv, _ := entier(img["bufferView"])
			v, _ := viewOf(rawViews[bv], g.binLen)
			b := make([]byte, v.n)
			if _, err := f.ReadAt(b, g.binOff+v.off); err != nil {
				t.Fatal(err)
			}
			im, _, err := image.Decode(bytes.NewReader(b))
			if err != nil {
				t.Fatal(err)
			}
			n := image.NewNRGBA(image.Rect(0, 0, im.Bounds().Dx(), im.Bounds().Dy()))
			draw.Draw(n, n.Rect, im, im.Bounds().Min, draw.Src)
			srcs[k] = n
			inBytes += v.n
			texels += int64(n.Rect.Dx() * n.Rect.Dy())
		}
		t.Logf("%s: %d of %d images, %.1f Mtexels, source %.2f B/texel", c, len(pick), len(ids), float64(texels)/1e6, float64(inBytes)/float64(texels))
		for _, p := range presets[c] {
			var mu sync.Mutex
			var out int64
			var psnrs []float64
			var worst float64 = 1000
			var cpu time.Duration
			ch := make(chan int)
			var wg sync.WaitGroup
			t0 := time.Now()
			for range workers {
				wg.Add(1)
				go func() {
					defer wg.Done()
					for k := range ch {
						s := time.Now()
						data, err := basisu.Encode(srcs[k], p.o)
						d := time.Since(s)
						if err != nil {
							t.Error(err)
							continue
						}
						dec, err := basisu.Decode(data, 0)
						if err != nil {
							t.Error(err)
							continue
						}
						ps := psnr(srcs[k], dec)
						mu.Lock()
						out += int64(len(data))
						psnrs = append(psnrs, ps)
						worst = math.Min(worst, ps)
						cpu += d
						mu.Unlock()
					}
				}()
			}
			for k := range srcs {
				ch <- k
			}
			close(ch)
			wg.Wait()
			sort.Float64s(psnrs)
			t.Logf("  %-18s out %.3f B/texel (x%.2f of source), PSNR median %.1f dB worst %.1f dB, %.2f s CPU per Mtexel (wall %s)",
				p.name, float64(out)/float64(texels), float64(out)/float64(inBytes), psnrs[len(psnrs)/2], worst,
				cpu.Seconds()/(float64(texels)/1e6), time.Since(t0).Round(time.Millisecond))
		}
	}
}

// psnr is the RGBA PSNR of `b` against `a` (alpha included only when `a` has any).
func psnr(a, b *image.NRGBA) float64 {
	alpha := false
	for i := 3; i < len(a.Pix); i += 4 {
		if a.Pix[i] != 255 {
			alpha = true
			break
		}
	}
	var se float64
	var n int
	for i := 0; i+3 < len(a.Pix); i += 4 {
		ch := 3
		if alpha {
			ch = 4
		}
		for c := 0; c < ch; c++ {
			d := float64(a.Pix[i+c]) - float64(b.Pix[i+c])
			se += d * d
			n++
		}
	}
	if se == 0 {
		return 99
	}
	return 10 * math.Log10(255*255/(se/float64(n)))
}

var _ = fmt.Sprint

// TestFullPass runs the pass over the whole GLB into IT3D_KTX2_BENCH_OUT, with ETC1S color maps
// when IT3D_KTX2_BENCH_COLOR=etc1s (quality 255), and prints its stats.
func TestFullPass(t *testing.T) {
	path, out := os.Getenv("IT3D_KTX2_BENCH_GLB"), os.Getenv("IT3D_KTX2_BENCH_OUT")
	if path == "" || out == "" {
		t.Skip("IT3D_KTX2_BENCH_GLB or IT3D_KTX2_BENCH_OUT not set")
	}
	o := Options{}
	if os.Getenv("IT3D_KTX2_BENCH_COLOR") == "etc1s" {
		o.Preset = func(c Class) basisu.Options {
			if c == ClassColor {
				return basisu.Options{Codec: basisu.ETC1S, SRGB: true, ETC1SQuality: 255, ETC1SEffort: 2, Mipmaps: true, MipWrap: true}
			}
			return Preset(c)
		}
	}
	st, err := CompressFile(context.Background(), path, out, o)
	if err != nil {
		t.Fatal(err)
	}
	logStats(t, st)
}

func logStats(t *testing.T, st Stats) {
	t.Logf("GLB %.1f MB -> %.1f MB in %s; %d images encoded, %d kept; GPU RGBA8+mips %.1f MB -> blocks+mips %.1f MB",
		float64(st.BytesIn)/1e6, float64(st.BytesOut)/1e6, st.Duration.Round(time.Second), st.Encoded, st.Kept,
		float64(st.GPURGBA8)/1e6, float64(st.GPUBlock)/1e6)
	for _, c := range []Class{ClassColor, ClassData, ClassNormal} {
		if cs := st.ByClass[c]; cs != nil {
			t.Logf("  %-6s %5d images, %7.1f Mtexels, %8.1f MB -> %8.1f MB, encode CPU %s",
				c, cs.Images, float64(cs.Texels)/1e6, float64(cs.BytesIn)/1e6, float64(cs.BytesOut)/1e6, cs.EncodeDur.Round(time.Second))
		}
	}
}
