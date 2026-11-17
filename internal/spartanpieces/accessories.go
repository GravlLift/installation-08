// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// accessories.go — the attachments, markers, themes and shared images of the
// library (LevelUp's internal/mapmesh pieces_accessoires.go, AGPL-3.0, JGtm).
package spartanpieces

import (
	"bytes"
	"context"
	"log/slog"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// writeAttachments writes each `ocad` entry that poses on one of the
// Spartan's markers.
func (b *library) writeAttachments(a *himap.Arsenal, r *himap.Armurerie) {
	names := map[uint32]bool{}
	for _, g := range r.Marqueurs {
		names[g.Nom] = true
	}
	accs, autres, illisibles := a.AccessoiresDuModele(b.ctx, names)
	b.index.Attachments = []AttachmentIndex{}
	multi := 0
	for _, acc := range accs {
		for k, e := range acc.Entrees {
			key := AttachmentKey(Identifier(acc.ID), k)
			if len(e.Marqueurs) > 1 {
				multi++
			}
			ai, err := b.writeAttachment(a, acc.ID, k, e, key)
			if err != nil {
				b.failure(key, err)
				continue
			}
			b.index.Attachments = append(b.index.Attachments, ai)
		}
	}
	slog.InfoContext(b.ctx, "spartan attachments", "attachments", len(accs), "otherModels", autres,
		"unreadable", illisibles, "entriesWithSeveralMarkers", multi)
}

// writeAttachment writes the entry k of the accessory id and returns its index
// entry. An entry with several markers (none measured) is posed on the first
// one.
func (b *library) writeAttachment(a *himap.Arsenal, id uint32, k int, e himap.EntreeAccessoire, key string) (AttachmentIndex, error) {
	m, err := a.ModeleAccessoire(b.ctx, e)
	if err != nil {
		return AttachmentIndex{}, err
	}
	extras := map[string]any{"model": "spartan-attachment", "tag": Identifier(id), "entry": k, "axes": axesGLB}
	var buf bytes.Buffer
	if err := himap.EcritGLB(&buf, m, b.generator, extras); err != nil {
		return AttachmentIndex{}, err
	}
	file := FileAttachment(key)
	n, err := b.writeGLB(file, buf.Bytes())
	if err != nil {
		return AttachmentIndex{}, err
	}
	mq := e.Marqueurs[0]
	t, q := himap.PoseGLTF(mq.Translation, mq.Rotation)
	return AttachmentIndex{Key: key, Tag: Identifier(id), Entry: k, Model: Identifier(e.Modele),
		File: file, Triangles: m.Structure.Triangles(), Box: gltfBox(&m.Structure), Bytes: n,
		Marker: Identifier(mq.Nom), Offset: Pose{Translation: t, Rotation: q}}, nil
}

// skeletonOf is the bones of the skin of every piece, in the `mode`'s order.
func skeletonOf(r *himap.Armurerie) SkeletonIndex {
	s := SkeletonIndex{Bones: r.Noms, Root: -1}
	for i, n := range r.Noeuds {
		if n.Parent < 0 || n.Parent >= len(r.Noeuds) {
			s.Root = i
			break
		}
	}
	return s
}

// markersOf is the Spartan's markers, region and permutation ranks translated
// into names.
func markersOf(r *himap.Armurerie) []MarkerIndex {
	out := make([]MarkerIndex, 0, len(r.Marqueurs))
	for _, g := range r.Marqueurs {
		mi := MarkerIndex{Name: Identifier(g.Nom), Instances: []InstanceIndex{}}
		for _, in := range g.Instances {
			ii := InstanceIndex{Node: -1}
			if in.Region >= 0 && in.Region < len(r.Regions) {
				reg := r.Regions[in.Region]
				ii.Region = Identifier(reg.Name)
				if in.Permutation >= 0 && in.Permutation < len(reg.Permutations) {
					ii.Permutation = Identifier(reg.Permutations[in.Permutation].Name)
				}
			}
			if in.Noeud != himap.SansNoeud && in.Noeud < len(r.Noms) {
				ii.Bone, ii.Node = r.Noms[in.Noeud], in.Noeud
			}
			ii.Translation, ii.Rotation = himap.PoseGLTF(in.Translation, in.Rotation)
			mi.Instances = append(mi.Instances, ii)
		}
		out = append(out, mi)
	}
	return out
}

// themesOf is the Spartan's themes, one per `ocur` (two themes of one ocgd
// share theirs); unreadable, they are logged and the index carries none.
func themesOf(ctx context.Context, a *himap.Arsenal) []ThemeIndex {
	out := []ThemeIndex{}
	themes, err := a.ThemesDuModele(ctx, himap.ModeSpartan)
	if err != nil {
		slog.WarnContext(ctx, "spartan themes unreadable: index without themes", "err", err)
		return out
	}
	seen := map[uint32]bool{}
	for _, th := range themes {
		if seen[th.Ocur] {
			continue
		}
		seen[th.Ocur] = true
		ti := ThemeIndex{Name: Identifier(th.Nom), Ocur: Identifier(th.Ocur),
			Permutation: Identifier(th.Permutation), Read: th.Lu, Base: []RegionIndex{}}
		for _, c := range th.Base {
			ti.Base = append(ti.Base, RegionIndex{Region: Identifier(c.Region), Permutation: Identifier(c.Permutation)})
		}
		out = append(out, ti)
	}
	return out
}
