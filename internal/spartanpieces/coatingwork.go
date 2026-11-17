// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// coatingwork.go — the coating distillation of a library build (LevelUp's
// internal/mapmesh revetements.go, AGPL-3.0, JGtm): while the GLBs are being
// written, each material the viewer paints (extras.surfaceBrute) receives its
// style read from the Ekur reference (extras.style); at the end, the style
// lists they name give the common table, one file per coating and the
// gradient images, read from the game files. A material the reference does not
// know, or that has no style, stays without extras.style (neutral render); a
// gradient that cannot be read has no image (the viewer replaces it with a
// neutral gradient). Both are counted in the index and logged.
package spartanpieces

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"path/filepath"
	"slices"
	"sync"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// CoatingWork is one build's coating distillation: the Ekur reference read,
// the painted materials annotated (Annotate) and the coating files written at
// the end (Finish). The Spartan piece library owns its own work; the weapon
// library reuses it to paint the weapon models it writes.
type CoatingWork struct {
	ref       ekurRef
	index     CoatingsIndex
	loaded    map[uint32]*ekurMaterial
	lists     map[string]bool
	gradients map[uint32]bool
	// mu (LOCAL-CHANGE (infinite-theater-3d)): one CoatingWork is shared by every piece/weapon/
	// rig of a library build, and the parallel build pool calls PaintableGLB (so material,
	// below) from several goroutines at once. Everything that reads or mutates loaded, lists,
	// gradients or index.* in this file holds mu; Finish and writeSwatches run after the pool
	// has drained (no concurrent caller left), so they do not need it.
	mu sync.Mutex
}

// OpenCoatingWork validates the reference folder; nil, nil when it is not
// given.
func OpenCoatingWork(folder string) (*CoatingWork, error) {
	if folder == "" {
		return nil, nil
	}
	if !EkurValid(folder) {
		return nil, fmt.Errorf("ekur reference %s: missing one of the contract entries", folder)
	}
	return &CoatingWork{ref: ekurRef{folder: folder},
		index:  CoatingsIndex{Source: filepath.Base(folder)},
		loaded: map[uint32]*ekurMaterial{}, lists: map[string]bool{}, gradients: map[uint32]bool{}}, nil
}

// Annotate puts extras.style on a painted material (himap.AnnotateMateriauxGLB).
func (a *CoatingWork) Annotate(ctx context.Context) func(extras map[string]any) bool {
	return func(extras map[string]any) bool {
		id, ok := himap.NombreJSON(extras["id"])
		raw, painted := extras[himap.CleSurfaceBrute].(map[string]any)
		if !ok || !painted {
			return false
		}
		m := a.material(ctx, id, raw)
		if m == nil || m.StyleInfo == nil {
			return false
		}
		extras[ExtrasStyleKey] = styleOf(*m.StyleInfo)
		return true
	}
}

// PaintableGLB writes m (through write, which encodes m with its current
// surface flags) so that only the hard surfaces the viewer can actually paint
// are raw: a material the reference styles is written raw (extras.surfaceBrute)
// and annotated (extras.style); one it cannot style is baked (extras.surfaceDure,
// the neutral textured render), because a raw surface with no style renders
// flat grey. The materials already in m.SurfacesBrutesDe stay raw whatever
// their style (a first-person rig's arms, painted from the armor library).
// mark, when not nil, is called on every raw styled material's extras that is
// not one of those kept materials (a rig marks its weapon). A nil work writes
// m with only the kept materials raw.
func (a *CoatingWork) PaintableGLB(ctx context.Context, m *himap.MaillageMonde, write func() ([]byte, error),
	mark func(extras map[string]any)) ([]byte, error) {
	keep := map[uint32]bool{}
	for id, raw := range m.SurfacesBrutesDe {
		if raw {
			keep[id] = true
		}
	}
	setRaw := func(styled map[uint32]bool) {
		m.SurfacesBrutes = false
		m.SurfacesBrutesDe = map[uint32]bool{}
		for id := range keep {
			m.SurfacesBrutesDe[id] = true
		}
		for id := range styled {
			m.SurfacesBrutesDe[id] = true
		}
	}
	if a == nil {
		setRaw(nil)
		return write()
	}
	// Pass 1: every hard surface raw, to learn which ones the reference styles.
	m.SurfacesBrutes = true
	glb, err := write()
	if err != nil {
		return nil, err
	}
	annotate := a.Annotate(ctx)
	styled, unstyled := map[uint32]bool{}, map[uint32]bool{}
	note := func(extras map[string]any) bool {
		_, raw := extras[himap.CleSurfaceBrute].(map[string]any)
		id, ok := himap.NombreJSON(extras["id"])
		if !ok || keep[id] {
			return false
		}
		changed := annotate(extras)
		if raw {
			if changed {
				styled[id] = true
				if mark != nil {
					mark(extras)
				}
			} else {
				unstyled[id] = true
			}
		}
		return changed
	}
	if glb, err = himap.AnnoteMateriauxGLB(glb, note); err != nil {
		return nil, err
	}
	if len(unstyled) == 0 {
		m.SurfacesBrutes = false
		return glb, nil
	}
	// Pass 2: the unstyled surfaces baked, the styled ones raw again.
	slog.InfoContext(ctx, "hard surfaces without style baked (neutral render)", "materials", len(unstyled), "styled", len(styled))
	setRaw(styled)
	if glb, err = write(); err != nil {
		return nil, err
	}
	return himap.AnnoteMateriauxGLB(glb, func(extras map[string]any) bool {
		if id, ok := himap.NombreJSON(extras["id"]); !ok || keep[id] {
			return false
		}
		changed := annotate(extras)
		if changed && mark != nil {
			mark(extras)
		}
		return changed
	})
}

