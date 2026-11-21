// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package himap — objets_attaches.go (LOCAL-CHANGE (infinite-theater-3d), ported from The Library's
// 2026-11-21 fix): the objects a model variant attaches, for a kit object whose render model has no
// section of its own.
//
// A `hlmt` variant's `objects` block names, per record, an object tag the game creates with the
// model and poses at one of the render model's markers. A `mode` with no section (ErrSansSections)
// draws nothing itself; the BTB weapon pod mover (machine b5683e48 of kit 26c22119, hlmt 71dc2741,
// mode 37406072) is one, and what the game shows is the two `bloc` pod halves 42207405 and
// 9938e34e its default variant attaches.
//
// LAYOUT (hlmt variants block as in variantes_modele.go):
//
//	variant record, 364 bytes: name StringID +0, regions TagBlock +0x34, objects TagBlock +0x48
//	object record, 72 bytes: parent marker StringID +0, child marker StringID +4, child variant
//	  StringID +8, child object tag reference +12 (GlobalID +20, group fourCC reversed +32),
//	  a second tag reference +40 (null on every record measured), +68..+72 not read
//
// MEASURED 2026-11-21 over every `hlmt` of the installation that names one of the 11 `mode` tags
// with no section: 3 carry objects in their first variant, 4 records in all, every child a `bloc`,
// every child marker and child variant 0, every parent marker a marker group of the `mode` whose
// instances are on region -1. A kit object names no variant, so the first variant is read. Only a
// model with no section is expanded: the attachments of a model with sections are not drawn.
package himap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
)

// Layout of a variant's objects block (see the header).
const (
	varianteOffObjets     = 0x48
	objetAttacheStride    = 72
	objetAttacheOffParent = 0
	objetAttacheOffEnfant = 4
	objetAttacheOffVar    = 8
	objetAttacheOffRef    = 20 // GlobalID of the child object's tag reference (+12 + 8)
)

// profondeurAttachesMax bounds the attachments followed: an attached object whose model has no
// section attaches its own objects in turn, up to this depth (a cycle stops there).
const profondeurAttachesMax = 4

// objetAttache is one object a model variant attaches: tag `ref` of group `groupe`, posed at the
// render model's marker `parent`. `enfant` and `variante` are the record's child marker and child
// variant StringIDs (0 on every record measured).
type objetAttache struct {
	parent, enfant, variante uint32
	ref                      uint32
	groupe                   string
}

// lisObjetsAttaches returns the objects the first variant of a decompressed `hlmt` attaches; nil
// for a hlmt without variants or a first variant without objects; an error for a header that does
// not validate or a block that is not a whole number of records.
func lisObjetsAttaches(hlmt []byte) ([]objetAttache, error) {
	ti, err := meilleurTagInfo(hlmt)
	if err != nil {
		return nil, fmt.Errorf("himap: hlmt header: %w", err)
	}
	root, err := ti.rootBlockIndex()
	if err != nil {
		return nil, err
	}
	vars, ok := lienDuChamp(ti, root, hlmtOffVariantes)
	if !ok {
		return nil, nil
	}
	l, ok := lienDuChamp(ti, vars.target, varianteOffObjets)
	if !ok {
		return nil, nil
	}
	n := compteChamp(ti, l)
	abs, taille := ti.blockAbs(l.target)
	if n <= 0 || taille != n*objetAttacheStride || abs < 0 || abs+taille > len(hlmt) {
		return nil, fmt.Errorf("himap: %d attached objects in %d bytes", n, taille)
	}
	out := make([]objetAttache, 0, n)
	for i := range n {
		r := hlmt[abs+i*objetAttacheStride : abs+(i+1)*objetAttacheStride]
		ref := uint32(u32(r, objetAttacheOffRef))
		if ref == 0 || ref == 0xffffffff {
			continue
		}
		out = append(out, objetAttache{
			parent:   uint32(u32(r, objetAttacheOffParent)),
			enfant:   uint32(u32(r, objetAttacheOffEnfant)),
			variante: uint32(u32(r, objetAttacheOffVar)),
			ref:      ref,
			groupe:   groupeInverse(r[objetAttacheOffRef+refOffGroupe : objetAttacheOffRef+refOffGroupe+4]),
		})
	}
	return out, nil
}

// modeSansSections reports whether a decompressed `mode` has no section (ErrSansSections).
func modeSansSections(mode []byte) bool {
	for _, ti := range tagCandidates(mode) {
		if _, err := modeGeoFromTagInfo(ti); errors.Is(err, ErrSansSections) {
			return true
		}
	}
	return false
}

