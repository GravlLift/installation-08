package footstepsounds

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"

	"github.com/JGtm/halo-infinite-map-images/himap"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/soundtags"
	"github.com/llampwall/infinite-theater-3d/internal/wwise"
	"github.com/llampwall/infinite-theater-3d/internal/wwvorbis"
)

// Reasons a table entry gets no takes, counted in Result.Silent.
const (
	SilentNoEvent     = "no_event"            // the sound tag has no third-person event
	SkippedNotRandom  = "event_not_container" // the event targets no media container
	SkippedNotVorbis  = "media_not_vorbis"    // a media is not Wwise Vorbis
	SkippedTagMissing = "tag_missing"         // the tag is not in the module index
)

// mediaContainers are the HIRC target types that carry takes: a sound, a random sequence, and
// the layer and switch containers the landing sounds are built from (a landing is a single blip,
// so any of the container's media is a fine take for the replay).
var mediaContainers = map[byte]bool{
	wwise.HircSound:     true,
	wwise.HircRandomSeq: true,
	wwise.HircLayer:     true,
	wwise.HircSwitch:    true,
}

// Options says where the game is and where the takes go.
type Options struct {
	// GameRoot is the deploy root; Module a map module whose index covers the game's globals
	// (firstperson.ResolveModule).
	GameRoot, Module string
	OutDir           string
}

// Result summarizes a build.
type Result struct {
	Manifest *Manifest
	Files    int
	Bytes    int64
	Removed  int
	// Silent lists, by reason, the table names (8 hex digits for a missing tag id, the table
	// name otherwise) left without takes.
	Silent map[string][]string
}

// builder holds what one build reads: the tag index, the media and what it wrote.
type builder struct {
	tags    soundtags.TagSource
	media   *soundtags.Media
	out     string
	parsed  map[uint32]*announcer.Tag
	takes   map[uint32][]Take // by sound tag id
	written map[uint32]Take   // by media id: a media two sounds share is written once
	res     *Result
}

// Build extracts every foot and movement sound in tags.go into opts.OutDir and writes the
// manifest there, then removes the take files of an earlier build the manifest does not list.
func Build(ctx context.Context, opts Options) (*Result, error) {
	if err := os.MkdirAll(opts.OutDir, 0o755); err != nil {
		return nil, err
	}
	paths, err := himap.GeometrySearchPathMonde(opts.GameRoot, opts.Module)
	if err != nil {
		return nil, fmt.Errorf("footstepsounds: %w", err)
	}
	ix, err := himap.NewModuleIndex(paths...)
	if err != nil {
		return nil, fmt.Errorf("footstepsounds: %w", err)
	}
	defer closeLogged(ctx, "module index", ix.Close)
	res := &Result{Manifest: &Manifest{Version: ManifestVersion, Feet: map[string]map[string]Footstep{}, Movement: map[string]Footstep{}}, Silent: map[string][]string{}}
	b := &builder{tags: ix, media: soundtags.NewMedia(ix, opts.GameRoot), out: opts.OutDir,
		parsed: map[uint32]*announcer.Tag{}, takes: map[uint32][]Take{}, written: map[uint32]Take{}, res: res}
	surfaces := make([]string, 0, len(feetIDs))
	for surface := range feetIDs {
		surfaces = append(surfaces, surface)
	}
	sort.Strings(surfaces)
	for _, surface := range surfaces {
		actions := feetIDs[surface]
		for _, action := range sortedActions(actions) {
			takes, err := b.soundTakes(tagID(feetIDs[surface][action]))
			if err != nil {
				return nil, err
			}
			if res.Manifest.Feet[surface] == nil {
				res.Manifest.Feet[surface] = map[string]Footstep{}
			}
			res.Manifest.Feet[surface][action] = Footstep{Takes: takes}
		}
	}
	for _, action := range sortedMovement() {
		takes, err := b.soundTakes(tagID(movementIDs[action]))
		if err != nil {
			return nil, err
		}
		res.Manifest.Movement[action] = Footstep{Takes: takes}
	}
	if err := writeManifest(opts.OutDir, res.Manifest); err != nil {
		return nil, err
	}
	if res.Removed, err = removeStaleTakes(opts.OutDir, res.Manifest); err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "foot step sounds extracted", "surfaces", len(res.Manifest.Feet), "movement", len(res.Manifest.Movement), "files", res.Files, "removed", res.Removed)
	return res, nil
}

