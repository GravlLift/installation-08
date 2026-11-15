package weapons

// equipment.go: the equipment objects of the library. The title's equipment manifest
// (refdata, `equipmentObjects`) names each equipment object the film can create by its `eqip`
// GlobalID and family. The library builds the model of each of them under its GlobalID (8
// lowercase hex digits, the same key form as a weapon), and the index maps each family the
// manifest names by exactly one object to that object's key: a power-up pad publishes its item
// by family (`powerup_camo`), and the view finds the item's model through this map. A family
// named by several objects (two grapples, three walls) has no single model and is left out.

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// equipmentPlan is the equipment part of a library build: the model keys to build, and the
// family of each key whose family names it alone.
type equipmentPlan struct {
	Keys     []string
	FamilyOf map[string]string
}

// planEquipment derives the plan from the manifest's GlobalID -> family table.
func planEquipment(families map[uint32]string) equipmentPlan {
	byFamily := map[string][]string{}
	plan := equipmentPlan{FamilyOf: map[string]string{}}
	for id, family := range families {
		key := fmt.Sprintf("%08x", id)
		plan.Keys = append(plan.Keys, key)
		byFamily[family] = append(byFamily[family], key)
	}
	sort.Strings(plan.Keys)
	for family, keys := range byFamily {
		if len(keys) == 1 {
			plan.FamilyOf[keys[0]] = family
		}
	}
	return plan
}

// buildEquipment writes the GLB of each planned equipment object, counting them into res (an
// object without a readable model is marked like a weapon), and returns the index's family ->
// key map, limited to the objects built.
func buildEquipment(ctx context.Context, w modelWriter, plan equipmentPlan, res *Result) (map[string]string, error) {
	out := map[string]string{}
	for _, key := range plan.Keys {
		n, err := buildEquipmentModel(ctx, w.a, key, w.dir, w.coats)
		if errors.Is(err, himap.ErrSansModele) {
			if merr := writeMarker(w.dir, key); merr != nil {
				return out, fmt.Errorf("marker for %s: %w", key, merr)
			}
			res.Skipped++
			continue
		}
		if err != nil {
			return out, fmt.Errorf("equipment %s: %w", key, err)
		}
		res.Built++
		res.Bytes += n
		if family, ok := plan.FamilyOf[key]; ok {
			out[family] = key
		}
	}
	return out, nil
}

// buildEquipmentModel writes one equipment object's painted GLB and returns its byte size.
func buildEquipmentModel(ctx context.Context, a *himap.Arsenal, key, dir string, coats *spartanpieces.CoatingWork) (int64, error) {
	id, err := parseKey(key)
	if err != nil {
		return 0, err
	}
	m, err := a.Equipement(ctx, id)
	if err != nil {
		return 0, err
	}
	return writeModelGLB(ctx, dir, key, m, coats, generatorEquipment, map[string]any{"eqip": key})
}
