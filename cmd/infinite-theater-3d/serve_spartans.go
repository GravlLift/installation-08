// serve_spartans.go — the match's players' armor route:
// GET /api/matches/{id}/spartans.
//
// The roster comes from the match summary; each player's manifest is read from
// the fetched customization and the shared GameCMS cache. A player whose armor
// cannot be read falls back to the default armor with its reason, individually;
// the response never fails for one player.
package main

import (
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
	writeJSON(w, http.StatusOK, matchSpartans(h.root, id, meta.Players, time.Now()))
}

// matchSpartans reads each roster player's armor; a player that fails gets the
// default armor with their reason, the rest are served.
func matchSpartans(root *store.Root, id string, players []store.Player, now time.Time) armor.Spartans {
	out := armor.Spartans{MatchID: id, Players: make([]armor.Spartan, 0, len(players))}
	for _, p := range players {
		out.Players = append(out.Players, spartanOf(root, id, p, now))
	}
	return out
}

// spartanOf resolves one player's armor from the fetched customization and the
// shared GameCMS cache.
func spartanOf(root *store.Root, id string, p store.Player, now time.Time) armor.Spartan {
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
		WeaponCoatings: weaponCoatingsOf(root, body)}
}

// weaponCoatingsOf reads the equipped weapon cores from the customization and, for each, its
// coating style from the shared cache. A core whose coating file is not read, or that names no
// style, keeps its model key with no style (the view paints it neutral); a core that names no
// weapon model key is skipped. Nil when no equipped core was read.
func weaponCoatingsOf(root *store.Root, body []byte) []armor.WeaponCoating {
	cores, err := haloapi.DecodeWeaponCores(body)
	if err != nil {
		return nil
	}
	var out []armor.WeaponCoating
	for _, c := range cores {
		key, ok := weapons.CoreKey(c.CorePath)
		if !ok {
			continue
		}
		wc := armor.WeaponCoating{CoreID: c.CoreID, ModelKey: key}
		if c.CoatingPath != "" {
			if raw, err := os.ReadFile(gamecmsPath(root, c.CoatingPath)); err == nil {
				if dto, err := haloapi.DecodeWeaponCoating(raw); err == nil && dto.StyleID != nil {
					wc.StyleKey = spartanpieces.Identifier(uint32(*dto.StyleID))
				}
			}
		}
		out = append(out, wc)
	}
	return out
}

func withReason(e armor.Spartan, reason armor.Reason) armor.Spartan {
	e.Status, e.Reason = armor.StatusDefault, reason
	return e
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