// sortedActions lists a surface's actions in order.
func sortedActions(actions map[string]uint32) []string {
	var out []string
	for action := range actions {
		out = append(out, action)
	}
	sort.Strings(out)
	return out
}

// sortedMovement lists the movement sounds in order.
func sortedMovement() []string {
	var out []string
	for action := range movementIDs {
		out = append(out, action)
	}
	sort.Strings(out)
	return out
}

// soundTakes returns the takes of a sound tag's third-person event, extracting each media once.
func (b *builder) soundTakes(id uint32) ([]Take, error) {
	if t, ok := b.takes[id]; ok {
		return t, nil
	}
	tag, err := b.tag(id)
	if err != nil {
		b.res.Silent[SkippedTagMissing] = append(b.res.Silent[SkippedTagMissing], fmt.Sprintf("%08x", id))
		return nil, nil
	}
	b.takes[id] = nil
	event, bankTag, ok := soundtags.Event(tag)
	if !ok {
		b.res.Silent[SilentNoEvent] = append(b.res.Silent[SilentNoEvent], fmt.Sprintf("%08x", id))
		return nil, nil
	}
	bk, err := b.media.Bank(bankTag)
	if err != nil {
		return nil, err
	}
	for _, typ := range b.media.EventTargetTypes(bk, event) {
		if !mediaContainers[typ] {
			b.res.Silent[SkippedNotRandom] = append(b.res.Silent[SkippedNotRandom], fmt.Sprintf("%08x", id))
			return nil, nil
		}
	}
	var takes []Take
	for _, id := range b.media.EventMedia(bk, event) {
		t, ok, err := b.extract(bk, id)
		if err != nil {
			return nil, err
		}
		if ok {
			takes = append(takes, t)
		}
	}
	b.takes[id] = takes
	return takes, nil
}

// extract writes one media as an Ogg take; false (and recorded) when it is not Wwise Vorbis.
func (b *builder) extract(bk *wwise.Bank, id uint32) (Take, bool, error) {
	if t, ok := b.written[id]; ok {
		return t, true, nil
	}
	raw, err := b.media.Bytes(bk, id)
	if err != nil {
		return Take{}, false, err
	}
	if f, err := wwise.ParseMediaFormat(raw); err != nil || f.Codec != wwise.CodecVorbis {
		b.res.Silent[SkippedNotVorbis] = append(b.res.Silent[SkippedNotVorbis], fmt.Sprintf("%d", id))
		return Take{}, false, nil
	}
	s, err := wwvorbis.Repack(raw)
	if err != nil {
		return Take{}, false, fmt.Errorf("media %d: %w", id, err)
	}
	name := takeName(id)
	if err := os.WriteFile(filepath.Join(b.out, name), s.Ogg, 0o644); err != nil {
		return Take{}, false, err
	}
	b.res.Files++
	b.res.Bytes += int64(len(s.Ogg))
	t := Take{File: name, Media: id, DurationMs: s.DurationMs()}
	b.written[id] = t
	return t, true, nil
}

// tag reads and parses a tag once.
func (b *builder) tag(id uint32) (*announcer.Tag, error) {
	if t, ok := b.parsed[id]; ok {
		return t, nil
	}
	raw, err := b.tags.Extract(id)
	if err != nil {
		return nil, fmt.Errorf("tag %08x: %w", id, err)
	}
	t, err := announcer.ParseTag(raw)
	if err != nil {
		return nil, fmt.Errorf("tag %08x: %w", id, err)
	}
	b.parsed[id] = t
	return t, nil
}

// closeLogged closes a resource at the end of a build and logs a failure.
func closeLogged(ctx context.Context, what string, closeFn func() error) {
	if err := closeFn(); err != nil {
		slog.WarnContext(ctx, "footstepsounds: closing "+what, "err", err)
	}
}
