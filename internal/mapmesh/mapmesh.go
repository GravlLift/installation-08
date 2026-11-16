// Package mapmesh builds a native map's 3D world mesh (the glTF binary the viewer loads):
// geometry in world space, sun, baked light probes and placed lights, written under a
// temporary name then renamed (a reader never sees a half-written GLB).
//
// Ported from LevelUp's internal/mapmesh (AGPL-3.0, JGtm): LevelUp built this mesh both for
// offline tooling and for the delivered tool its desktop app launches on demand; this project
// only needs the second use, in-process, from this repo's own CLI.
//
// This package reads the game's installed files (github.com/JGtm/halo-infinite-map-images,
// AGPL-3.0 chain): it is meant to be used from a standalone CLI, never linked into a server
// that must stay free of that chain.
package mapmesh

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/texcompress"

	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/JGtm/halo-infinite-map-images/himap"
)

// Target is a native map to build.
type Target struct {
	// Key is the map's installed folder name, the key of its background and its mesh.
	Key string
	// Module is the `.module` that carries the rendered geometry (the map's own, or the one
	// its settings designate when it keeps its geometry elsewhere).
	Module string
	// MapModule is the map's own `.module`, whose scenario names the lighting of the played
	// structure (same as Module, except for deported geometry).
	MapModule string
	// Names are the map's displayed names, published in the GLB.
	Names []string
	// Anchors are the objectives' world positions; they designate the played bsp.
	Anchors [][3]float64
	// Frame is the world-space rectangle (minX, minY, maxX, maxY) outside which instances are
	// dropped (see FrameOf). Zero means the whole bsp's geometry.
	Frame [4]float64
	// SunIntensity and SunColor, when set, replace the scenario sun's intensity and color: a Forge
	// map's own lighting options (mapvar.Lighting) override its canvas's sun.
	SunIntensity *float64
	SunColor     *[3]float64
	// SunAzimuth and SunLatitude, when set, replace the scenario sun's azimuth and latitude
	// (degrees, himap.DirectionSoleil): a Forge map's Sun Direction (mapvar.SunDirection). The
	// direction is recomputed with the scenario's own hour angle and season.
	SunAzimuth  *float64
	SunLatitude *float64
	// TextureCaps is the build's texture read sizes (himap.TextureCaps); zero is the standard
	// caps (himap.CapsStandard), today's output.
	TextureCaps himap.TextureCaps
	// Textures is the image format of the written GLB (texcompress.Format); empty keeps the
	// writer's PNG and JPEG images.
	Textures texcompress.Format
}

// Frame margins, in world units. The 3D view exists to follow the game, not to admire the
// scenery: a few units around the playable frame are enough, and a map's distant scenery would
// cost both the build machine's memory and the GLB's weight.
const (
	frameMargin      = 10
	frameMarginLarge = 20
	// largeFrameSide: from this longest side on, the map counts as a large map (BTB maps are
	// above it, native arenas below).
	largeFrameSide = 128
)

// FrameOf returns the map's published background's playable frame, widened by its margin.
func FrameOf(cal replay.MapBackgroundCalibration) [4]float64 {
	minX, maxY := cal.OriginX, cal.OriginY
	maxX := minX + float64(cal.WidthPx)*cal.MetersPerPixel
	minY := maxY - float64(cal.HeightPx)*cal.MetersPerPixel
	m := float64(frameMargin)
	if max(maxX-minX, maxY-minY) >= largeFrameSide {
		m = frameMarginLarge
	}
	return [4]float64{minX - m, minY - m, maxX + m, maxY + m}
}

// axesGLB: the axis mapping published in every GLB's extras, under axesGLBKey.
const (
	axesGLB    = "gltf(x, y, z) = halo(x, z, -y)"
	axesGLBKey = "axes"
)

// Step is a build step, announced at its start.
type Step string

// The steps, in order. Geometry (materials and textures included) carries most of the time.
const (
	StepGeometry Step = "geometry"
	StepLighting Step = "lighting"
	StepWriting  Step = "writing"
	// StepTextures rewrites the written GLB's images as KTX2 (Textures = texcompress.FormatKTX2).
	StepTextures Step = "textures"
)

// Summary summarizes a written mesh.
type Summary struct {
	Triangles   int
	SceneryTris int
	Bytes       int64
	Sun         bool
	Probes      bool
	Lights      int
}