// material returns the reference's material id (read once, counted once); nil
// when it is missing.
func (a *CoatingWork) material(ctx context.Context, id uint32, raw map[string]any) *ekurMaterial {
	a.mu.Lock()
	defer a.mu.Unlock()
	if m, seen := a.loaded[id]; seen {
		return m
	}
	m, err := a.ref.material(id)
	if err != nil {
		a.loaded[id] = nil
		a.index.Missing++
		slog.WarnContext(ctx, "material unknown to the ekur reference: neutral render", "material", Identifier(id), "err", err)
		return nil
	}
	a.loaded[id] = &m
	if m.StyleInfo == nil {
		a.index.WithoutStyle++
		slog.WarnContext(ctx, "material without style in the ekur reference: neutral render", "material", Identifier(id))
		return &m
	}
	a.index.Materials++
	a.lists[idFrom(m.StyleInfo.Stylelist)] = true
	if sameMasks(raw, m.Textures) {
		a.index.MasksAgree++
	} else {
		a.index.MasksDisagree++
		slog.WarnContext(ctx, "material masks differ from the ekur reference", "material", Identifier(id),
			"read", raw["bitmaps"], "reference", m.Textures)
	}
	return &m
}

// sameMasks says whether the reader's images (surfaceBrute) are the reference's:
// the same bitmap on both sides, or an image absent on both (not bound, or an
// empty game image the reader does not publish, when Ekur names nothing: -1,
// 0 or key absent).
func sameMasks(raw map[string]any, textures map[string]int32) bool {
	// The reader's surfaceBrute names its masks asg / masque0 / masque1 (French
	// keys, the vendored reader's own); the reference names them Asg / Mask0 /
	// Mask1. The keys must match what the reader actually writes.
	bitmaps, _ := raw["bitmaps"].(map[string]any)
	for key, name := range map[string]string{"asg": "Asg", "masque0": "Mask0", "masque1": "Mask1"} {
		read, _ := himap.NombreJSON(bitmaps[key])
		ref, named := textures[name]
		if named && read == uint32(ref) {
			continue
		}
		_, published := himap.NombreJSON(raw[key])
		if published || (named && ref != 0 && ref != -1) {
			return false
		}
	}
	return true
}

