// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_objectives.go — the replay document's mapObjectives, derived when the document is
// served (as LevelUp's replay service does) from the match's map variant and its mode, so
// matches fetched before this field existed get it without a new fetch. The mode-to-role
// table mirrors LevelUp's config/titles/halo_infinite/mappings/objective_roles.toml.
//
// It also holds the served-document pipeline the objectives live in: the document is
// decoded once, every enrichment is applied (objectives, then the weapon steps, in
// LevelUp's GetReplay order), then re-encoded once, and the result is cached per match.

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"sync"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

var modeWords = regexp.MustCompile(`[^a-z0-9]+`)

func objectiveSpecs(mode string) []replay.ObjectiveRoleSpec {
	mode = " " + modeWords.ReplaceAllString(strings.ToLower(mode), " ") + " "
	has := func(s string) bool { return strings.Contains(mode, " "+s+" ") }
	var out []replay.ObjectiveRoleSpec
	add := func(neutral, points bool, roles ...mapvar.Role) {
		for _, role := range roles {
			out = append(out, replay.ObjectiveRoleSpec{Role: role, Neutral: neutral, PointsOnly: points})
		}
	}
	if has("ctf") || has("neutral flag") {
		add(false, true, mapvar.RoleFlagSpawn, mapvar.RoleFlagDelivery)
	}
	if has("strongholds") {
		add(true, false, mapvar.RoleStrongholdZone)
	}
	if has("oddball") {
		add(false, true, mapvar.RoleOddballSpawn)
	}
	if has("stockpile") {
		add(false, true, mapvar.RoleStockpileSocket, mapvar.RoleStockpileNavpoint)
	}
	if has("extraction") {
		add(true, false, mapvar.RoleExtractionZone)
	}
	if has("assault") || has("neutral bomb") || has("one bomb") {
		add(false, true, mapvar.RoleAssaultBomb)
	}
	if has("king of the hill") || has("koth") {
		add(true, false, mapvar.RoleHill)
	}
	if has("land grab") {
		add(true, false, mapvar.RoleLandGrabZone)
	}
	return out
}

// objectiveCatalog derives, from a raw map variant and the match's mode, both the served
// mapObjectives and the zone input the document build bakes live zone states from: one
// derivation, so the served zones and the baked zoneRef indexes share one order.
func objectiveCatalog(raw []byte, mode string) (*replay.MapObjectives, replay.ZoneInput, error) {
	specs := objectiveSpecs(mode)
	if len(specs) == 0 {
		return nil, replay.ZoneInput{}, nil
	}
	variant, err := mapvar.Parse(raw)
	if err != nil {
		return nil, replay.ZoneInput{}, err
	}
	return objectiveCatalogFromVariant(variant, mode, specs)
}

// objectiveCatalogFromVariant is objectiveCatalog over an already parsed variant.
func objectiveCatalogFromVariant(variant *mapvar.Variant, mode string, specs []replay.ObjectiveRoleSpec) (*replay.MapObjectives, replay.ZoneInput, error) {
	entry := replay.MapObjectivesEntry{Objectives: variant.Objectives()}
	objectives := replay.BuildMapObjectives(entry, specs)
	var zone replay.ZoneInput
	for _, spec := range specs {
		if spec.Role != mapvar.RoleHill && spec.Role != mapvar.RoleStrongholdZone {
			continue
		}
		zone.Zones = append(zone.Zones, entry.ZonesOfRole(spec.Role).Zones...)
		if zone.Roles != "" {
			zone.Roles += ","
		}
		zone.Roles += string(spec.Role)
	}
	zone.Hill = decfilm.ObjectiveTypeOf(mode) == decfilm.ObjectiveTypeHill
	return objectives, zone, nil
}

// matchObjectiveCatalog is objectiveCatalog over a stored match's map.mvar and stats.json
// mode; a missing file yields no catalog, never an error.
func matchObjectiveCatalog(root *store.Root, id string) (*replay.MapObjectives, replay.ZoneInput, error) {
	mode, ok, err := matchGameVariantName(root, id)
	if !ok || err != nil {
		return nil, replay.ZoneInput{}, err
	}
	raw, err := os.ReadFile(variantPath(root, id, "map.mvar"))
	if os.IsNotExist(err) {
		return nil, replay.ZoneInput{}, nil
	}
	if err != nil {
		return nil, replay.ZoneInput{}, err
	}
	return objectiveCatalog(raw, mode)
}

// servedReplay is one match's served document and the stamp of the files it was made from.
type servedReplay struct {
	stamp string
	gz    []byte
}

// servedReplays caches each match's served document by its replay file path: applying the
// enrichments decodes and re-encodes the whole document (most of a second), so it runs once
// per change of the replay, the map variant, the stats or the summary, never once per load.
var servedReplays = struct {
	sync.Mutex
	byPath map[string]servedReplay
}{byPath: map[string]servedReplay{}}

