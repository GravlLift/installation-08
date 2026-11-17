// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package mapmesh

// forge_objects.go ports LevelUp's internal/mapmesh/forge_objets.go (AGPL-3.0, JGtm): resolving
// the Forge object catalog (JSON reference data, not shipped by this repo) into the set of
// placement keys (himap.CleObjetVariante) a variant's object layer should NOT render. Forge
// marks some object types and representations as editor-only landmarks (blockers, gameplay
// volumes, spawn and nav-mesh markers, scripting/AI aids, generic lights, FX) that the game
// itself never draws in a played match.

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

type representationCatalog struct {
	Name  int32 `json:"name_int"`
	Model int32 `json:"model"`
}

type objectCatalog struct {
	ID              int32                   `json:"id"`
	DefaultVariant  int32                   `json:"default_variant"`
	Representations []representationCatalog `json:"representations"`
}

type categoryCatalog struct {
	Name          string            `json:"name"`
	SubCategories []categoryCatalog `json:"sub_categories"`
	Objects       []objectCatalog   `json:"objects"`
}

type forgeObjectCatalog struct {
	RootCategories []categoryCatalog        `json:"root_categories"`
	Objects        map[string]objectCatalog `json:"objects"`
}

type catalogKey struct{ Name, Model int32 }
type categoryVisibility struct{ Hidden, Visible bool }

// hiddenCategoryPrefixes: object categories whose model serves only as a Forge-editor landmark,
// never drawn by the game in a played match.
var hiddenCategoryPrefixes = []string{
	"Blockers", "Gameplay > Volumes", "Gameplay > Player Spawning", "Gameplay > Audio",
	"Gameplay > Nav Mesh", "Gameplay > Scripting", "Gameplay > AI", "Gameplay > Match Flow",
	"Lights > Generic Light Objects", "FX",
}

func categoryHidden(path string) bool {
	for _, prefix := range hiddenCategoryPrefixes {
		if path == prefix || strings.HasPrefix(path, prefix+" > ") {
			return true
		}
	}
	return false
}

// ForgeHiddenObjects resolves the Forge object catalog `data` (JSON) into the placement keys a
// variant's object layer should not render.
func ForgeHiddenObjects(data []byte) (map[himap.CleObjetVariante]bool, error) {
	var c forgeObjectCatalog
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("forge object catalog: %w", err)
	}
	if c.RootCategories == nil || c.Objects == nil {
		return nil, fmt.Errorf("forge object catalog: missing categories or objects")
	}
	reps, types := visibilityTables(c.RootCategories)
	out := map[himap.CleObjetVariante]bool{}
	for _, o := range c.Objects {
		t := types[o.ID]
		for _, r := range o.Representations {
			v := reps[catalogKey{r.Name, r.Model}]
			if (t.Hidden || v.Hidden) && !t.Visible && !v.Visible {
				out[himap.CleObjetVariante{TypeID: o.ID, RepresentationID: r.Name}] = true
			}
		}
		if t.Hidden && !t.Visible {
			out[himap.CleObjetVariante{TypeID: o.ID, SansRepresentation: true}] = true
		}
	}
	return out, nil
}

// visibilityTables walks the catalog's category tree once, recording each object type's and
// representation's hidden/visible status (an object or representation can appear under more
// than one category, hence the separate Hidden/Visible bits rather than a single bool).
func visibilityTables(categories []categoryCatalog) (map[catalogKey]categoryVisibility, map[int32]categoryVisibility) {
	reps := map[catalogKey]categoryVisibility{}
	types := map[int32]categoryVisibility{}
	mark := func(v categoryVisibility, hidden bool) categoryVisibility {
		if hidden {
			v.Hidden = true
		} else {
			v.Visible = true
		}
		return v
	}
	var visit func([]categoryCatalog, string)
	visit = func(cats []categoryCatalog, parent string) {
		for _, cat := range cats {
			path := cat.Name
			if parent != "" {
				path = parent + " > " + path
			}
			hidden := categoryHidden(path)
			for _, o := range cat.Objects {
				types[o.ID] = mark(types[o.ID], hidden)
				for _, r := range o.Representations {
					reps[catalogKey{r.Name, r.Model}] = mark(reps[catalogKey{r.Name, r.Model}], hidden)
				}
			}
			visit(cat.SubCategories, path)
		}
	}
	visit(categories, "")
	return reps, types
}
