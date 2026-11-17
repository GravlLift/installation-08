// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Command parity compares, for one match, the replay document and the match context
// served by the standalone server and by LevelUp: every top-level key present on each
// side, array counts, and for mode-specific fields the first entries and value ranges.
// It ignores language-only differences (LevelUp localizes some labels; the standalone
// serves the API vocabulary).
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

func main() {
	ourReplay := flag.String("our-replay", "", "path to the standalone replay document")
	luReplay := flag.String("lu-replay", "", "path to the LevelUp replay document")
	ourContext := flag.String("our-context", "", "path to the standalone context")
	luContext := flag.String("lu-context", "", "path to the LevelUp context")
	flag.Parse()
	for _, pair := range [][2]string{{*ourReplay, *luReplay}, {*ourContext, *luContext}} {
		if pair[0] == "" || pair[1] == "" {
			fatalf("both -our-replay and -lu-replay, or -our-context and -lu-context, are required")
		}
	}
	ourDoc, luDoc := load(*ourReplay), load(*luReplay)
	ourCtx, luCtx := load(*ourContext), load(*luContext)

	ourDocObj, luDocObj := object(ourDoc), object(luDoc)
	ourCtxObj, luCtxObj := object(ourCtx), object(luCtx)
	if ourDocObj == nil || luDocObj == nil || ourCtxObj == nil || luCtxObj == nil {
		fatalf("one of the four payloads is not a JSON object")
	}

	mode := modeFromHeader(object(ourCtxObj["header"]), object(luCtxObj["header"]))
	report := compareSection("replay document", ourDocObj, luDocObj, documentFields(), mode)
	report += compareSection("context", ourCtxObj, luCtxObj, contextFields(), "")
	fmt.Print(report)
}

// documentFields are the top-level document keys inspected for counts and mode-specific
// shapes: the mode-specific fields named in the brief plus the roster and kill layers,
// which both sides must carry identically.
func documentFields() []string {
	return []string{
		"mapObjectives", "objectiveObjects", "skullCarries", "scoreTimeline",
		"flagCarries", "zoneStates", "vipCrown", "bombArmings", "bombStats",
		"roster", "killCauses", "shots", "projectiles", "weaponLabels",
		"objectivePoses", "coverage",
	}
}

// documentModes says which fields a mode-specific document must carry: the objective
// families named in the brief (Oddball, CTF, Strongholds, King of the Hill). The key is
// the mode key the document's context header names (see modeFromHeader).
func documentModes() map[string][]string {
	return map[string][]string{
		"oddball":       {"skullCarries", "scoreTimeline"},
		"ctf":           {"flagCarries", "scoreTimeline"},
		"strongholds":   {"zoneStates", "scoreTimeline"},
		"kingOfTheHill": {"vipCrown", "scoreTimeline"},
		"stockpile":     {"scoreTimeline"},
		"slayer":        {},
	}
}

// modeFromHeader reads the mode the context header names (mode_ui, falling back to
// LevelUp's) and returns its document mode key.
func modeFromHeader(ourHeader, luHeader map[string]any) string {
	for _, h := range []map[string]any{ourHeader, luHeader} {
		if name, ok := h["mode_ui"].(string); ok && name != "" {
			return modeKey(name)
		}
	}
	return ""
}

// contextFields are the context keys inspected: the header fields the brief names and the
// row/event fields that must be present on both sides.
func contextFields() []string {
	return []string{
		"header", "scoreboard", "highlight_events", "media", "regulation_seconds",
	}
}

// sectionBuilder collects the rendered comparison lines of one section.
type sectionBuilder struct {
	lines []string
}

func (b *sectionBuilder) line(format string, args ...any) {
	if len(args) == 0 {
		b.lines = append(b.lines, format)
		return
	}
	b.lines = append(b.lines, fmt.Sprintf(format, args...))
}

func (b *sectionBuilder) linef(format string, args ...any) {
	b.lines = append(b.lines, fmt.Sprintf(format, args...))
}

func (b *sectionBuilder) indentf(format string, args ...any) {
	b.lines = append(b.lines, "  "+fmt.Sprintf(format, args...))
}

func (b *sectionBuilder) String() string {
	return strings.Join(b.lines, "\n") + "\n"
}

