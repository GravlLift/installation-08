package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"sync"

	"github.com/JGtm/halo-infinite-film-decoder/killicon"
	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// killIcons picks the icon a kill feed line shows between the two names.
//
// THE GAME'S KILL FEED ATLAS FIRST, FOR EVERY KILL. The killfeed sprites are the
// pictograms the game itself draws in its kill feed, already pointing toward the victim,
// and they cover what the 40-icon contour atlas does not: grenades, melee, vehicles,
// turrets, coils, splatter, falls. Using them for registry weapons too keeps one style
// across the feed, and the client's sound and death-fall tables key off the `killfeed-NN`
// stem of the URL (sound/replaySound.ts KILL_SPRITE_SOUND_STEMS, scene3d/fall3d.ts).
//
// The contour atlas stays as the last resort: a weapon key the bridge maps to no sprite
// but the contour atlas names still gets its icon (the client swaps it for the silhouette
// and mirrors it).
type killIcons struct {
	feed    map[string]string // killfeed-NN stem -> file, from the built index.json
	contour map[string]string // weapon key -> contour file, from the built index.json
}

// url is the icon URL of a kill, or "" when nothing names its source.
func (ic killIcons) url(d build.KillDetail) string {
	if file, ok := ic.feed[d.KillfeedSprite]; ok && d.KillfeedSprite != "" {
		return weaponIconURLPrefix + file
	}
	// A kill-details.json written before the build stored the sprite still knows the
	// weapon key: the killicon rules give its sprite.
	if sprite := killfeedSpriteOfWeaponKey()[d.WeaponKey]; sprite != "" {
		if file, ok := ic.feed[sprite]; ok {
			return weaponIconURLPrefix + file
		}
	}
	if file, ok := ic.contour[d.WeaponKey]; ok && d.WeaponKey != "" {
		return weaponIconURLPrefix + file
	}
	return ""
}

// killfeedSpriteOfWeaponKey inverts the killicon rules: weapon key -> kill feed sprite.
// Every rule of one key names the same sprite (Energy Sword, Shock Rifle); the first wins.
var killfeedSpriteOfWeaponKey = sync.OnceValue(func() map[string]string {
	out := map[string]string{}
	for _, r := range killicon.Rules() {
		if r.WeaponKey != "" && out[r.WeaponKey] == "" {
			out[r.WeaponKey] = r.Sprite
		}
	}
	return out
})

// legacyRefreshed records the matches whose kill details this process already tried to
// refresh, so a film that cannot be decoded is tried once, not on every request.
var legacyRefreshed sync.Map

// refreshLegacyKillDetails re-decodes the kill feed of a match whose kill-details.json
// predates the killfeed_sprite field, and stores the result. Such a file cannot tell a
// melee kill from a fall (neither has a weapon key), so without this every one of those
// kills keeps an empty gap until the match is rebuilt. The kill decode alone takes about
// two seconds and runs once per match; any failure keeps the stored details as they are.
func refreshLegacyKillDetails(root *store.Root, id string, details []build.KillDetail) []build.KillDetail {
	for _, d := range details {
		if d.KillfeedSprite != "" {
			return details
		}
	}
	if _, done := legacyRefreshed.LoadOrStore(id, true); done {
		return details
	}
	chunkDir, err := root.MatchChunksDir(id)
	if err != nil {
		return details
	}
	if _, err := os.Stat(chunkDir); err != nil {
		return details
	}
	meta, err := root.MatchMeta(id)
	if err != nil || meta.MapName == "" {
		return details
	}
	fresh, err := build.DecodeKillDetails(context.Background(), build.Input{
		ChunkDir:     chunkDir,
		ManifestPath: optionalPath(root.MatchManifestPath(id)),
		MatchID:      id,
		MapName:      meta.MapName,
		MatchMap:     storedMapLink(root, id),
	})
	if err != nil || len(fresh) == 0 {
		slog.Info("kill details refresh skipped, serving the stored details", "match_id", id, "err", err)
		return details
	}
	raw, err := json.Marshal(fresh)
	if err == nil {
		err = root.WriteFile(variantPath(root, id, "kill-details.json"), raw)
	}
	if err != nil {
		slog.Warn("kill details refreshed but not stored", "match_id", id, "err", err)
	} else {
		slog.Info("kill details refreshed with kill feed sprites", "match_id", id, "kills", len(fresh))
	}
	return fresh
}