// Finish writes the common table, one file per coating and the gradient
// images in folder; it returns the index section.
func (a *CoatingWork) Finish(ctx context.Context, arsenal *himap.Arsenal, folder string) (*CoatingsIndex, error) {
	d := distill{ref: a.ref, styles: map[string]CoatingStyle{}, gradients: a.gradients}
	table, perStyle, err := d.table(ctx, a.lists)
	if err != nil {
		return nil, err
	}
	n, err := writeJSON(filepath.Join(folder, FileCoatings), table)
	if err != nil {
		return nil, err
	}
	a.index.Bytes += n
	for _, key := range sortedKeys(perStyle) {
		c := Coating{Style: key, Lists: perStyle[key], Styles: map[string]CoatingStyle{}}
		for _, ref := range c.Lists {
			c.Styles[ref] = d.styles[ref]
		}
		n, err = writeJSON(filepath.Join(folder, FileCoating(key)), c)
		if err != nil {
			return nil, err
		}
		a.index.Bytes += n
		a.index.Coatings++
	}
	a.index.Lists, a.index.Styles = len(a.lists), len(d.styles)
	if err := a.writeSwatches(ctx, arsenal, folder); err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "library coatings written", "materials", a.index.Materials, "withoutStyle", a.index.WithoutStyle,
		"missing", a.index.Missing, "masksDisagree", a.index.MasksDisagree, "lists", a.index.Lists, "styles", a.index.Styles,
		"coatings", a.index.Coatings, "swatches", a.index.Swatches, "swatchesMissing", a.index.SwatchesMissing, "bytes", a.index.Bytes)
	return &a.index, nil
}

// writeSwatches writes, read from the game, the image of each gradient named
// by the kept styles.
func (a *CoatingWork) writeSwatches(ctx context.Context, arsenal *himap.Arsenal, folder string) error {
	ids := make([]uint32, 0, len(a.gradients))
	for id := range a.gradients {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, id := range ids {
		png, err := arsenal.Nuancier(id)
		if err != nil {
			a.index.SwatchesMissing++
			slog.WarnContext(ctx, "swatch gradient unreadable: neutral gradient", "bitmap", Identifier(id), "err", err)
			continue
		}
		n, err := writeFile(filepath.Join(folder, FileSwatch(Identifier(id))), func(w io.Writer) error {
			_, err := w.Write(png)
			return err
		})
		if err != nil {
			return err
		}
		a.index.Swatches++
		a.index.Bytes += n
	}
	return nil
}

// distill is the styles distilled once each, by key (referenceStyle).
type distill struct {
	ref       ekurRef
	styles    map[string]CoatingStyle
	gradients map[uint32]bool
}

// table is the common table and, per style name (a coating's StyleId), its
// reference per list.
func (d *distill) table(ctx context.Context, lists map[string]bool) (CoatingTable, map[string]map[string]string, error) {
	t := CoatingTable{Schema: SchemaPieces, Defaults: map[string]string{}, Styles: map[string]CoatingStyle{}}
	var g ekurGlobals
	var v ekurVisors
	err := errors.Join(d.ref.readJSON("globals.json", &g), d.ref.readJSON("visor_data.json", &v))
	if err == nil {
		t.Globals, err = globalsOf(g, d.gradients)
	}
	if err == nil {
		t.Visors, err = visorsOf(v, d.gradients)
	}
	if err != nil {
		return t, nil, err
	}
	perStyle := map[string]map[string]string{}
	for _, key := range sortedKeys(lists) {
		l, err := d.ref.list(key)
		if errors.Is(err, fs.ErrNotExist) {
			slog.WarnContext(ctx, "style list absent from the ekur reference: materials in neutral render", "list", key)
			continue
		}
		if err != nil {
			return t, nil, err
		}
		if t.Defaults[key], err = d.style(l.DefaultStyle.Reference); err != nil {
			return t, nil, err
		}
		t.Styles[t.Defaults[key]] = d.styles[t.Defaults[key]]
		for name, e := range l.Styles {
			s, err := idFromText(name)
			if err == nil {
				err = d.add(perStyle, s, key, e.Reference)
			}
			if err != nil {
				return t, nil, err
			}
		}
	}
	return t, perStyle, nil
}

// add stores the reference ref of the style s for the list list.
func (d *distill) add(perStyle map[string]map[string]string, s, list, ref string) error {
	key, err := d.style(ref)
	if err != nil {
		return err
	}
	if perStyle[s] == nil {
		perStyle[s] = map[string]string{}
	}
	perStyle[s][list] = key
	return nil
}

// style distills (once) the reference's style ref and returns its key.
func (d *distill) style(ref string) (string, error) {
	key, old, err := referenceStyle(ref)
	if err != nil {
		return "", err
	}
	if _, seen := d.styles[key]; seen {
		return key, nil
	}
	s, err := d.ref.style(ref)
	if err != nil {
		return "", err
	}
	if d.styles[key], err = coatingStyleOf(s, old, d.gradients); err != nil {
		return "", err
	}
	return key, nil
}
