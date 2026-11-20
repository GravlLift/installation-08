// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weapons

// index.go defines the model-key vocabulary of the weapon library and the index.json the view
// reads, under the same names and JSON fields LevelUp's server writes (so the lifted view needs
// no change). A model key is either a weapon's `weap` tag family or an equipment object's `eqip`
// GlobalID (8 lowercase hex digits), a grenade projectile rank (grenade0, grenade1, ...), or the
// Spartan body (spartan).

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// KeySpartan is the model key of the Spartan body.
const KeySpartan = "spartan"

// KeyPrefixGrenade prefixes a grenade projectile's model key with its rank.
const KeyPrefixGrenade = "grenade"

// WeaponKey resolves a weapon identifier from a replay document to its model key: the `weap`
// tag family, 8 lowercase hex digits, read from the head of a 0x-prefixed 8- or 16-hex id or a
// bare 8-hex id. Falsy for any other identifier (a power-up family is not a weapon). This is the
// server-side mirror of the view's weaponModelKey and of LevelUp's meshproto.CleArme.
func WeaponKey(id string) (string, bool) {
	hex := strings.TrimPrefix(strings.TrimPrefix(id, "0x"), "0X")
	if (len(hex) != 8 && len(hex) != 16) || (hex == id && len(hex) != 8) {
		return "", false
	}
	for i := 0; i < len(hex); i++ {
		c := hex[i]
		switch {
		case c >= '0' && c <= '9', c >= 'a' && c <= 'f', c >= 'A' && c <= 'F':
		default:
			return "", false
		}
	}
	return strings.ToLower(hex[:8]), true
}

// GrenadeKey is a grenade projectile's model key, for its rank.
func GrenadeKey(rank int) string { return KeyPrefixGrenade + strconv.Itoa(rank) }

// RankOfGrenade is a grenade model key's rank, false for any other key.
func RankOfGrenade(key string) (int, bool) {
	if !strings.HasPrefix(key, KeyPrefixGrenade) {
		return 0, false
	}
	r, err := strconv.Atoi(strings.TrimPrefix(key, KeyPrefixGrenade))
	if err != nil || r < 0 || GrenadeKey(r) != key {
		return 0, false
	}
	return r, true
}

// ModelKeyValid says whether key is a well-formed library model key: a weapon family, a grenade
// rank, or the Spartan.
func ModelKeyValid(key string) bool {
	if key == KeySpartan {
		return true
	}
	if _, ok := RankOfGrenade(key); ok {
		return true
	}
	_, ok := WeaponKey(key)
	return ok
}

// FileOf is the library file name of a model key: the key plus .glb.
func FileOf(key string) string { return key + ".glb" }

// Index is the weapons/index.json the view reads: the schema marker, the generator tag, and the
// model keys in key order.
type Index struct {
	Schema    int    `json:"schema"`
	Generator string `json:"generator"`
	// EkurStamp: the digest of the Ekur export this build read (spartanpieces.EkurStamp),
	// "" when the build ran without an export: the server compares it with the current
	// export and rebuilds the library when the two differ.
	EkurStamp  string   `json:"ekur_stamp"`
	WeapKeys   []string `json:"weapons"`
	SpartanKey string   `json:"spartan"`
	// Coatings: the coating table of the library (coatings.json), nil when the
	// build had no Ekur reference: the weapons then stay in their neutral paint.
	Coatings *spartanpieces.CoatingsIndex `json:"coatings,omitempty"`
	// ReticleRanges: per weapon model key, the red-reticle range and the per-level zoom
	// magnifications read from its `weap` tag (reticle.go). A weapon absent from it has no range
	// and no magnification: its reticle never turns red and it does not zoom. Always written,
	// empty included: an index without the field predates it and is stale.
	ReticleRanges map[string]ReticleRange `json:"reticle_ranges"`
	// Banners: per weapon model key, the team banner its model carries (banners.go). Always
	// written, empty included: an index without the field predates it and is stale.
	Banners map[string]Banner `json:"banners"`
	// IdleEffects: per weapon model key, the particle effects its model carries while held
	// (idle_effects.go: the Shock Rifle's electricity). Always written, empty included: an index
	// without the field predates it and is stale.
	IdleEffects map[string][]IdleEffect `json:"idle_effects"`
	// ShotEffects: what a weapon's shot plays (shot_effects.go: the Shock Rifle's firing, flight and
	// impact effects), and the effects themselves with their fx-* files; null when not read.
	ShotEffects *ShotTable `json:"shot_effects"`
	// ShieldHit: the Spartan shield's impact generator (shield_hit.go), its parameters and the
	// fx-* textures it samples; null when the game holds no readable one (the view draws no hit).
	ShieldHit *ShieldGenerator `json:"shield_hit"`
	// Equipment: per equipment family of the title's manifest whose pad items share one model, the
	// model key of that model (equipment.go), for the items a power-up or equipment pad publishes
	// by family. Always written, empty included: an index without the field predates it and is
	// stale.
	Equipment map[string]string `json:"equipment"`
	// EquipmentRule: the rule the Equipment table was derived by (EquipmentRuleCurrent). An index
	// written by an older rule (absent: 0) lacks families the current one maps, and is stale.
	EquipmentRule int `json:"equipment_rule"`
}