// compareSection renders the comparison of one payload pair: per top-level key the state
// (both / ours only / theirs only), array counts, and for the named fields a value shape
// sample.
func compareSection(name string, ours, theirs map[string]any, fields []string, modeKey string) string {
	out := &sectionBuilder{}
	out.linef("== %s ==", name)
	for _, key := range keys(ours, theirs) {
		ov, oursHas := ours[key]
		tv, theirsHas := theirs[key]
		ovObj, tvObj := object(ov), object(tv)
		ovArr, tvArr := array(ov), array(tv)
		if len(fields) > 0 && !inList(fields, key) && ovObj == nil && ovArr == nil {
			out.line(key, state(oursHas, theirsHas))
			continue
		}
		if inList(fields, key) && (ovObj != nil || ovArr != nil) {
			out.linef("%-24s %s", key, state(oursHas, theirsHas))
			if ovArr != nil || tvArr != nil {
				out.indentf("array counts: ours=%d theirs=%d", len(ovArr), len(tvArr))
			}
			switch key {
			case "header":
				out.mapSample(ovObj, tvObj)
			case "scoreboard":
				out.scoreboard(ovArr, tvArr)
			case "highlight_events":
				out.events(ovArr, tvArr)
			case "media":
				out.linef("media items: ours=%d theirs=%d", len(array(object(ov)["media_items"])), len(array(object(tv)["media_items"])))
			default:
				out.valueSample(key, ov, tv, oursHas, theirsHas)
			}
			continue
		}
		out.line(key, state(oursHas, theirsHas))
	}
	if modeKey != "" {
		out.modeChecks(ours, modeKey)
	}
	return out.String()
}

// modeChecks says whether the document carries the objective fields the mode needs and
// samples the mode-specific sub-objects of coverage.
func (b *sectionBuilder) modeChecks(ours map[string]any, key string) {
	b.linef("mode key (from context header): %s", key)
	for _, field := range documentModes()[key] {
		v, ok := ours[field]
		if !ok {
			b.linef("  MISSING for mode %s: %s", key, field)
			continue
		}
		b.linef("  present: %s (%s)", field, sampleEntry(v))
	}
	coverage := object(ours["coverage"])
	if coverage == nil {
		return
	}
	for _, sub := range []string{"skullCarries", "flagCarries", "zoneStates", "vipCrown", "score", "bombStats"} {
		if v, ok := coverage[sub]; ok {
			b.linef("  coverage.%s: %s", sub, sampleEntry(v))
		}
	}
}

func modeKey(mode string) string {
	m := lowerFold(mode)
	for key, name := range map[string]string{
		"oddball":       "odd ball",
		"ctf":           "capture the flag",
		"strongholds":   "strongholds",
		"kingOfTheHill": "king of the hill",
		"stockpile":     "stockpile",
		"slayer":        "slayer",
	} {
		if m == name || containsFold(m, name) {
			return key
		}
	}
	return "slayer"
}

// valueSample prints, for a named document field, the count and the shape of the first
// entries on each side (key names of the first row, or the value type for scalars).
func (b *sectionBuilder) valueSample(key string, ov, tv any, oursHas, theirsHas bool) {
	if ovObj := object(ov); ovObj != nil {
		b.mapSample(ovObj, object(tv))
		return
	}
	if !oursHas && !theirsHas {
		return
	}
	b.indentf("first entries: ours=%s theirs=%s", sampleEntry(ov), sampleEntry(tv))
}

func (b *sectionBuilder) mapSample(ov, tv map[string]any) {
	ourKeys := sortedKeys(ov)
	theirKeys := sortedKeys(tv)
	b.indentf("object keys: ours=%d theirs=%d", len(ov), len(tv))
	onlyOurs := difference(ourKeys, theirKeys)
	onlyTheirs := difference(theirKeys, ourKeys)
	if len(onlyOurs) > 0 {
		b.indentf("  keys only ours: %v", onlyOurs)
	}
	if len(onlyTheirs) > 0 {
		b.indentf("  keys only theirs: %v", onlyTheirs)
	}
	for _, k := range intersection(ourKeys, theirKeys) {
		b.indentf("  %s: ours=%s theirs=%s", k, scalarOrCount(object(ov[k]), array(ov[k])), scalarOrCount(object(tv[k]), array(tv[k])))
	}
}

