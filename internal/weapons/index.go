package weapons

// index.go defines the model-key vocabulary of the weapon library and the index.json the view
// reads, under the same names and JSON fields LevelUp's server writes (so the lifted view needs
// no change). A model key is either a weapon's `weap` tag family (8 lowercase hex digits), a
// grenade projectile rank (grenade0, grenade1, ...), or the Spartan body (spartan).

import (
	"path/filepath"
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

// CoreKey is the model key of a weapon core's inventory path: the hex family at the tail of
// the path's base name ("Cores/Weapon/209-200-olympus-aa30213b.json" is "aa30213b"); false
// when it does not name a weapon key.
func CoreKey(corePath string) (string, bool) {
	base := strings.TrimSuffix(filepath.Base(corePath), ".json")
	if i := strings.LastIndex(base, "-"); i >= 0 {
		base = base[i+1:]
	}
	return WeaponKey(base)
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
	Schema     int      `json:"schema"`
	Generator  string   `json:"generator"`
	WeapKeys   []string `json:"weapons"`
	SpartanKey string   `json:"spartan"`
	// Coatings: the coating table of the library (coatings.json), nil when the
	// build had no Ekur reference: the weapons then stay in their neutral paint.
	Coatings *spartanpieces.CoatingsIndex `json:"coatings,omitempty"`
}

// NewIndex builds the library index for the built model keys (weapon families only; the Spartan
// is always present by its fixed key).
func NewIndex(weaponKeys []string, generator string) Index {
	return Index{Schema: 1, Generator: generator, WeapKeys: weaponKeys, SpartanKey: KeySpartan}
}
