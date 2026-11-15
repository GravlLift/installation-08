package ambience

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"

	"github.com/JGtm/halo-infinite-map-images/himap"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/wwise"
	"github.com/llampwall/infinite-theater-3d/internal/wwvorbis"
)

// Reasons a map gets no bed, the keys of Result.Skipped.
const (
	SkippedNoLevel   = "no_level"      // neither map module holds a level tag
	SkippedNoZones   = "no_zones"      // the level's palette names no background sound
	SkippedNoEvent   = "no_event"      // the looping sound names no play event in its bank
	SkippedNoMedia   = "no_media"      // the play event reaches no Wwise Vorbis media
	SkippedReadError = "read_error"    // a tag or media could not be read (logged)
	SkippedNoModule  = "module_absent" // the map directory has no module
)

// Options says where the game is and where the takes go.
type Options struct {
	// GameRoot is the deploy root (…/Halo Infinite/deploy).
	GameRoot string
	OutDir   string
	// Maps restricts the build to these module keys; empty builds every multiplayer map.
	Maps []string
}

// Result summarizes a build.
type Result struct {
	Manifest *Manifest
	Files    int
	Bytes    int64
	Removed  int
	// Skipped lists, by reason, the map keys left without a bed.
	Skipped map[string][]string
}

// Build extracts every multiplayer map's bed into opts.OutDir and writes the manifest there,
// then removes the take files of an earlier build the manifest does not list. A map that cannot
// be read is skipped and logged, never fatal: one odd map must not cost the others their bed.
func Build(ctx context.Context, opts Options) (*Result, error) {
	if err := os.MkdirAll(opts.OutDir, 0o755); err != nil {
		return nil, err
	}
	keys := opts.Maps
	if len(keys) == 0 {
		var err error
		if keys, err = multiplayerMaps(opts.GameRoot); err != nil {
			return nil, err
		}
	}
	res := &Result{Manifest: &Manifest{Version: ManifestVersion, Maps: map[string]Bed{}}, Skipped: map[string][]string{}}
	b := &builder{root: opts.GameRoot, out: opts.OutDir, res: res,
		streams: &streams{dir: filepath.Join(announcer.SoundRoot(opts.GameRoot), "SFX")}, written: map[uint32]Take{}}
	for _, key := range keys {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		bed, reason, err := b.mapBed(key)
		var wf writeFailure
		switch {
		case errors.As(err, &wf):
			return nil, wf.err
		case err != nil:
			slog.WarnContext(ctx, "ambience: map skipped", "map", key, "err", err)
			reason = SkippedReadError
		}
		if reason != "" {
			res.Skipped[reason] = append(res.Skipped[reason], key)
			continue
		}
		res.Manifest.Maps[key] = bed
	}
	if err := writeManifest(opts.OutDir, res.Manifest); err != nil {
		return nil, err
	}
	var err error
	if res.Removed, err = removeStaleTakes(opts.OutDir, res.Manifest); err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "ambience extracted", "maps", len(res.Manifest.Maps), "files", res.Files, "removed", res.Removed)
	return res, nil
}

// multiplayerMaps lists the module keys under pc/levels/multi, sorted.
func multiplayerMaps(gameRoot string) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(gameRoot, "pc", "levels", "multi"))
	if err != nil {
		return nil, fmt.Errorf("ambience: %w", err)
	}
	var keys []string
	for _, e := range entries {
		if e.IsDir() {
			keys = append(keys, e.Name())
		}
	}
	sort.Strings(keys)
	return keys, nil
}

// writeFailure is an output error: unlike a map that cannot be read, it ends the build.
type writeFailure struct{ err error }

func (w writeFailure) Error() string { return w.err.Error() }

// builder holds what a build keeps across maps: the SFX packages and the media written.
type builder struct {
	root    string
	out     string
	streams *streams
	written map[uint32]Take // by media id
	res     *Result
}

