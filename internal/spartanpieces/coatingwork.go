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

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// coatingWork is one build's coating distillation.
type coatingWork struct {
	ref       ekurRef
	index     CoatingsIndex
	loaded    map[uint32]*ekurMaterial
	lists     map[string]bool
	gradients map[uint32]bool
}

// openCoatingWork validates the reference folder; nil, nil when it is not
// given.
func openCoatingWork(folder string) (*coatingWork, error) {
	if folder == "" {
		return nil, nil
	}
	if !EkurValid(folder) {
		return nil, fmt.Errorf("ekur reference %s: missing one of the contract entries", folder)
	}
	return &coatingWork{ref: ekurRef{folder: folder},
		index:  CoatingsIndex{Source: filepath.Base(folder)},
		loaded: map[uint32]*ekurMaterial{}, lists: map[string]bool{}, gradients: map[uint32]bool{}}, nil
}

// annotate puts extras.style on a painted material (himap.AnnotateMaterialsGLB).
func (a *coatingWork) annotate(ctx context.Context) func(extras map[string]any) bool {
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

// material returns the reference's material id (read once, counted once); nil
// when it is missing.
func (a *coatingWork) material(ctx context.Context, id uint32, raw map[string]any) *ekurMaterial {
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

// finish writes the common table, one file per coating and the gradient
// images in folder; it returns the index section.
func (a *coatingWork) finish(ctx context.Context, arsenal *himap.Arsenal, folder string) (*CoatingsIndex, error) {
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
	for _, key := range sortedKeys(a.lists) {
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
func (a *coatingWork) writeSwatches(ctx context.Context, arsenal *himap.Arsenal, folder string) error {
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