// Build writes the target's GLB to `path`. `announce` (nil accepted) receives each step at its
// start. The sun, probes and lights are optional: unreadable, they are logged and the mesh is
// written without them. The geometry, however, is mandatory.
func Build(ctx context.Context, gameRoot string, t Target, path, generator string, announce func(Step)) (Summary, error) {
	if announce == nil {
		announce = func(Step) {}
	}
	announce(StepGeometry)
	m, _, err := himap.CollecteMaillageMonde(ctx, himap.OptionsCuisson{
		RacineDeploy:      gameRoot,
		CheminModule:      t.Module,
		CheminModuleCarte: t.MapModule,
		Ancres:            t.Anchors,
		CadreMaillage:     t.Frame,
		TextureCaps:       t.TextureCaps,
	})
	if err != nil {
		return Summary{}, err
	}
	if err := ctx.Err(); err != nil {
		return Summary{}, err
	}
	announce(StepLighting)
	readLighting(ctx, t, m)
	if err := ctx.Err(); err != nil {
		return Summary{}, err
	}
	announce(StepWriting)
	extras := map[string]any{"module": t.Key, "mapNames": t.Names, axesGLBKey: axesGLB, "frame": t.Frame}
	sky := skyOf(ctx, gameRoot, t, m)
	// The summary is read before writing: the texture pass that follows the writer must not keep
	// the collected mesh (and its decoded textures) alive.
	s := Summary{
		Triangles: m.Structure.Triangles() + m.Terrain.Triangles(), SceneryTris: m.Decor.Triangles(),
		Sun: m.Soleil != nil, Probes: m.Sondes != nil, Lights: len(m.Lumieres),
	}
	outOfBox, outOfFrame := m.HorsBoite, m.HorsCadre
	n, err := writeGLB(ctx, path, t.Key, t.Textures, announce, func(w io.Writer) error {
		if err := himap.EcritGLBCiel(w, m, generator, extras, sky); err != nil {
			return err
		}
		return ctx.Err()
	})
	if err != nil {
		return Summary{}, err
	}
	s.Bytes = n
	slog.InfoContext(ctx, "mesh written", "map", t.Key, "names", t.Names,
		"triangles", s.Triangles, "sceneryTriangles", s.SceneryTris, "outOfBox", outOfBox, "instancesOutOfFrame", outOfFrame,
		"sun", s.Sun, "probes", s.Probes, "lights", s.Lights,
		"bytes", n, "file", filepath.Base(path))
	return s, nil
}

// writeGLB writes a map or variant GLB to `path` like writeFile. For texcompress.FormatKTX2 the
// writer's GLB goes to `path + ".src"` first, its images are rewritten into `path`
// (StepTextures), and the source is removed: `path` only ever holds the finished KTX2 GLB.
func writeGLB(ctx context.Context, path, key string, format texcompress.Format, announce func(Step), write func(io.Writer) error) (int64, error) {
	if format != texcompress.FormatKTX2 {
		return writeFile(path, write)
	}
	src := path + ".src"
	// `write` is not used past this call: the collected mesh its closure holds can be freed
	// during the pass (the callers read what they report from it beforehand).
	if _, err := writeFile(src, write); err != nil {
		return 0, err
	}
	defer func() { _ = os.Remove(src) }()
	if announce != nil {
		announce(StepTextures)
	}
	st, err := texcompress.CompressFile(ctx, src, path, texcompress.Options{})
	if err != nil {
		return 0, fmt.Errorf("textures: %w", err)
	}
	slog.InfoContext(ctx, "textures compressed", "map", key, "images", st.Encoded,
		"bytesBefore", st.BytesIn, "bytesAfter", st.BytesOut,
		"gpuRGBA8", st.GPURGBA8, "gpuBlocks", st.GPUBlock, "duration", st.Duration.Round(time.Millisecond))
	return st.BytesOut, nil
}

// writeFile writes what `write` produces under `path + ".tmp"` then renames it (a reader never
// sees a half-written file), and returns its size.
func writeFile(path string, write func(io.Writer) error) (int64, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return 0, fmt.Errorf("mesh directory: %w", err)
	}
	tmp := path + ".tmp"
	f, err := os.Create(tmp) //nolint:gosec // cache path, set by the caller
	if err != nil {
		return 0, fmt.Errorf("create: %w", err)
	}
	if err := write(f); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return 0, err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return 0, fmt.Errorf("close: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return 0, fmt.Errorf("rename: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return 0, fmt.Errorf("written mesh unreadable: %w", err)
	}
	return info.Size(), nil
}

