package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
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

func deriveObjectives(raw []byte, mode string) (*replay.MapObjectives, error) {
	specs := objectiveSpecs(mode)
	if len(specs) == 0 {
		return nil, nil
	}
	variant, err := mapvar.Parse(raw)
	if err != nil {
		return nil, err
	}
	return objectivesFromVariant(variant, specs), nil
}

func matchObjectives(root *store.Root, id string) (*replay.MapObjectives, error) {
	stats, err := os.ReadFile(variantPath(root, id, "stats.json"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var facts struct {
		GameVariantName string `json:"gameVariantName"`
	}
	if err = json.Unmarshal(stats, &facts); err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(variantPath(root, id, "map.mvar"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return deriveObjectives(raw, facts.GameVariantName)
}

func enrichReplay(raw []byte, objectives *replay.MapObjectives) ([]byte, error) {
	if objectives == nil {
		return raw, nil
	}
	doc, err := gunzipBytes(raw)
	if err != nil {
		return nil, err
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(doc, &fields); err != nil || fields == nil {
		return nil, fmt.Errorf("invalid replay document: %v", err)
	}
	fields["mapObjectives"], err = json.Marshal(objectives)
	if err != nil {
		return nil, err
	}
	doc, err = json.Marshal(fields)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err = gz.Write(doc); err != nil {
		return nil, err
	}
	if err = gz.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func objectivesFromVariant(variant *mapvar.Variant, specs []replay.ObjectiveRoleSpec) *replay.MapObjectives {
	return replay.BuildMapObjectives(replay.MapObjectivesEntry{Objectives: variant.Objectives()}, specs)
}
