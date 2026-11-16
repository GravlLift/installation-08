package mapmesh

import (
	"context"
	"testing"
)

// recProgress records the reports a build makes, for the progress tests.
type recProgress struct {
	add func(frac float64, stage string)
}

func (r recProgress) Report(frac float64, stage string) { r.add(frac, stage) }

// TestProgressKTX2Schedule — a KTX2 build's stage fractions are monotonic bounds that never
// reach 1 on their own, and the texture sub-progress fills the texture span as images
// complete.
func TestProgressKTX2Schedule(t *testing.T) {
	var fracs []float64
	var stages []string
	p := progress{rep: recProgress{add: func(f float64, s string) {
		fracs = append(fracs, f)
		stages = append(stages, s)
	}}, ktx2: true}
	p.stage(StepGeometry)
	p.stage(StepLighting)
	p.stage(StepWriting)
	p.stage(StepTextures)
	for i := 1; i <= 10; i++ {
		p.texturesDone(i, 10)
	}
	want := []float64{0, ktx2Lighting, ktx2Writing, ktx2Textures}
	for i, w := range want {
		if fracs[i] != w {
			t.Fatalf("stage %d frac = %v, want %v", i, fracs[i], w)
		}
	}
	if got := fracs[len(fracs)-1]; got != ktx2TexturesEnd {
		t.Fatalf("final textures frac = %v, want %v", got, ktx2TexturesEnd)
	}
	wantStages := []string{string(StepGeometry), string(StepLighting), string(StepWriting), string(StepTextures)}
	for i, w := range wantStages {
		if stages[i] != w {
			t.Fatalf("stage %d = %q, want %q", i, stages[i], w)
		}
	}
	for i, f := range fracs {
		if i > 0 && f < fracs[i-1] {
			t.Fatalf("fracs go backwards at %d: %v", i, fracs)
		}
		if f >= 1 {
			t.Fatalf("a reported frac reached 1 (1 is the runner's, on success): %v", fracs)
		}
	}
}

// TestProgressPNGSchedule — a PNG build has no texture stage: geometry, lighting, writing,
// and no sub-progress reports.
func TestProgressPNGSchedule(t *testing.T) {
	var fracs []float64
	var stages []string
	p := progress{rep: recProgress{add: func(f float64, s string) {
		fracs = append(fracs, f)
		stages = append(stages, s)
	}}, ktx2: false}
	p.stage(StepGeometry)
	p.stage(StepLighting)
	p.stage(StepWriting)
	p.texturesDone(1, 1) // a no-op on a PNG build
	want := []float64{0, pngLighting, pngWriting}
	for i, w := range want {
		if fracs[i] != w {
			t.Fatalf("stage %d frac = %v, want %v", i, fracs[i], w)
		}
	}
	if len(stages) != 3 || stages[2] != string(StepWriting) {
		t.Fatalf("stages = %v, want geometry lighting writing", stages)
	}
}

// TestProgressOfContext — a bare context carries no reporter, and reporting through a nil
// reporter is a no-op (the standalone CLI builds out of band).
func TestProgressOfContext(t *testing.T) {
	if p := progressOf(context.Background(), true); p.rep != nil {
		t.Fatal("bare context should carry no progress reporter")
	}
	p := progress{rep: nil, ktx2: true}
	p.stage(StepGeometry)
	p.texturesDone(1, 1)
}
