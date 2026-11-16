// idle_effects.go — the particle effects a weapon carries while it is held (the Shock Rifle's
// electricity around its barrel housing), read from its `weap` tag down to the numbers the view
// simulates (himap.EffetDeParticules), with the textures and particle meshes they draw.
//
// An effect is kept when its attachment is scaled by a weapon function (the Shock Rifle's
// `fx_ready`) and every one of its particle systems is readable: a particle whose shader layout is
// not known, or a property function of a kind the view does not evaluate, leaves the system out
// (logged), never guessed. The view draws only what this index names.
package weapons

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"log/slog"
	"math"
	"path/filepath"
	"regexp"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-map-images/himap"

	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

// IdleEffect is one effect a weapon attaches: the functions that scale it, the markers its
// systems are emitted at, and its systems.
type IdleEffect struct {
	Effect string `json:"effect"`
	// ScaleA, ScaleB: the weapon functions scaling the effect (its A scale also starts and stops
	// it), by name (functionName).
	ScaleA string `json:"scaleA"`
	ScaleB string `json:"scaleB"`
	// Functions: the weapon's object functions the scales read, by name.
	Functions []IdleFunction `json:"functions"`
	// Markers: per location name, the marker instances of the weapon's third-person model, model
	// space, GLB axes (the systems emit at the first instance).
	Markers map[string][][3]float64 `json:"markers"`
	Systems []IdleSystem            `json:"systems"`
}

// IdleFunction is a weapon object function (weaponicons.ObjectFunction), by name.
type IdleFunction struct {
	Import      string  `json:"import"`
	Default     float32 `json:"default"`
	Export      string  `json:"export"`
	TurnOffWith string  `json:"turnOffWith,omitempty"`
	Invert      bool    `json:"invert,omitempty"`
}

// IdleSystem is a particle system, its vectors in GLB axes.
type IdleSystem struct {
	Location         string      `json:"location"`
	Event            int         `json:"event"`
	EventFlags       int         `json:"eventFlags"`
	EventDuration    [2]float32  `json:"eventDuration"`
	CoordinateSystem int         `json:"coordinateSystem"`
	CameraMode       int         `json:"cameraMode"`
	Flags            uint32      `json:"flags"`
	SizeScale        float32     `json:"sizeScale"`
	Emitter          IdleEmitter `json:"emitter"`
	Render           IdleRender  `json:"render"`
	Particle         string      `json:"particle"`
}

// IdleEmitter is himap.EmetteurParticules with its vectors in GLB axes (axisScale swizzled, the
// directions turned).
type IdleEmitter struct {
	Flags               int                                `json:"flags"`
	Appearance          uint32                             `json:"appearance"`
	ParticleFlags       uint32                             `json:"particleFlags"`
	Shape               int                                `json:"shape"`
	AxisScale           [3]float32                         `json:"axisScale"`
	Direction           [3]float32                         `json:"direction"`
	StartingInterpolant [3]float32                         `json:"startingInterpolant"`
	Billboard           int                                `json:"billboard"`
	Properties          map[string]himap.FonctionParticule `json:"properties"`
}

// IdleRender is how a particle draws: its textures (library files), shader constants, blend mode
// and mesh (a library file, "" for a sprite).
type IdleRender struct {
	Appearance uint32               `json:"appearance"`
	BlendMode  int                  `json:"blendMode"`
	Shader     string               `json:"shader"`
	Textures   []IdleTexture        `json:"textures"`
	Constants  map[string][]float64 `json:"constants"`
	Model      string               `json:"model,omitempty"`
}

// IdleTexture is a bound texture: its shader name, its file (the layers of an array stacked top to
// bottom) and its layer count.
type IdleTexture struct {
	Name   string `json:"name"`
	File   string `json:"file"`
	Layers int    `json:"layers"`
}

// effectFilePattern names an effect file of the library: fx-<bitmap>.png, fx-<pmdf>.bin.
var effectFilePattern = regexp.MustCompile(`^fx-[0-9a-f]{8}\.(png|bin)$`)

// EffectFile says whether name is an idle-effect file of the library.
func EffectFile(name string) bool { return effectFilePattern.MatchString(name) }

// effectTextureSide caps an effect texture's side (the arcs are 512, the palette 448).
const effectTextureSide = 512

// knownFunctionNames are the engine names the view feeds or the Shock Rifle's functions export;
// a StringID outside it is written as #<hex>.
var knownFunctionNames = func() map[uint32]string {
	out := map[uint32]string{}
	for _, n := range []string{"ready", "is_reloading", "primary_ammunition", "secondary_ammunition", "camo",
		"active_camo", "zoom", "secondary_charged", "fx_ready", "fx_reloading", "fx_ammo", "fx_zoom",
		"illumination", "heat", "primary_charged", "overheated", "power"} {
		out[uint32(mapvar.LabelHash(n))] = n
	}
	return out
}()