// readLighting sets the sun, probes and placed lights of the collected structure (`m.BSP`) on
// the mesh, as named by the map's scenario. An unreadable scenario leaves the mesh without the
// game's own lighting; each unreadable part is logged and dropped on its own.
func readLighting(ctx context.Context, t Target, m *himap.MaillageMonde) {
	src, err := himap.SourcesLumiereDe(t.MapModule, t.Module, m.BSP)
	if err != nil {
		slog.ErrorContext(ctx, "scenario unreadable, mesh written without the game's lighting", "map", t.Key, "err", err)
		return
	}
	m.Soleil = sunOf(ctx, t, src)
	m.Sondes = probesOf(ctx, t.Key, src)
	if m.Lumieres, err = himap.LitLumieres(src); err != nil {
		slog.ErrorContext(ctx, "placed lights unreadable, mesh written without them", "map", t.Key, "err", err)
		m.Lumieres = nil
	}
}

// overrideSun applies the target's own sun intensity and color (Target.SunIntensity, SunColor)
// to the scenario's sun `s` (nil: nothing to override, the direction is the scenario's).
func overrideSun(s *himap.Soleil, t Target) {
	if s == nil {
		return
	}
	if t.SunIntensity != nil {
		s.Intensite, s.AvecIntensite = *t.SunIntensity, true
	}
	if t.SunColor != nil {
		s.Couleur, s.AvecCouleur = *t.SunColor, true
	}
}

// probesOf reads the map's baked lighting. A map with no probes, or unreadable ones, comes out
// without them (the viewer keeps its fallback lighting).
func probesOf(ctx context.Context, key string, src himap.SourcesLumiere) *himap.SondesLumiere {
	s, ok, err := himap.LitSondes(src)
	if err != nil {
		slog.ErrorContext(ctx, "light probes unreadable, mesh written without them", "map", key, "err", err)
		return nil
	}
	if !ok {
		slog.InfoContext(ctx, "map without light probes", "map", key)
		return nil
	}
	return &s
}

// sunOf reads the map's sun, with the target's own settings over the scenario's (targetSun). A
// map with no sun, or an unreadable one, comes out without it (the viewer keeps its own setting).
func sunOf(ctx context.Context, t Target, src himap.SourcesLumiere) *himap.Soleil {
	p, ok, err := sunParams(src)
	if err != nil {
		slog.ErrorContext(ctx, "sun unreadable, mesh written without a sun", "map", t.Key, "err", err)
		return nil
	}
	if ok {
		var s himap.Soleil
		if s, ok = targetSun(p, t); ok {
			return &s
		}
	}
	slog.InfoContext(ctx, "map without a sun", "map", t.Key)
	return nil
}

// sunParams reads the scenario's first dynamic sun as stored, like himap.LitSoleil: ok=false when
// the scenario names no `dwsg` or the `dwsg` has no sun.
func sunParams(src himap.SourcesLumiere) (himap.ParametresSoleil, bool, error) {
	if src.EtatDuMonde == 0 {
		return himap.ParametresSoleil{}, false, nil
	}
	if src.ModuleEtat == "" {
		return himap.ParametresSoleil{}, false, fmt.Errorf("%s %#x not found", himap.GroupeEtatDuMonde, src.EtatDuMonde)
	}
	p, err := himap.LitParametresSoleil(src.ModuleEtat, src.EtatDuMonde)
	if errors.Is(err, himap.ErrSansSoleil) {
		return himap.ParametresSoleil{}, false, nil
	}
	return p, err == nil, err
}

// targetSun resolves the scenario sun `p` with the target's own azimuth and latitude (the hour
// angle and season stay the scenario's), then its own intensity and color (overrideSun). ok=false
// as himap.ParametresSoleil.Soleil: no described position, a sun switched off, or below the horizon.
func targetSun(p himap.ParametresSoleil, t Target) (himap.Soleil, bool) {
	if t.SunAzimuth != nil {
		p.Azimut = *t.SunAzimuth
	}
	if t.SunLatitude != nil {
		p.Latitude = *t.SunLatitude
	}
	s, ok := p.Soleil()
	if !ok {
		return himap.Soleil{}, false
	}
	overrideSun(&s, t)
	return s, true
}
