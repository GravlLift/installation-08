package weapons

// label_catalog.go — the title's weapon label tables, assembled at startup from the
// embedded hand-written mappings (tables/), the same tables LevelUp's replay service joins
// on (replaylabels.Load): family to canonical key, key to display names, shot render
// family, shot impact, shot tint and combat role.
//
// The tables live in files, not code, because they are title data: a new weapon key or a
// corrected tint is a one-line change without a recompile. They are embedded in the binary
// so the server needs no data directory beyond the match store.

import (
	_ "embed"
	"fmt"
	"strconv"
	"strings"

	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/llampwall/infinite-theater-3d/internal/refdata"
)

//go:embed tables/weapon_names.toml
var weaponNamesTOML string

//go:embed tables/weapon_families.toml
var weaponFamiliesTOML string

//go:embed tables/shot_tables.toml
var shotTablesTOML string

//go:embed tables/weapon_roles.toml
var weaponRolesTOML string

// LabelCatalog is the assembled weapon label tables.
type LabelCatalog struct {
	// LabelCatalog is the decoder's own per-family label table: what completes the
	// document's weaponLabels (text and shot render family), family keyed.
	LabelCatalog replay.LabelCatalog
	// FamilyToKey maps a weapon family (high 32 bits of the film's weapon id, hex) to the
	// title's canonical weapon_key.
	FamilyToKey map[string]string
	// ShotImpacts maps a weapon_key to whether its projectile explodes on impact.
	ShotImpacts map[string]bool
	// ShotTints maps a weapon_key to the nature of its discharge.
	ShotTints map[string]string
	// Roles maps a weapon_key to its combat role ("" when the registry does not classify it).
	Roles map[string]string
}

// LoadLabelCatalog assembles the tables from the embedded mappings. An ill-formed table is
// an error: a half-loaded catalog would name some weapons and mute others without a trace.
func LoadLabelCatalog() (LabelCatalog, error) {
	families, err := parseSection(weaponFamiliesTOML, "families")
	if err != nil {
		return LabelCatalog{}, fmt.Errorf("weapon families: %w", err)
	}
	names, err := parseNames(weaponNamesTOML)
	if err != nil {
		return LabelCatalog{}, fmt.Errorf("weapon names: %w", err)
	}
	shotEffects, shotImpacts, shotTints, err := parseShotTables(shotTablesTOML)
	if err != nil {
		return LabelCatalog{}, fmt.Errorf("shot tables: %w", err)
	}
	roles, err := parseSection(weaponRolesTOML, "roles")
	if err != nil {
		return LabelCatalog{}, fmt.Errorf("weapon roles: %w", err)
	}
	labels := buildFamilyLabels(families, names, shotEffects)
	labels.Icons = refdata.Labels().Icons
	return LabelCatalog{
		LabelCatalog: labels,
		FamilyToKey:  families, ShotImpacts: shotImpacts, ShotTints: shotTints, Roles: roles,
	}, nil
}

// buildFamilyLabels folds the per-key tables into the decoder's per-family label table:
// each family is labeled with the display names of its key and the render family of its
// shots, exactly the entries the decoder's buildWeaponLabels needs to complete labels.
// A key with no name row keeps its family unlabeled (it is never named).
func buildFamilyLabels(families map[string]string, names map[string]map[string]string, shotEffects map[string]string) replay.LabelCatalog {
	weapons := map[uint32]replay.WeaponLabel{}
	for family, key := range families {
		row, ok := names[key]
		if !ok {
			continue
		}
		text := replay.Text{}
		for lang, v := range row {
			text[lang] = v
		}
		weapons[mustParseFamily(family)] = replay.WeaponLabel{Text: text, Fx: shotEffects[key]}
	}
	return replay.LabelCatalog{Weapons: weapons}
}

// ShotEffects renders the family of the shots of the key ("" when the table does not name
// it): the same fact as Fx of the per-family label table, kept on the key so the request
// join reads one table per field.
func (c LabelCatalog) ShotEffects(key string) string {
	if fam, ok := c.FamilyToKey[key]; ok {
		if lbl, ok := c.LabelCatalog.Weapons[mustParseFamily(fam)]; ok {
			return lbl.Fx
		}
	}
	return ""
}

// mustParseFamily parses an 8-hex-digit family row of the tables; LoadLabelCatalog is the
// only caller and its parseSection already checked the row is a plain value.
func mustParseFamily(fam string) uint32 {
	v, err := strconv.ParseUint(fam, 16, 32)
	if err != nil {
		panic(fmt.Sprintf("weapon families: %q is not an 8-hex family", fam))
	}
	return uint32(v)
}

// parseSection reads a flat `[section]` of key = value lines into a map. Comments, blank
// lines, the section header and any other section are skipped.
func parseSection(body, section string) (map[string]string, error) {
	out := map[string]string{}
	in := false
	for i, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") {
			in = line == "["+section+"]"
			continue
		}
		if !in {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			return nil, fmt.Errorf("line %d: no '=' in %q", i+1, line)
		}
		out[unquote(strings.TrimSpace(key))] = unquote(strings.TrimSpace(value))
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("section [%s] is empty", section)
	}
	return out, nil
}

// parseNames reads the [weapons] section of the names table, whose values are inline
// tables: key = { en = "...", fr = "..." }.
func parseNames(body string) (map[string]map[string]string, error) {
	out := map[string]map[string]string{}
	for i, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "[") {
			continue
		}
		key, rest, ok := strings.Cut(line, "=")
		if !ok {
			return nil, fmt.Errorf("line %d: no '=' in %q", i+1, line)
		}
		inner, ok := strings.CutPrefix(strings.TrimSpace(rest), "{")
		if !ok {
			return nil, fmt.Errorf("line %d: value of %q is not an inline table", i+1, key)
		}
		inner = strings.TrimSuffix(strings.TrimSpace(inner), "}")
		names := map[string]string{}
		for _, part := range strings.Split(inner, ",") {
			k, v, ok := strings.Cut(part, "=")
			if !ok {
				return nil, fmt.Errorf("line %d: bad member %q in %q", i+1, part, key)
			}
			names[strings.TrimSpace(k)] = unquote(strings.TrimSpace(v))
		}
		if len(names) == 0 {
			return nil, fmt.Errorf("line %d: empty name table for %q", i+1, key)
		}
		out[strings.TrimSpace(key)] = names
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("[weapons] section is empty")
	}
	return out, nil
}

// parseShotTables reads the [shot_effects], [shot_impact] and [shot_tints] sections of the
// shot tables file.
func parseShotTables(body string) (map[string]string, map[string]bool, map[string]string, error) {
	effects, err := parseSection(body, "shot_effects")
	if err != nil {
		return nil, nil, nil, err
	}
	impactLines, err := parseSection(body, "shot_impact")
	if err != nil {
		return nil, nil, nil, err
	}
	impacts := map[string]bool{}
	for k, v := range impactLines {
		if v == "true" {
			impacts[k] = true
		} else if v != "false" {
			return nil, nil, nil, fmt.Errorf("shot_impact: %q is not a boolean", v)
		}
	}
	tints, err := parseSection(body, "shot_tints")
	if err != nil {
		return nil, nil, nil, err
	}
	return effects, impacts, tints, nil
}

// unquote strips one layer of double quotes from a TOML basic string.
func unquote(s string) string {
	if len(s) >= 2 && strings.HasPrefix(s, `"`) && strings.HasSuffix(s, `"`) {
		return s[1 : len(s)-1]
	}
	return s
}