// functionName is the engine name of the StringID v ("" for 0).
func functionName(v uint32) string {
	if v == 0 {
		return ""
	}
	if n, ok := knownFunctionNames[v]; ok {
		return n
	}
	return fmt.Sprintf("#%08x", v)
}

// readIdleEffects reads the idle effects of every weapon key and writes their files into dir. The
// map is never nil; a weapon without one is left out.
func readIdleEffects(ctx context.Context, a *himap.Arsenal, gameRoot, module, dir string, keys []string) (map[string][]IdleEffect, error) {
	paths, err := himap.GeometrySearchPathMonde(gameRoot, module)
	if err != nil {
		return nil, err
	}
	ix, err := himap.NewModuleIndex(paths...)
	if err != nil {
		return nil, fmt.Errorf("weapon tag index: %w", err)
	}
	defer func() {
		if err := ix.Close(); err != nil {
			slog.WarnContext(ctx, "closing weapon tag index", "err", err)
		}
	}()
	out := map[string][]IdleEffect{}
	w := effectWriter{a: a, dir: dir, written: map[string]bool{}}
	for _, key := range keys {
		id, err := parseKey(key)
		if err != nil {
			return nil, err
		}
		raw, err := ix.Extract(id)
		if err != nil {
			continue
		}
		effects, err := w.effectsOf(ctx, id, raw)
		if err != nil {
			return nil, fmt.Errorf("idle effects of %s: %w", key, err)
		}
		if len(effects) > 0 {
			out[key] = effects
		}
	}
	slog.InfoContext(ctx, "weapon idle effects read", "weapons", len(keys), "with_effect", len(out))
	return out, nil
}

// effectWriter writes the effect files of one build (each file once).
type effectWriter struct {
	a       *himap.Arsenal
	dir     string
	written map[string]bool
}

// effectsOf reads the idle effects of the weapon `weap` (its tag `raw`).
func (w effectWriter) effectsOf(ctx context.Context, weap uint32, raw []byte) ([]IdleEffect, error) {
	atts, err := weaponicons.ReadEffectAttachments(raw)
	if err != nil || len(atts) == 0 {
		return nil, nil //nolint:nilerr // a weapon without readable attachments has no idle effect
	}
	fns, err := weaponicons.ReadObjectFunctions(raw)
	if err != nil {
		slog.WarnContext(ctx, "weapon functions unreadable", "weapon", fmt.Sprintf("%08x", weap), "err", err)
		return nil, nil
	}
	mode, ok := w.a.ModeleDeLArme(weap)
	if !ok {
		return nil, nil
	}
	var out []IdleEffect
	for _, at := range atts {
		if at.PrimaryScale == 0 {
			continue // an effect without a scaling function is not an idle effect (the banner)
		}
		fx, err := w.a.EffetDeParticules(at.Effect)
		if err != nil {
			continue // not a particle effect (a lens flare), or none of its systems readable
		}
		for _, s := range fx.Skipped {
			slog.WarnContext(ctx, "idle effect system left out", "weapon", fmt.Sprintf("%08x", weap),
				"effect", fmt.Sprintf("%08x", at.Effect), "why", s)
		}
		e, err := w.effect(at, fns, mode, fx)
		if err != nil {
			return nil, err
		}
		if len(e.Systems) > 0 {
			out = append(out, e)
		}
	}
	return out, nil
}

// effect builds one IdleEffect and writes its files.
func (w effectWriter) effect(at weaponicons.EffectAttachment, fns []weaponicons.ObjectFunction, mode uint32, fx *himap.EffetParticules) (IdleEffect, error) {
	e := IdleEffect{Effect: fmt.Sprintf("%08x", at.Effect), ScaleA: functionName(at.PrimaryScale),
		ScaleB: functionName(at.SecondaryScale), Markers: map[string][][3]float64{}}
	for _, f := range fns {
		e.Functions = append(e.Functions, IdleFunction{Import: functionName(f.Import), Default: f.Default,
			Export: functionName(f.Export), TurnOffWith: functionName(f.TurnOffWith), Invert: f.Invert})
	}
	noms := map[uint32]bool{}
	for _, s := range fx.Systems {
		noms[s.Location] = true
	}
	ms, err := w.a.MarqueursDuModele(mode, noms)
	if err != nil {
		return IdleEffect{}, err
	}
	for _, m := range ms {
		k := fmt.Sprintf("%08x", m.Nom)
		e.Markers[k] = append(e.Markers[k], gltfOf(m.Translation))
	}
	for _, s := range fx.Systems {
		loc := fmt.Sprintf("%08x", s.Location)
		if len(e.Markers[loc]) == 0 {
			continue // the model has no such marker: nowhere to emit
		}
		r, err := w.render(s.Render)
		if err != nil {
			return IdleEffect{}, err
		}
		em := s.Emitter
		e.Systems = append(e.Systems, IdleSystem{
			Location: loc, Event: s.Event, EventFlags: s.EventFlags, EventDuration: s.EventDuration,
			CoordinateSystem: s.Coordinate, CameraMode: s.CameraMode, Flags: s.Flags, SizeScale: s.SizeScale,
			Particle: fmt.Sprintf("%08x", s.Render.Particle),
			Emitter: IdleEmitter{
				Flags: em.Flags, Appearance: em.Appearance, ParticleFlags: em.ParticleFlags, Shape: em.Shape,
				AxisScale:           [3]float32{em.AxisScale[0], em.AxisScale[2], em.AxisScale[1]},
				Direction:           gltf32(em.Direction),
				StartingInterpolant: gltf32(em.StartingOffset),
				Billboard:           em.Billboard, Properties: em.Properties,
			},
			Render: r,
		})
	}
	return e, nil
}