// replayWithEnrichments returns the stored gzip document with every served-side enrichment
// applied: mapObjectives, then the weapon steps (pads, tiers, labels, pad-join check), in
// LevelUp's GetReplay order. The document is decoded once and re-encoded once. A failure to
// decode it is logged and serves the stored document raw unchanged.
func replayWithEnrichments(ctx context.Context, root *store.Root, id string, cat weaponsCatalog, raw []byte) []byte {
	key := variantPath(root, id, "replay.json.gz")
	stamp := servedDocInputsStamp(root, id)
	servedReplays.Lock()
	cached, ok := servedReplays.byPath[key]
	servedReplays.Unlock()
	if ok && cached.stamp == stamp {
		return cached.gz
	}
	enriched, err := enrichReplayDocument(ctx, root, id, cat, raw)
	if err != nil {
		slog.WarnContext(ctx, "enrich replay document", "id", id, "err", err)
		return raw
	}
	servedReplays.Lock()
	servedReplays.byPath[key] = servedReplay{stamp: stamp, gz: enriched}
	servedReplays.Unlock()
	return enriched
}

// servedDocInputsStamp names the size and modification time of each file the served
// document is made from; any change to one of them changes the stamp.
func servedDocInputsStamp(root *store.Root, id string) string {
	var b strings.Builder
	for _, name := range []string{"replay.json.gz", "map.mvar", "stats.json", "match.json"} {
		if info, err := os.Stat(variantPath(root, id, name)); err == nil {
			fmt.Fprintf(&b, "%s:%d:%d;", name, info.Size(), info.ModTime().UnixNano())
		}
	}
	return b.String()
}

// enrichReplayDocument is the single decode-enrich-encode pass: the document is read once,
// every enrichment is applied to the struct, then it is written back once. Each enrichment
// is best-effort on its own inputs (an absent field is logged, never an error); the one
// hard failure is a document that does not decode at all.
func enrichReplayDocument(ctx context.Context, root *store.Root, id string, cat weaponsCatalog, raw []byte) ([]byte, error) {
	doc, err := decodeReplayDocument(raw)
	if err != nil {
		return nil, err
	}
	variant, err := matchVariantFor(root, id)
	if err != nil {
		slog.WarnContext(ctx, "read map variant", "id", id, "err", err)
	}
	keys, err := matchKeysFor(root, id)
	if err != nil {
		slog.WarnContext(ctx, "read match keys", "id", id, "err", err)
		keys = matchMapKeys{}
	}

	// The stored document may predate the field and leave it empty: the server names the
	// title it serves, as LevelUp's server does.
	if doc.TitleSlug == "" {
		doc.TitleSlug = "halo_infinite"
	}

	// LevelUp's GetReplay order: objectives, then the weapon steps.
	objectives, err := deriveObjectivesFromVariant(variant, keys.pairName)
	if err != nil {
		slog.WarnContext(ctx, "derive map objectives", "id", id, "err", err)
	} else if objectives != nil {
		doc.MapObjectives = objectives
	}
	doc.MapWeaponPads = mapWeaponPadsFor(ctx, id, keys, variant, doc.WeaponPads)
	doc.WeaponTiers = weaponTiersFor(keys.pairName)
	enrichWeaponLabels(ctx, cat, doc)
	checkWeaponTierJoin(ctx, id, cat, doc)

	return encodeReplayDocument(doc)
}

// matchVariantFor reads and parses the match's map variant; a missing or unparsable file
// returns nil so the steps that need it degrade to absent fields.
func matchVariantFor(root *store.Root, id string) (*mapvar.Variant, error) {
	raw, err := os.ReadFile(variantPath(root, id, "map.mvar"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return mapvar.Parse(raw)
}

// deriveObjectivesFromVariant is matchObjectives over an already-read variant: the mode's
// role specs applied to the variant's objectives; nil variant or no specs yield nil.
func deriveObjectivesFromVariant(variant *mapvar.Variant, mode string) (*replay.MapObjectives, error) {
	if variant == nil {
		return nil, nil
	}
	specs := objectiveSpecs(mode)
	if len(specs) == 0 {
		return nil, nil
	}
	objectives, _, err := objectiveCatalogFromVariant(variant, mode, specs)
	return objectives, err
}

// decodeReplayDocument reads the stored gzip document into its struct form.
func decodeReplayDocument(raw []byte) (*replay.ReplayDocument, error) {
	doc, err := gunzipBytes(raw)
	if err != nil {
		return nil, err
	}
	var out replay.ReplayDocument
	if err = json.Unmarshal(doc, &out); err != nil {
		return nil, fmt.Errorf("invalid replay document: %w", err)
	}
	return &out, nil
}

// encodeReplayDocument writes the document back to the stored form (gzip JSON).
func encodeReplayDocument(doc *replay.ReplayDocument) ([]byte, error) {
	out, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err = gz.Write(out); err != nil {
		return nil, err
	}
	if err = gz.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