// poseAttache returns the pose, in the parent model's frame, of the first instance of marker
// `parent` that applies to every region (the kit draws the default permutations); false when the
// model carries no such marker instance.
func poseAttache(parent uint32, groupes []GroupeMarqueurs, noeuds []Noeud) (Instance, bool) {
	for _, g := range groupes {
		if g.Nom != parent {
			continue
		}
		in, ok := ChoisitInstance(g, nil, nil)
		if !ok {
			return Instance{}, false
		}
		return instanceDeTransforme(in.DansLeModele(noeuds)), true
	}
	return Instance{}, false
}

// instanceDeTransforme turns a model-space transform into an Instance pose: the columns of its
// rotation are the axes, its uniform scale the scale of each axis.
func instanceDeTransforme(t Transforme) Instance {
	return Instance{
		Scale:    [3]float64{t.Scale, t.Scale, t.Scale},
		Position: t.Trans,
		Forward:  [3]float64{t.Rot[0], t.Rot[3], t.Rot[6]},
		Left:     [3]float64{t.Rot[1], t.Rot[4], t.Rot[7]},
		Up:       [3]float64{t.Rot[2], t.Rot[5], t.Rot[8]},
	}
}

// modelesObjetKit returns the pieces a kit object draws: its own model, posed at the object's
// pose, or, when its render model has no section, the objects its model variant attaches, each at
// its marker composed with that pose. Empty when neither yields a model.
func modelesObjetKit(ctx context.Context, idx *ModuleIndex, o objetKit, assets map[uint32]*RuntimeGeoAsset) []pieceKit {
	return piecesObjet(ctx, idx, o, assets, 0)
}

// piecesObjet is modelesObjetKit for an object attached `profondeur` levels down.
func piecesObjet(ctx context.Context, idx *ModuleIndex, o objetKit, assets map[uint32]*RuntimeGeoAsset, profondeur int) []pieceKit {
	if mv := modeleObjetKit(ctx, idx, o, assets); mv != nil {
		return []pieceKit{{mv: mv, pose: o.pose}}
	}
	if profondeur >= profondeurAttachesMax {
		return nil
	}
	hlmt, mode, ok := modeleSansSections(ctx, idx, o)
	if !ok {
		return nil
	}
	attaches, err := lisObjetsAttaches(hlmt)
	if err != nil {
		slog.DebugContext(ctx, "attached objects unreadable", "object", fmt.Sprintf("%08x", o.ref), "err", err)
		return nil
	}
	noeuds, _ := ModeNodes(mode)        // no node: the markers pose in the model frame
	groupes, _ := MarqueursDuMode(mode) // no marker block: no attachment poses, logged below
	var out []pieceKit
	for _, a := range attaches {
		local, ok := poseAttache(a.parent, groupes, noeuds)
		if !ok || a.enfant != 0 || a.variante != 0 {
			slog.DebugContext(ctx, "attached object not posed", "object", fmt.Sprintf("%08x", o.ref), "attached", fmt.Sprintf("%08x", a.ref),
				"marker", ok, "childMarker", a.enfant, "childVariant", a.variante)
			continue
		}
		enfant := objetKit{ref: a.ref, groupe: a.groupe, pose: composeInstance(o.pose, local)}
		out = append(out, piecesObjet(ctx, idx, enfant, assets, profondeur+1)...)
	}
	return out
}

// modeleSansSections returns the `hlmt` of a kit object and its `mode`, when that `mode` has no
// section; false otherwise (the object's model is drawn, or missing, the usual way). The model is
// the one modeleDuHlmt picks: the first hlmt that names a geometry, its `rtgo` before its `mode`.
func modeleSansSections(ctx context.Context, idx *ModuleIndex, o objetKit) (hlmt, mode []byte, ok bool) {
	if g, _, trouve := idx.Lookup(o.ref); !trouve || g != o.groupe {
		return nil, nil, false
	}
	objet, err := idx.Extract(o.ref)
	if err != nil {
		return nil, nil, false
	}
	for _, h := range refsInlineDuGroupe(objet, idx, GroupeHlmt) {
		tagH, err := idx.Extract(h)
		if err != nil {
			continue
		}
		if len(refsInlineDuGroupe(tagH, idx, GroupeRtgo)) > 0 {
			return nil, nil, false
		}
		modes := refsInlineDuGroupe(tagH, idx, GroupeMode)
		if len(modes) == 0 {
			continue
		}
		tagM, err := idx.Extract(modes[0])
		if err != nil {
			slog.DebugContext(ctx, "mode unreadable", "id", fmt.Sprintf("%08x", modes[0]), "err", err)
			return nil, nil, false
		}
		return tagH, tagM, modeSansSections(tagM)
	}
	return nil, nil, false
}
