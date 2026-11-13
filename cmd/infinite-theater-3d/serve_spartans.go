// serve_spartans.go — the match's players' armor route:
// GET /api/matches/{id}/spartans.
//
// The roster comes from the match summary; each player's manifest is read from
// the fetched customization and the shared GameCMS cache. A player whose armor
// cannot be read falls back to the default armor with its reason, individually;
// the response never fails for one player.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/armor"
	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

func (h serverHandlers) handleMatchSpartans(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.MatchIDValid(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid match id"})
		return
	}
	meta, err := h.root.MatchMeta(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match_not_found", "id": id})
			return
		}
		slog.Error("match meta", "err", err, "id", id)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, matchSpartans(h.root, id, h.labelCat, meta.Players, time.Now()))
}

// matchSpartans reads each roster player's armor; a player that fails gets the
// default armor with their reason, the rest are served.
func matchSpartans(root *store.Root, id string, labelCat weapons.LabelCatalog, players []store.Player, now time.Time) armor.Spartans {
	out := armor.Spartans{MatchID: id, Players: make([]armor.Spartan, 0, len(players))}
	for _, p := range players {
		out.Players = append(out.Players, spartanOf(root, id, labelCat, p, now))
	}
	return out
}

// spartanOf resolves one player's armor from the fetched customization and the
// shared GameCMS cache.
func spartanOf(root *store.Root, id string, labelCat weapons.LabelCatalog, p store.Player, now time.Time) armor.Spartan {
	e := armor.Spartan{XUID: p.XUID}
	switch {
	case p.IsBot:
		return withReason(e, armor.ReasonBot)
	case !xuidValid(p.XUID):
		return withReason(e, armor.ReasonUnknownPlayer)
	}
	body, err := os.ReadFile(customizationPath(root, id, p.XUID))
	if err != nil {
		return withReason(e, armor.ReasonAPIError)
	}
	c, err := haloapi.DecodeArmorCustomization(body)
	if err != nil {
		return withReason(e, armor.ReasonNoArmor)
	}
	theme, items, err := armorFiles(root, c)
	if err != nil {
		return withReason(e, armor.ReasonAPIError)
	}
	m, err := armor.Assemble(c, armor.Files{Theme: theme, Items: items})
	if err != nil {
		return withReason(e, armor.ReasonAPIError)
	}
	fetched := now
	return armor.Spartan{XUID: p.XUID, Status: armor.StatusArmor, FetchedAt: &fetched, Manifest: &m,
		WeaponCoatings: weaponCoatingsOf(root, body, labelCat)}
}

// weaponCoatingsOf reads the equipped weapon cores from the customization and, for each, its
// model key (the weapon the theme names) and its coating style from the shared cache. A core
// whose equipped theme is not read, or whose weapon name the tables do not know, is left out
// and logged once; a core whose coating file is not read, or that names no style, keeps its
// model key with no style (the view paints it neutral). Nil when no equipped core was read.
func weaponCoatingsOf(root *store.Root, body []byte, labelCat weapons.LabelCatalog) []armor.WeaponCoating {
	cores, err := haloapi.DecodeWeaponCores(body)
	if err != nil {
		return nil
	}
	var out []armor.WeaponCoating
	for _, c := range cores {
		styleKey := ""
		if c.CoatingPath != "" {
			if raw, err := os.ReadFile(gamecmsPath(root, c.CoatingPath)); err == nil {
				if dto, err := haloapi.DecodeWeaponCoating(raw); err == nil && dto.StyleID != nil {
					styleKey = spartanpieces.Identifier(uint32(*dto.StyleID))
				}
			}
		}
		// One entry per model key of the weapon: a weapon with two models (the Bandit and
		// the Bandit Evo, the two Shock Rifles) shares the core's coating, and the replay
		// may hold either.
		for _, key := range weaponModelKeysOf(root, c, labelCat) {
			out = append(out, armor.WeaponCoating{CoreID: c.CoreID, ModelKey: key, StyleKey: styleKey})
		}
	}
	return out
}

// weaponModelKeysOf resolves one equipped core's model keys: its equipped theme file's
// weapon name, through the weapon name tables. A theme that is not read, or a weapon name
// the tables do not know, is logged once and not resolved (nil).
func weaponModelKeysOf(root *store.Root, c haloapi.WeaponThemeDTO, labelCat weapons.LabelCatalog) []string {
	if c.ThemePath == "" {
		return nil
	}
	raw, err := os.ReadFile(gamecmsPath(root, c.ThemePath))
	if err != nil {
		logWeaponCoatMiss(c.CoreID, "theme not in cache", c.ThemePath)
		return nil
	}
	theme, err := haloapi.DecodeWeaponTheme(raw)
	if err != nil {
		logWeaponCoatMiss(c.CoreID, "theme unreadable", c.ThemePath)
		return nil
	}
	keys := labelCat.ModelKeysForWeaponName(theme.WeaponName)
	if keys == nil {
		logWeaponCoatMiss(c.CoreID, "weapon name unknown", theme.WeaponName)
	}
	return keys
}

func withReason(e armor.Spartan, reason armor.Reason) armor.Spartan {
	e.Status, e.Reason = armor.StatusDefault, reason
	return e
}

// weaponCoatMissLogged records the reason a core's coating was left out, so the same
// reason is logged at most once per serve (a roster of 24 unknown names is one line, not
// twenty-four).
var weaponCoatMissLogged = map[string]bool{}

// logWeaponCoatMiss logs one reason a core's weapon model key could not be resolved, once
// per reason per process.
func logWeaponCoatMiss(coreID, reason, detail string) {
	if weaponCoatMissLogged[reason] {
		return
	}
	weaponCoatMissLogged[reason] = true
	slog.WarnContext(context.Background(), "weapon coating left out", "reason", reason, "core", coreID, "detail", detail)
}

// xuidValid says whether xuid is a decimal xuid ("" and bots' non-numeric
// names are not).
func xuidValid(xuid string) bool {
	if xuid == "" {
		return false
	}
	for i := 0; i < len(xuid); i++ {
		if xuid[i] < '0' || xuid[i] > '9' {
			return false
		}
	}
	return true
}

func customizationPath(root *store.Root, id, xuid string) string {
	return filepath.Join(root.MatchesDir(), id, "customization", xuid+".json")
}

// armorFiles reads the theme and item definitions from the shared cache. The
// theme is required; an unreadable item is left unresolved in the manifest,
// not an error.
func armorFiles(root *store.Root, c *haloapi.ArmorCustomizationDTO) (*haloapi.ArmorThemeDTO, map[string]*haloapi.ArmorItemDTO, error) {
	if c.ThemePath == "" {
		return nil, nil, errors.New("no theme path")
	}
	raw, err := os.ReadFile(gamecmsPath(root, c.ThemePath))
	if err != nil {
		return nil, nil, err
	}
	theme, err := haloapi.DecodeArmorTheme(raw)
	if err != nil {
		return nil, nil, err
	}
	items := map[string]*haloapi.ArmorItemDTO{}
	for _, p := range haloapi.ArmorItemPaths(c) {
		raw, err := os.ReadFile(gamecmsPath(root, p))
		if err != nil {
			continue
		}
		item, err := haloapi.DecodeArmorItem(raw)
		if err != nil {
			continue
		}
		items[p] = item
	}
	return theme, items, nil
}