// render writes a particle's textures and mesh and returns its entry.
func (w effectWriter) render(r himap.RenduParticule) (IdleRender, error) {
	out := IdleRender{Appearance: r.Appearance, BlendMode: r.BlendMode, Shader: fmt.Sprintf("%08x", r.Shader), Constants: r.Constants}
	for _, t := range r.Textures {
		file, layers, err := w.texture(t.Bitmap)
		if err != nil {
			return IdleRender{}, err
		}
		out.Textures = append(out.Textures, IdleTexture{Name: t.Name, File: file, Layers: layers})
	}
	if r.Model != 0 {
		file, err := w.model(r.Model)
		if err != nil {
			return IdleRender{}, err
		}
		out.Model = file
	}
	return out, nil
}

// texture writes the bitmap `id` as fx-<id>.png, its layers stacked top to bottom.
func (w effectWriter) texture(id uint32) (string, int, error) {
	file := fmt.Sprintf("fx-%08x.png", id)
	first, layers, err := w.a.BitmapParticule(id, 0, effectTextureSide)
	if err != nil {
		return "", 0, err
	}
	if w.written[file] {
		return file, layers, nil
	}
	b := first.Image.Bounds()
	sheet := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()*layers))
	draw.Draw(sheet, b, first.Image, b.Min, draw.Src)
	for k := 1; k < layers; k++ {
		t, _, err := w.a.BitmapParticule(id, k, effectTextureSide)
		if err != nil {
			return "", 0, err
		}
		if t.Image.Bounds().Dx() != b.Dx() || t.Image.Bounds().Dy() != b.Dy() {
			return "", 0, fmt.Errorf("bitmap %08x: layer %d of another size", id, k)
		}
		draw.Draw(sheet, image.Rect(0, k*b.Dy(), b.Dx(), (k+1)*b.Dy()), t.Image, t.Image.Bounds().Min, draw.Src)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, sheet); err != nil {
		return "", 0, err
	}
	if err := w.write(file, buf.Bytes()); err != nil {
		return "", 0, err
	}
	return file, layers, nil
}

// model writes the particle mesh `id` as fx-<id>.bin: little-endian float32 records of
// (x, y, z, u, v), GLB axes, three per triangle.
func (w effectWriter) model(id uint32) (string, error) {
	file := fmt.Sprintf("fx-%08x.bin", id)
	if w.written[file] {
		return file, nil
	}
	m, err := w.a.ModeleDeParticule(context.Background(), id)
	if err != nil {
		return "", err
	}
	buf := make([]byte, 0, len(m.Triangles)*3*5*4)
	put := func(v float32) { buf = binary.LittleEndian.AppendUint32(buf, math.Float32bits(v)) }
	for _, t := range m.Triangles {
		for _, k := range t {
			p := m.Sommets[k]
			put(float32(p[0]))
			put(float32(p[2]))
			put(float32(-p[1]) + 0)
			put(m.UV[k][0])
			put(m.UV[k][1])
		}
	}
	if err := w.write(file, buf); err != nil {
		return "", err
	}
	return file, nil
}

// write writes one effect file atomically, once per build.
func (w effectWriter) write(file string, data []byte) error {
	if _, err := writeFile(filepath.Join(w.dir, file), func(out ioWriter) error {
		_, err := out.Write(data)
		return err
	}); err != nil {
		return err
	}
	w.written[file] = true
	return nil
}

// gltf32 turns a Halo-axes vector into the GLB's axes.
func gltf32(v [3]float32) [3]float32 { return [3]float32{v[0], v[2], -v[1] + 0} }