// mapBed reads one map's bed. It returns a skip reason when the map has none, an error when a
// tag cannot be read, and a writeFailure when a take cannot be written.
func (b *builder) mapBed(key string) (Bed, string, error) {
	mod := filepath.Join(b.root, "pc", "levels", "multi", key, key+"-rtx-new.module")
	if _, err := os.Stat(mod); err != nil {
		return Bed{}, SkippedNoModule, nil
	}
	paths, err := himap.GeometrySearchPathMonde(b.root, mod)
	if err != nil {
		return Bed{}, "", err
	}
	anyMod := filepath.Join(b.root, "any", "levels", "multi", key, key+"-rtx-new.module")
	if _, err := os.Stat(anyMod); err == nil {
		paths = append(paths, anyMod)
	}
	ix, err := himap.NewModuleIndex(paths...)
	if err != nil {
		return Bed{}, "", err
	}
	defer func() {
		if err := ix.Close(); err != nil {
			slog.Warn("ambience: closing module index", "map", key, "err", err)
		}
	}()
	level, ok, err := levelTag(ix, mod, anyMod)
	if err != nil || !ok {
		return Bed{}, SkippedNoLevel, err
	}
	zones, err := zoneLoops(level)
	if err != nil {
		return Bed{}, "", err
	}
	loop, distinct, ok := mainLoop(zones)
	if !ok {
		return Bed{}, SkippedNoZones, nil
	}
	takes, reason, err := b.loopTakes(ix, loop)
	if err != nil || reason != "" {
		return Bed{}, reason, err
	}
	return Bed{Loop: fmt.Sprintf("%08x", loop), Zones: len(zones), Beds: distinct, Takes: takes}, "", nil
}

// levelTag returns the parsed level tag of the map: the one the map's own modules hold.
func levelTag(ix *himap.ModuleIndex, modules ...string) (*announcer.Tag, bool, error) {
	own := map[string]bool{}
	for _, m := range modules {
		own[m] = true
	}
	for _, id := range ix.EntreesDuGroupe("levl") {
		if _, module, ok := ix.Lookup(id); !ok || !own[module] {
			continue
		}
		raw, err := ix.Extract(id)
		if err != nil {
			return nil, false, fmt.Errorf("level %08x: %w", id, err)
		}
		t, err := announcer.ParseTag(raw)
		if err != nil {
			return nil, false, fmt.Errorf("level %08x: %w", id, err)
		}
		return t, true, nil
	}
	return nil, false, nil
}

// loopTakes extracts the media a looping sound's play event reaches.
func (b *builder) loopTakes(tags tagSource, loop uint32) ([]Take, string, error) {
	raw, err := tags.Extract(loop)
	if err != nil {
		return nil, "", fmt.Errorf("looping sound %08x: %w", loop, err)
	}
	t, err := announcer.ParseTag(raw)
	if err != nil {
		return nil, "", fmt.Errorf("looping sound %08x: %w", loop, err)
	}
	event, bankTag, ok := loopEvent(t)
	if !ok {
		return nil, SkippedNoEvent, nil
	}
	bank, err := parseBank(tags, bankTag)
	if err != nil {
		return nil, "", err
	}
	var takes []Take
	for _, id := range bank.EventMedia(event) {
		tk, ok, err := b.extract(bank, id)
		if err != nil {
			return nil, "", err
		}
		if ok {
			takes = append(takes, tk)
		}
	}
	if len(takes) == 0 {
		return nil, SkippedNoMedia, nil
	}
	return takes, "", nil
}

// extract writes one media as an Ogg take, once per build; false when it is not Wwise Vorbis.
func (b *builder) extract(bank *wwise.Bank, id uint32) (Take, bool, error) {
	if t, ok := b.written[id]; ok {
		return t, true, nil
	}
	raw, err := b.streams.mediaBytes(bank, id)
	if err != nil {
		return Take{}, false, err
	}
	f, err := wwise.ParseMediaFormat(raw)
	if err != nil || f.Codec != wwise.CodecVorbis {
		return Take{}, false, nil
	}
	s, err := wwvorbis.Repack(raw)
	if err != nil {
		return Take{}, false, fmt.Errorf("media %d: %w", id, err)
	}
	name := takeName(id)
	if err := os.WriteFile(filepath.Join(b.out, name), s.Ogg, 0o644); err != nil {
		return Take{}, false, writeFailure{err}
	}
	b.res.Files++
	b.res.Bytes += int64(len(s.Ogg))
	t := Take{File: name, Media: id, DurationMs: s.DurationMs(), Channels: f.Channels}
	b.written[id] = t
	return t, true, nil
}