// EquipmentRuleCurrent is the current Equipment rule: 2 maps a family named by several pickup
// objects (two grapples, two walls) when their models are the same; 1 (unrecorded) mapped only a
// family named by a single object.
const EquipmentRuleCurrent = 2

// SchemaCurrent is the current library index schema. Bumped when the build output changes
// (the models the library holds), so a library built by an older version of the app is
// outdated and rebuilt by the normal build flow; an index without a schema (built before
// schema versioning) is outdated. 3: the energy shader's self-light (the Sentinel Beam's energy
// parts) is read from its declared emissive_intensity and its tint map. 4: the weapons' idle
// particle effects (idle_effects, the Shock Rifle's electricity) and their fx-* files. 5: the idle
// effects' weapon functions carry their mapping (the Heatwave's `fx_camo_off` is 1 - camo).
// 6: vehicle models and the Spartan's vehicle-seat animations. 7: the Spartan shield's impact
// generator (shield_hit) and its fx-* textures. 8: the models carry the game's vertex normals
// (himap geometry_normales.go), so the view shades them smooth instead of faceted. 9: the shield
// generator's function properties carry their curves (the hit's intensity and radius over the time
// since the impact). 10: the weapons' shot effects (shot_effects: the Shock Rifle's firing, flight
// and impact effects, its projectile's speed and range) and their fx-* files; a particle property
// may be a periodic function (himap effet_arme.go), so idle effects gain the systems it had left out.
const SchemaCurrent = 10

// NewIndex builds the library index for the built model keys (weapon families only; the Spartan
// is always present by its fixed key).
func NewIndex(weaponKeys []string, generator string) Index {
	return Index{Schema: SchemaCurrent, Generator: generator, WeapKeys: weaponKeys, SpartanKey: KeySpartan,
		ReticleRanges: map[string]ReticleRange{}, Banners: map[string]Banner{}, Equipment: map[string]string{},
		IdleEffects: map[string][]IdleEffect{}, EquipmentRule: EquipmentRuleCurrent}
}

// IndexCurrent says whether a library index.json carries every field the view reads from it: the
// red-reticle table, each entry with its per-level magnifications, the team banners and the
// equipment families by the current rule, at the current schema. A library built before one of
// them existed (an older schema, or no schema at all) is stale (its rebuild adds it); a reticle
// table without entries (no readable weapons) carries nothing more and is current.
func IndexCurrent(raw []byte) bool {
	var idx struct {
		Schema        int `json:"schema"`
		ReticleRanges *map[string]struct {
			Magnifications json.RawMessage `json:"magnifications"`
		} `json:"reticle_ranges"`
		Banners       *map[string]json.RawMessage `json:"banners"`
		IdleEffects   *map[string]json.RawMessage `json:"idle_effects"`
		Equipment     *map[string]string          `json:"equipment"`
		EquipmentRule int                         `json:"equipment_rule"`
	}
	if err := json.Unmarshal(raw, &idx); err != nil || idx.ReticleRanges == nil || idx.Banners == nil || idx.Equipment == nil ||
		idx.IdleEffects == nil {
		return false // a field was never written (a library older than it)
	}
	if idx.Schema < SchemaCurrent {
		return false // built by an older version (or before schemas existed)
	}
	if idx.EquipmentRule < EquipmentRuleCurrent {
		return false // the equipment table was derived by an older rule
	}
	for _, r := range *idx.ReticleRanges {
		if len(r.Magnifications) == 0 || string(r.Magnifications) == "null" {
			return false
		}
	}
	return true
}
