// progress.go gives a map or variant build the fraction and stage the job runner shows in
// its state snapshot. The build reads the runner's reporter from its context
// (meshjobs.ProgressFromContext); a build that runs out of band (the standalone CLI) gets
// nil and reports nothing.
//
// The stage fractions are bounds, set from measured build times (KTX2 builds spend most of
// their time in geometry and in the texture compression that follows the writer, PNG builds
// in geometry alone): the bar jumps to a stage's lower bound when the stage starts, and the
// texture stage fills its span as images are compressed (texcompress counts them). The
// runner sets the fraction to 1 only when the file is written and the build succeeded, so
// the reported fraction here never reaches 1 on its own and never goes backwards (the
// runner moves it only forward).

package mapmesh

import (
	"context"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
)

// The stage bounds. geometry starts at 0; each name is the fraction reported when that
// stage starts, and the stage fills the span up to the next one (textures up to its upper
// bound, through the compressed-image count). Measured on the smallest installed Forge
// canvas (a Blank-canvas map, 730 triangles, 5 textures: geometry 271 ms, lighting 1 ms,
// GLB write ~300 ms, KTX2 compression 734 ms of a 1.3 s build) — on small maps the KTX2
// pass is most of the build and geometry a fifth of it; larger maps spend more in geometry
// than this sample, so the KTX2 writing span is left wide enough for that.
const (
	ktx2Lighting    = 0.20 // geometry is done, lighting starts (KTX2 build)
	ktx2Writing     = 0.22 // the GLB (PNG/JPEG) is written, the KTX2 pass starts at ktx2Textures
	ktx2Textures    = 0.30
	ktx2TexturesEnd = 0.96 // all images compressed; the runner sets 1 on success

	pngLighting = 0.45
	pngWriting  = 0.48 // the file is being written; the runner sets 1 on success

	// The geometry pass (geocompress) follows the writer and the KTX2 pass: about a second for
	// Streets' 600 MB of geometry, a sliver of either build.
	ktx2Compress = ktx2TexturesEnd
	pngCompress  = 0.9
)

// progress is one build's progress reporting: the runner's reporter (nil reports nothing)
// and whether the written GLB gets its KTX2 pass (which shapes the stage bounds).
type progress struct {
	rep  meshjobs.ProgressReporter
	ktx2 bool
}

// progressOf reads the runner's reporter of the build running under ctx.
func progressOf(ctx context.Context, ktx2 bool) progress {
	return progress{rep: meshjobs.ProgressFromContext(ctx), ktx2: ktx2}
}

// stage reports a step's start.
func (p progress) stage(step Step) {
	if p.rep == nil {
		return
	}
	switch step {
	case StepGeometry:
		p.rep.Report(0, string(step))
	case StepLighting:
		f := pngLighting
		if p.ktx2 {
			f = ktx2Lighting
		}
		p.rep.Report(f, string(step))
	case StepWriting:
		f := pngWriting
		if p.ktx2 {
			f = ktx2Writing
		}
		p.rep.Report(f, string(step))
	case StepTextures:
		p.rep.Report(ktx2Textures, string(step))
	case StepCompress:
		f := pngCompress
		if p.ktx2 {
			f = ktx2Compress
		}
		p.rep.Report(f, string(step))
	}
}

// texturesDone reports the KTX2 pass's sub-progress, done of total images compressed.
func (p progress) texturesDone(done, total int) {
	if p.rep == nil || !p.ktx2 || total <= 0 {
		return
	}
	f := ktx2Textures + (ktx2TexturesEnd-ktx2Textures)*float64(done)/float64(total)
	p.rep.Report(f, string(StepTextures))
}