func (b *sectionBuilder) scoreboard(ov, tv []any) {
	if len(ov) == 0 && len(tv) == 0 {
		b.indentf("scoreboard rows: 0 / 0")
		return
	}
	ourRow, theirRow := firstRow(ov), firstRow(tv)
	b.indentf("scoreboard rows: ours=%d theirs=%d", len(ov), len(tv))
	b.indentf("  row field sets: ours=%d fields theirs=%d fields", len(ourRow), len(theirRow))
	ourKeys := sortedKeys(ourRow)
	theirKeys := sortedKeys(theirRow)
	if only := difference(ourKeys, theirKeys); len(only) > 0 {
		b.indentf("  row fields only ours: %v", only)
	}
	if only := difference(theirKeys, ourKeys); len(only) > 0 {
		b.indentf("  row fields only theirs: %v", only)
	}
	for _, k := range intersection(ourKeys, theirKeys) {
		b.indentf("  row %s: ours=%s theirs=%s", k, shortVal(ourRow[k]), shortVal(theirRow[k]))
	}
}

func (b *sectionBuilder) events(ov, tv []any) {
	b.indentf("highlight_events: ours=%d theirs=%d", len(ov), len(tv))
	ourTypes := eventTypes(ov)
	theirTypes := eventTypes(tv)
	for t := range unionMaps(ourTypes, theirTypes) {
		b.indentf("  type %q: ours=%d theirs=%d", t, ourTypes[t], theirTypes[t])
	}
}

func eventTypes(evs []any) map[string]int {
	counts := map[string]int{}
	for _, v := range evs {
		e := object(v)
		t, _ := e["event_type"].(string)
		counts[t]++
	}
	return counts
}

func firstRow(rows []any) map[string]any {
	if len(rows) == 0 {
		return map[string]any{}
	}
	return object(rows[0])
}

func unionMaps(a, b map[string]int) map[string]int {
	out := map[string]int{}
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		if _, ok := out[k]; !ok {
			out[k] = v
		}
	}
	return out
}

func sampleEntry(v any) string {
	if v == nil {
		return "absent"
	}
	if arr := array(v); arr != nil {
		if len(arr) == 0 {
			return "[] (empty)"
		}
		return fmt.Sprintf("[...%d] first=%s", len(arr), sampleEntry(arr[0]))
	}
	if obj := object(v); obj != nil {
		return fmt.Sprintf("{%d keys: %v...}", len(obj), firstKeys(obj, 6))
	}
	return shortVal(v)
}

func firstKeys(m map[string]any, n int) []string {
	keys := sortedKeys(m)
	if len(keys) > n {
		keys = keys[:n]
	}
	return keys
}

func shortVal(v any) string {
	if v == nil {
		return "absent"
	}
	switch val := v.(type) {
	case string:
		if len(val) > 40 {
			return strconv.Quote(val[:40] + "...")
		}
		return strconv.Quote(val)
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(val)
	case []any:
		return fmt.Sprintf("[%d items]", len(val))
	case map[string]any:
		return fmt.Sprintf("{%d keys}", len(val))
	default:
		return fmt.Sprintf("%T", v)
	}
}

func scalarOrCount(obj map[string]any, arr []any) string {
	if arr != nil {
		return fmt.Sprintf("[%d]", len(arr))
	}
	if obj != nil {
		return fmt.Sprintf("{%d keys}", len(obj))
	}
	return "absent"
}

func keys(a, b map[string]any) []string {
	set := map[string]bool{}
	for k := range a {
		set[k] = true
	}
	if b != nil {
		for k := range b {
			set[k] = true
		}
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func difference(a, b []string) []string {
	set := map[string]bool{}
	for _, k := range b {
		set[k] = true
	}
	var out []string
	for _, k := range a {
		if !set[k] {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

func intersection(a, b []string) []string {
	set := map[string]bool{}
	for _, k := range b {
		set[k] = true
	}
	var out []string
	for _, k := range a {
		if set[k] {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

func inList(list []string, v string) bool {
	for _, item := range list {
		if item == v {
			return true
		}
	}
	return false
}

func state(ours, theirs bool) string {
	switch {
	case ours && theirs:
		return "both"
	case ours:
		return "ours only"
	default:
		return "theirs only"
	}
}

func lowerFold(s string) string {
	return strings.ToLower(s)
}

func containsFold(s, sub string) bool {
	return strings.Contains(strings.ToLower(s), sub)
}

// sortedKeys returns the keys of m in sorted order.
func sortedKeys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func object(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func array(v any) []any {
	a, _ := v.([]any)
	return a
}

func load(path string) any {
	raw, err := os.ReadFile(path)
	if err != nil {
		fatalf("read %s: %v", path, err)
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		fatalf("json %s: %v", path, err)
	}
	return v
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
