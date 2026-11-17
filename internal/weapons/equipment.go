// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weapons

// equipment.go: the equipment objects of the library. The title's equipment manifest
// (refdata, `equipmentObjects`) names each equipment object the film can create by its `eqip`
// GlobalID and family. The library builds the model of each of them under its GlobalID (8
// lowercase hex digits, the same key form as a weapon), and the index maps each family to one
// model key: a power-up or equipment pad publishes its item by family (`powerup_camo`, `wall`),
// and the view finds the item's model through this map.
//
// Several manifest families are named by more than one pickup object (two grapples, two walls,
// two sensors, two thrusters: per-mode copies of the same item). Measured on the installed game
// (2026-11-15), the objects of each such family carry the same model: their GLBs differ only in
// the `eqip` key of their extras. So a family maps to its lowest key when every pickup object of
// it that has a model builds the same GLB (key aside), and is left out when they differ (the
// family's pad item is then ambiguous). The placed form of an item (`deployed`, a standing Drop
// Wall panel) is never a pad item and takes no part in that choice.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"sort"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// equipmentPlan is the equipment part of a library build: the model keys to build, and per
// family the keys of its pickup objects (deployed objects excluded), sorted.
type equipmentPlan struct {
	Keys     []string
	Families map[string][]string
}

// planEquipment derives the plan from the manifest's GlobalID -> family table and its set of
// deployed objects (nil accepted).
func planEquipment(families map[uint32]string, deployed map[uint32]bool) equipmentPlan {
	plan := equipmentPlan{Families: map[string][]string{}}
	for id, family := range families {
		key := fmt.Sprintf("%08x", id)
		plan.Keys = append(plan.Keys, key)
		if !deployed[id] {
			plan.Families[family] = append(plan.Families[family], key)
		}
	}
	sort.Strings(plan.Keys)
	for _, keys := range plan.Families {
		sort.Strings(keys)
	}
	return plan
}

// buildEquipment writes the GLB of each planned equipment object, counting them into res (an
// object without a readable model is marked like a weapon), and returns the index's family ->
// key map, limited to the objects built.
func buildEquipment(ctx context.Context, w modelWriter, plan equipmentPlan, res *Result) (map[string]string, error) {
	prints := map[string][sha256.Size]byte{}
	for _, key := range plan.Keys {
		glb, err := equipmentGLB(ctx, w.a, key, w.coats)
		if errors.Is(err, himap.ErrSansModele) {
			if merr := writeMarker(w.dir, key); merr != nil {
				return nil, fmt.Errorf("marker for %s: %w", key, merr)
			}
			res.Skipped++
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("equipment %s: %w", key, err)
		}
		n, err := writeGLB(w.dir, key, glb)
		if err != nil {
			return nil, fmt.Errorf("equipment %s: %w", key, err)
		}
		res.Built++
		res.Bytes += n
		prints[key] = equipmentPrint(key, glb)
	}
	return equipmentFamilies(ctx, plan.Families, prints), nil
}

// equipmentFamilies picks each family's model key: the lowest of its built keys when all of
// them share one fingerprint (prints, by key, the built objects only); a family with no built
// key, or whose built keys carry different models, has none.
func equipmentFamilies(ctx context.Context, families map[string][]string, prints map[string][sha256.Size]byte) map[string]string {
	out := map[string]string{}
	for family, keys := range families {
		chosen := ""
		same := true
		for _, key := range keys {
			p, ok := prints[key]
			if !ok {
				continue
			}
			if chosen == "" {
				chosen = key
			} else if p != prints[chosen] {
				same = false
			}
		}
		if chosen == "" {
			continue
		}
		if !same {
			slog.WarnContext(ctx, "equipment family left without a model: its pickup objects differ",
				"family", family, "keys", keys)
			continue
		}
		out[family] = chosen
	}
	return out
}

// equipmentPrint is the fingerprint of an equipment GLB with its own key taken out of its
// extras (`"eqip":"<key>"`), so two objects of the same model print the same.
func equipmentPrint(key string, glb []byte) [sha256.Size]byte {
	return sha256.Sum256(bytes.ReplaceAll(glb, []byte(`"eqip":"`+key+`"`), []byte(`"eqip":""`)))
}

// equipmentGLB encodes one equipment object's painted GLB.
func equipmentGLB(ctx context.Context, a *himap.Arsenal, key string, coats *spartanpieces.CoatingWork) ([]byte, error) {
	id, err := parseKey(key)
	if err != nil {
		return nil, err
	}
	m, err := a.Equipement(ctx, id)
	if err != nil {
		return nil, err
	}
	return paintModelGLB(ctx, m, coats, generatorEquipment, map[string]any{"eqip": key})
}
